import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.AUTH_YANDEX_ENABLED = "1";
process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";
process.env.DEV_AUTH_ENABLED = "1";
process.env.DEV_AUTH_SECRET = "";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let app: typeof import("../../app.js").app;
let pool: typeof import("../../db/pool.js").pool;

const PRIMARY_TG = "960001";
const OTHER_TG = "960002";
const PRIMARY_USERNAME = "yandex_link_primary";
const OTHER_USERNAME = "yandex_link_other";
const PRIMARY_YANDEX_SUB = "yandex_link_sub_42";
const OTHER_YANDEX_SUB = "yandex_link_sub_other_77";
const SHARED_YANDEX_SUB = "yandex_link_sub_shared_99";

let primaryUserId: string;
let otherUserId: string;

async function seedUsers() {
  const r1 = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
     VALUES ($1::bigint, $2, 'Yandex Link Primary', 'ya_primary', 'USER', NOW(), NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [PRIMARY_TG, PRIMARY_USERNAME]
  );
  primaryUserId = r1.rows[0].id;
  // Backfill the telegram identity for the primary user so identity-count is correct.
  await pool.query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, 'telegram', $2, NULL)
     ON CONFLICT DO NOTHING`,
    [primaryUserId, PRIMARY_TG]
  );

  const r2 = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role, onboarding_completed_at, role_selected_at)
     VALUES ($1::bigint, $2, 'Yandex Link Other', 'ya_other', 'USER', NOW(), NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [OTHER_TG, OTHER_USERNAME]
  );
  otherUserId = r2.rows[0].id;
  await pool.query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, 'telegram', $2, NULL)
     ON CONFLICT DO NOTHING`,
    [otherUserId, OTHER_TG]
  );
}

async function cleanupSeed() {
  await pool.query(
    `DELETE FROM auth_oauth_pending_link WHERE user_id IN ($1, $2)`,
    [primaryUserId, otherUserId]
  );
  await pool.query(
    `DELETE FROM auth_oauth_state WHERE link_user_id IN ($1, $2)`,
    [primaryUserId, otherUserId]
  );
  await pool.query(
    `DELETE FROM user_identities WHERE provider = 'yandex' AND provider_user_id IN ($1, $2, $3)`,
    [PRIMARY_YANDEX_SUB, OTHER_YANDEX_SUB, SHARED_YANDEX_SUB]
  );
  await pool.query(
    `DELETE FROM user_identities WHERE user_id IN ($1, $2)`,
    [primaryUserId, otherUserId]
  );
  await pool.query(
    `DELETE FROM audit_logs WHERE user_id IN ($1, $2) AND action IN ('identity.link', 'identity.unlink', 'auth.telegram.login', 'auth.yandex.login')`,
    [primaryUserId, otherUserId]
  );
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [primaryUserId, otherUserId]);
}

