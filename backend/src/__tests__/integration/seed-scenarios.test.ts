// Наполнитель тестовых сценариев (backend/src/db/seeds/scenarios*).
//
// Проверяем то, что важно для запуска на staging:
//   - без явного разрешения и на признаках прода скрипт отказывает и ничего не пишет;
//   - главного человека не создаёт и его прежние данные не меняет;
//   - два запуска подряд дают одинаковый набор (те же счётчики и те же id);
//   - `--remove` убирает только помеченное, чужие данные рядом остаются;
//   - авто-напоминания о тестовых событиях не уходят никому.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dispatched: Array<{ eventId?: string; recipientUserId?: string; chatId?: string | null }> = [];
vi.mock("../../lib/notification-dispatch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/notification-dispatch.js")>();
  return {
    ...original,
    dispatchNotification: async (params: { eventId?: string; recipientUserId?: string; chatId?: string | null }) => {
      dispatched.push({ eventId: params.eventId, recipientUserId: params.recipientUserId, chatId: params.chatId });
      return { mode: "SYNC" as const };
    },
  };
});

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
// Бот-API — на закрытый порт: если что-то всё же попробует отправить, наружу не уйдёт.
process.env.TELEGRAM_BOT_API_BASE_URL = "http://127.0.0.1:9";

const exec = promisify(execFile);
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI = path.join(BACKEND_DIR, "src/db/seeds/scenarios.ts");

let pool: typeof import("../../db/pool.js").pool;
let plan: typeof import("../../db/seeds/scenarios/plan.js");
let apply: typeof import("../../db/seeds/scenarios/apply.js");
let ids: typeof import("../../db/seeds/scenarios/ids.js");
let schedule: typeof import("../../lib/notification-schedule.js");
let reminders: typeof import("../../modules/reminders/auto.js");

const stamp = Date.now() % 1_000_000;
const OWNER_TG = String(961_000_000 + stamp);
const STRANGER_TG = String(962_000_000 + stamp);
const fx = { owner: "", stranger: "", ownTeam: "", strangerTeam: "", ownEvent: "", strangerEvent: "", ownTx: "" };

