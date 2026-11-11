import { query } from "../../db/pool.js";
import { publicFirstName } from "./public-first-name.js";

// Факты о команде для экранов приглашения (`/invite/:token`, `/join/:code`).
// Эти ручки открыты любому, у кого есть ссылка, поэтому наружу уходят только
// три поля, и ни одно из них не несёт свободного текста:
//   inviter      — `{ name }`: первое имя того, кто зовёт, если оно похоже на
//                  имя (`publicFirstName`), иначе null; фамилия не уходит;
//   membersCount — число активных участников;
//   nextEvent    — `{ startsAt, type, timezone }` ближайшего будущего события
//                  игрового типа (тренировка, турнир, чемпионат, спарринг).
//                  Название и место не уходят: там бывают адреса, ссылки и
//                  названия закрытых событий. Сборы, ТО и «другое»
//                  пропускаются, берётся ближайшее игровое после них.
// Состав, ники, аватары, суммы, заметки и описания сюда не попадают.

/** Типы событий, которые можно показать без входа. Остальные (MEETING, MAINTENANCE, OTHER) — внутренние. */
export const PUBLIC_EVENT_TYPES = ["TRAINING", "TOURNAMENT", "CHAMPIONSHIP", "FRIENDLY_MATCH"] as const;

export type InviteFacts = {
  inviter: { name: string } | null;
  membersCount: number;
  nextEvent: { startsAt: string; type: string; timezone: string } | null;
};

type FactsRow = {
  inviter_name: string | null;
  members_count: number;
  event_type: string | null;
  event_start_at: Date | string | null;
  timezone: string;
};

// Константы из кода, не ввод: список встраивается в текст запроса.
const PUBLIC_EVENT_TYPES_SQL = PUBLIC_EVENT_TYPES.map((type) => `'${type}'::event_type`).join(", ");

/**
 * Один запрос. `inviter`: `{ creatorId }` — тот, кто выпустил приглашение;
 * `"captain"` — капитан команды (для ссылки команды: старший по вступлению).
 */
export async function loadInviteFacts(teamId: string, inviter: { creatorId: string } | "captain"): Promise<InviteFacts | null> {
  const inviterSql =
    inviter === "captain"
      ? `(SELECT u.name FROM team_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.team_id = t.id AND m.role = 'CAPTAIN' AND u.is_active = TRUE
          ORDER BY m.created_at ASC LIMIT 1)`
      : `(SELECT u.name FROM users u WHERE u.id = $2)`;
  const values = inviter === "captain" ? [teamId] : [teamId, inviter.creatorId];
  const result = await query<FactsRow>(
    `SELECT ${inviterSql} AS inviter_name,
            (SELECT COUNT(*)::int FROM team_memberships m JOIN users u ON u.id = m.user_id
             WHERE m.team_id = t.id AND u.is_active = TRUE) AS members_count,
            e.type::text AS event_type, e.start_at AS event_start_at, t.timezone
     FROM teams t
     LEFT JOIN LATERAL (
       SELECT type, start_at
       FROM events
       WHERE team_id = t.id AND is_cancelled = FALSE AND start_at >= NOW()
         AND type IN (${PUBLIC_EVENT_TYPES_SQL})
       ORDER BY start_at ASC
       LIMIT 1
     ) e ON TRUE
     WHERE t.id = $1`,
    values
  );
  const row = result.rows[0];
  if (!row) return null;
  const name = publicFirstName(row.inviter_name);
  return {
    inviter: name ? { name } : null,
    membersCount: row.members_count,
    nextEvent:
      row.event_start_at && row.event_type
        ? {
            startsAt: new Date(row.event_start_at).toISOString(),
            type: row.event_type,
            timezone: row.timezone,
          }
        : null,
  };
}
