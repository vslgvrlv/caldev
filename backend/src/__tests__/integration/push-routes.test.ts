import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
// Ключи фиктивные, но валидного формата (web-push требует base64url VAPID
// ключей при setVapidDetails) — реальная отправка в этих тестах не происходит.
process.env.PUSH_NOTIFICATIONS_ENABLED = "1";
process.env.VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BDd9Aqz2tVC8M8V7XKf5m5r3nxbz3Z2y3G9b1W8bA0G2Z0bA0G2Z0bA0G2Z0bA0G2Z0bA0G2Z0bA0G2Z0bA0G2Y";
process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "6LDiMsL9cR0xHfPRwiJRZ-27LHyQtW9tfDH5qmUSCoY";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const telegramId = "970002";

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
});

afterAll(async () => {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint LIKE 'https://push.example.com/pushroutes%'`);
  await pool.query(`DELETE FROM users WHERE telegram_id = $1::bigint`, [telegramId]);
});

async function loginAgent() {
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/dev/login")
    .set("x-dev-auth-secret", process.env.DEV_AUTH_SECRET || "")
    .send({ telegramId, username: "pushroutes_test", ensureTeam: false });
  if (loginRes.status !== 200) {
    throw new Error(`dev login failed ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }
  return agent;
}

describe("push routes", () => {
  it("GET /push/vapid-key returns the public key when push is enabled", async () => {
    const res = await request(app).get("/api/v1/push/vapid-key");
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
  });

  it("POST /push/subscribe requires auth", async () => {
    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ endpoint: "https://push.example.com/pushroutes-noauth", keys: { p256dh: "p", auth: "a" } });
    expect(res.status).toBe(401);
  });

  it("subscribe stores the subscription, re-subscribe upserts, unsubscribe removes it", async () => {
    const agent = await loginAgent();
    const endpoint = "https://push.example.com/pushroutes-1";

    const subscribeRes = await agent.post("/api/v1/push/subscribe").send({
      endpoint,
      keys: { p256dh: "p256dh-value-1", auth: "auth-value-1" },
    });
    expect(subscribeRes.status).toBe(200);

    const row = await pool.query<{ p256dh: string }>(`SELECT p256dh FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    expect(row.rows[0]?.p256dh).toBe("p256dh-value-1");

    // Re-subscribe with rotated keys (browser can rotate without unsubscribing first).
    const resubscribeRes = await agent.post("/api/v1/push/subscribe").send({
      endpoint,
      keys: { p256dh: "p256dh-value-2", auth: "auth-value-2" },
    });
    expect(resubscribeRes.status).toBe(200);
    const rowAfterUpsert = await pool.query<{ p256dh: string }>(`SELECT p256dh FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    expect(rowAfterUpsert.rowCount).toBe(1);
    expect(rowAfterUpsert.rows[0]?.p256dh).toBe("p256dh-value-2");

    const unsubscribeRes = await agent.post("/api/v1/push/unsubscribe").send({ endpoint });
    expect(unsubscribeRes.status).toBe(200);
    const rowAfterDelete = await pool.query(`SELECT 1 FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    expect(rowAfterDelete.rowCount).toBe(0);
  });
});
