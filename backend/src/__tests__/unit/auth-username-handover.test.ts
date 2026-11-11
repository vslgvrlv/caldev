import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ник Telegram в каждый момент принадлежит одному человеку. Если он уже
// записан у другого аккаунта, у того аккаунта ник устарел (человек сменил его
// или отдал). Вход не должен падать с 500 на UNIQUE(users.username): ник
// снимается со старого аккаунта и записывается новому в одной транзакции.

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let mod: typeof import("../../lib/oauth-login.js");

const stamp = Date.now() % 1_000_000;
const OLD_TG = 930_000_000 + stamp;
const NEW_TG = 931_000_000 + stamp;
const THIRD_TG = 932_000_000 + stamp;
const NICK = `handover_${stamp}`;
const ids = [OLD_TG, NEW_TG, THIRD_TG].map(String);

function makeReqRes(): { req: any; res: any } {
  const session: any = {
    regenerate(cb: (err?: unknown) => void) {
      for (const key of Object.keys(this)) {
        if (key === "cookie" || typeof (this as any)[key] === "function") continue;
        delete (this as any)[key];
      }
      cb();
    },
    save(cb: (err?: unknown) => void) {
      cb();
    },
  };
  return { req: { session, headers: {}, ip: "127.0.0.1", get: () => "" }, res: { clearCookie: () => {} } };
}

function login(telegramId: number, username: string | null, authMethod: "PAIRING" | "WEBAPP" = "PAIRING") {
  const { req, res } = makeReqRes();
  return mod.completeOAuthLogin(req, res, {
    provider: "telegram",
    profile: { id: String(telegramId), firstName: `U${telegramId}`, lastName: null, username, avatarUrl: null },
    authMethod,
  });
}

async function usernameOf(telegramId: number): Promise<string | null> {
  const r = await pool.query<{ username: string | null }>(`SELECT username FROM users WHERE telegram_id = $1`, [telegramId]);
  return r.rows[0]?.username ?? null;
}

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  mod = await import("../../lib/oauth-login.js");
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE telegram_id::text = ANY($1))`,
    [ids]
  );
  await pool.query(`DELETE FROM user_identities WHERE provider = 'telegram' AND provider_user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM users WHERE telegram_id::text = ANY($1)`, [ids]);
});

describe("вход кодом: ник Telegram уже записан у другого аккаунта", () => {
  it("новый аккаунт входит, ник переезжает к нему, у старого — пусто", async () => {
    const old = await login(OLD_TG, NICK);
    expect(old?.userId).toBeTruthy();
    expect(await usernameOf(OLD_TG)).toBe(NICK);

    const fresh = await login(NEW_TG, NICK);
    expect(fresh?.userId).toBeTruthy();
    expect(fresh?.userId).not.toBe(old?.userId);
    expect(await usernameOf(NEW_TG)).toBe(NICK);
    expect(await usernameOf(OLD_TG)).toBeNull();
  });

  it("старый аккаунт после этого входит как раньше — со своим новым ником или без него", async () => {
    const again = await login(OLD_TG, null);
    expect(again?.userId).toBeTruthy();
    expect(await usernameOf(OLD_TG)).toBeNull();
    const renamed = await login(OLD_TG, `${NICK}_new`);
    expect(renamed?.userId).toBe(again?.userId);
    expect(await usernameOf(OLD_TG)).toBe(`${NICK}_new`);
    expect(await usernameOf(NEW_TG)).toBe(NICK);
  });

  it("уже существующий аккаунт забирает ник, записанный у другого (в другом регистре тоже)", async () => {
    await login(THIRD_TG, null, "WEBAPP");
    const taken = await login(THIRD_TG, NICK.toUpperCase(), "WEBAPP");
    expect(taken?.userId).toBeTruthy();
    expect(await usernameOf(THIRD_TG)).toBe(NICK.toUpperCase());
    expect(await usernameOf(NEW_TG)).toBeNull();
  });
});
