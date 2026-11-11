// Постановка сообщений о новом, перенесённом и отменённом событии в очередь
// `event_announcements` (спека event_announcements, решения Василия 11.11.2026).
//
// Вызывается из ручек событий после COMMIT. Ошибка здесь не роняет запрос:
// каждая функция ловит её сама, пишет в лог и возвращается. Если рассылка
// выключена на сервере (`EVENT_ANNOUNCEMENTS_ENABLED` не `1`), строки не
// пишутся вовсе — включение позже не выплеснет накопленное.
//
// Правила (раздел спеки «Когда строка появляется»):
//   - новое событие → CREATED / EVENT; новая серия → одна CREATED / SERIES;
//   - перенос (время или место): есть ожидающая CREATED — новой строки нет,
//     она уйдёт с актуальными данными, а её срок пересчитывается от нового
//     начала (через 3 минуты после последней правки, ночное правило — от
//     нового времени; для серии — от ближайшего не начавшегося занятия); есть
//     ожидающая RESCHEDULED — «было» остаётся прежним, сдвигается срок; иначе
//     RESCHEDULED с «было»;
//   - удаление: есть ожидающая CREATED — она SKIPPED, отмены нет; есть
//     ожидающая RESCHEDULED — она SKIPPED и пишется CANCELLED; иначе CANCELLED;
//   - событие уже началось или в прошлом — строк нет.

import { query } from "../../db/pool.js";
import { logger } from "../../lib/logger.js";
import { localIsoWeekday } from "../../lib/notification-messages.js";
import { ANNOUNCEMENT_RULES, announcementDueAt } from "../../lib/notification-schedule.js";

