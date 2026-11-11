import { query } from "../../db/pool.js";

// Ближайшее событие команды для тех, кто ещё не в ней: открытые экраны
// приглашения (`/teams/invites/:token`, `/join-requests/link/:code`) и
// заявка на вступление, пока она ждёт решения (`/join-requests/*`).
//
// Правило одно на все эти ответы:
//   - только игровые типы (тренировка, турнир, чемпионат, спарринг); сборы,
//     ТО и «другое» пропускаются, берётся ближайшее игровое после них;
//   - только `{ startsAt, type, timezone }`. Название, место, описание и
//     стоимость не уходят: там бывают адреса, ссылки и названия закрытых
//     событий.

/** Типы событий, которые видны не участнику. Остальные (MEETING, MAINTENANCE, OTHER) — внутренние. */
export const PUBLIC_EVENT_TYPES = ["TRAINING", "TOURNAMENT", "CHAMPIONSHIP", "FRIENDLY_MATCH"] as const;

export type PublicNextEvent = { startsAt: string; type: string; timezone: string };

// Константы из кода, не ввод: список встраивается в текст запроса.
const PUBLIC_EVENT_TYPES_SQL = PUBLIC_EVENT_TYPES.map((type) => `'${type}'::event_type`).join(", ");

/**
 * Подзапрос для `LEFT JOIN LATERAL (...) e ON TRUE`: колонки `type`, `start_at`
 * ближайшего будущего игрового события команды `teamIdSql`.
 */
export function publicNextEventLateral(teamIdSql: string): string {
  return `SELECT type::text AS type, start_at
       FROM events
       WHERE team_id = ${teamIdSql} AND is_cancelled = FALSE AND start_at >= NOW()
         AND type IN (${PUBLIC_EVENT_TYPES_SQL})
       ORDER BY start_at ASC
       LIMIT 1`;
}

/** Строка запроса → поле ответа; нет события — null. */
export function toPublicNextEvent(row: {
  event_type: string | null;
  event_start_at: Date | string | null;
  timezone: string;
}): PublicNextEvent | null {
  if (!row.event_type || !row.event_start_at) return null;
  return { startsAt: new Date(row.event_start_at).toISOString(), type: row.event_type, timezone: row.timezone };
}

/** Отдельным запросом — для заявки на вступление. */
export async function loadPublicNextEvent(teamId: string): Promise<PublicNextEvent | null> {
  const result = await query<{ event_type: string | null; event_start_at: Date | null; timezone: string }>(
    `SELECT e.type AS event_type, e.start_at AS event_start_at, t.timezone
     FROM teams t
     LEFT JOIN LATERAL (${publicNextEventLateral("t.id")}) e ON TRUE
     WHERE t.id = $1`,
    [teamId]
  );
  const row = result.rows[0];
  return row ? toPublicNextEvent(row) : null;
}
