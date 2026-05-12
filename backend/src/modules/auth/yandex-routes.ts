import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { sendError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { recordAuthMetric } from "../../lib/auth-slo.js";
import { createState, consumeState } from "../../lib/oauth-state.js";
import { buildYandexAuthorizeUrl, exchangeYandexCode, fetchYandexUserInfo } from "../../lib/yandex-oauth.js";
import { completeOAuthLogin } from "../../lib/oauth-login.js";

const yandexRouter = Router();

const startQuerySchema = z.object({ redirectTo: z.string().min(1).max(256).optional() });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

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

export { yandexRouter };
