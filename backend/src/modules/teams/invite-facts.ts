import { query } from "../../db/pool.js";

// Факты о команде для экранов приглашения (`/invite/:token`, `/join/:code`).
// Эти ручки открыты любому, у кого есть ссылка, поэтому наружу уходят только
// три поля: имя того, кто зовёт, число участников и ближайшее событие.
// Состав, ники, суммы, заметки и адреса площадок сюда не попадают.

export type InviteFacts = {
  inviter: { name: string } | null;
  membersCount: number;
  nextEvent: { startsAt: string; type: string; title: string; location: string | null; timezone: string } | null;
};

type FactsRow = {
  inviter_name: string | null;
  members_count: number;
  event_type: string | null;
  event_title: string | null;
  event_start_at: Date | string | null;
  event_location: string | null;
  timezone: string;
};

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
            e.type::text AS event_type, e.title AS event_title, e.start_at AS event_start_at,
            e.location AS event_location, t.timezone
     FROM teams t
     LEFT JOIN LATERAL (
       SELECT type, title, start_at, location
       FROM events
       WHERE team_id = t.id AND is_cancelled = FALSE AND start_at >= NOW()
       ORDER BY start_at ASC
       LIMIT 1
     ) e ON TRUE
     WHERE t.id = $1`,
    values
  );
  const row = result.rows[0];
  if (!row) return null;
  const name = row.inviter_name?.trim();
  return {
    inviter: name ? { name } : null,
    membersCount: row.members_count,
    nextEvent:
      row.event_start_at && row.event_title && row.event_type
        ? {
            startsAt: new Date(row.event_start_at).toISOString(),
            type: row.event_type,
            title: row.event_title,
            location: row.event_location,
            timezone: row.timezone,
          }
        : null,
  };
}
