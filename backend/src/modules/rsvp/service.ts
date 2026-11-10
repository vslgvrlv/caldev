// Запись ответа «Иду / Не иду» не из приложения: кнопка бота и кнопка пуша
// (трек 2 ревизии). Права проверяются здесь, в одном месте: ответ пишется
// только за того, кто нажал, только участнику команды события, только пока
// событие не отменено и не началось. После начала молчун остаётся «молчит»
// (решение Василия 10.11.2026, п. 8).

import { query } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";

export type RsvpAnswerStatus = "CONFIRMED" | "DECLINED";
export type RsvpAnswerSource = "telegram" | "push";

export type RsvpEventInfo = {
  id: string;
  teamId: string;
  title: string;
  startAt: string;
  location: string | null;
  locationUrl: string | null;
  teamName: string;
  teamShortCode: string | null;
  timezone: string | null;
};

export type RsvpAnswerResult =
  | { ok: true; previous: "PENDING" | "CONFIRMED" | "DECLINED" | null; status: RsvpAnswerStatus; event: RsvpEventInfo }
  | { ok: false; reason: "EVENT_NOT_FOUND" }
  | { ok: false; reason: "NOT_MEMBER" | "CANCELLED" | "STARTED"; event: RsvpEventInfo };

type EventRow = {
  id: string;
  team_id: string;
  title: string;
  start_at: Date;
  location: string | null;
  location_url: string | null;
  is_cancelled: boolean;
  team_name: string;
  short_code: string | null;
  timezone: string | null;
  is_member: boolean;
  previous: "PENDING" | "CONFIRMED" | "DECLINED" | null;
};

export async function loadRsvpEvent(eventId: string, userId: string | null): Promise<(RsvpEventInfo & {
  isCancelled: boolean;
  isMember: boolean;
  previous: EventRow["previous"];
}) | null> {
  const result = await query<EventRow>(
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
            e.is_cancelled,
            t.name AS team_name,
            t.short_code,
            t.timezone,
            EXISTS (
              SELECT 1 FROM team_memberships tm
              JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
              WHERE tm.team_id = e.team_id AND tm.user_id = $2
            ) AS is_member,
            (SELECT r.status::text FROM rsvps r WHERE r.event_id = e.id AND r.user_id = $2) AS previous
       FROM events e
       JOIN teams t ON t.id = e.team_id
      WHERE e.id = $1`,
    [eventId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    startAt: new Date(row.start_at).toISOString(),
    location: row.location,
    locationUrl: row.location_url,
    teamName: row.team_name,
    teamShortCode: row.short_code,
    timezone: row.timezone,
    isCancelled: row.is_cancelled,
    isMember: Boolean(userId) && row.is_member,
    previous: row.previous,
  };
}

export async function recordRsvpAnswer(params: {
  userId: string | null;
  eventId: string;
  status: RsvpAnswerStatus;
  source: RsvpAnswerSource;
  now?: Date;
}): Promise<RsvpAnswerResult> {
  const loaded = await loadRsvpEvent(params.eventId, params.userId);
  if (!loaded) return { ok: false, reason: "EVENT_NOT_FOUND" };
  const { isCancelled, isMember, previous, ...event } = loaded;
  if (!params.userId || !isMember) return { ok: false, reason: "NOT_MEMBER", event };
  if (isCancelled) return { ok: false, reason: "CANCELLED", event };
  const now = params.now ?? new Date();
  if (new Date(event.startAt).getTime() <= now.getTime()) return { ok: false, reason: "STARTED", event };

  await query(
    `INSERT INTO rsvps (event_id, user_id, status, updated_at)
     VALUES ($1, $2, $3::rsvp_status, NOW())
     ON CONFLICT (event_id, user_id)
     DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
    [event.id, params.userId, params.status]
  );
  if (previous !== params.status) {
    await writeAudit(params.userId, "rsvp.update", { eventId: event.id, status: params.status, source: params.source });
  }
  return { ok: true, previous, status: params.status, event };
}

/** Человек PBTH по id в Telegram (кто нажал кнопку). */
export async function findUserByTelegramId(telegramId: string | number | null | undefined): Promise<string | null> {
  const value = String(telegramId ?? "").trim();
  if (!/^\d{1,20}$/.test(value)) return null;
  const result = await query<{ id: string }>(
    `SELECT id FROM users WHERE telegram_id = $1::bigint AND is_active = TRUE LIMIT 1`,
    [value]
  );
  return result.rows[0]?.id ?? null;
}
