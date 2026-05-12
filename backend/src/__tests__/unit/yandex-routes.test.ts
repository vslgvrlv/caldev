import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.AUTH_YANDEX_ENABLED = "1";
process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_oauth_state WHERE redirect_to LIKE '/test%' OR redirect_to LIKE '/app%'`);
});

describe("yandex routes", () => {
  it("GET /start redirects to authorize URL and stores state", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/start?redirectTo=/app");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://oauth.yandex.ru/authorize");
    expect(res.headers.location).toMatch(/state=[A-Za-z0-9_-]+/);
    expect(res.headers.location).toContain("client_id=yandex-cid");
  });

  it("GET /callback without state returns 400", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/callback?code=x");
    expect(res.status).toBe(400);
  });

  it("GET /callback with invalid state redirects to /login with OAUTH_STATE_INVALID", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/callback?code=x&state=does-not-exist");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("auth_error=OAUTH_STATE_INVALID");
  });

  it("GET /callback with valid state but no existing identity redirects with NO_ACCOUNT", async () => {
    const stateMod = await import("../../lib/oauth-state.js");
    const { state } = await stateMod.createState({
      provider: "yandex",
      intent: "login",
      redirectTo: "/app",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "AT", token_type: "bearer", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yandex_user_no_identity_99999", login: "no_match", default_email: "x@y.ru" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(app).get(`/api/v1/auth/yandex/callback?code=auth-code&state=${state}`);
    vi.unstubAllGlobals();
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("auth_error=OAUTH_NO_ACCOUNT");
  });

  it("GET /callback succeeds when identity already exists and redirects to redirectTo", async () => {
    // Seed user + yandex identity directly.
    const r = await pool.query<{ id: string }>(
      `INSERT INTO users (telegram_id, username, name, nickname, account_role)
       VALUES (999994, 'yandex_route_test', 'Yandex Route Test', 'yr_test', 'USER')
       ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const userId = r.rows[0].id;
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'yandex', 'seeded_yandex_id_42', 'seeded@y.ru')
       ON CONFLICT DO NOTHING`,
      [userId]
    );

    const stateMod = await import("../../lib/oauth-state.js");
    const { state } = await stateMod.createState({
      provider: "yandex",
      intent: "login",
      redirectTo: "/app",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "AT", token_type: "bearer", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "seeded_yandex_id_42", login: "match", default_email: "seeded@y.ru" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get(`/api/v1/auth/yandex/callback?code=auth-code&state=${state}`);
    vi.unstubAllGlobals();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/app");
    expect(res.headers["set-cookie"]).toBeDefined();

    // Cleanup
    await pool.query(`DELETE FROM user_identities WHERE provider='yandex' AND provider_user_id='seeded_yandex_id_42'`);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
});