async function runCli(args: string[], env: Record<string, string | undefined>) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--import", "tsx", CLI, ...args], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** Всё, что принадлежит главному человеку вне тестовых команд. */
async function ownerSnapshot(teamIds: string[]) {
  const user = await pool.query(`SELECT * FROM users WHERE id = $1`, [fx.owner]);
  const memberships = await pool.query(
    `SELECT id, team_id, role, status, balance::text, updated_at FROM team_memberships
      WHERE user_id = $1 AND NOT (team_id = ANY($2::uuid[])) ORDER BY id`,
    [fx.owner, teamIds]
  );
  const rsvps = await pool.query(
    `SELECT r.event_id, r.status, r.updated_at FROM rsvps r JOIN events e ON e.id = r.event_id
      WHERE r.user_id = $1 AND NOT (e.team_id = ANY($2::uuid[])) ORDER BY r.event_id`,
    [fx.owner, teamIds]
  );
  const team = await pool.query(`SELECT * FROM teams WHERE id = $1`, [fx.ownTeam]);
  const event = await pool.query(`SELECT * FROM events WHERE id = $1`, [fx.ownEvent]);
  const tx = await pool.query(`SELECT * FROM transactions WHERE team_id = $1 ORDER BY id`, [fx.ownTeam]);
  const settings = await pool.query(`SELECT * FROM user_notification_settings WHERE user_id = $1`, [fx.owner]);
  const sameTelegram = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE telegram_id = $1::bigint`, [OWNER_TG]);
  return {
    user: user.rows,
    memberships: memberships.rows,
    rsvps: rsvps.rows,
    team: team.rows,
    event: event.rows,
    tx: tx.rows,
    settings: settings.rows,
    sameTelegram: sameTelegram.rows[0].n,
  };
}

async function strangerSnapshot() {
  const team = await pool.query(`SELECT * FROM teams WHERE id = $1`, [fx.strangerTeam]);
  const user = await pool.query(`SELECT * FROM users WHERE id = $1`, [fx.stranger]);
  const event = await pool.query(`SELECT * FROM events WHERE id = $1`, [fx.strangerEvent]);
  const membership = await pool.query(`SELECT * FROM team_memberships WHERE team_id = $1`, [fx.strangerTeam]);
  const rsvp = await pool.query(`SELECT * FROM rsvps WHERE event_id = $1`, [fx.strangerEvent]);
  return { team: team.rows, user: user.rows, event: event.rows, membership: membership.rows, rsvp: rsvp.rows };
}

async function seedOnce(now: Date) {
  const scenario = plan.buildScenarioPlan({ now, ownerUserId: fx.owner });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await apply.applyPlan(client, scenario, fx.owner);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return scenario;
}

async function scopeCounts(teamIds: string[]) {
  const client = await pool.connect();
  try {
    return await apply.countScope(client, await apply.resolveScope(client, teamIds));
  } finally {
    client.release();
  }
}

async function removeAll(teamIds: string[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await apply.removeScope(client, await apply.resolveScope(client, teamIds), [fx.owner]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

const LOCAL_ENV = { SEED_SCENARIOS_ALLOW: "local", DB_HOST: process.env.DB_HOST || "127.0.0.1", NODE_ENV: "test" };

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  plan = await import("../../db/seeds/scenarios/plan.js");
  apply = await import("../../db/seeds/scenarios/apply.js");
  ids = await import("../../db/seeds/scenarios/ids.js");
  schedule = await import("../../lib/notification-schedule.js");
  reminders = await import("../../modules/reminders/auto.js");

  const mkUser = async (tg: string, name: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (telegram_id, username, name, nickname, account_role) VALUES ($1::bigint, $2, $3, $4, 'USER') RETURNING id`,
        [tg, `seedtest_${tg}`, name, `seedtest_${tg}`]
      )
    ).rows[0].id;
  fx.owner = await mkUser(OWNER_TG, "Хозяин аккаунта");
  fx.stranger = await mkUser(STRANGER_TG, "Посторонний");
  fx.ownTeam = (
    await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code, budget) VALUES ('Своя команда', $1, 1234) RETURNING id`, [
      `seedown${stamp}`,
    ])
  ).rows[0].id;
  fx.strangerTeam = (
    await pool.query<{ id: string }>(`INSERT INTO teams (name, short_code) VALUES ('Чужая (тест)', $1) RETURNING id`, [`seedstr${stamp}`])
  ).rows[0].id;
  await pool.query(`INSERT INTO team_memberships (user_id, team_id, role, balance) VALUES ($1, $2, 'CAPTAIN', -300)`, [fx.owner, fx.ownTeam]);
  await pool.query(`INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'CAPTAIN')`, [fx.stranger, fx.strangerTeam]);
  fx.ownEvent = (
    await pool.query<{ id: string }>(
      `INSERT INTO events (team_id, type, title, start_at, end_at) VALUES ($1, 'TRAINING', 'Своя тренировка', now() + interval '1 day', now() + interval '26 hours') RETURNING id`,
      [fx.ownTeam]
    )
  ).rows[0].id;
  fx.strangerEvent = (
    await pool.query<{ id: string }>(
      `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'MEETING', 'Чужое собрание', now() + interval '2 days') RETURNING id`,
      [fx.strangerTeam]
    )
  ).rows[0].id;
  await pool.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED')`, [fx.ownEvent, fx.owner]);
  await pool.query(`INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'PENDING')`, [fx.strangerEvent, fx.stranger]);
  await pool.query(
    `INSERT INTO transactions (team_id, type, amount, title, date, created_by) VALUES ($1, 'EXPENSE', 500, 'Своя трата', now(), $2)`,
    [fx.ownTeam, fx.owner]
  );
  await pool.query(`INSERT INTO user_notification_settings (user_id, auto_event_reminders) VALUES ($1, TRUE)`, [fx.owner]);
});

