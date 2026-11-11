// Запись набора сценариев в базу и удаление его оттуда. Всё в транзакции
// вызывающего (`client` уже внутри BEGIN): или набор целиком, или ничего.
//
// Что считается «своим»:
//   - тестовые люди: telegram id в диапазоне `TEST_TELEGRAM_BASE` и ник с
//     префиксом `pbth_test_` — оба признака сразу;
//   - тестовые команды: id из набора (устойчивые, см. `ids.ts`) и название с
//     меткой « (тест)» в конце; плюс команды, созданные по тестовым заявкам на
//     создание команды (если их одобрили в консоли), тоже только с этой меткой;
//   - записи журнала с меткой `payload.seedScenarios`.
// Всё остальное, что привязано к тестовым командам и людям (события, ответы,
// деньги, заявки, ответы главного человека в тестовых событиях), уходит
// каскадом вместе с ними. Данные вне тестовых команд не трогаются.

import type { PoolClient } from "pg";
import {
  SEED_MARK,
  TEAM_NAME_SUFFIX,
  TEST_TELEGRAM_BASE,
  TEST_TELEGRAM_RANGE,
  TEST_USERNAME_PREFIX,
} from "./ids.js";
import type { Row, ScenarioPlan } from "./plan.js";

export type Scope = { teamIds: string[]; userIds: string[] };
export type ScopeCounts = Record<string, number>;

export class SeedScopeError extends Error {}

/** Тестовые команды и люди, которые сейчас лежат в базе. */
export async function resolveScope(client: PoolClient, fixedTeamIds: string[]): Promise<Scope> {
  const users = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE telegram_id >= $1::bigint AND telegram_id < $2::bigint
        AND left(username, $4) = $3`,
    [String(TEST_TELEGRAM_BASE), String(TEST_TELEGRAM_BASE + TEST_TELEGRAM_RANGE), TEST_USERNAME_PREFIX, TEST_USERNAME_PREFIX.length]
  );
  const userIds = users.rows.map((r) => r.id);

  const fixed = await client.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = ANY($1::uuid[])`, [fixedTeamIds]);
  for (const row of fixed.rows) {
    if (!row.name.endsWith(TEAM_NAME_SUFFIX)) {
      // Совпадение устойчивого id с настоящей командой практически невозможно,
      // но если оно случилось — ничего не трогаем.
      throw new SeedScopeError(`Команда ${row.id} «${row.name}» без метки «${TEAM_NAME_SUFFIX.trim()}» — не тестовая, остановка`);
    }
  }
  const created = await client.query<{ id: string }>(
    `SELECT DISTINCT t.id
       FROM team_creation_requests r
       JOIN teams t ON t.id = r.team_id
      WHERE r.user_id = ANY($1::uuid[])
        AND right(t.name, $3) = $2`,
    [userIds, TEAM_NAME_SUFFIX, TEAM_NAME_SUFFIX.length]
  );
  const teamIds = Array.from(new Set([...fixed.rows.map((r) => r.id), ...created.rows.map((r) => r.id)]));
  return { teamIds, userIds };
}