export function isEventAnnouncementsEnabled(): boolean {
  const raw = String(process.env.EVENT_ANNOUNCEMENTS_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function announcementsDelaySeconds(): number {
  const raw = String(process.env.EVENT_ANNOUNCEMENTS_DELAY_SECONDS ?? "").trim();
  const seconds = raw === "" ? ANNOUNCEMENT_RULES.delaySeconds : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : ANNOUNCEMENT_RULES.delaySeconds;
}

type Kind = "CREATED" | "RESCHEDULED" | "CANCELLED";

async function teamTimezone(teamId: string): Promise<string | null> {
  const result = await query<{ timezone: string | null }>(`SELECT timezone FROM teams WHERE id = $1`, [teamId]);
  return result.rows[0]?.timezone ?? null;
}

async function due(teamId: string, startAt: Date, now: Date) {
  return announcementDueAt(now, startAt, await teamTimezone(teamId), announcementsDelaySeconds());
}

/** Ожидающая строка вида `kind` для события (scope EVENT) или для серии (scope SERIES). */
async function findPending(kind: Kind, target: { eventId: string } | { seriesId: string }): Promise<string | null> {
  const result =
    "eventId" in target
      ? await query<{ id: string }>(
          `SELECT id FROM event_announcements WHERE status = 'PENDING' AND scope = 'EVENT' AND kind = $1 AND event_id = $2 LIMIT 1`,
          [kind, target.eventId]
        )
      : await query<{ id: string }>(
          `SELECT id FROM event_announcements WHERE status = 'PENDING' AND scope = 'SERIES' AND kind = $1 AND series_id = $2 LIMIT 1`,
          [kind, target.seriesId]
        );
  return result.rows[0]?.id ?? null;
}

async function markSkipped(id: string, reason: string) {
  await query(
    `UPDATE event_announcements SET status = 'SKIPPED', skip_reason = $2, updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
    [id, reason]
  );
}

async function insertRow(row: {
  teamId: string;
  eventId: string;
  seriesId: string | null;
  kind: Kind;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  dueAt: Date;
}) {
  const scope = row.seriesId ? "SERIES" : "EVENT";
  const conflict =
    scope === "SERIES"
      ? `ON CONFLICT (series_id, kind) WHERE status = 'PENDING' AND scope = 'SERIES' DO NOTHING`
      : `ON CONFLICT (event_id, kind) WHERE status = 'PENDING' AND scope = 'EVENT' DO NOTHING`;
  await query(
    `INSERT INTO event_announcements (team_id, event_id, series_id, scope, kind, actor_user_id, payload, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ${conflict}`,
    [row.teamId, row.eventId, row.seriesId, scope, row.kind, row.actorUserId, JSON.stringify(row.payload), row.dueAt]
  );
}

/** Сдвинуть срок ожидающей строки, «было» в ней не трогать. */
async function shiftPending(id: string, dueAt: Date, silent: boolean) {
  await query(
    `UPDATE event_announcements
        SET due_at = $2, payload = payload || jsonb_build_object('silent', $3::boolean), updated_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [id, dueAt, silent]
  );
}

async function guarded(name: string, context: Record<string, unknown>, fn: () => Promise<void>) {
  if (!isEventAnnouncementsEnabled()) return;
  try {
    await fn();
  } catch (error) {
    logger.error("announcements.enqueue_failed", {
      step: name,
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Ожидающее сообщение о новой серии: пересчитать срок от ближайшего ещё не
 * начавшегося занятия серии (после правки). Занятий не осталось — срок не
 * трогаем: при отправке строка станет SKIPPED.
 */
async function shiftPendingSeriesCreated(id: string, teamId: string, seriesId: string, now: Date) {
  const next = await query<{ start_at: Date }>(
    `SELECT start_at FROM events WHERE series_id = $1 AND is_cancelled = FALSE AND start_at > $2 ORDER BY start_at LIMIT 1`,
    [seriesId, now]
  );
  const start = next.rows[0]?.start_at;
  if (!start) return;
  const { dueAt, silent } = await due(teamId, new Date(start), now);
  await shiftPending(id, dueAt, silent);
}

function sameLocation(a: string | null | undefined, b: string | null | undefined) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/** Новое одиночное событие. */
export function announceEventCreated(params: { teamId: string; eventId: string; startAt: Date; actorUserId: string | null; now?: Date }) {
  return guarded("event.created", { eventId: params.eventId }, async () => {
    const now = params.now ?? new Date();
    if (params.startAt.getTime() <= now.getTime()) return;
    const { dueAt, silent } = await due(params.teamId, params.startAt, now);
    await insertRow({ ...params, seriesId: null, kind: "CREATED", payload: { silent }, dueAt });
  });
}

/** Новая серия: одна строка на всю серию, событие — первое занятие. */
export function announceSeriesCreated(params: {
  teamId: string;
  seriesId: string;
  firstEventId: string;
  starts: Date[];
  untilDate: string;
  actorUserId: string | null;
  now?: Date;
}) {
  return guarded("series.created", { seriesId: params.seriesId }, async () => {
    const now = params.now ?? new Date();
    const upcoming = params.starts.filter((s) => s.getTime() > now.getTime());
    if (!upcoming.length) return;
    const tz = await teamTimezone(params.teamId);
    const { dueAt, silent } = announcementDueAt(now, upcoming[0], tz, announcementsDelaySeconds());
    await insertRow({
      teamId: params.teamId,
      eventId: params.firstEventId,
      seriesId: params.seriesId,
      kind: "CREATED",
      actorUserId: params.actorUserId,
      payload: {
        silent,
        count: params.starts.length,
        weekdays: [...new Set(params.starts.map((s) => localIsoWeekday(s, tz)))].sort((a, b) => a - b),
        untilDate: params.untilDate,
      },
      dueAt,
    });
  });
}

/** Правка одного события: перенос времени или места. */
export function announceEventChanged(params: {
  teamId: string;
  eventId: string;
  seriesId: string | null;
  before: { startAt: Date; location: string | null };
  after: { startAt: Date; location: string | null };
  actorUserId: string | null;
  now?: Date;
}) {
  return guarded("event.changed", { eventId: params.eventId }, async () => {
    const now = params.now ?? new Date();
    const timeChanged = params.before.startAt.getTime() !== params.after.startAt.getTime();
    if (!timeChanged && sameLocation(params.before.location, params.after.location)) return;
    if (params.before.startAt.getTime() <= now.getTime() || params.after.startAt.getTime() <= now.getTime()) return;

    const { dueAt, silent } = await due(params.teamId, params.after.startAt, now);

    // Сообщение о новом событии ещё не ушло — уйдёт с новыми данными. Срок
    // считается заново от нового начала: событие, перенесённое ночью на утро,
    // не должно ждать 09:00 и пропасть как «уже началось».
    const created = await findPending("CREATED", { eventId: params.eventId });
    if (created) {
      await shiftPending(created, dueAt, silent);
      return;
    }
    if (params.seriesId) {
      const seriesCreated = await findPending("CREATED", { seriesId: params.seriesId });
      if (seriesCreated) {
        await shiftPendingSeriesCreated(seriesCreated, params.teamId, params.seriesId, now);
        return;
      }
    }

    const pending = await findPending("RESCHEDULED", { eventId: params.eventId });
    if (pending) {
      await shiftPending(pending, dueAt, silent);
      return;
    }
    await insertRow({
      teamId: params.teamId,
      eventId: params.eventId,
      seriesId: null,
      kind: "RESCHEDULED",
      actorUserId: params.actorUserId,
      payload: {
        silent,
        previousStartAt: params.before.startAt.toISOString(),
        previousLocation: params.before.location,
      },
      dueAt,
    });
  });
}

/** Правка «это и все следующие» у серии: одна строка на серию. */
export function announceSeriesChanged(params: {
  teamId: string;
  seriesId: string;
  anchorEventId: string;
  /** Затронутые занятия до правки. */
  beforeStarts: Date[];
  before: { startAt: Date; location: string | null };
  after: { startAt: Date; location: string | null };
  actorUserId: string | null;
  now?: Date;
}) {
  return guarded("series.changed", { seriesId: params.seriesId }, async () => {
    const now = params.now ?? new Date();
    const timeChanged = params.before.startAt.getTime() !== params.after.startAt.getTime();
    if (!timeChanged && sameLocation(params.before.location, params.after.location)) return;
    if (params.before.startAt.getTime() <= now.getTime() || params.after.startAt.getTime() <= now.getTime()) return;

    const seriesCreated = await findPending("CREATED", { seriesId: params.seriesId });
    if (seriesCreated) {
      await shiftPendingSeriesCreated(seriesCreated, params.teamId, params.seriesId, now);
      return;
    }

    const tz = await teamTimezone(params.teamId);
    const { dueAt, silent } = announcementDueAt(now, params.after.startAt, tz, announcementsDelaySeconds());
    const pending = await findPending("RESCHEDULED", { seriesId: params.seriesId });
    if (pending) {
      await shiftPending(pending, dueAt, silent);
      return;
    }
    await insertRow({
      teamId: params.teamId,
      eventId: params.anchorEventId,
      seriesId: params.seriesId,
      kind: "RESCHEDULED",
      actorUserId: params.actorUserId,
      payload: {
        silent,
        previousStartAt: params.before.startAt.toISOString(),
        previousLocation: params.before.location,
        previousWeekdays: [...new Set(params.beforeStarts.map((s) => localIsoWeekday(s, tz)))].sort((a, b) => a - b),
      },
      dueAt,
    });
  });
}

/** Удаление одного события. */
export function announceEventCancelled(params: {
  teamId: string;
  eventId: string;
  seriesId: string | null;
  title: string;
  startAt: Date;
  location: string | null;
  actorUserId: string | null;
  now?: Date;
}) {
  return guarded("event.cancelled", { eventId: params.eventId }, async () => {
    const now = params.now ?? new Date();
    if (params.startAt.getTime() <= now.getTime()) return;

    const created = await findPending("CREATED", { eventId: params.eventId });
    if (created) {
      await markSkipped(created, "EVENT_DELETED");
      return;
    }
    // Сообщение о новой серии ещё не ушло: людям не говорили об этом занятии,
    // отменять нечего. Сообщение о серии при отправке перечитает занятия.
    if (params.seriesId && (await findPending("CREATED", { seriesId: params.seriesId }))) return;

    const rescheduled = await findPending("RESCHEDULED", { eventId: params.eventId });
    if (rescheduled) await markSkipped(rescheduled, "EVENT_DELETED");

    const { dueAt, silent } = await due(params.teamId, params.startAt, now);
    await insertRow({
      teamId: params.teamId,
      eventId: params.eventId,
      seriesId: null,
      kind: "CANCELLED",
      actorUserId: params.actorUserId,
      payload: { silent, title: params.title, startAt: params.startAt.toISOString(), location: params.location },
      dueAt,
    });
  });
}

/** Удаление «это и все следующие» у серии: одна строка на серию. */
export function announceSeriesCancelled(params: {
  teamId: string;
  seriesId: string;
  anchorEventId: string;
  title: string;
  startAt: Date;
  location: string | null;
  count: number;
  actorUserId: string | null;
  now?: Date;
}) {
  return guarded("series.cancelled", { seriesId: params.seriesId }, async () => {
    const now = params.now ?? new Date();
    if (params.count <= 0 || params.startAt.getTime() <= now.getTime()) return;

    const created = await findPending("CREATED", { seriesId: params.seriesId });
    if (created) {
      // Остались занятия до удалённых — сообщение о серии уйдёт про них; не осталось — не уйдёт.
      const left = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM events WHERE series_id = $1 AND is_cancelled = FALSE AND start_at > $2`,
        [params.seriesId, now]
      );
      if (!left.rows[0]?.n) await markSkipped(created, "SERIES_DELETED");
      return;
    }
    const rescheduled = await findPending("RESCHEDULED", { seriesId: params.seriesId });
    if (rescheduled) await markSkipped(rescheduled, "SERIES_DELETED");

    const { dueAt, silent } = await due(params.teamId, params.startAt, now);
    await insertRow({
      teamId: params.teamId,
      eventId: params.anchorEventId,
      seriesId: params.seriesId,
      kind: "CANCELLED",
      actorUserId: params.actorUserId,
      payload: {
        silent,
        title: params.title,
        startAt: params.startAt.toISOString(),
        location: params.location,
        count: params.count,
      },
      dueAt,
    });
  });
}
