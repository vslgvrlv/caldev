import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
});

afterAll(async () => {
  await pool.query(`DELETE FROM user_identities WHERE provider_user_id LIKE 'idroutes%' OR provider_user_id = '970001'`);
  await pool.query(`DELETE FROM users WHERE telegram_id = 970001`);
});

describe("identities routes", () => {
  it("GET /identities returns 401 when anonymous", async () => {
    const res = await request(app).get("/api/v1/auth/identities");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_REQUIRED");
  });

  it("GET /identities returns linked providers for current session", async () => {
    // Pre-create user + telegram identity (dev/login otherwise falls back to a demo user).
    const telegramId = "970001";
    const userInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role)
       VALUES ($1::bigint, 'idroutes_test', 'IdRoutes Test', 'idr', 'USER')
       ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [telegramId]
    );
    const userId = userInsert.rows[0].id;
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'telegram', $2, NULL),
              ($1, 'yandex', 'idroutes_ya_1', 'idroutes@yandex.ru')
       ON CONFLICT DO NOTHING`,
      [userId, telegramId]
    );

    const agent = request.agent(app);
    const loginRes = await agent
      .post("/api/v1/auth/dev/login")
      .set("x-dev-auth-secret", process.env.DEV_AUTH_SECRET || "")
      .send({ telegramId, username: "idroutes_test", ensureTeam: false });
    if (loginRes.status !== 200) {
      throw new Error(`dev login failed ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    }

    const res = await agent.get("/api/v1/auth/identities");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.identities)).toBe(true);
    const providers = res.body.identities.map((i: any) => i.provider).sort();
    expect(providers).toContain("telegram");
    expect(providers).toContain("yandex");

    const ya = res.body.identities.find((i: any) => i.provider === "yandex");
    expect(ya.emailMasked).toMatch(/^i\*\*\*@yandex\.ru$/);
    expect(typeof ya.linkedAt).toBe("string");
  });
});
