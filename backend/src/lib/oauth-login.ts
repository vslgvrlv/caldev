import type { Request, Response } from "express";
import { query } from "../db/pool.js";
import { writeAudit } from "./audit.js";
import { canChooseAdminRole } from "./entry-role.js";
import { getUserMemberships } from "./permissions.js";
import { findIdentity, linkIdentity } from "./identity-repo.js";

export type AuthMethod = "WEBAPP" | "OIDC" | "LEGACY_WIDGET" | "DEV" | "BOT_HANDOFF" | "YANDEX_OAUTH" | "PAIRING";

export type OAuthProvider = "telegram" | "yandex";

export interface OAuthProfile {
  /** Provider-specific subject id (Telegram numeric id as string, Yandex sub, etc.). */
  id: string;
  email?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface CompleteOAuthLoginParams {
  provider: OAuthProvider;
  profile: OAuthProfile;
  authMethod: AuthMethod;
  /**
   * Forces a specific session.entryRole. Used by:
   *   - telegram-handoff (USER/ADMIN, scope decided from the deeplink),
   *   - yandex callback (ADMIN when redirectTo starts with /admin AND the
   *     user is allowlisted via their linked telegram_id).
   * Other callers must leave it undefined → entryRole stays unset (neutral
   * mode for allowlisted owners, "USER" otherwise).
   */
  entryRoleOverride?: "ADMIN" | "USER";
}

/**
 * Centralised OAuth login finisher: shared by every Telegram entry point (OIDC,
 * webapp, legacy widget, bot-handoff, dev-login) and by Yandex. Preserves the
 * exact side-effects of the original inline `completeTelegramLogin` in
 * `modules/auth/routes.ts` — see the parity test in
 * `__tests__/unit/oauth-login-parity.test.ts`.
 *
 * Returns `null` for non-Telegram providers when no `user_identities` row
 * exists yet — PBTH is invite-only, so we refuse anonymous OAuth sign-up and
 * let the caller surface the right error code.
 *
 * NOTE: `res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, …)` is intentionally NOT
 * called here — the cookie symbols live in `routes.ts`, so each call site
 * clears the guard cookie inline after this helper resolves.
 */
export async function completeOAuthLogin(
  req: any,
  res: Response,
  params: CompleteOAuthLoginParams,
): Promise<{ userId: string } | null> {
  const { provider, profile } = params;
  const authMethod = params.authMethod ?? "WEBAPP";

  // 1. Lookup identity. Yandex (and any future provider) cannot auto-create
  // users — PBTH is invite-only, so we bail out with null and let the caller
  // redirect to the right error screen.
  const existing = await findIdentity(provider, profile.id);

  if (!existing && provider !== "telegram") {
    return null;
  }

  let userId: string;
  let userRow: {
    id: string;
    telegram_id: string | null;
    username: string | null;
    account_role: "ADMIN" | "USER" | null;
    onboarding_completed_at: string | null;
  };

  if (existing) {
    // Refresh denormalized users row with the latest profile fields.
    // Mirror the UPSERT branch: COALESCE username/avatar (so we never wipe a
    // value the user already has), but always overwrite name/nickname.
    if (provider === "telegram") {
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username || `tg-${profile.id}`;
      const nickname = profile.username || `tg_${profile.id}`;
      const upd = await query<{
        id: string;
        telegram_id: string;
        username: string | null;
        account_role: "ADMIN" | "USER" | null;
        onboarding_completed_at: string | null;
      }>(
        `UPDATE users
            SET username = COALESCE($2, username),
                name = $3,
                nickname = $4,
                avatar = COALESCE($5, avatar),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, telegram_id::text AS telegram_id, username, account_role, onboarding_completed_at`,
        [existing.userId, profile.username ?? null, name, nickname, profile.avatarUrl ?? null]
      );
      userRow = upd.rows[0];
    } else {
      // Non-telegram: just hydrate the row, don't touch profile fields here.
      const sel = await query<{
        id: string;
        telegram_id: string | null;
        username: string | null;
        account_role: "ADMIN" | "USER" | null;
        onboarding_completed_at: string | null;
      }>(
        `SELECT id, telegram_id::text AS telegram_id, username, account_role, onboarding_completed_at
           FROM users
          WHERE id = $1`,
        [existing.userId]
      );
      userRow = sel.rows[0];
    }
    userId = userRow.id;
  } else {
    // Telegram-only: create a new users row + identity link.
    // Invariant (3): BOT_HANDOFF new users keep onboarding_completed_at NULL
    // so the handoff onboarding screen fires; every other auth method marks
    // it complete on insert.
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username || `tg-${profile.id}`;
    const nickname = profile.username || `tg_${profile.id}`;
    const onboardingCompletedAt = authMethod === "BOT_HANDOFF" ? null : new Date().toISOString();

    const upsert = await query<{
      id: string;
      telegram_id: string;
      username: string | null;
      account_role: "ADMIN" | "USER" | null;
      onboarding_completed_at: string | null;
    }>(
      `INSERT INTO users (telegram_id, username, name, nickname, avatar, account_role, role_selected_at, onboarding_completed_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6::timestamptz)
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username = COALESCE(EXCLUDED.username, users.username),
         name = EXCLUDED.name,
         nickname = EXCLUDED.nickname,
         avatar = EXCLUDED.avatar,
         onboarding_completed_at = COALESCE(users.onboarding_completed_at, EXCLUDED.onboarding_completed_at),
         updated_at = NOW()
       RETURNING id, telegram_id::text AS telegram_id, username, account_role, onboarding_completed_at`,
      [profile.id, profile.username ?? null, name, nickname, profile.avatarUrl ?? null, onboardingCompletedAt]
    );
    userRow = upsert.rows[0];
    userId = userRow.id;

    // Backfill the identity row so subsequent logins go through the
    // `existing` branch above. Race-safe: ON CONFLICT DO NOTHING.
    const linkResult = await linkIdentity({
      userId,
      provider: "telegram",
      providerUserId: profile.id,
      email: null,
    });
    if (linkResult.conflict && linkResult.conflict !== "USER_PROVIDER_TAKEN") {
      // PROVIDER_SUBJECT_TAKEN here means somebody else already owns this
      // telegram_id — shouldn't happen, since the users.telegram_id UNIQUE
      // would have funneled us into the same userId. Defensive throw.
      throw new Error(`completeOAuthLogin: unexpected identity conflict ${linkResult.conflict}`);
    }
  }

  // 2. Role-selection invariant. A user can pick ADMIN if their *linked*
  // telegram_id is in the allowlist — independent of which OAuth provider
  // ran THIS login. Rationale: allowlist membership belongs to the human, not
  // to the channel they signed in through. A Telegram-registered owner who
  // later attaches Yandex should be able to enter admin mode via either path.
  // The auth-method trust gate (`isTrustedAdminAuthMethod`) decides whether
  // the admin scope is actually granted on the auth/me side; here we only
  // unlock the *eligibility* to choose ADMIN entryRole.
  const allowAdminChoice =
    userRow.telegram_id !== null
      ? canChooseAdminRole({ telegram_id: userRow.telegram_id, username: userRow.username })
      : false;

  if (params.entryRoleOverride === "ADMIN" && !allowAdminChoice) {
    throw new Error("ADMIN_SCOPE_NONE");
  }
  const targetEntryRole = params.entryRoleOverride ?? (allowAdminChoice ? null : "USER");
  if (targetEntryRole && userRow.account_role !== targetEntryRole) {
    await query(
      `UPDATE users
         SET account_role = $2::account_role,
             role_selected_at = NOW(),
             updated_at = NOW()
       WHERE id = $1`,
      [userId, targetEntryRole]
    );
  } else if (!targetEntryRole && !allowAdminChoice && !userRow.account_role) {
    await query(
      `UPDATE users
         SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  // 3. Regenerate the session and bind the user.
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });

  req.session.userId = userId;
  req.session.authMethod = authMethod;
  if (targetEntryRole) req.session.entryRole = targetEntryRole;
  else delete req.session.entryRole;

  // 4. Membership bootstrap. Only USER scope auto-binds an active membership;
  // ADMIN scope deliberately clears it so admin tooling renders correctly.
  const accountRole = req.session.entryRole ?? null;
  const memberships = accountRole === "USER" ? await getUserMemberships(userId) : [];
  if (accountRole === "USER" && memberships.length === 1) {
    req.session.activeMembershipId = memberships[0].id;
    req.session.activeTeamId = memberships[0].team_id;
  } else {
    delete req.session.activeMembershipId;
    delete req.session.activeTeamId;
  }

  // 5. Audit. Keep the legacy `auth.telegram.login` action + `telegramId`
  // field for the telegram path so the existing dashboards keep working;
  // future providers fan out into `auth.<provider>.login`.
  if (provider === "telegram") {
    await writeAudit(userId, "auth.telegram.login", {
      telegramId: profile.id,
      authMethod,
    });
  } else {
    await writeAudit(userId, `auth.${provider}.login`, {
      provider,
      providerUserId: profile.id,
      authMethod,
    });
  }

  // 6. Persist the session before we return — middlewares downstream rely on
  // the cookie being written even when no further response writes happen.
  await new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Invariant (9): caller clears LOGOUT_GUARD_COOKIE_NAME inline. We
  // intentionally don't touch cookies here.
  void res;

  return { userId };
}
