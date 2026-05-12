import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { sendError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { recordAuthMetric } from "../../lib/auth-slo.js";
import { createState, consumeState } from "../../lib/oauth-state.js";
import { buildYandexAuthorizeUrl, exchangeYandexCode, fetchYandexUserInfo } from "../../lib/yandex-oauth.js";
import { completeOAuthLogin } from "../../lib/oauth-login.js";
import {
  findIdentity,
  linkIdentity,
  unlinkIdentity,
  countIdentitiesForUser,
} from "../../lib/identity-repo.js";
import { createPendingLink, consumePendingLink } from "../../lib/pending-link.js";
import { writeAudit } from "../../lib/audit.js";
import { query } from "../../db/pool.js";

const yandexRouter = Router();

const startQuerySchema = z.object({ redirectTo: z.string().min(1).max(256).optional() });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });
const linkCallbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });
const linkConfirmSchema = z.object({ token: z.string().min(1).max(256) });
const unlinkSchema = z.object({ provider: z.enum(["telegram", "yandex"]) });

function hashRequestPart(value: string | undefined): string | null {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function requireEnabled(req: Request, res: Response): boolean {
  if (!env.yandexOAuth.enabled) {
    sendError(req, res, 404, "OAUTH_PROVIDER_DISABLED", "Yandex OAuth disabled");
    return false;
  }
  return true;
}

yandexRouter.get(
  "/start",
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const parsed = startQuerySchema.safeParse(req.query);
    const redirectTo = parsed.success && parsed.data.redirectTo ? parsed.data.redirectTo : "/app";
    const { state } = await createState({
      provider: "yandex",
      intent: "login",
      redirectTo,
      ttlSeconds: env.yandexOAuth.stateTtlSeconds,
      ipHash: hashRequestPart(String(req.ip || "")),
      uaHash: hashRequestPart(String(req.get("user-agent") || "")),
      linkUserId: null,
      codeVerifier: null,
      nonce: null,
    });
    recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ATTEMPT" });
    res.redirect(302, buildYandexAuthorizeUrl({ state, redirectUri: env.yandexOAuth.redirectUri }));
  })
);

yandexRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const parsed = callbackQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendError(req, res, 400, "VALIDATION_ERROR", "code and state required");
    const stateRow = await consumeState(parsed.data.state, "yandex");
    if (!stateRow || stateRow.intent !== "login") {
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "STATE_INVALID" });
      return res.redirect(302, `/login?auth_error=OAUTH_STATE_INVALID`);
    }
    try {
      const token = await exchangeYandexCode({ code: parsed.data.code, redirectUri: env.yandexOAuth.redirectUri });
      const info = await fetchYandexUserInfo(token.access_token);
      const result = await completeOAuthLogin(req, res, {
        provider: "yandex",
        profile: {
          id: info.id,
          email: info.email,
          firstName: info.firstName,
          lastName: info.lastName,
          username: info.login,
          displayName: info.displayName,
          avatarUrl: info.avatarUrl,
        },
        authMethod: "YANDEX_OAUTH",
      });
      if (!result) {
        recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "NO_ACCOUNT" });
        return res.redirect(302, `/login?auth_error=OAUTH_NO_ACCOUNT`);
      }
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "SUCCESS" });
      return res.redirect(302, stateRow.redirectTo);
    } catch (err) {
      logger.warn("[yandex] callback failed", { err: err instanceof Error ? err.message : String(err) });
      recordAuthMetric({ method: "YANDEX_OAUTH", platform: "unknown", outcome: "ERROR", code: "CALLBACK_EXCEPTION" });
      return res.redirect(302, `/login?auth_error=OAUTH_STATE_INVALID`);
    }
  })
);

/**
 * GET /link/start — kick off OAuth dance to link a Yandex identity to the
 * already-logged-in user. State carries `intent: 'link'` + `linkUserId` so the
 * callback can rebind the user even if the cookie is dropped mid-flow.
 */
yandexRouter.get(
  "/link/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const userId = req.session.userId!;
    const parsed = startQuerySchema.safeParse(req.query);
    const redirectTo = parsed.success && parsed.data.redirectTo ? parsed.data.redirectTo : "/app/profile";
    const { state } = await createState({
      provider: "yandex",
      intent: "link",
      redirectTo,
      ttlSeconds: env.yandexOAuth.stateTtlSeconds,
      ipHash: hashRequestPart(String(req.ip || "")),
      uaHash: hashRequestPart(String(req.get("user-agent") || "")),
      linkUserId: userId,
      codeVerifier: null,
      nonce: null,
    });
    res.redirect(302, buildYandexAuthorizeUrl({ state, redirectUri: env.yandexOAuth.linkRedirectUri }));
  })
);

/**
 * GET /link/callback — finish the link dance. We do NOT require an active
 * session here: the state row binds the flow to a specific userId. The
 * mandatory cookie check happens at /link/confirm, which the user reaches
 * with a fresh session.
 */
