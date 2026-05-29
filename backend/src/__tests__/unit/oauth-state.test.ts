import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let mod: typeof import("../../lib/oauth-state.js");
let testUserId: string;

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  mod = await import("../../lib/oauth-state.js");
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES (999993, 'oauth_state_test', 'OAuth State', 'os_test', 'USER')
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  testUserId = r.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM auth_oauth_state WHERE redirect_to LIKE 'oauth-state-test%'`);
  await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
});

describe("oauth-state", () => {
  it("create + consume returns row exactly once", async () => {
    const { state: token } = await mod.createState({
      provider: "yandex",
      intent: "login",
      redirectTo: "oauth-state-test-1",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    const first = await mod.consumeState(token, "yandex");
    expect(first?.redirectTo).toBe("oauth-state-test-1");
    expect(first?.intent).toBe("login");
    const second = await mod.consumeState(token, "yandex");
    expect(second).toBeNull();
  });

  it("consume rejects wrong provider", async () => {
    const { state: token } = await mod.createState({
      provider: "yandex",
      intent: "login",
      redirectTo: "oauth-state-test-2",
      ttlSeconds: 60,
      ipHash: null,
      uaHash: null,
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    expect(await mod.consumeState(token, "vk")).toBeNull();
    // Cleanup remaining row.
    expect(await mod.consumeState(token, "yandex")).not.toBeNull();
  });

  it("consume rejects expired state", async () => {
    const { state: token } = await mod.createState({
      provider: "yandex",
      intent: "login",
      redirectTo: "oauth-state-test-3",
      ttlSeconds: -1,
      ipHash: null,
      uaHash: null,
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    expect(await mod.consumeState(token, "yandex")).toBeNull();
    await pool.query(`DELETE FROM auth_oauth_state WHERE state = $1`, [token]);
  });

  it("preserves intent='link' and linkUserId", async () => {
    const { state: token } = await mod.createState({
      provider: "yandex",
      intent: "link",
      redirectTo: "oauth-state-test-4",
      ttlSeconds: 60,
      ipHash: "ip",
      uaHash: "ua",
      linkUserId: testUserId,
      codeVerifier: "v",
      nonce: "n",
    });
    const row = await mod.consumeState(token, "yandex");
    expect(row?.intent).toBe("link");
    expect(row?.linkUserId).toBe(testUserId);
    expect(row?.codeVerifier).toBe("v");
    expect(row?.nonce).toBe("n");
  });
});
