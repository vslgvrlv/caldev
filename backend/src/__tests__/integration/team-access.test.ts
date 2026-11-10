// Основа ревизии 11.11.2026, PR 2: команда в запросе и владелец платформы.
//
// Контракт: источник команды — параметр ручки → заголовок `X-PBTH-Team` →
// `?team=` → сессия. Без явной команды ответы прежние. Владелец платформы
// (список ADMIN_ROLE_ALLOWLIST_*) при явной команде действует как капитан
// (`via: 'owner'`), в составе не числится, его записи в журнале помечены.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = {
  member: String(976_000_000 + stamp),
  stranger: String(977_000_000 + stamp),
  owner: String(978_000_000 + stamp),
};

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.ADMIN_ROLE_ALLOWLIST_IDS = TG.owner;

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const CODE_A = `TaC${stamp}`;
const f = {
  teamA: "",
  teamB: "",
  users: {} as Record<keyof typeof TG, string>,
  eventA: "",
};

const agents = new Map<string, ReturnType<typeof request.agent>>();
async function login(who: keyof typeof TG) {
  const cached = agents.get(who);
  if (cached) return cached;
  const agent = request.agent(app);
  agents.set(who, agent);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `ta_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  // Имена так, чтобы команда A шла первой по алфавиту: её /init выберет по умолчанию.
  const a = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget) VALUES ($1, $2, 700) RETURNING id`,
    [`AAA Access ${stamp}`, CODE_A]
  );
  const b = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget) VALUES ($1, $2, 900) RETURNING id`,
    [`AAB Access ${stamp}`, `TbB${stamp}`]
  );
  f.teamA = a.rows[0].id;
  f.teamB = b.rows[0].id;
  for (const who of Object.keys(TG) as Array<keyof typeof TG>) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `ta_${who}_${stamp}`, `Access ${who}`, `ta_${who}`]
    );
    f.users[who] = u.rows[0].id;
  }
  await pool.query(
    `INSERT INTO team_memberships (user_id, team_id, role) VALUES ($1, $2, 'PLAYER'), ($1, $3, 'CAPTAIN')`,
    [f.users.member, f.teamA, f.teamB]
  );
  const e = await pool.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, start_at) VALUES ($1, 'TRAINING', $2, NOW() + INTERVAL '2 days') RETURNING id`,
    [f.teamA, `Тренировка A ${stamp}`]
  );
  f.eventA = e.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[f.teamA, f.teamB]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(f.users)]);
});

describe("/init без явной команды — как раньше", () => {
  it("команда из сессии, без новых пометок в ответе", async () => {
    const member = await login("member");
    const res = await member.get("/api/v1/init");
    expect(res.status).toBe(200);
    expect(res.body.team.id).toBe(f.teamA);
    expect(res.body.team).not.toHaveProperty("via");
    expect(res.body.teams.every((t: any) => !("via" in t))).toBe(true);
  });
});

