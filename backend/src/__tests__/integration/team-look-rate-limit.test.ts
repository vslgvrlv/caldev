// Предел частоты на оформление команды: смена знака и загрузка логотипа
// считаются вместе, по вошедшему человеку. Запросы без входа получают 401 и
// ничью квоту не тратят; два человека с одного адреса предел не делят.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const stamp = Date.now() % 1_000_000;
const TG = { first: String(941_000_000 + stamp), second: String(942_000_000 + stamp) };
type Who = keyof typeof TG;

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.RATE_TEAM_LOOK_MAX = "3";
process.env.RATE_TEAM_LOOK_WINDOW_MS = "60000";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;
const users: string[] = [];
// Команды с таким id нет: вошедший получает 404 уже после счётчика.
const TEAM = "00000000-0000-4000-8000-000000000001";

async function login(who: Who) {
  const agent = request.agent(app);
  await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId: TG[who], username: `rl_${who}_${stamp}`, ensureTeam: false })
    .expect(200);
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  for (const who of Object.keys(TG) as Who[]) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
       VALUES ($1::bigint, $2, $3, $4, 'USER', NOW(), NOW()) RETURNING id`,
      [TG[who], `rl_${who}_${stamp}`, `Limit ${who}`, `rl_${who}`]
    );
    users.push(u.rows[0].id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
});

describe("предел частоты оформления", () => {
  it("запросы без входа получают 401 сколько угодно раз и квоту не тратят", async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).put(`/api/v1/teams/${TEAM}/logo`).set("Content-Type", "image/png").send(Buffer.from("x"));
      expect(res.status).toBe(401);
    }
    expect((await request(app).patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(401);
    expect((await request(app).delete(`/api/v1/teams/${TEAM}/logo`)).status).toBe(401);
  });

  it("после чужих 401 у вошедшего вся квота цела; четвёртый его запрос — 429 в общем формате", async () => {
    const first = await login("first");
    const statuses = [
      (await first.put(`/api/v1/teams/${TEAM}/logo`).set("Content-Type", "image/png").send(Buffer.from("x"))).status,
      (await first.patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status,
      (await first.delete(`/api/v1/teams/${TEAM}/logo`)).status,
    ];
    expect(statuses).toEqual([404, 404, 404]);

    const blocked = await first.put(`/api/v1/teams/${TEAM}/logo`).set("Content-Type", "image/png").send(Buffer.alloc(64 * 1024));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect((await first.patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(429);
  });

  it("второй человек с того же адреса предел не делит", async () => {
    const second = await login("second");
    for (let i = 0; i < 3; i += 1) {
      expect((await second.patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(404);
    }
    expect((await second.patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(429);
    // Без входа с того же адреса — по-прежнему 401, не 429.
    expect((await request(app).patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(401);
  });

  it("чтение логотипа под этот предел не попадает", async () => {
    const res = await request(app).get(`/api/v1/teams/logo/${"0".repeat(32)}.webp`);
    expect(res.status).toBe(404);
  });
});
