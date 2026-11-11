// Авто-напоминания о явке (трек 2 ревизии, решение Василия 10.11.2026, п. 8):
// неответившим накануне в 19:00 и утром в день события, по поясу команды.
//
// Чем запускается. Очередь pg-boss в проде может быть выключена
// (`NOTIFICATIONS_QUEUE_ENABLED`), поэтому авто-напоминания от неё не
// зависят: таймер в процессе API раз в несколько минут смотрит, каким
// событиям «пора» (окна — `lib/notification-schedule.ts`). Дубли исключает
// база, а не таймер: перед отправкой вставляется строка в
// `event_auto_reminders` с уникальным ключом (событие, человек, слот+дата);
// не вставилась — уже отправлено, пропускаем. Поэтому повторная проверка,
// перезапуск сервера и даже два процесса сразу не шлют одно и то же дважды.
// Цена — «не больше одного раза»: если отправка упала, повтора нет, строка
// остаётся с ошибкой и видна капитану.
//
// Включение: `AUTO_REMINDERS_ENABLED=1`. Выключено по умолчанию, чтобы
// автоматические сообщения людям не пошли с первым же выкатом сами.

import { query } from "../../db/pool.js";
import { logger } from "../../lib/logger.js";
import {
  classifyTelegramSendError,
  dispatchNotification,
  eventUrlFor,
  resolvePushSubscriptionsByUsers,
} from "../../lib/notification-dispatch.js";
import { buildEventRsvpMessage } from "../../lib/notification-messages.js";
import { dueAutoReminder, type DueAutoReminder } from "../../lib/notification-schedule.js";