describe("/init?team= и заголовок X-PBTH-Team", () => {
  it("код без учёта регистра → нужная команда, сессия не меняется", async () => {
    const member = await login("member");
    const res = await member.get(`/api/v1/init?team=${CODE_A.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.team).toMatchObject({ id: f.teamA, role: "PLAYER", via: "membership" });

    const byId = await member.get(`/api/v1/init?team=${f.teamB}`);
    expect(byId.body.team).toMatchObject({ id: f.teamB, role: "CAPTAIN", via: "membership" });
    expect(byId.body.teams.map((t: any) => t.via)).toEqual(["membership", "membership"]);

    // Явная команда не переключает сессию: старый фронтенд в другой вкладке
    // остаётся в своей команде.
    const plain = await member.get("/api/v1/init");
    expect(plain.body.team.id).toBe(f.teamA);
  });

  it("заголовок X-PBTH-Team выбирает команду и для /init, и для денег", async () => {
    const member = await login("member");
    const viaHeader = await member.get("/api/v1/init").set("X-PBTH-Team", f.teamB);
    expect(viaHeader.body.team.id).toBe(f.teamB);
    // В сессии — команда A, где он игрок: книга закрыта. С заголовком B — капитан.
    expect((await member.get("/api/v1/finance/overview")).status).toBe(403);
    const ledger = await member.get("/api/v1/finance/overview").set("X-PBTH-Team", f.teamB);
    expect(ledger.status).toBe(200);
    expect(ledger.body.team.id).toBe(f.teamB);
  });

  it("неизвестная команда — 404, чужая — 403", async () => {
    const member = await login("member");
    const missing = await member.get("/api/v1/init?team=nosuchteam");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("TEAM_NOT_FOUND");
    const stranger = await login("stranger");
    const denied = await stranger.get(`/api/v1/init?team=${CODE_A}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("TEAM_ACCESS_DENIED");
    const deniedHeader = await stranger.get("/api/v1/places").set("X-PBTH-Team", f.teamA);
    expect(deniedHeader.status).toBe(403);
  });
});

describe("владелец платформы", () => {
  it("без явной команды — прежний ответ", async () => {
    const owner = await login("owner");
    const res = await owner.get("/api/v1/init");
    expect(res.body.noTeamYet).toBe(true);
  });

  it("/init?team= — команда, где он не состоит, как капитан; в списке все команды", async () => {
    const owner = await login("owner");
    const res = await owner.get(`/api/v1/init?team=${CODE_A}`);
    expect(res.status).toBe(200);
    expect(res.body.team).toMatchObject({ id: f.teamA, role: "CAPTAIN", via: "owner", budget: 700, financeScope: "FULL" });
    expect(res.body.members.some((m: any) => m.id === f.users.owner)).toBe(false);
    const teams = new Map<string, any>(res.body.teams.map((t: any) => [t.teamId, t]));
    expect(teams.get(f.teamA)).toMatchObject({ via: "owner", role: "CAPTAIN", membershipId: null });
    expect(teams.get(f.teamB)).toMatchObject({ via: "owner" });
    const event = res.body.events.find((e: any) => e.id === f.eventA);
    expect(event).toMatchObject({ viewerRole: "CAPTAIN", rsvpStatus: "UNANSWERED" });
    expect(res.body.actionRequiredEvents.some((e: any) => e.id === f.eventA)).toBe(false);
  });

  it("действует как капитан по заголовку, в состав не попадает, журнал помечен", async () => {
    const owner = await login("owner");
    const created = await owner
      .post("/api/v1/events")
      .set("X-PBTH-Team", f.teamA)
      .send({ type: "TRAINING", title: `От владельца ${stamp}`, startAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(created.status).toBe(201);

    const audit = await pool.query<{ payload: any }>(
      `SELECT payload FROM audit_logs WHERE user_id = $1 AND action = 'events.create' ORDER BY created_at DESC LIMIT 1`,
      [f.users.owner]
    );
    expect(audit.rows[0].payload).toMatchObject({ actorVia: "owner", ownerTeamIds: [f.teamA] });

    const membership = await pool.query(`SELECT 1 FROM team_memberships WHERE user_id = $1`, [f.users.owner]);
    expect(membership.rowCount).toBe(0);
  });

  it("без явной команды владелец в чужой команде ничего не может", async () => {
    const owner = await login("owner");
    const res = await owner
      .post("/api/v1/events")
      .send({ type: "TRAINING", title: "Без команды", startAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(res.status).toBe(403);
  });

  it("журнал обычного человека пометки владельца не получает", async () => {
    const member = await login("member");
    await member
      .post("/api/v1/events")
      .set("X-PBTH-Team", f.teamB)
      .send({ type: "TRAINING", title: `От капитана ${stamp}`, startAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(201);
    const audit = await pool.query<{ payload: any }>(
      `SELECT payload FROM audit_logs WHERE user_id = $1 AND action = 'events.create' ORDER BY created_at DESC LIMIT 1`,
      [f.users.member]
    );
    expect(audit.rows[0].payload).not.toHaveProperty("actorVia");
  });
});

describe("места для треков", () => {
  it("модули треков подключены и пока пусты", async () => {
    // `/join-requests` и `/team-requests` наполнил трек 1 — их держит track1-join-flow.test.ts.
    for (const path of ["/reminders", "/platform", "/slots"]) {
      const res = await request(app).get(`/api/v1${path}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    }
  });

  it("код команды уникален без учёта регистра", async () => {
    await expect(
      pool.query(`INSERT INTO teams (name, short_code) VALUES ('dup', $1)`, [CODE_A.toLowerCase()])
    ).rejects.toMatchObject({ code: "23505" });
  });
});
