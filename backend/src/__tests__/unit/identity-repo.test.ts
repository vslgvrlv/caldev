import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let repo: typeof import("../../lib/identity-repo.js");
let primaryUserId: string;
let secondaryUserId: string;

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  repo = await import("../../lib/identity-repo.js");
  const r1 = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES (999991, 'identity_test_primary', 'Identity Primary', 'id_primary', 'USER')
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  primaryUserId = r1.rows[0].id;
  const r2 = await pool.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, account_role)
     VALUES (999992, 'identity_test_secondary', 'Identity Secondary', 'id_secondary', 'USER')
     ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  secondaryUserId = r2.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM user_identities WHERE user_id IN ($1, $2)`, [primaryUserId, secondaryUserId]);
  await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [primaryUserId, secondaryUserId]);
});

describe("identity-repo", () => {
  it("link + find + list + unlink round-trip", async () => {
    const linkResult = await repo.linkIdentity({
      userId: primaryUserId,
      provider: "yandex",
      providerUserId: "yandex_test_1",
      email: "test@yandex.ru",
    });
    expect(linkResult.conflict).toBeNull();
    expect(linkResult.identity?.userId).toBe(primaryUserId);
    expect(linkResult.identity?.email).toBe("test@yandex.ru");

    const found = await repo.findIdentity("yandex", "yandex_test_1");
    expect(found?.userId).toBe(primaryUserId);

    const list = await repo.listIdentitiesForUser(primaryUserId);
    expect(list.map((i) => i.provider)).toEqual(expect.arrayContaining(["yandex"]));

    const unlinked = await repo.unlinkIdentity(primaryUserId, "yandex");
    expect(unlinked).toBe(true);
    expect(await repo.findIdentity("yandex", "yandex_test_1")).toBeNull();
  });

  it("returns USER_PROVIDER_TAKEN when same user re-links the same provider", async () => {
    await repo.linkIdentity({
      userId: primaryUserId,
      provider: "yandex",
      providerUserId: "yandex_dup_a",
      email: null,
    });
    const second = await repo.linkIdentity({
      userId: primaryUserId,
      provider: "yandex",
      providerUserId: "yandex_dup_b",
      email: null,
    });
    expect(second.identity).toBeNull();
    expect(second.conflict).toBe("USER_PROVIDER_TAKEN");
    await repo.unlinkIdentity(primaryUserId, "yandex");
  });

  it("returns PROVIDER_SUBJECT_TAKEN when the same provider account is linked to a different user", async () => {
    await repo.linkIdentity({
      userId: primaryUserId,
      provider: "yandex",
      providerUserId: "yandex_shared",
      email: null,
    });
    const second = await repo.linkIdentity({
      userId: secondaryUserId,
      provider: "yandex",
      providerUserId: "yandex_shared",
      email: null,
    });
    expect(second.identity).toBeNull();
    expect(second.conflict).toBe("PROVIDER_SUBJECT_TAKEN");
    await repo.unlinkIdentity(primaryUserId, "yandex");
  });

  it("countIdentitiesForUser tracks live identity count", async () => {
    await repo.linkIdentity({ userId: primaryUserId, provider: "yandex", providerUserId: "ya_count_1", email: null });
    const count = await repo.countIdentitiesForUser(primaryUserId);
    expect(count).toBeGreaterThanOrEqual(1);
    await repo.unlinkIdentity(primaryUserId, "yandex");
  });
});
