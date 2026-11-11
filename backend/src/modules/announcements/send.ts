// Отправка сообщений о новом, перенесённом и отменённом событии из очереди
// `event_announcements` (спека event_announcements, решения Василия 11.11.2026).
//
// Таймер в процессе API по образцу авто-напоминаний (`modules/reminders/auto.ts`),
// от очереди pg-boss не зависит. Строки берутся атомарно (FOR UPDATE SKIP
// LOCKED, статус SENDING) и уходят не больше одного раза: упала отправка
// человеку — в журнале доставки ошибка, повтора нет.
//
// Перед отправкой состояние читается заново: сообщение о новом событии,
// которое уже удалили, не уходит; перенос, после которого время и место
// вернули как было, не уходит; о начавшемся событии не пишем.
//
// Включение: `EVENT_ANNOUNCEMENTS_ENABLED=1`, шаг — `EVENT_ANNOUNCEMENTS_INTERVAL_SECONDS`.

import { randomUUID } from "node:crypto";
import { query } from "../../db/pool.js";
import { logger } from "../../lib/logger.js";
import {
  calendarUrlFor,
  classifyTelegramSendError,
  dispatchNotification,
  eventUrlFor,
  resolvePushSubscriptionsByUsers,
  type OutgoingMessage,
} from "../../lib/notification-dispatch.js";
import {
  buildEventCancelledMessage,
  buildEventCreatedMessage,
  buildEventRescheduledMessage,
  buildSeriesCancelledMessage,
  buildSeriesCreatedMessage,
  buildSeriesRescheduledMessage,
  type RsvpState,
} from "../../lib/notification-messages.js";
import { autoReminderWindows } from "../../lib/notification-schedule.js";
import { resolveEffectiveRsvp } from "../../lib/series-commitment.js";
import { receivesAnnouncement, type AnnouncementKind, type AnnouncementScope } from "./audience.js";
import { isEventAnnouncementsEnabled } from "./enqueue.js";

export function announcementsIntervalMs(): number {
  const raw = String(process.env.EVENT_ANNOUNCEMENTS_INTERVAL_SECONDS ?? "").trim();
  const seconds = raw === "" ? 30 : Number(raw);
  return Math.max(5, Number.isFinite(seconds) ? seconds : 30) * 1000;
}

/** Авто-напоминание по событию не уйдёт, если его окно открыто сейчас или откроется в ближайшие столько. */
const SUPPRESS_AUTO_WITHIN_MS = 2 * 60 * 60 * 1000;
const CLAIM_LIMIT = 50;

type AnnouncementRow = {
  id: string;
  team_id: string;
  event_id: string;
  series_id: string | null;
  scope: AnnouncementScope;
  kind: AnnouncementKind;
  actor_user_id: string | null;
  payload: Record<string, any>;
  due_at: Date;
};

type EventRow = {
  id: string;
  team_id: string;
  series_id: string | null;
  title: string;
  start_at: Date;
  location: string | null;
  location_url: string | null;
  is_cancelled: boolean;
  team_name: string;
  short_code: string | null;
  timezone: string | null;
};

type Member = {
  user_id: string;
  telegram_id: string | null;
  member_status: string;
  rsvp_status: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  committed: boolean;
  auto_on: boolean;
};

export type AnnouncementTickResult = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  recipients: number;
};

async function claimDue(now: Date): Promise<AnnouncementRow[]> {
  const result = await query<AnnouncementRow>(
    `UPDATE event_announcements a
        SET status = 'SENDING', updated_at = now()
      WHERE a.id IN (
        SELECT id FROM event_announcements
         WHERE status = 'PENDING' AND due_at <= $1
         ORDER BY due_at
         LIMIT ${CLAIM_LIMIT}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING a.id, a.team_id, a.event_id, a.series_id::text AS series_id, a.scope, a.kind,
                a.actor_user_id, a.payload, a.due_at`,
    [now]
  );
  return result.rows;
}

async function finish(id: string, status: "SENT" | "SKIPPED" | "FAILED", extra: { reason?: string | null; batchId?: string | null } = {}) {
  await query(
    `UPDATE event_announcements
        SET status = $2, skip_reason = $3, batch_id = $4, updated_at = now(),
            sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE sent_at END
      WHERE id = $1`,
    [id, status, extra.reason?.slice(0, 500) ?? null, extra.batchId ?? null]
  );
}

