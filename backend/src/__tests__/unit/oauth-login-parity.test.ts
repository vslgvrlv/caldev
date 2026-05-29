import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
// Seed admin allowlist with the telegram_ids used by the cross-provider
// allowlist tests below. Tests that rely on the empty allowlist (e.g. the
// "non-allowlisted user is locked to USER" cases) use telegram_ids outside
// this set. Multiple ids are listed up-front because env.ts reads
// ADMIN_ROLE_ALLOWLIST_IDS once at import time — mutating it later in a
// test has no effect.
process.env.ADMIN_ROLE_ALLOWLIST_IDS = process.env.ADMIN_ROLE_ALLOWLIST_IDS || "920100,920102";

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

  it("ADMIN override for an allowlisted user via YANDEX_OAUTH grants ADMIN entryRole", async () => {
    // Cross-provider invariant: allowlist membership is rooted in
    // `users.telegram_id`, not in the OAuth provider used for *this* login.
    // A user who first signed up via Telegram (and so is in the allowlist via
    // their telegram_id) must be able to land in ADMIN scope when they log
    // back in via Yandex with redirectTo=/admin (yandex-routes passes
    // entryRoleOverride='ADMIN' in that case).
    const telegramId = 920100; // matches ADMIN_ROLE_ALLOWLIST_IDS above
    cleanup.push(telegramId);
    // 1. Seed the user via a Telegram login (creates users + telegram identity).
    {
      const { req, res } = makeReqRes();
      await mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "Allowed",
          lastName: "Owner",
          username: "allowed_owner_test",
          avatarUrl: null,
        },
        authMethod: "OIDC",
      });
    }
    // 2. Link a Yandex identity to the same user (mirrors yandex-routes
    //    /link/callback after the user attaches Yandex from /profile).
    const yandexSub = `yandex_${telegramId}`;
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'yandex', $2) ON CONFLICT DO NOTHING`,
      [userRow.rows[0].id, yandexSub]
    );
    // 3. Yandex login with entryRoleOverride='ADMIN' must succeed and land
    //    the session in ADMIN.
    const { req, res } = makeReqRes();
    const result = await mod.completeOAuthLogin(req, res, {
      provider: "yandex",
      profile: { id: yandexSub, email: "owner@y.ru", username: "yandex_login_allowed" },
      authMethod: "YANDEX_OAUTH",
      entryRoleOverride: "ADMIN",
    });
    expect(result?.userId).toBe(userRow.rows[0].id);
    expect(req.session.entryRole).toBe("ADMIN");
    expect(req.session.authMethod).toBe("YANDEX_OAUTH");
  });

  it("ADMIN override for a non-allowlisted user via YANDEX_OAUTH throws ADMIN_SCOPE_NONE", async () => {
    // Even with a linked Yandex identity, a user whose telegram_id is NOT in
    // the allowlist must not be able to escalate to ADMIN through Yandex.
    const telegramId = 920101;
    cleanup.push(telegramId);
    {
      const { req, res } = makeReqRes();
      await mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "Random",
          lastName: "User",
          username: "random_user_test",
          avatarUrl: null,
        },
        authMethod: "OIDC",
      });
    }
    const yandexSub = `yandex_${telegramId}`;
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'yandex', $2) ON CONFLICT DO NOTHING`,
      [userRow.rows[0].id, yandexSub]
    );
    const { req, res } = makeReqRes();
    await expect(
      mod.completeOAuthLogin(req, res, {
        provider: "yandex",
        profile: { id: yandexSub, email: "rando@y.ru", username: "yandex_login_random" },
        authMethod: "YANDEX_OAUTH",
        entryRoleOverride: "ADMIN",
      })
    ).rejects.toThrow("ADMIN_SCOPE_NONE");
  });

  it("YANDEX_OAUTH login without override leaves entryRole undefined for allowlisted user", async () => {
    // No override = neutral mode. Allowlisted owner logging in via Yandex from
    // /login (redirectTo=/app) lands in USER-eligible state with entryRole
    // intentionally unset, so they can still play as a regular user and
    // separately flip to ADMIN via /admin/login → "Включить режим владельца".
    // telegramId is seeded into ADMIN_ROLE_ALLOWLIST_IDS at file top.
    const telegramId = 920102;
    cleanup.push(telegramId);
    {
      const { req, res } = makeReqRes();
      await mod.completeOAuthLogin(req, res, {
        provider: "telegram",
        profile: {
          id: String(telegramId),
          firstName: "Neutral",
          lastName: "Owner",
          username: "neutral_owner_test",
          avatarUrl: null,
        },
        authMethod: "OIDC",
      });
    }
    const yandexSub = `yandex_${telegramId}`;
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'yandex', $2) ON CONFLICT DO NOTHING`,
      [userRow.rows[0].id, yandexSub]
    );
    const { req, res } = makeReqRes();
    await mod.completeOAuthLogin(req, res, {
      provider: "yandex",
      profile: { id: yandexSub, email: "neutral@y.ru", username: "yandex_login_neutral" },
      authMethod: "YANDEX_OAUTH",
    });
    expect(req.session.entryRole).toBeUndefined();
    expect(req.session.authMethod).toBe("YANDEX_OAUTH");
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