async function loginAs(telegramId: string, username: string) {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/dev/login")
    .send({ telegramId, username, ensureTeam: false });
  if (res.status !== 200) {
    throw new Error(`dev login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
  ({ pool } = await import("../../db/pool.js"));
  await seedUsers();
});

afterAll(async () => {
  await cleanupSeed();
});

describe("yandex link/unlink routes", () => {
  it("GET /link/start without session returns 401", async () => {
    const res = await request(app).get("/api/v1/auth/yandex/link/start");
    expect(res.status).toBe(401);
  });

  it("GET /link/start with session redirects to Yandex authorize with intent=link state", async () => {
    const agent = await loginAs(PRIMARY_TG, PRIMARY_USERNAME);
    const res = await agent.get("/api/v1/auth/yandex/link/start");
    expect(res.status).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain("https://oauth.yandex.ru/authorize");
    expect(loc).toContain("client_id=yandex-cid");
    const stateMatch = loc.match(/[?&]state=([A-Za-z0-9_-]+)/);
    expect(stateMatch).toBeTruthy();
    // Verify the state row is bound to this user and has intent=link
    const r = await pool.query(
      `SELECT intent, link_user_id FROM auth_oauth_state WHERE state = $1`,
      [stateMatch![1]]
    );
    expect(r.rows[0].intent).toBe("link");
    expect(r.rows[0].link_user_id).toBe(primaryUserId);
  });

  it("GET /link/callback with valid state links the identity directly and redirects to profile", async () => {
    const stateMod = await import("../../lib/oauth-state.js");
    const { state } = await stateMod.createState({
      provider: "yandex",
      intent: "link",
      redirectTo: "/app/profile",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: primaryUserId,
      codeVerifier: null,
      nonce: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "AT_link", token_type: "bearer", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: PRIMARY_YANDEX_SUB,
          login: "yauser",
          default_email: "primary@yandex.ru",
          real_name: "Primary Y",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(app).get(
      `/api/v1/auth/yandex/link/callback?code=auth-c&state=${state}`
    );
    vi.unstubAllGlobals();
    // No session cookie sent — the link must still persist (Telegram in-app
    // browser drops the cookie across the OAuth round-trip).
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/app/profile?linked=yandex");

    // Identity row persisted in one step (no /link/confirm).
    const ident = await pool.query(
      `SELECT user_id, email FROM user_identities WHERE provider='yandex' AND provider_user_id=$1`,
      [PRIMARY_YANDEX_SUB]
    );
    expect(ident.rows[0].user_id).toBe(primaryUserId);
    expect(ident.rows[0].email).toBe("primary@yandex.ru");

    // Audit row written.
    const audit = await pool.query(
      `SELECT action, payload FROM audit_logs
        WHERE user_id = $1 AND action = 'identity.link'
        ORDER BY created_at DESC LIMIT 1`,
      [primaryUserId]
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].payload.provider).toBe("yandex");

    // Idempotent re-link: same user + same sub again still succeeds.
    const { state: state2 } = await stateMod.createState({
      provider: "yandex",
      intent: "link",
      redirectTo: "/app/profile",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: primaryUserId,
      codeVerifier: null,
      nonce: null,
    });
    const fetchMock2 = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "AT_link_again", token_type: "bearer", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: PRIMARY_YANDEX_SUB, login: "yauser", default_email: "primary@yandex.ru" }),
      });
    vi.stubGlobal("fetch", fetchMock2);
    const resAgain = await request(app).get(
      `/api/v1/auth/yandex/link/callback?code=auth-c-again&state=${state2}`
    );
    vi.unstubAllGlobals();
    expect(resAgain.status).toBe(302);
    expect(resAgain.headers.location).toBe("/app/profile?linked=yandex");

    // Cleanup so later tests see a fresh state.
    await pool.query(
      `DELETE FROM user_identities WHERE provider='yandex' AND provider_user_id=$1`,
      [PRIMARY_YANDEX_SUB]
    );
  });

  it("GET /link/callback redirects with OAUTH_LINK_TAKEN when yandex sub belongs to another user", async () => {
    // Seed: shared yandex sub already linked to otherUserId
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'yandex', $2, 'other@yandex.ru')
       ON CONFLICT DO NOTHING`,
      [otherUserId, SHARED_YANDEX_SUB]
    );

    const stateMod = await import("../../lib/oauth-state.js");
    const { state } = await stateMod.createState({
      provider: "yandex",
      intent: "link",
      redirectTo: "/app/profile",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: primaryUserId,
      codeVerifier: null,
      nonce: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "AT_link2", token_type: "bearer", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: SHARED_YANDEX_SUB, login: "shared", default_email: "shared@yandex.ru" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(app).get(
      `/api/v1/auth/yandex/link/callback?code=auth-c2&state=${state}`
    );
    vi.unstubAllGlobals();
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/app/profile?link_error=OAUTH_LINK_TAKEN");

    // The sub stays bound to the other user; primary did NOT acquire it.
    const stillOther = await pool.query(
      `SELECT user_id FROM user_identities WHERE provider='yandex' AND provider_user_id=$1`,
      [SHARED_YANDEX_SUB]
    );
    expect(stillOther.rows[0].user_id).toBe(otherUserId);
    const primaryHas = await pool.query(
      `SELECT 1 FROM user_identities WHERE user_id=$1 AND provider='yandex'`,
      [primaryUserId]
    );
    expect(primaryHas.rowCount).toBe(0);

    await pool.query(
      `DELETE FROM user_identities WHERE provider='yandex' AND provider_user_id=$1`,
      [SHARED_YANDEX_SUB]
    );
  });

  it("POST /unlink removes yandex identity when user has >=2 identities", async () => {
    // Seed: primary user with both telegram + yandex
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'yandex', $2, 'p@y.ru')
       ON CONFLICT DO NOTHING`,
      [primaryUserId, PRIMARY_YANDEX_SUB]
    );

    const agent = await loginAs(PRIMARY_TG, PRIMARY_USERNAME);
    const res = await agent.post("/api/v1/auth/yandex/unlink").send({ provider: "yandex" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const r = await pool.query(
      `SELECT 1 FROM user_identities WHERE user_id = $1 AND provider = 'yandex'`,
      [primaryUserId]
    );
    expect(r.rowCount).toBe(0);
  });

  it("POST /unlink with last identity returns 409 OAUTH_LAST_IDENTITY", async () => {
    // Ensure primary user has exactly one identity (telegram only).
    await pool.query(
      `DELETE FROM user_identities WHERE user_id = $1 AND provider <> 'telegram'`,
      [primaryUserId]
    );

    const agent = await loginAs(PRIMARY_TG, PRIMARY_USERNAME);
    const res = await agent.post("/api/v1/auth/yandex/unlink").send({ provider: "telegram" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("OAUTH_LAST_IDENTITY");
  });

  it("POST /unlink rejects removing telegram identity when account_role='ADMIN'", async () => {
    // Add a second identity so the unlink would otherwise be allowed.
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'yandex', $2, 'p@y.ru')
       ON CONFLICT DO NOTHING`,
      [primaryUserId, PRIMARY_YANDEX_SUB]
    );

    // Login first (dev/login forces account_role = 'USER'), then promote the
    // DB row to ADMIN so the route's own SELECT sees ADMIN.
    const agent = await loginAs(PRIMARY_TG, PRIMARY_USERNAME);
    await pool.query(`UPDATE users SET account_role = 'ADMIN' WHERE id = $1`, [primaryUserId]);

    const res = await agent.post("/api/v1/auth/yandex/unlink").send({ provider: "telegram" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");

    // Restore
    await pool.query(`UPDATE users SET account_role = 'USER' WHERE id = $1`, [primaryUserId]);
    await pool.query(
      `DELETE FROM user_identities WHERE user_id = $1 AND provider = 'yandex'`,
      [primaryUserId]
    );
  });
});