const COUNT_SQL: Array<[string, string]> = [
  ["users", `SELECT COUNT(*) FROM users WHERE id = ANY($2::uuid[])`],
  ["teams", `SELECT COUNT(*) FROM teams WHERE id = ANY($1::uuid[])`],
  ["team_memberships", `SELECT COUNT(*) FROM team_memberships WHERE team_id = ANY($1::uuid[])`],
  ["team_join_links", `SELECT COUNT(*) FROM team_join_links WHERE team_id = ANY($1::uuid[])`],
  ["team_invites", `SELECT COUNT(*) FROM team_invites WHERE team_id = ANY($1::uuid[])`],
  ["team_open_schedules", `SELECT COUNT(*) FROM team_open_schedules WHERE team_id = ANY($1::uuid[])`],
  ["team_followers", `SELECT COUNT(*) FROM team_followers WHERE team_id = ANY($1::uuid[])`],
  ["event_series", `SELECT COUNT(*) FROM event_series WHERE team_id = ANY($1::uuid[])`],
  ["events", `SELECT COUNT(*) FROM events WHERE team_id = ANY($1::uuid[])`],
  [
    "event_series_commitment",
    `SELECT COUNT(*) FROM event_series_commitment c JOIN event_series s ON s.id = c.series_id WHERE s.team_id = ANY($1::uuid[])`,
  ],
  ["rsvps", `SELECT COUNT(*) FROM rsvps r JOIN events e ON e.id = r.event_id WHERE e.team_id = ANY($1::uuid[])`],
  ["event_attendance", `SELECT COUNT(*) FROM event_attendance a JOIN events e ON e.id = a.event_id WHERE e.team_id = ANY($1::uuid[])`],
  ["event_games", `SELECT COUNT(*) FROM event_games g JOIN events e ON e.id = g.event_id WHERE e.team_id = ANY($1::uuid[])`],
  [
    "game_points",
    `SELECT COUNT(*) FROM game_points p JOIN event_games g ON g.id = p.game_id JOIN events e ON e.id = g.event_id WHERE e.team_id = ANY($1::uuid[])`,
  ],
  [
    "game_reflections",
    `SELECT COUNT(*) FROM game_reflections r JOIN game_points p ON p.id = r.point_id JOIN event_games g ON g.id = p.game_id
       JOIN events e ON e.id = g.event_id WHERE e.team_id = ANY($1::uuid[])`,
  ],
  ["transactions", `SELECT COUNT(*) FROM transactions WHERE team_id = ANY($1::uuid[])`],
  ["event_member_charges", `SELECT COUNT(*) FROM event_member_charges WHERE team_id = ANY($1::uuid[])`],
  ["event_slots", `SELECT COUNT(*) FROM event_slots WHERE team_id = ANY($1::uuid[])`],
  ["event_slot_guests", `SELECT COUNT(*) FROM event_slot_guests g JOIN events e ON e.id = g.event_id WHERE e.team_id = ANY($1::uuid[])`],
  ["team_join_requests", `SELECT COUNT(*) FROM team_join_requests WHERE team_id = ANY($1::uuid[])`],
  ["team_creation_requests", `SELECT COUNT(*) FROM team_creation_requests WHERE user_id = ANY($2::uuid[])`],
  ["notification_deliveries", `SELECT COUNT(*) FROM notification_deliveries WHERE team_id = ANY($1::uuid[])`],
  ["event_announcements", `SELECT COUNT(*) FROM event_announcements WHERE team_id = ANY($1::uuid[])`],
  ["event_auto_reminders", `SELECT COUNT(*) FROM event_auto_reminders WHERE team_id = ANY($1::uuid[])`],
  ["audit_logs", `SELECT COUNT(*) FROM audit_logs WHERE payload->>'seedScenarios' = $3`],
];

/** Сколько тестовых строк лежит в базе сейчас, по таблицам. */
export async function countScope(client: PoolClient, scope: Scope): Promise<ScopeCounts> {
  const counts: ScopeCounts = {};
  for (const [table, sql] of COUNT_SQL) {
    const params: unknown[] = [scope.teamIds, scope.userIds, SEED_MARK];
    // У каждого запроса свой набор параметров: лишние Postgres не примет.
    const used = [1, 2, 3].filter((n) => sql.includes(`$${n}`));
    const result = await client.query<{ count: string }>(
      sql.replace(/\$(\d)/g, (_m, n) => `$${used.indexOf(Number(n)) + 1}`),
      used.map((n) => params[n - 1])
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

/** Убрать весь тестовый набор. Главного человека и его данные вне тестовых команд не трогает. */
export async function removeScope(client: PoolClient, scope: Scope, protectUserIds: string[] = []): Promise<void> {
  for (const id of protectUserIds) {
    if (scope.userIds.includes(id)) throw new SeedScopeError(`Пользователь ${id} попал в тестовый диапазон — остановка`);
  }
  await client.query(
    `DELETE FROM request_bot_messages
      WHERE (kind = 'join' AND request_id IN (
               SELECT id FROM team_join_requests WHERE team_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])))
         OR (kind = 'team' AND request_id IN (
               SELECT id FROM team_creation_requests WHERE user_id = ANY($2::uuid[])))`,
    [scope.teamIds, scope.userIds]
  );
  await client.query(`DELETE FROM audit_logs WHERE payload->>'seedScenarios' = $1`, [SEED_MARK]);
  await client.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [scope.teamIds]);
  await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [scope.userIds]);
}

const CHUNK = 200;

async function insertRows(client: PoolClient, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column] === undefined ? null : row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
  }
}

/**
 * Записать набор: сначала убрать прежний (если был), потом вставить заново с
 * теми же id. Повторный запуск даёт то же состояние и те же ссылки.
 */
export async function applyPlan(client: PoolClient, plan: ScenarioPlan, ownerUserId: string): Promise<void> {
  const before = await resolveScope(client, plan.teamIds);
  await removeScope(client, before, [ownerUserId]);
  for (const { table, rows } of plan.tables) {
    await insertRows(client, table, rows);
  }
}
