import { query } from "../../db/pool.js";
import { publicNextEventLateral, toPublicNextEvent, type PublicNextEvent } from "./public-next-event.js";

// Факты о команде для экранов приглашения (`/invite/:token`, `/join/:code`).
// Эти ручки открыты любому, у кого есть ссылка, поэтому наружу уходят только
// два поля, и ни одно не несёт свободного текста:
//   membersCount — число активных участников;
//   nextEvent    — `{ startsAt, type, timezone }` ближайшего игрового события
//                  (правило — в public-next-event.ts).
// Имени того, кто зовёт, здесь нет: `users.name` — свободный текст (ник,
// `tg-<id>`, телефон), отличить в нём имя от ника нельзя (решение 11.11.2026).
// Состав, ники, аватары, суммы, заметки и описания сюда не попадают.

export type InviteFacts = {
  membersCount: number;
  nextEvent: PublicNextEvent | null;
};

type FactsRow = {
  members_count: number;
  event_type: string | null;
  event_start_at: Date | string | null;
  timezone: string;
};

/** Один запрос: число людей и ближайшее игровое событие. */
export async function loadInviteFacts(teamId: string): Promise<InviteFacts | null> {
  const result = await query<FactsRow>(
    `SELECT (SELECT COUNT(*)::int FROM team_memberships m JOIN users u ON u.id = m.user_id
             WHERE m.team_id = t.id AND u.is_active = TRUE) AS members_count,
            e.type AS event_type, e.start_at AS event_start_at, t.timezone
     FROM teams t
     LEFT JOIN LATERAL (${publicNextEventLateral("t.id")}) e ON TRUE
     WHERE t.id = $1`,
    [teamId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { membersCount: row.members_count, nextEvent: toPublicNextEvent(row) };
}
