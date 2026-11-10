import { query } from "../../db/pool.js";

// Журнал команды по-русски (трек 3). Источник — `audit_logs`; людям
// показываются только действия из списка ниже, сырые названия вроде
// `auth.context.switch` наружу не уходят. Действия владельца платформы в
// чужой команде помечены (`actorVia: 'owner'` в записи, см. `lib/audit.ts`).

type Payload = Record<string, unknown>;

type Describe = (payload: Payload, ctx: { eventTitle: string | null }) => string;

const ROLE_GENITIVE: Record<string, string> = {
  CAPTAIN: "капитана",
  TRAINER: "тренера",
  PLAYER: "игрока",
};

const ROLE_NOMINATIVE: Record<string, string> = {
  CAPTAIN: "капитан",
  TRAINER: "тренер",
  PLAYER: "игрок",
};

const NBSP = " ";

function money(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `${new Intl.NumberFormat("ru-RU").format(amount)}${NBSP}₽`;
}

function eventName(ctx: { eventTitle: string | null }): string {
  return ctx.eventTitle ? `«${ctx.eventTitle}»` : "";
}

function withEvent(text: string, ctx: { eventTitle: string | null }): string {
  const name = eventName(ctx);
  return name ? `${text} ${name}` : text;
}

const DESCRIBE: Record<string, Describe> = {
  "events.create": (_p, ctx) => withEvent("Создал событие", ctx),
  "admin.v1.events.create": (_p, ctx) => withEvent("Создал событие", ctx),
  "events.create.recurrence": (_p, ctx) => withEvent("Создал серию событий", ctx),
  "events.update.single": (_p, ctx) => withEvent("Изменил событие", ctx),
  "admin.v1.events.patch": (_p, ctx) => withEvent("Изменил событие", ctx),
  "events.update.future": (_p, ctx) => `${withEvent("Изменил событие", ctx)} и следующие в серии`,
  "events.delete.single": (_p, ctx) => withEvent("Удалил событие", ctx),
  "events.delete.future": (_p, ctx) => `${withEvent("Удалил событие", ctx)} и следующие в серии`,
  "events.attendance.mark": (_p, ctx) => withEvent("Отметил, кто был на событии", ctx),
  "events.series.commit": () => "Записался на все занятия серии",
  "events.series.leave": () => "Отказался от занятий серии",
  "rsvp.update": (p, ctx) => {
    if (p.status === "CONFIRMED") return withEvent("Идёт на", ctx);
    if (p.status === "DECLINED") return withEvent("Не идёт на", ctx);
    return withEvent("Пока не решил про", ctx);
  },
  "finance.event_charges.generate": (_p, ctx) => withEvent("Начислил сбор по событию", ctx),
  "finance.payment.create": (p) => `Записал оплату ${money(p.amount)}`.trim(),
  "finance.transaction.create": (p) => {
    if (p.type === "EXPENSE") return `Записал расход ${money(p.amount)}`.trim();
    if (p.type === "FEE") return `Записал взнос ${money(p.amount)}`.trim();
    return `Записал поступление ${money(p.amount)}`.trim();
  },
  "teams.create": () => "Создал команду",
  "platform.team.create": () => "Создал команду",
  "teams.invite.create": (p) => `Выпустил приглашение для ${ROLE_GENITIVE[String(p.role)] ?? "участника"}`,
  "teams.invite.accept": () => "Вступил в команду по приглашению",
  "teams.membership.upsert": (p) => `Добавил в команду: ${ROLE_NOMINATIVE[String(p.role)] ?? "участник"}`,
  "teams.membership.update": (p) =>
    p.role ? `Сменил роль участника: ${ROLE_NOMINATIVE[String(p.role)] ?? "другая"}` : "Сменил статус участника",
  "admin.v1.team.members.patch": () => "Сменил роль или статус участника",
  "reflection.point_roster": () => "Записал, кто выходил на пойнт",
  "reflection.point_results": () => "Разметил выигранные пойнты",
  "reflection.captain_report": () => "Заполнил разбор пойнта",
  "reflection.submit": () => "Заполнил рефлексию за пойнт",
  "reflection.table.sent": (_p, ctx) => withEvent("Выгрузил разбор события", ctx),
  "notifications.event_reminder.send": (_p, ctx) => withEvent("Напомнил о событии", ctx),
  "notifications.debt_reminder.send": (_p, ctx) => withEvent("Напомнил о долге по событию", ctx),
  "notifications.member_debt_reminder.send": () => "Напомнил игроку о долге",
  "notifications.team_debt_reminder.send": () => "Напомнил должникам",
};

export const JOURNAL_ACTIONS = Object.keys(DESCRIBE);

export type JournalItem = {
  id: string;
  at: string;
  actorName: string;
  /** Действие владельца платформы в команде, где он не состоит. */
  byOwner: boolean;
  text: string;
};

type Row = {
  id: string;
  action: string;
  payload: Payload | null;
  created_at: string;
  actor_name: string | null;
  event_title: string | null;
};

export function describeJournalRow(row: Row, teamId: string): JournalItem | null {
  const describe = DESCRIBE[row.action];
  if (!describe) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const ownerTeamIds = Array.isArray(payload.ownerTeamIds) ? payload.ownerTeamIds.map(String) : [];
  const byOwner =
    row.action === "platform.team.create" || (payload.actorVia === "owner" && ownerTeamIds.includes(teamId));
  return {
    id: row.id,
    at: new Date(row.created_at).toISOString(),
    actorName: row.actor_name || "Кто-то",
    byOwner,
    text: describe(payload, { eventTitle: row.event_title }),
  };
}

/**
 * Последние действия в команде. Запись относится к команде, если в ней
 * команда названа прямо, владелец действовал в ней, или она про событие,
 * игру, пойнт, серию или участника этой команды.
 */
export async function loadTeamJournal(teamId: string, limit: number): Promise<JournalItem[]> {
  const result = await query<Row>(
    `WITH team_events AS (SELECT id::text AS id FROM events WHERE team_id = $1),
          team_games AS (
            SELECT g.id::text AS id FROM event_games g JOIN events e ON e.id = g.event_id WHERE e.team_id = $1
          ),
          team_points AS (
            SELECT p.id::text AS id FROM game_points p
            JOIN event_games g ON g.id = p.game_id
            JOIN events e ON e.id = g.event_id
            WHERE e.team_id = $1
          ),
          team_series AS (SELECT id::text AS id FROM event_series WHERE team_id = $1),
          team_members AS (SELECT id::text AS id FROM team_memberships WHERE team_id = $1)
     SELECT a.id::text AS id,
            a.action,
            a.payload,
            a.created_at,
            u.name AS actor_name,
            ev.title AS event_title
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN events ev ON ev.id::text = a.payload->>'eventId'
     WHERE a.action = ANY($2::text[])
       AND (
         a.payload->>'teamId' = $1::text
         OR COALESCE(a.payload->'ownerTeamIds', '[]'::jsonb) ? $1::text
         OR a.payload->>'eventId' IN (SELECT id FROM team_events)
         OR a.payload->>'gameId' IN (SELECT id FROM team_games)
         OR a.payload->>'pointId' IN (SELECT id FROM team_points)
         OR a.payload->>'seriesId' IN (SELECT id FROM team_series)
         OR a.payload->>'membershipId' IN (SELECT id FROM team_members)
       )
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [teamId, JOURNAL_ACTIONS, limit]
  );
  return result.rows
    .map((row) => describeJournalRow(row, teamId))
    .filter((item): item is JournalItem => item !== null);
}