afterAll(async () => {
  if (!pool) return;
  const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
  await removeAll(teamIds).catch(() => {});
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[fx.ownTeam, fx.strangerTeam]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[fx.owner, fx.stranger]]);
  await pool.end();
});

describe("наполнитель сценариев: защита в командной строке", () => {
  it("без SEED_SCENARIOS_ALLOW отказывает с кодом 2 и ничего не пишет", async () => {
    const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
    await removeAll(teamIds);
    const result = await runCli(["--owner-telegram-id", OWNER_TG], { ...LOCAL_ENV, SEED_SCENARIOS_ALLOW: undefined });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/SEED_SCENARIOS_ALLOW/);
    const counts = await scopeCounts(teamIds);
    expect(counts.teams).toBe(0);
    expect(counts.users).toBe(0);
  });

  it("на признаках прода отказывает даже с разрешением и любыми флагами", async () => {
    const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
    for (const env of [
      { ...LOCAL_ENV, SEED_SCENARIOS_ALLOW: "staging", DB_NAME: "pbth_prod", FRONTEND_URL: "https://staging.pbthub.ru" },
      { ...LOCAL_ENV, FRONTEND_URL: "https://pbthub.ru" },
      { ...LOCAL_ENV, APP_ENV: "production" },
    ]) {
      const result = await runCli(["--owner-telegram-id", OWNER_TG, "--force", "--yes"], env);
      expect(result.code, JSON.stringify(env)).toBe(2);
      expect(result.stderr).toMatch(/ОТКАЗ/);
    }
    expect((await scopeCounts(teamIds)).teams).toBe(0);
  });

  it("не создаёт главного человека, если его нет", async () => {
    const missing = String(963_000_000 + stamp);
    const result = await runCli(["--owner-telegram-id", missing], LOCAL_ENV);
    expect(result.code).toBe(3);
    const found = await pool.query(`SELECT 1 FROM users WHERE telegram_id = $1::bigint`, [missing]);
    expect(found.rowCount).toBe(0);
  });

  it("--dry-run печатает базу и план и ничего не пишет", async () => {
    const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
    const result = await runCli(["--owner-telegram-id", OWNER_TG, "--dry-run"], LOCAL_ENV);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Смотрю \(ничего не пишу\): .+\/.+/);
    expect(result.stdout).toMatch(/Гроза \(тест\)/);
    expect((await scopeCounts(teamIds)).teams).toBe(0);
  });

  it("запись через командную строку печатает, в какую базу пишет", async () => {
    const result = await runCli(["--owner-telegram-id", OWNER_TG], LOCAL_ENV);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Пишу в базу: .+:\d+\/\S+/);
    const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
    expect((await scopeCounts(teamIds)).teams).toBe(12);
    const removed = await runCli(["--remove"], LOCAL_ENV);
    expect(removed.code, removed.stderr).toBe(0);
    expect((await scopeCounts(teamIds)).teams).toBe(0);
  });
});