export function isAutoRemindersEnabled(): boolean {
  const raw = String(process.env.AUTO_REMINDERS_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function autoRemindersIntervalMs(): number {
  const seconds = Number(process.env.AUTO_REMINDERS_INTERVAL_SECONDS ?? 300);
  return Math.max(10, Number.isFinite(seconds) ? seconds : 300) * 1000;
}

type CandidateEvent = {
  id: string;
  team_id: string;
  title: string;
  start_at: Date;
  location: string | null;
  location_url: string | null;
  series_id: string | null;
  team_name: string;
  short_code: string | null;
  timezone: string | null;
};

type Recipient = {
  user_id: string;
  telegram_id: string | null;
  rsvp_status: "PENDING" | null;
};

export type AutoReminderTickResult = {
  events: number;
  claimed: number;
  sent: number;
  failed: number;
  noChannel: number;
};

/** События, которым напоминание может быть «пора»: не отменены, начинаются в ближайшие двое суток. */
async function loadCandidateEvents(now: Date): Promise<CandidateEvent[]> {
  const result = await query<CandidateEvent>(
    `SELECT e.id,
            e.team_id,
            e.title,
            e.start_at,
            e.location,
            (SELECT sp.yandex_url FROM saved_places sp
               WHERE lower(sp.name) = lower(e.location)
                 AND (sp.team_id = e.team_id OR sp.team_id IS NULL)
               ORDER BY (sp.team_id = e.team_id) DESC NULLS LAST
               LIMIT 1) AS location_url,
            e.series_id::text AS series_id,
            t.name AS team_name,
            t.short_code,
            t.timezone
       FROM events e
       JOIN teams t ON t.id = e.team_id
      WHERE e.is_cancelled = FALSE
        AND e.start_at > $1
        AND e.start_at < $1 + INTERVAL '48 hours'
      ORDER BY e.start_at ASC`,
    [now]
  );
  return result.rows;
}

/**
 * Кому напоминать: участники команды без ответа («молчат» — нет ответа или
 * «думаю»; согласие на серию считается ответом «иду»), кто не отключил
 * авто-напоминания и кому это напоминание ещё не уходило. Запасным
 * (`team_memberships.status = 'RESERVE'`) авто-напоминания не уходят
 * (решение Василия 11.11.2026); в травме и в отпуске — уходят. Ручное
 * «Напомнить» капитана запасных по-прежнему зовёт.
 */
async function loadRecipients(event: CandidateEvent, slotKey: string): Promise<Recipient[]> {
  const result = await query<Recipient>(
    `SELECT tm.user_id,
            u.telegram_id::text AS telegram_id,
            r.status::text AS rsvp_status
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
       LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
       LEFT JOIN event_series_commitment c
         ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
       LEFT JOIN user_notification_settings s ON s.user_id = tm.user_id
      WHERE tm.team_id = $2
        AND tm.status <> 'RESERVE'
        AND (r.status = 'PENDING' OR (r.status IS NULL AND c.id IS NULL))
        AND COALESCE(s.auto_event_reminders, TRUE)
        AND NOT EXISTS (
          SELECT 1 FROM event_auto_reminders a
           WHERE a.event_id = $1 AND a.user_id = tm.user_id AND a.slot_key = $4
        )`,
    [event.id, event.team_id, event.series_id, slotKey]
  );
  return result.rows;
}

/** Занять отправку. false — эту строку уже вставил кто-то раньше. */
async function claim(event: CandidateEvent, userId: string, due: DueAutoReminder): Promise<string | null> {
  const result = await query<{ id: string }>(
    `INSERT INTO event_auto_reminders (event_id, team_id, user_id, slot, slot_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id, user_id, slot_key) DO NOTHING
     RETURNING id`,
    [event.id, event.team_id, userId, due.slot, due.slotKey]
  );
  return result.rows[0]?.id ?? null;
}

async function settle(
  id: string,
  outcome: { status: "SENT" | "QUEUED" | "FAILED" | "NO_CHANNEL"; channel?: string | null; errorCode?: string | null; errorDetail?: string | null }
) {
  await query(
    `UPDATE event_auto_reminders
        SET status = $2, channel = $3, error_code = $4, error_detail = $5, updated_at = now()
      WHERE id = $1`,
    [id, outcome.status, outcome.channel ?? null, outcome.errorCode ?? null, outcome.errorDetail?.slice(0, 500) ?? null]
  );
}

/** Одна проверка: всем событиям, которым «пора», — напоминания тем, кто молчит. */
export async function runAutoReminderTick(now: Date = new Date()): Promise<AutoReminderTickResult> {
  const totals: AutoReminderTickResult = { events: 0, claimed: 0, sent: 0, failed: 0, noChannel: 0 };
  const events = await loadCandidateEvents(now);
  for (const event of events) {
    const due = dueAutoReminder(new Date(event.start_at), event.timezone, now);
    if (!due) continue;
    totals.events += 1;
    const recipients = await loadRecipients(event, due.slotKey);
    if (recipients.length === 0) continue;
    const pushByUser = await resolvePushSubscriptionsByUsers(recipients.map((r) => r.user_id));
    const team = { shortCode: event.short_code, teamId: event.team_id };
    const eventUrl = eventUrlFor(team, event.id);

    for (const recipient of recipients) {
      const claimId = await claim(event, recipient.user_id, due);
      if (!claimId) continue;
      totals.claimed += 1;
      const pushSubscriptions = pushByUser.get(recipient.user_id) ?? [];
      if (!recipient.telegram_id && pushSubscriptions.length === 0) {
        totals.noChannel += 1;
        await settle(claimId, { status: "NO_CHANNEL", errorCode: "NO_CHANNEL" });
        continue;
      }
      const message = buildEventRsvpMessage({
        card: {
          eventId: event.id,
          title: event.title,
          startAt: event.start_at,
          location: event.location,
          locationUrl: event.location_url,
          teamName: event.team_name,
          timezone: event.timezone,
        },
        kind: due.slot,
        state: recipient.rsvp_status === "PENDING" ? "PENDING" : "UNANSWERED",
        eventUrl,
      });
      try {
        const { mode } = await dispatchNotification({
          chatId: recipient.telegram_id,
          pushSubscriptions,
          message,
          type: "EVENT_AUTO_REMINDER",
          recipientUserId: recipient.user_id,
          teamId: event.team_id,
          eventId: event.id,
          eventStartAt: event.start_at,
        });
        totals.sent += 1;
        await settle(claimId, {
          status: mode === "QUEUE" ? "QUEUED" : "SENT",
          channel: mode === "PUSH" ? "WEBPUSH" : "TELEGRAM",
        });
      } catch (error) {
        totals.failed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        await settle(claimId, { status: "FAILED", channel: "TELEGRAM", errorCode: classifyTelegramSendError(reason), errorDetail: reason });
      }
    }
  }
  if (totals.claimed > 0) logger.info("reminders.auto.tick", { ...totals });
  return totals;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function safeTick() {
  if (running) return;
  running = true;
  try {
    await runAutoReminderTick();
  } catch (error) {
    logger.error("reminders.auto.tick_failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}

/** Запуск из `server.ts`. Без `AUTO_REMINDERS_ENABLED=1` ничего не делает. */
export function startAutoReminders(): boolean {
  if (timer || !isAutoRemindersEnabled()) return false;
  const interval = autoRemindersIntervalMs();
  timer = setInterval(() => void safeTick(), interval);
  timer.unref();
  // Первая проверка — вскоре после старта: окно могло открыться, пока сервер лежал.
  setTimeout(() => void safeTick(), 15_000).unref();
  logger.info("reminders.auto.started", { intervalSeconds: interval / 1000 });
  return true;
}

export function stopAutoReminders() {
  if (timer) clearInterval(timer);
  timer = null;
}