yandexRouter.get(
  "/link/callback",
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const parsed = linkCallbackQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendError(req, res, 400, "VALIDATION_ERROR", "code and state required");

    const stateRow = await consumeState(parsed.data.state, "yandex");
    if (!stateRow || stateRow.intent !== "link" || !stateRow.linkUserId) {
      return res.redirect(302, `/app/profile?link_error=OAUTH_STATE_INVALID`);
    }

    // Defensive: a session swap mid-flow would be a security issue, refuse.
    if (req.session?.userId && req.session.userId !== stateRow.linkUserId) {
      return res.redirect(302, `/app/profile?link_error=OAUTH_STATE_INVALID`);
    }

    try {
      const token = await exchangeYandexCode({
        code: parsed.data.code,
        redirectUri: env.yandexOAuth.linkRedirectUri,
      });
      const info = await fetchYandexUserInfo(token.access_token);

      // Pre-flight: if this Yandex subject is already linked to a different
      // account, surface a friendly error via the confirm page. We still
      // create a pending row so the page can render details, but the
      // /confirm step will reject with OAUTH_LINK_TAKEN.
      const existing = await findIdentity("yandex", info.id);
      const linkTakenByOther = existing && existing.userId !== stateRow.linkUserId;

      const { token: pendingToken } = await createPendingLink({
        userId: stateRow.linkUserId,
        provider: "yandex",
        providerUserId: info.id,
        providerEmail: info.email,
        providerDisplayName: info.displayName,
        ttlSeconds: env.yandexOAuth.pendingLinkTtlSeconds,
      });

      const confirmPath = `/auth/yandex/link/confirm?token=${encodeURIComponent(pendingToken)}` +
        (linkTakenByOther ? `&error=OAUTH_LINK_TAKEN` : "");
      return res.redirect(302, confirmPath);
    } catch (err) {
      logger.warn("[yandex] link callback failed", { err: err instanceof Error ? err.message : String(err) });
      return res.redirect(302, `/app/profile?link_error=OAUTH_STATE_INVALID`);
    }
  })
);

/**
 * POST /link/confirm — finalize the link after the user confirms on the
 * pre-confirmation page. Atomic single-use consume of the pending token,
 * then write the user_identities row.
 */
yandexRouter.post(
  "/link/confirm",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireEnabled(req, res)) return;
    const userId = req.session.userId!;
    const parsed = linkConfirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(req, res, 400, "VALIDATION_ERROR", "token required");
    }
    const pending = await consumePendingLink(parsed.data.token, userId);
    if (!pending) {
      return sendError(req, res, 410, "OAUTH_PENDING_LINK_EXPIRED", "Pending link expired or already used");
    }

    const link = await linkIdentity({
      userId,
      provider: pending.provider,
      providerUserId: pending.providerUserId,
      email: pending.providerEmail,
    });
    if (link.conflict) {
      // Both conflict codes surface as OAUTH_LINK_TAKEN to the client. The
      // server log preserves the distinction for debugging.
      logger.info("[yandex] link.confirm conflict", { userId, conflict: link.conflict });
      return sendError(req, res, 409, "OAUTH_LINK_TAKEN", "Identity already linked");
    }

    await writeAudit(userId, "identity.link", {
      provider: pending.provider,
      providerUserId: pending.providerUserId,
      ip_hash: hashRequestPart(String(req.ip || "")),
      ua_hash: hashRequestPart(String(req.get("user-agent") || "")),
    });

    return res.json({
      ok: true,
      identity: {
        provider: link.identity!.provider,
        email: link.identity!.email,
        linkedAt: link.identity!.linkedAt,
      },
    });
  })
);

/**
 * POST /unlink — drop one of the user's identity rows. Refuses to remove the
 * last identity (would lock the user out) and refuses to drop the telegram
 * identity for ADMIN accounts (admin tooling assumes telegram is present).
 */
yandexRouter.post(
  "/unlink",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.session.userId!;
    const parsed = unlinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(req, res, 400, "VALIDATION_ERROR", "provider required");
    }
    const provider = parsed.data.provider;

    const count = await countIdentitiesForUser(userId);
    if (count <= 1) {
      return sendError(req, res, 409, "OAUTH_LAST_IDENTITY", "Cannot remove last identity");
    }

    if (provider === "telegram") {
      const r = await query<{ account_role: "ADMIN" | "USER" | null }>(
        `SELECT account_role FROM users WHERE id = $1`,
        [userId]
      );
      if (r.rows[0]?.account_role === "ADMIN") {
        return sendError(req, res, 403, "FORBIDDEN", "ADMIN must keep Telegram identity");
      }
    }

    const removed = await unlinkIdentity(userId, provider);
    if (!removed) {
      return sendError(req, res, 404, "NOT_FOUND", "Identity not linked");
    }

    await writeAudit(userId, "identity.unlink", {
      provider,
      ip_hash: hashRequestPart(String(req.ip || "")),
      ua_hash: hashRequestPart(String(req.get("user-agent") || "")),
      reason: "user_requested",
    });

    return res.json({ ok: true });
  })
);

export { yandexRouter };
