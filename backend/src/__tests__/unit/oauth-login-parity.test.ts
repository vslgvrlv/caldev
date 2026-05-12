import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";

let pool: typeof import("../../db/pool.js").pool;
let mod: typeof import("../../lib/oauth-login.js");
const cleanup: number[] = [];

beforeAll(async () => {
  ({ pool } = await import("../../db/pool.js"));
  mod = await import("../../lib/oauth-login.js");
});

afterAll(async () => {
  if (cleanup.length > 0) {
    const ids = cleanup.map(String);
    await pool.query(
      `DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE telegram_id::text = ANY($1))`,
      [ids]
    );
    await pool.query(
      `DELETE FROM user_identities WHERE provider='telegram' AND provider_user_id = ANY($1)`,
      [ids]
    );
    await pool.query(`DELETE FROM users WHERE telegram_id::text = ANY($1)`, [ids]);
  }
});

function makeReqRes(): { req: any; res: any } {
  const session: any = {
    regenerate(cb: (err?: unknown) => void) {
      // Real express-session.regenerate wipes everything but session.cookie.
      // Mirror that here so tests that pre-populate session fields see them
      // cleared (matches the prod helper's behaviour).
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
  const req: any = { session, headers: {}, ip: "127.0.0.1", get: () => "" };
  const res: any = { clearCookie: () => {} };
  return { req, res };
}

describe("completeOAuthLogin parity", () => {
  it("BOT_HANDOFF new user leaves onboarding_completed_at NULL", async () => {
    const telegramId = 920001;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    const result = await mod.completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(telegramId),
        firstName: "BotHandoff",
        lastName: null,
        username: "bot_handoff_test",
        avatarUrl: null,
      },
      authMethod: "BOT_HANDOFF",
      entryRoleOverride: "USER",
    });
    expect(result?.userId).toBeTruthy();
    const { rows } = await pool.query<{ onboarding_completed_at: Date | null }>(
      `SELECT onboarding_completed_at FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    expect(rows[0].onboarding_completed_at).toBeNull();
  });

  it("WEBAPP new user sets onboarding_completed_at", async () => {
    const telegramId = 920002;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    await mod.completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(telegramId),
        firstName: "WebApp",
        lastName: null,
        username: "webapp_test",
        avatarUrl: null,
      },
      authMethod: "WEBAPP",
    });
    const { rows } = await pool.query<{ onboarding_completed_at: Date | null }>(
      `SELECT onboarding_completed_at FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    expect(rows[0].onboarding_completed_at).not.toBeNull();
  });

  it("entryRoleOverride='USER' writes to session.entryRole", async () => {
    const telegramId = 920003;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    await mod.completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(telegramId),
        firstName: "Dev",
        lastName: null,
        username: "dev_entryrole_test",
        avatarUrl: null,
      },
      authMethod: "BOT_HANDOFF",
      entryRoleOverride: "USER",
    });
    expect(req.session.entryRole).toBe("USER");
  });

  it("non-allowlisted user without override is locked to USER scope", async () => {
    // Mirrors the original: if canChooseAdminRole returns false (which is
    // true for any random telegram_id), entryRole must be "USER".
    const telegramId = 920004;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    await mod.completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(telegramId),
        firstName: "Locked",
        lastName: null,
        username: "no_override_test",
        avatarUrl: null,
      },
      authMethod: "OIDC",
    });
    expect(req.session.entryRole).toBe("USER");

    // And the row gets account_role='USER' + role_selected_at backfilled.
    const { rows } = await pool.query<{ account_role: string; role_selected_at: Date | null }>(
      `SELECT account_role, role_selected_at FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    expect(rows[0].account_role).toBe("USER");
    expect(rows[0].role_selected_at).not.toBeNull();
  });

  it("ADMIN override against a non-allowlisted user throws ADMIN_SCOPE_NONE", async () => {
    const telegramId = 920005;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    await expect(
      mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "Forbidden",
          lastName: null,
          username: "forbidden_admin_test",
          avatarUrl: null,
        },
        authMethod: "BOT_HANDOFF",
        entryRoleOverride: "ADMIN",
      })
    ).rejects.toThrow("ADMIN_SCOPE_NONE");
  });

  it("yandex provider with no identity returns null (no auto-create)", async () => {
    const { req, res } = makeReqRes();
    const result = await mod.completeOAuthLogin(req, res, {
      provider: "yandex",
      profile: { id: "yandex_anon_user_920006", email: "anon@y.ru" },
      authMethod: "YANDEX_OAUTH",
    });
    expect(result).toBeNull();
    expect(req.session.userId).toBeUndefined();
    expect(req.session.authMethod).toBeUndefined();
    // Sanity: nothing inserted.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM user_identities WHERE provider='yandex' AND provider_user_id=$1`,
      ["yandex_anon_user_920006"]
    );
    expect(rows[0].count).toBe("0");
  });

  it("writes audit row with auth.telegram.login action + telegramId + authMethod", async () => {
    const telegramId = 920007;
    cleanup.push(telegramId);
    const { req, res } = makeReqRes();
    await mod.completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(telegramId),
        firstName: "Audit",
        lastName: null,
        username: "audit_test",
        avatarUrl: null,
      },
      authMethod: "WEBAPP",
    });
    const { rows } = await pool.query<{ action: string; payload: any }>(
      `SELECT action, payload FROM audit_logs
        WHERE user_id = (SELECT id FROM users WHERE telegram_id=$1)
        ORDER BY created_at DESC LIMIT 1`,
      [telegramId]
    );
    expect(rows[0]?.action).toBe("auth.telegram.login");
    expect(rows[0]?.payload?.telegramId).toBe(String(telegramId));
    expect(rows[0]?.payload?.authMethod).toBe("WEBAPP");
  });

  it("login is idempotent (second call refreshes profile, keeps user)", async () => {
    const telegramId = 920008;
    cleanup.push(telegramId);
    {
      const { req, res } = makeReqRes();
      await mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "FirstLogin",
          lastName: null,
          username: "idempotent_test",
          avatarUrl: null,
        },
        authMethod: "WEBAPP",
      });
    }
    const firstUserId = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id=$1`,
      [telegramId]
    );
    {
      const { req, res } = makeReqRes();
      await mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "SecondLogin",
          lastName: "Updated",
          username: "idempotent_test",
          avatarUrl: null,
        },
        authMethod: "OIDC",
      });
    }
    const secondUserId = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE telegram_id=$1`,
      [telegramId]
    );
    expect(secondUserId.rows[0].id).toBe(firstUserId.rows[0].id);
    expect(secondUserId.rows[0].name).toBe("SecondLogin Updated");
  });
});