async function loadEvent(eventId: string): Promise<EventRow | null> {
  const result = await query<EventRow>(
    `SELECT e.id, e.team_id, e.series_id::text AS series_id, e.title, e.start_at, e.location,
            (SELECT sp.yandex_url FROM saved_places sp
               WHERE lower(sp.name) = lower(e.location)
                 AND (sp.team_id = e.team_id OR sp.team_id IS NULL)
               ORDER BY (sp.team_id = e.team_id) DESC NULLS LAST
               LIMIT 1) AS location_url,
            e.is_cancelled, t.name AS team_name, t.short_code, t.timezone
       FROM events e
       JOIN teams t ON t.id = e.team_id
      WHERE e.id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

/** Занятия серии, которые ещё не начались и не отменены; `from` — не раньше этого момента. */
async function upcomingOccurrences(seriesId: string, now: Date, from?: Date): Promise<Array<{ id: string; start_at: Date }>> {
  const result = await query<{ id: string; start_at: Date }>(
    `SELECT id, start_at FROM events
      WHERE series_id = $1 AND is_cancelled = FALSE AND start_at > $2 AND ($3::timestamptz IS NULL OR start_at >= $3)
      ORDER BY start_at`,
    [seriesId, now, from ?? null]
  );
  return result.rows;
}

/** Активные участники команды, кроме того, кто сделал действие. */
async function loadMembers(row: AnnouncementRow, eventId: string, seriesId: string | null): Promise<Member[]> {
  const result = await query<Member>(
    `SELECT tm.user_id,
            u.telegram_id::text AS telegram_id,
            tm.status::text AS member_status,
            r.status::text AS rsvp_status,
            (c.id IS NOT NULL) AS committed,
            COALESCE(s.auto_event_reminders, TRUE) AS auto_on
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
       LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
       LEFT JOIN event_series_commitment c
         ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
       LEFT JOIN user_notification_settings s ON s.user_id = tm.user_id
      WHERE tm.team_id = $2
        AND tm.user_id IS DISTINCT FROM $4::uuid
      ORDER BY u.name`,
    [eventId, row.team_id, seriesId, row.actor_user_id]
  );
  return result.rows;
}

type Plan =
  | { skip: string }
  | {
      /** Событие, к которому относятся ответ человека, журнал и окна авто-напоминаний. */
      event: EventRow;
      seriesId: string | null;
      /** Начало этого события — для окон авто-напоминаний. */
      startAt: Date;
      build: (state: RsvpState) => OutgoingMessage;
      eventStartAtForPush: Date;
      eventIdForPush?: string;
    };

function sameLocation(a: unknown, b: unknown) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

async function plan(row: AnnouncementRow, now: Date): Promise<Plan> {
  const event = await loadEvent(row.event_id);
  if (!event) return { skip: "EVENT_NOT_FOUND" };
  const team = { shortCode: event.short_code, teamId: event.team_id };
  const eventUrl = eventUrlFor(team, event.id);
  const card = {
    eventId: event.id,
    title: event.title,
    startAt: new Date(event.start_at).toISOString(),
    location: event.location,
    locationUrl: event.location_url,
    teamName: event.team_name,
    timezone: event.timezone,
  };
  const started = new Date(event.start_at).getTime() <= now.getTime();
  const p = row.payload ?? {};

  if (row.scope === "EVENT") {
    if (row.kind === "CREATED") {
      if (event.is_cancelled) return { skip: "EVENT_CANCELLED" };
      if (started) return { skip: "EVENT_STARTED" };
      return {
        event,
        seriesId: event.series_id,
        startAt: new Date(event.start_at),
        eventStartAtForPush: new Date(event.start_at),
        eventIdForPush: event.id,
        build: (state) =>
          buildEventCreatedMessage({ card, state: state === "PENDING" ? "PENDING" : "UNANSWERED", eventUrl }),
      };
    }
    if (row.kind === "RESCHEDULED") {
      if (event.is_cancelled) return { skip: "EVENT_CANCELLED" };
      if (started) return { skip: "EVENT_STARTED" };
      const previousStart = p.previousStartAt ? new Date(p.previousStartAt) : null;
      if (
        previousStart &&
        previousStart.getTime() === new Date(event.start_at).getTime() &&
        sameLocation(p.previousLocation, event.location)
      ) {
        return { skip: "UNCHANGED" };
      }
      return {
        event,
        seriesId: event.series_id,
        startAt: new Date(event.start_at),
        eventStartAtForPush: new Date(event.start_at),
        eventIdForPush: event.id,
        build: (state) =>
          buildEventRescheduledMessage({
            card,
            previous: { startAt: previousStart ?? event.start_at, location: p.previousLocation ?? null },
            state,
            eventUrl,
          }),
      };
    }
    // CANCELLED
    const cancelledStart = p.startAt ? new Date(p.startAt) : new Date(event.start_at);
    if (!event.is_cancelled) return { skip: "EVENT_NOT_CANCELLED" };
    if (cancelledStart.getTime() <= now.getTime()) return { skip: "EVENT_STARTED" };
    const calendarUrl = calendarUrlFor(team);
    return {
      event,
      seriesId: event.series_id,
      startAt: cancelledStart,
      eventStartAtForPush: cancelledStart,
      build: () =>
        buildEventCancelledMessage({
          card: { eventId: event.id, title: p.title ?? event.title, startAt: cancelledStart, teamName: event.team_name, timezone: event.timezone },
          calendarUrl,
        }),
    };
  }

  // Серия.
  const seriesId = row.series_id!;
  if (row.kind === "CREATED") {
    const occurrences = await upcomingOccurrences(seriesId, now);
    if (!occurrences.length) return { skip: "NOTHING_LEFT" };
    const first = (await loadEvent(occurrences[0].id)) ?? event;
    const firstUrl = eventUrlFor(team, first.id);
    return {
      event: first,
      seriesId,
      startAt: new Date(first.start_at),
      eventStartAtForPush: new Date(first.start_at),
      build: () =>
        buildSeriesCreatedMessage({
          seriesId,
          teamName: first.team_name,
          title: first.title,
          location: first.location,
          locationUrl: first.location_url,
          timezone: first.timezone,
          starts: occurrences.map((o) => o.start_at),
          openUrl: firstUrl,
        }),
    };
  }
  if (row.kind === "RESCHEDULED") {
    if (event.is_cancelled) return { skip: "EVENT_CANCELLED" };
    if (started) return { skip: "EVENT_STARTED" };
    const previousStart = p.previousStartAt ? new Date(p.previousStartAt) : new Date(event.start_at);
    if (previousStart.getTime() === new Date(event.start_at).getTime() && sameLocation(p.previousLocation, event.location)) {
      return { skip: "UNCHANGED" };
    }
    const occurrences = await upcomingOccurrences(seriesId, now, new Date(event.start_at));
    if (!occurrences.length) return { skip: "NOTHING_LEFT" };
    return {
      event,
      seriesId,
      startAt: new Date(event.start_at),
      eventStartAtForPush: new Date(event.start_at),
      build: () =>
        buildSeriesRescheduledMessage({
          teamName: event.team_name,
          title: event.title,
          location: event.location,
          locationUrl: event.location_url,
          timezone: event.timezone,
          starts: occurrences.map((o) => o.start_at),
          previous: {
            startAt: previousStart,
            location: p.previousLocation ?? null,
            weekdays: Array.isArray(p.previousWeekdays) ? p.previousWeekdays : [],
          },
          openUrl: eventUrl,
          tag: `series-${seriesId}`,
        }),
    };
  }
  // CANCELLED / SERIES
  const fromStart = p.startAt ? new Date(p.startAt) : new Date(event.start_at);
  if (fromStart.getTime() <= now.getTime()) return { skip: "EVENT_STARTED" };
  const calendarUrl = calendarUrlFor(team);
  return {
    event,
    seriesId,
    startAt: fromStart,
    eventStartAtForPush: fromStart,
    build: () =>
      buildSeriesCancelledMessage({
        teamName: event.team_name,
        title: p.title ?? event.title,
        timezone: event.timezone,
        fromStartAt: fromStart,
        count: Number(p.count) || 1,
        calendarUrl,
        tag: `series-${seriesId}`,
      }),
  };
}

/**
 * Не два сообщения подряд: человеку только что ушло «новое событие» или
 * «перенос» — авто-напоминание, чьё окно открыто сейчас или откроется в
 * ближайшие 2 часа, ему не уйдёт. Строка слота вставляется как уже
 * отправленная; `channel = 'ANNOUNCEMENT'` отличает её от настоящего
 * напоминания на экране «Кому дошло».
 */
async function suppressAutoReminders(event: EventRow, startAt: Date, userIds: string[], now: Date) {
  if (!userIds.length) return;
  const horizon = now.getTime() + SUPPRESS_AUTO_WITHIN_MS;
  for (const window of autoReminderWindows(startAt, event.timezone)) {
    const openNow = now.getTime() >= window.windowStart.getTime() && now.getTime() < window.windowEnd.getTime();
    const opensSoon = window.windowStart.getTime() > now.getTime() && window.windowStart.getTime() <= horizon;
    if (!openNow && !opensSoon) continue;
    await query(
      `INSERT INTO event_auto_reminders (event_id, team_id, user_id, slot, slot_key, status, channel)
       SELECT $1, $2, u, $3, $4, 'SENT', 'ANNOUNCEMENT' FROM unnest($5::uuid[]) AS u
       ON CONFLICT (event_id, user_id, slot_key) DO NOTHING`,
      [event.id, event.team_id, window.slot, window.slotKey, userIds]
    );
  }
}

async function processRow(row: AnnouncementRow, now: Date, totals: AnnouncementTickResult) {
  const decided = await plan(row, now);
  if ("skip" in decided) {
    totals.skipped += 1;
    await finish(row.id, "SKIPPED", { reason: decided.skip });
    return;
  }

  const members = await loadMembers(row, decided.event.id, decided.seriesId);
  const hasSeries = Boolean(decided.seriesId);
  const recipients = members
    .map((m) => ({
      ...m,
      state: resolveEffectiveRsvp({ explicit: m.rsvp_status, hasSeries, committedToSeries: m.committed }),
    }))
    .filter((m) =>
      receivesAnnouncement(row.kind, row.scope, {
        memberStatus: m.member_status,
        state: m.state,
        committedToSeries: m.committed,
        autoRemindersOn: m.auto_on,
      })
    );
  if (!recipients.length) {
    totals.skipped += 1;
    await finish(row.id, "SKIPPED", { reason: "NO_RECIPIENTS" });
    return;
  }

  const batchId = randomUUID();
  const pushByUser = await resolvePushSubscriptionsByUsers(recipients.map((r) => r.user_id));
  const silent = Boolean(row.payload?.silent);
  const reached: string[] = [];

  for (const recipient of recipients) {
    const pushSubscriptions = pushByUser.get(recipient.user_id) ?? [];
    let status: "SENT" | "QUEUED" | "FAILED";
    let channel: string;
    let errorCode: string | null = null;
    let errorDetail: string | null = null;
    if (!recipient.telegram_id && pushSubscriptions.length === 0) {
      status = "FAILED";
      channel = "NONE";
      errorCode = "NO_CHANNEL";
    } else {
      try {
        const { mode } = await dispatchNotification({
          chatId: recipient.telegram_id,
          pushSubscriptions,
          message: decided.build(recipient.state as RsvpState),
          type: "EVENT_ANNOUNCEMENT",
          actorUserId: row.actor_user_id,
          recipientUserId: recipient.user_id,
          teamId: row.team_id,
          eventId: decided.eventIdForPush,
          eventStartAt: decided.eventStartAtForPush,
          silent,
        });
        status = mode === "QUEUE" ? "QUEUED" : "SENT";
        channel = mode === "PUSH" ? "WEBPUSH" : "TELEGRAM";
        reached.push(recipient.user_id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        status = "FAILED";
        channel = "TELEGRAM";
        errorCode = classifyTelegramSendError(reason);
        errorDetail = reason.slice(0, 500);
      }
    }
    if (status === "FAILED") totals.failed += 1;
    totals.recipients += 1;
    try {
      await query(
        `INSERT INTO notification_deliveries (team_id, event_id, user_id, kind, channel, status, error_code, error_detail, batch_id)
         VALUES ($1, $2, $3, 'EVENT_ANNOUNCEMENT', $4, $5, $6, $7, $8)`,
        [row.team_id, decided.event.id, recipient.user_id, channel, status, errorCode, errorDetail, batchId]
      );
    } catch (error) {
      logger.error("announcements.delivery_log_failed", { id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (row.kind !== "CANCELLED") {
    try {
      await suppressAutoReminders(decided.event, decided.startAt, reached, now);
    } catch (error) {
      logger.error("announcements.suppress_failed", { id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  totals.sent += 1;
  await finish(row.id, "SENT", { batchId });
}

/** Одна проверка: всё, чему подошёл срок, — разослать. */
export async function runEventAnnouncementTick(now: Date = new Date()): Promise<AnnouncementTickResult> {
  const totals: AnnouncementTickResult = { claimed: 0, sent: 0, skipped: 0, failed: 0, recipients: 0 };
  for (let round = 0; round < 10; round += 1) {
    const rows = await claimDue(now);
    totals.claimed += rows.length;
    for (const row of rows) {
      try {
        await processRow(row, now, totals);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error("announcements.row_failed", { id: row.id, error: reason });
        await finish(row.id, "FAILED", { reason }).catch(() => {});
      }
    }
    if (rows.length < CLAIM_LIMIT) break;
  }
  if (totals.claimed > 0) logger.info("announcements.tick", { ...totals });
  return totals;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function safeTick() {
  if (running) return;
  running = true;
  try {
    await runEventAnnouncementTick();
  } catch (error) {
    logger.error("announcements.tick_failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}

/** Запуск из `server.ts`. Без `EVENT_ANNOUNCEMENTS_ENABLED=1` ничего не делает. */
export function startEventAnnouncements(): boolean {
  if (timer || !isEventAnnouncementsEnabled()) return false;
  const interval = announcementsIntervalMs();
  timer = setInterval(() => void safeTick(), interval);
  timer.unref();
  setTimeout(() => void safeTick(), 5_000).unref();
  logger.info("announcements.started", { intervalSeconds: interval / 1000 });
  return true;
}

export function stopEventAnnouncements() {
  if (timer) clearInterval(timer);
  timer = null;
}