describe("наполнитель сценариев: данные", () => {
  it("главный человек получает роли в тестовых командах, его прежние данные не меняются", async () => {
    const teamIds = plan.buildScenarioPlan({ now: new Date(), ownerUserId: fx.owner }).teamIds;
    const before = await ownerSnapshot(teamIds);
    const strangerBefore = await strangerSnapshot();

    const scenario = await seedOnce(new Date());

    expect(await ownerSnapshot(teamIds)).toEqual(before);
    expect(await strangerSnapshot()).toEqual(strangerBefore);
    expect(before.sameTelegram).toBe(1);

    const roles = await pool.query<{ short_code: string; role: string; status: string }>(
      `SELECT t.short_code, tm.role::text AS role, tm.status::text AS status
         FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = $1 AND tm.team_id = ANY($2::uuid[]) ORDER BY t.short_code`,
      [fx.owner, scenario.teamIds]
    );
    const byCode = Object.fromEntries(roles.rows.map((r) => [r.short_code, `${r.role}/${r.status}`]));
    expect(byCode).toMatchObject({
      "tst-groza": "CAPTAIN/ACTIVE",
      "tst-veter": "TRAINER/ACTIVE",
      "tst-kobry": "PLAYER/ACTIVE",
      "tst-lisy": "PLAYER/RESERVE",
      "tst-novichki": "CAPTAIN/ACTIVE",
      "tst-metel": "PLAYER/INJURED",
      "tst-shtorm": "PLAYER/VACATION",
    });
    expect(roles.rowCount).toBe(9);

    // Все тестовые люди — в тестовом диапазоне.
    const people = await pool.query<{ telegram_id: string; username: string }>(
      `SELECT u.telegram_id::text, u.username FROM users u
        WHERE u.id IN (SELECT user_id FROM team_memberships WHERE team_id = ANY($1::uuid[])) AND u.id <> $2`,
      [scenario.teamIds, fx.owner]
    );
    for (const p of people.rows) {
      expect(ids.isTestTelegramId(p.telegram_id)).toBe(true);
      expect(p.username.startsWith(ids.TEST_USERNAME_PREFIX)).toBe(true);
    }

    // Казна согласована: бюджет = поступления − расходы, баланс = оплаты − начисления.
    const budgets = await pool.query<{ id: string; budget: string; calc: string }>(
      `SELECT t.id, t.budget::text,
              COALESCE((SELECT SUM(CASE WHEN type = 'DEPOSIT' THEN amount WHEN type = 'EXPENSE' THEN -amount ELSE 0 END)
                          FROM transactions WHERE team_id = t.id), 0)::text AS calc
         FROM teams t WHERE t.id = ANY($1::uuid[])`,
      [scenario.teamIds]
    );
    for (const b of budgets.rows) expect(Number(b.budget)).toBe(Number(b.calc));
    const grozaBudget = Number(budgets.rows.find((b) => b.id === ids.stableUuid("team:groza"))!.budget);
    const yastrebyBudget = Number(budgets.rows.find((b) => b.id === ids.stableUuid("team:yastreby"))!.budget);
    expect(grozaBudget).toBeGreaterThan(0);
    expect(yastrebyBudget).toBeLessThan(0);
    const ownerDebt = await pool.query<{ balance: string }>(
      `SELECT balance::text FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
      [fx.owner, ids.stableUuid("team:kobry")]
    );
    expect(Number(ownerDebt.rows[0].balance)).toBe(-1500);
  });

  it("повторный запуск даёт тот же набор: те же счётчики и те же id", async () => {
    const first = await seedOnce(new Date());
    const countsA = await scopeCounts(first.teamIds);
    const eventsA = await pool.query<{ id: string }>(`SELECT id FROM events WHERE team_id = ANY($1::uuid[]) ORDER BY id`, [first.teamIds]);

    const second = await seedOnce(new Date(Date.now() + 60_000));
    const countsB = await scopeCounts(second.teamIds);
    const eventsB = await pool.query<{ id: string }>(`SELECT id FROM events WHERE team_id = ANY($1::uuid[]) ORDER BY id`, [second.teamIds]);

    expect(countsB).toEqual(countsA);
    expect(eventsB.rows).toEqual(eventsA.rows);
    expect(countsA.teams).toBe(12);
    expect(countsA.events).toBeGreaterThan(40);
    const ownerRows = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE telegram_id = $1::bigint`, [OWNER_TG]);
    expect(ownerRows.rows[0].n).toBe(1);
  });

  it("действия главного человека в тестовых событиях при повторном запуске сбрасываются к сценарию", async () => {
    const scenario = await seedOnce(new Date());
    const tonight = ids.stableUuid("event:groza.tonight");
    await pool.query(
      `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'CONFIRMED')
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'CONFIRMED'`,
      [tonight, fx.owner]
    );
    await seedOnce(new Date());
    const answer = await pool.query(`SELECT status FROM rsvps WHERE event_id = $1 AND user_id = $2`, [tonight, fx.owner]);
    expect(answer.rowCount).toBe(0);
    expect(scenario.teamIds.length).toBe(12);
  });

  it("авто-напоминания о тестовых событиях не уходят ни главному человеку, ни тестовым людям", async () => {
    const now = new Date();
    const scenario = await seedOnce(now);
    const events = await pool.query<{ id: string; start_at: Date; timezone: string }>(
      `SELECT e.id, e.start_at, t.timezone FROM events e JOIN teams t ON t.id = e.team_id
        WHERE e.team_id = ANY($1::uuid[]) AND e.start_at > $2 AND e.is_cancelled = FALSE`,
      [scenario.teamIds, now]
    );
    const seeded = new Set(events.rows.map((e) => e.id));
    const moments = new Set<number>();
    for (const e of events.rows) {
      for (const w of schedule.autoReminderWindows(new Date(e.start_at), e.timezone)) {
        if (w.windowEnd.getTime() > now.getTime() && w.windowStart.getTime() < now.getTime() + 3 * 86_400_000) {
          moments.add(Math.max(w.windowStart.getTime(), now.getTime()) + 60_000);
        }
      }
    }
    expect(moments.size).toBeGreaterThan(0);
    dispatched.length = 0;
    for (const at of [...moments].sort()) await reminders.runAutoReminderTick(new Date(at));
    const toSeeded = dispatched.filter((d) => d.eventId && seeded.has(d.eventId));
    expect(toSeeded).toEqual([]);
  });

  it("--remove убирает только помеченное: свои и чужие данные рядом остаются", async () => {
    const scenario = await seedOnce(new Date());
    const before = await ownerSnapshot(scenario.teamIds);
    const strangerBefore = await strangerSnapshot();
    // Главный человек ответил в тестовом событии и подписался на тестовую команду —
    // это уходит вместе с тестовыми командами.
    await pool.query(
      `INSERT INTO rsvps (event_id, user_id, status) VALUES ($1, $2, 'DECLINED')
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'DECLINED'`,
      [ids.stableUuid("event:kobry.trip"), fx.owner]
    );
    // Чужой журнал рядом не трогается.
    await pool.query(`INSERT INTO audit_logs (user_id, action, payload) VALUES ($1, 'rsvp.update', $2::jsonb)`, [
      fx.stranger,
      JSON.stringify({ eventId: fx.strangerEvent, marker: stamp }),
    ]);

    await removeAll(scenario.teamIds);

    const counts = await scopeCounts(scenario.teamIds);
    for (const [table, n] of Object.entries(counts)) expect(n, table).toBe(0);
    expect(await ownerSnapshot(scenario.teamIds)).toEqual(before);
    expect(await strangerSnapshot()).toEqual(strangerBefore);
    const strangerLog = await pool.query(`SELECT 1 FROM audit_logs WHERE payload->>'marker' = $1`, [String(stamp)]);
    expect(strangerLog.rowCount).toBe(1);
    const leftovers = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE telegram_id >= $1::bigint AND telegram_id < $2::bigint`,
      [String(ids.TEST_TELEGRAM_BASE), String(ids.TEST_TELEGRAM_BASE + ids.TEST_TELEGRAM_RANGE)]
    );
    expect(leftovers.rows[0].n).toBe(0);
    // Команда «Чужая (тест)» без устойчивого id набора не тронута, хотя название с той же меткой.
    expect((await pool.query(`SELECT 1 FROM teams WHERE id = $1`, [fx.strangerTeam])).rowCount).toBe(1);
  });

  it("одобренная в консоли тестовая заявка на команду удаляется вместе с набором", async () => {
    const scenario = await seedOnce(new Date());
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, short_code) VALUES ('Барсы (тест)', $1) RETURNING id`,
      [`seedbars${stamp}`]
    );
    await pool.query(`UPDATE team_creation_requests SET status = 'APPROVED', team_id = $1 WHERE id = $2`, [
      team.rows[0].id,
      ids.stableUuid("team-request:galiev"),
    ]);
    await removeAll(scenario.teamIds);
    expect((await pool.query(`SELECT 1 FROM teams WHERE id = $1`, [team.rows[0].id])).rowCount).toBe(0);
  });
});
