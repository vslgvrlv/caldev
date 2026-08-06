import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { attachAuthUser, requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { buildTelegramOAuthUrl, buildTelegramStartHtml, parseTelegramPayload, verifyTelegramAuth, verifyTelegramWebAppInitData } from "../../lib/telegram.js";
import { buildOidcAuthorizeUrl, createOidcChallenge, exchangeOidcCode, verifyOidcIdToken } from "../../lib/telegram-oidc.js";
import { getMembershipById, getUserMemberships } from "../../lib/permissions.js";
import { canChooseAdminRole, getEffectiveEntryRole } from "../../lib/entry-role.js";
import { env } from "../../config/env.js";
import { getRequestPublicOrigin } from "../../lib/public-origin.js";
import { pruneExpiredAuthArtifacts, registerReplayPayload, sha256Hex } from "../../lib/replay-guard.js";
import { decideOidcCanary, newCanaryBucket, normalizeForceOverride, parseCanaryBucket } from "../../lib/auth-canary.js";
import { getAuthSloSummary, recordAuthMetric } from "../../lib/auth-slo.js";
import {
  buildTelegramHandoffAttemptKey,
  buildTelegramHandoffDeepLink,
  hashTelegramHandoffCompletionToken,
  isTrustedAdminAuthMethod,
  resolveTelegramHandoffRedirect,
  type TelegramHandoffScope,
} from "../../lib/auth-telegram-handoff.js";
import {
  buildPairingBrowserSecret,
  buildPairingDeepLink,
  classifyPairingStatus,
  describePairingDevice,
  formatPairingCode,
  generatePairingCode,
  hashPairingBrowserSecret,
  hashPairingCode,
  normalizePairingCode,
  resolvePairingRedirect,
  type PairingAttemptStatus,
} from "../../lib/auth-pairing.js";
import { completeOAuthLogin } from "../../lib/oauth-login.js";

const contextSchema = z.object({
  membershipId: z.string().uuid(),
});

const selectRoleSchema = z.object({
  accountRole: z.enum(["ADMIN", "USER"]),
});

const webAppAuthSchema = z.object({
  initData: z.string().min(1),
});

const oidcStartSchema = z.object({
  redirectTo: z.string().optional(),
});

const oidcCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const handoffStartSchema = z.object({
  scope: z.enum(["USER", "ADMIN"]),
  redirectTo: z.string().optional(),
});

const handoffCompleteSchema = z.object({
  token: z.string().min(1),
});

const pairStartSchema = z.object({
  scope: z.enum(["USER", "ADMIN"]),
  redirectTo: z.string().optional(),
});

const pairStatusSchema = z.object({
  // Длина с запасом: код доезжает с дефисом и в любом регистре,
  // нормализация разбирается дальше.
  code: z.string().min(1).max(32),
});

const authSloQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
});

const clientAuthTelemetrySchema = z.object({
  scope: z.enum(["USER", "ADMIN", "INVITE"]),
  flow: z.enum(["MINIAPP", "OIDC", "BOT_HANDOFF", "PAIRING", "UNKNOWN"]).optional(),
  event: z.string().min(1).max(64),
  platform: z.enum(["android", "ios", "desktop", "unknown"]),
  code: z.string().min(1).max(80).optional(),
  detail: z.string().min(1).max(180).optional(),
  path: z.string().min(1).max(180).optional(),
  ts: z.string().optional(),
});

const devLoginSchema = z.object({
  userId: z.string().uuid().optional(),
  telegramId: z.string().regex(/^\d+$/).optional(),
  username: z.string().min(1).max(64).optional(),
  ensureTeam: z.boolean().optional(),
  redirectTo: z.string().min(1).optional(),
});

export const authRouter = Router();
const LOGOUT_GUARD_COOKIE_NAME = "pbth.logout.guard";
const LOGOUT_GUARD_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function logoutGuardCookieOptions() {
  return {
    path: "/",
    domain: env.session.cookieDomain,
    sameSite: env.session.cookieSameSite,
    secure: env.isProd,
    httpOnly: true,
  } as const;
}

// Секрет привязки попытки к браузеру (#109). httpOnly — значит недоступен
// скриптам страницы; path сужен до auth-ручек, потому что больше его никто
// не читает. Живёт чуть дольше самой попытки: между «показали код» и
// «подтвердили в Telegram» человек уходит в другое приложение и возвращается.
const PAIRING_COOKIE_NAME = "pbth.pair";
const PAIRING_COOKIE_TTL_MS = 1000 * 60 * 30;

function pairingCookieOptions() {
  return {
    path: "/api/v1/auth",
    domain: env.session.cookieDomain,
    sameSite: env.session.cookieSameSite,
    secure: env.isProd,
    httpOnly: true,
    maxAge: PAIRING_COOKIE_TTL_MS,
  } as const;
}

function hasCookie(req: any, name: string): boolean {
  const rawCookie = req?.headers?.cookie;
  if (typeof rawCookie !== "string" || !rawCookie.trim()) return false;
  const target = `${name}=`;
  return rawCookie
    .split(";")
    .map((part: string) => part.trim())
    .some((part: string) => part.startsWith(target));
}

function readCookie(req: any, name: string): string | null {
  const rawCookie = req?.headers?.cookie;
  if (typeof rawCookie !== "string" || !rawCookie.trim()) return null;
  const target = `${name}=`;
  for (const part of rawCookie.split(";").map((item: string) => item.trim())) {
    if (!part.startsWith(target)) continue;
    const value = part.slice(target.length);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function hashRequestSide(value: string | undefined): string | null {
  if (!value) return null;
  return sha256Hex(value).slice(0, 32);
}

function sanitizeRedirectTo(input: unknown, fallback = "/app"): string {
  if (typeof input !== "string" || input.length === 0) return fallback;
  // Only allow same-origin absolute paths.
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  return input;
}

function getAuthPublicUrls(req: any) {
  const origin = getRequestPublicOrigin({
    host: req.get("host"),
    forwardedHost: req.get("x-forwarded-host"),
    forwardedProto: req.get("x-forwarded-proto"),
  });
  return {
    origin,
    callbackUrl: new URL("/api/v1/auth/telegram/callback", origin).toString(),
    appUrl: new URL("/app", origin).toString(),
    fallbackUrl: new URL("/", origin).toString(),
  };
}

function detectRequestPlatform(req: any): "android" | "ios" | "desktop" | "unknown" {
  const ua = String(req.get("user-agent") || "").toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || ua.includes("cpu os")) {
    return "ios";
  }
  if (ua) return "desktop";
  return "unknown";
}

function normalizeErrorCode(code: unknown, fallback: string): string {
  if (typeof code !== "string" || !code.trim()) return fallback;
  const normalized = code
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || fallback;
}

function normalizeLoginPath(redirectTo: string | undefined): string {
  const safe = sanitizeRedirectTo(redirectTo, "/app");
  if (safe.startsWith("/admin")) return "/admin/login";
  if (safe.startsWith("/invite/")) return safe;
  return "/login";
}

function isTrustedAdminReady(authMethod: Parameters<typeof isTrustedAdminAuthMethod>[0]) {
  return !env.telegramOidc.adminRequired || isTrustedAdminAuthMethod(authMethod);
}

function buildAuthErrorRedirectPath(params: {
  redirectTo?: string;
  code: string;
  detail?: string;
}): string {
  const url = new URL(normalizeLoginPath(params.redirectTo), "http://localhost");
  url.searchParams.set("auth_error", normalizeErrorCode(params.code, "AUTH_FAILED"));
  if (params.detail) {
    url.searchParams.set("detail", params.detail.slice(0, 120));
  }
  return `${url.pathname}${url.search}`;
}

function shouldUseOidcFromCanary(req: any, res: any, redirectTo: string) {
  const forceOverride = normalizeForceOverride(req.query?.oidc ?? req.query?.auth_canary);
  const cookieName = env.telegramOidc.canaryCookieName;
  let stickyBucket = parseCanaryBucket(readCookie(req, cookieName));
  if (stickyBucket === null) {
    stickyBucket = newCanaryBucket();
    res.cookie(cookieName, String(stickyBucket), {
      path: "/",
      domain: env.session.cookieDomain,
      sameSite: env.session.cookieSameSite,
      secure: env.isProd,
      httpOnly: true,
      maxAge: env.telegramOidc.canaryCookieMaxAgeSec * 1000,
    });
  }

  return {
    stickyBucket,
    decision: decideOidcCanary({
      oidcEnabled: env.telegramOidc.enabled,
      fallbackEnabled: env.telegramOidc.fallbackEnabled,
      canaryPercent: env.telegramOidc.canaryPercent,
      isAdminPath: redirectTo.startsWith("/admin"),
      stickyBucket,
      forceOverride,
    }),
  };
}

async function ensureUserHasTeam(userId: string, req: any) {
  const memberships = await getUserMemberships(userId);
  if (memberships.length > 0) {
    if (!req.session.activeMembershipId || !req.session.activeTeamId) {
      req.session.activeMembershipId = memberships[0].id;
      req.session.activeTeamId = memberships[0].team_id;
    }
    return false;
  }

  const teamInsert = await query<{ id: string }>(
    `INSERT INTO teams (name, short_code)
     VALUES ('Local Dev Team', upper(substr(md5(random()::text), 1, 6)))
     RETURNING id`
  );
  const teamId = teamInsert.rows[0].id;

  const membershipInsert = await query<{ id: string }>(
    `INSERT INTO team_memberships (user_id, team_id, role, status)
     VALUES ($1, $2, 'CAPTAIN', 'ACTIVE')
     RETURNING id`,
    [userId, teamId]
  );

  req.session.activeMembershipId = membershipInsert.rows[0].id;
  req.session.activeTeamId = teamId;
  return true;
}

const DEV_DEFAULT_TELEGRAM_ID = "9000000103";

type DevLoginParsed = z.infer<typeof devLoginSchema>;

async function resolveDevLoginPayload(parsed: DevLoginParsed) {
  if (parsed.userId) {
    const byId = await query<{ telegram_id: string; username: string | null; name: string }>(
      `SELECT telegram_id::text, username, name
       FROM users
       WHERE id = $1`,
      [parsed.userId]
    );
    if (byId.rows[0]) {
      return {
        id: byId.rows[0].telegram_id,
        first_name: byId.rows[0].name,
        username: byId.rows[0].username ?? undefined,
      };
    }
  }

  if (parsed.telegramId) {
    const byTelegram = await query<{ telegram_id: string; username: string | null; name: string }>(
      `SELECT telegram_id::text, username, name
       FROM users
       WHERE telegram_id = $1::bigint`,
      [parsed.telegramId]
    );
    if (byTelegram.rows[0]) {
      return {
        id: byTelegram.rows[0].telegram_id,
        first_name: byTelegram.rows[0].name,
        username: byTelegram.rows[0].username ?? undefined,
      };
    }
  }

  if (parsed.username) {
    const byUsername = await query<{ telegram_id: string; username: string | null; name: string }>(
      `SELECT telegram_id::text, username, name
       FROM users
       WHERE lower(username) = lower($1)`,
      [parsed.username]
    );
    if (byUsername.rows[0]) {
      return {
        id: byUsername.rows[0].telegram_id,
        first_name: byUsername.rows[0].name,
        username: byUsername.rows[0].username ?? undefined,
      };
    }
  }

  const byDefaultDemoUser = await query<{ telegram_id: string; username: string | null; name: string }>(
    `SELECT telegram_id::text, username, name
     FROM users
     WHERE telegram_id = $1::bigint`,
    [DEV_DEFAULT_TELEGRAM_ID]
  );
  if (byDefaultDemoUser.rows[0]) {
    return {
      id: byDefaultDemoUser.rows[0].telegram_id,
      first_name: byDefaultDemoUser.rows[0].name,
      username: byDefaultDemoUser.rows[0].username ?? undefined,
    };
  }

  return {
    id: parsed.telegramId || DEV_DEFAULT_TELEGRAM_ID,
    first_name: parsed.username || "Local Dev User",
    username: parsed.username,
  };
}

type AdminScope = "NONE" | "TEAM" | "PLATFORM";

type TelegramHandoffAttemptRow = {
  id: string;
  scope: TelegramHandoffScope;
  redirect_to: string;
  status: "PENDING" | "LINK_SENT" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  telegram_user_id: string | null;
  telegram_profile: {
    id?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    photo_url?: string;
  } | null;
  completion_token_expires_at: string | null;
  expires_at: string;
};

type PairingAttemptRow = {
  id: string;
  scope: "USER" | "ADMIN";
  status: string;
  redirect_to: string;
  browser_secret_hash: string;
  telegram_profile: {
    id?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    photo_url?: string;
  } | null;
  expires_at: string;
};

function buildCapabilities(params: {
  effectiveRole: "ADMIN" | "USER" | null;
  memberships: Array<{ role: "CAPTAIN" | "TRAINER" | "PLAYER" }>;
  adminScope: AdminScope;
}) {
  const capabilities = new Set<string>(["auth:session"]);
  if (params.memberships.length > 0) {
    capabilities.add("team:read");
    capabilities.add("event:read");
  }
  if (params.memberships.some((m) => m.role === "CAPTAIN" || m.role === "TRAINER")) {
    capabilities.add("event:write");
    capabilities.add("rsvp:manage");
  }
  if (params.memberships.some((m) => m.role === "CAPTAIN")) {
    capabilities.add("team:manage");
    capabilities.add("invite:manage");
    capabilities.add("reminder:send");
  }

  if (params.adminScope === "TEAM") {
    capabilities.add("admin:team");
    capabilities.add("admin:team:overview");
    capabilities.add("admin:team:events");
    capabilities.add("admin:team:members");
    capabilities.add("admin:team:audit");
  }
  if (params.adminScope === "PLATFORM") {
    capabilities.add("admin:platform");
    capabilities.add("admin:platform:overview");
    capabilities.add("admin:platform:events");
    capabilities.add("admin:platform:members");
    capabilities.add("admin:platform:audit");
  }

  if (params.effectiveRole === "ADMIN") {
    capabilities.add("entry:admin");
  }
  return Array.from(capabilities).sort();
}

authRouter.post(
  "/telemetry/client",
  asyncHandler(async (req, res) => {
    const parsed = clientAuthTelemetrySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ detail: "Invalid auth telemetry payload", code: "INVALID_TELEMETRY" });
    }

    console.info("[auth] client telemetry", {
      scope: parsed.data.scope,
      flow: parsed.data.flow || "UNKNOWN",
      event: parsed.data.event,
      platform: parsed.data.platform,
      code: parsed.data.code || null,
      path: parsed.data.path || null,
      ip: req.ip,
      ua: req.get("user-agent") || "",
    });

    const flow = parsed.data.flow || "UNKNOWN";
    const method =
      flow === "OIDC"
        ? "OIDC"
        : flow === "BOT_HANDOFF"
          ? "BOT_HANDOFF"
        : flow === "PAIRING"
          ? "PAIRING"
        : flow === "MINIAPP"
          ? "WEBAPP"
          : "UNKNOWN";
    if (parsed.data.event === "login_start" || parsed.data.event === "oidc_redirect_start") {
      recordAuthMetric({
        method,
        platform: parsed.data.platform,
        outcome: "ATTEMPT",
      });
    } else if (parsed.data.event === "login_success") {
      recordAuthMetric({
        method,
        platform: parsed.data.platform,
        outcome: "SUCCESS",
      });
    } else if (parsed.data.event === "login_error" || parsed.data.event === "error_page") {
      recordAuthMetric({
        method,
        platform: parsed.data.platform,
        outcome: "ERROR",
        code: parsed.data.code,
      });
    }

    return res.status(202).json({ ok: true });
  })
);

authRouter.get(
  "/slo",
  asyncHandler(async (req, res) => {
    if (!env.authSlo.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }

    if (env.authSlo.token) {
      const provided = String(req.get("x-auth-slo-token") || "");
      if (provided !== env.authSlo.token) {
        return res.status(401).json({ detail: "Invalid SLO token", code: "AUTH_REQUIRED" });
      }
    }

    const parsed = authSloQuerySchema.parse(req.query ?? {});
    const summary = getAuthSloSummary({
      windowMinutes: parsed.windowMinutes ?? env.authSlo.windowMinutes,
      minAttempts: env.authSlo.minAttempts,
      maxErrorRate: env.authSlo.maxErrorRate,
    });
    return res.json(summary);
  })
);

authRouter.get(
  "/telegram/start",
  asyncHandler(async (_req, res) => {
    const urls = getAuthPublicUrls(_req);
    res.type("html").send(buildTelegramStartHtml({ callback: urls.callbackUrl, fallback: urls.fallbackUrl }));
  })
);

authRouter.post(
  "/telegram/handoff/start",
  asyncHandler(async (req, res) => {
    if (!env.telegramHandoff.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }

    const parsed = handoffStartSchema.parse(req.body ?? {});
    const redirectTo = resolveTelegramHandoffRedirect({
      scope: parsed.scope,
      redirectTo: parsed.redirectTo,
    });
    const attemptKey = buildTelegramHandoffAttemptKey();
    const attemptInsert = await query<{ expires_at: string }>(
      `INSERT INTO auth_telegram_handoff_attempts (
         attempt_key,
         scope,
         status,
         redirect_to,
         requested_ip_hash,
         requested_ua_hash,
         expires_at
       )
       VALUES ($1, $2, 'PENDING', $3, $4, $5, NOW() + make_interval(secs => $6))
       RETURNING expires_at`,
      [
        attemptKey,
        parsed.scope,
        redirectTo,
        hashRequestSide(req.ip),
        hashRequestSide(req.get("user-agent") || ""),
        env.telegramHandoff.attemptTtlSeconds,
      ]
    );

    recordAuthMetric({
      method: "BOT_HANDOFF",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });
    return res.json({
      botUrl: buildTelegramHandoffDeepLink(env.telegram.botUsername, attemptKey),
      expiresAt: attemptInsert.rows[0].expires_at,
    });
  })
);

authRouter.get(
  "/telegram/handoff/complete",
  asyncHandler(async (req, res) => {
    if (!env.telegramHandoff.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }

    const parsed = handoffCompleteSchema.parse(req.query ?? {});
    const tokenHash = hashTelegramHandoffCompletionToken(parsed.token);
    const attemptResult = await query<TelegramHandoffAttemptRow>(
      `SELECT
         id,
         scope::text,
         redirect_to,
         status::text,
         telegram_user_id,
         telegram_profile,
         completion_token_expires_at,
         expires_at
       FROM auth_telegram_handoff_attempts
       WHERE completion_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) {
      recordAuthMetric({
        method: "BOT_HANDOFF",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "HANDOFF_TOKEN_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          code: "HANDOFF_TOKEN_EXPIRED",
        })
      );
    }

    const now = Date.now();
    const tokenExpiresAt = attempt.completion_token_expires_at ? new Date(attempt.completion_token_expires_at).getTime() : 0;
    const attemptExpiresAt = new Date(attempt.expires_at).getTime();
    if (
      attempt.status === "COMPLETED" ||
      attempt.status === "CANCELLED" ||
      !attempt.telegram_profile?.id ||
      tokenExpiresAt <= now ||
      attemptExpiresAt <= now
    ) {
      await query(
        `UPDATE auth_telegram_handoff_attempts
         SET status = CASE
           WHEN status IN ('COMPLETED', 'CANCELLED') THEN status
           ELSE 'EXPIRED'
         END,
         completion_token_hash = NULL,
         completion_token_expires_at = NULL
         WHERE id = $1`,
        [attempt.id]
      );
      recordAuthMetric({
        method: "BOT_HANDOFF",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "HANDOFF_TOKEN_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: attempt.redirect_to,
          code: "HANDOFF_TOKEN_EXPIRED",
        })
      );
    }

    let adminCandidateUsername = attempt.telegram_profile.username ?? null;
    if (attempt.scope === "ADMIN" && !adminCandidateUsername) {
      const existingUser = await query<{ username: string | null }>(
        `SELECT username
         FROM users
         WHERE telegram_id = $1::bigint
         LIMIT 1`,
        [String(attempt.telegram_profile.id)]
      );
      adminCandidateUsername = existingUser.rows[0]?.username ?? null;
    }

    if (attempt.scope === "ADMIN" && !canChooseAdminRole({
      telegram_id: String(attempt.telegram_profile.id),
      username: adminCandidateUsername,
    })) {
      await query(
        `UPDATE auth_telegram_handoff_attempts
         SET status = 'CANCELLED',
             completion_token_hash = NULL,
             completion_token_expires_at = NULL
         WHERE id = $1`,
        [attempt.id]
      );
      recordAuthMetric({
        method: "BOT_HANDOFF",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "ADMIN_SCOPE_NONE",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: attempt.redirect_to,
          code: "ADMIN_SCOPE_NONE",
        })
      );
    }

    await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(attempt.telegram_profile.id),
        firstName: attempt.telegram_profile.first_name,
        lastName: attempt.telegram_profile.last_name,
        username: attempt.telegram_profile.username,
        avatarUrl: attempt.telegram_profile.photo_url,
      },
      authMethod: "BOT_HANDOFF",
      entryRoleOverride: attempt.scope === "ADMIN" ? "ADMIN" : "USER",
    });
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());

    await query(
      `UPDATE auth_telegram_handoff_attempts
       SET status = 'COMPLETED',
           completion_token_hash = NULL,
           completion_token_expires_at = NULL,
           completed_at = NOW()
       WHERE id = $1`,
      [attempt.id]
    );
    recordAuthMetric({
      method: "BOT_HANDOFF",
      platform: detectRequestPlatform(req),
      outcome: "SUCCESS",
    });

    const { origin } = getAuthPublicUrls(req);
    return res.redirect(302, new URL(attempt.redirect_to, origin).toString());
  })
);

// --- Вход по коду сопряжения (#109) ---------------------------------------
//
// Единственная схема, которая работает в PWA на домашнем экране iOS: там своя
// банка кук, изолированная от Safari, и любой редирект «уйти и вернуться»
// отдаёт Set-Cookie не тому браузеру. Здесь сессионная кука приходит на ответ
// опроса, который PWA сделало само, — навигации нет вообще.

authRouter.post(
  "/pair/start",
  asyncHandler(async (req, res) => {
    if (!env.authPairing.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }

    const parsed = pairStartSchema.parse(req.body ?? {});
    const redirectTo = resolvePairingRedirect({ scope: parsed.scope, redirectTo: parsed.redirectTo });

    // Секрет браузера переживает попытки: если человек перезапросил код, это
    // тот же браузер, и лимит должен считаться по нему, а не обнуляться.
    let browserSecret = readCookie(req, PAIRING_COOKIE_NAME);
    if (!browserSecret) {
      browserSecret = buildPairingBrowserSecret();
    }
    const browserSecretHash = hashPairingBrowserSecret(browserSecret);

    const recent = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM auth_pairing_attempts
        WHERE browser_secret_hash = $1
          AND created_at > NOW() - make_interval(secs => $2)`,
      [browserSecretHash, env.authPairing.attemptWindowSeconds]
    );
    if (Number(recent.rows[0]?.count ?? 0) >= env.authPairing.maxAttemptsPerWindow) {
      recordAuthMetric({
        method: "PAIRING",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "PAIRING_RATE_LIMITED",
      });
      return res.status(429).json({ detail: "Too many pairing attempts", code: "PAIRING_RATE_LIMITED" });
    }

    // Коллизия кода за пять минут маловероятна, но UNIQUE на code_hash —
    // жёсткий инвариант: два живых кода с одним значением означали бы, что
    // подтверждение уходит не в ту попытку.
    let code = "";
    let inserted: { id: string; expires_at: string } | undefined;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      code = generatePairingCode();
      const result = await query<{ id: string; expires_at: string }>(
        `INSERT INTO auth_pairing_attempts (
           code_hash, browser_secret_hash, scope, status, redirect_to,
           device_label, requested_ip, expires_at
         )
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, NOW() + make_interval(secs => $7))
         ON CONFLICT (code_hash) DO NOTHING
         RETURNING id, expires_at`,
        [
          hashPairingCode(code),
          browserSecretHash,
          parsed.scope,
          redirectTo,
          describePairingDevice(req.get("user-agent")),
          req.ip ?? null,
          env.authPairing.attemptTtlSeconds,
        ]
      );
      inserted = result.rows[0];
    }
    if (!inserted) {
      throw new Error("pair/start: could not allocate a free pairing code");
    }

    res.cookie(PAIRING_COOKIE_NAME, browserSecret, pairingCookieOptions());
    recordAuthMetric({
      method: "PAIRING",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });

    return res.json({
      code: formatPairingCode(code),
      botUrl: buildPairingDeepLink(env.telegram.botUsername, code),
      botUsername: env.telegram.botUsername,
      expiresAt: inserted.expires_at,
    });
  })
);

authRouter.get(
  "/pair/status",
  asyncHandler(async (req, res) => {
    if (!env.authPairing.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }

    const parsed = pairStatusSchema.parse(req.query ?? {});
    const code = normalizePairingCode(parsed.code);
    const browserSecret = readCookie(req, PAIRING_COOKIE_NAME);
    if (!code || !browserSecret) {
      return res.status(404).json({ detail: "Unknown pairing attempt", code: "PAIRING_NOT_FOUND" });
    }

    const attemptResult = await query<PairingAttemptRow>(
      `SELECT id, scope::text, status::text, redirect_to, browser_secret_hash,
              telegram_profile, expires_at
         FROM auth_pairing_attempts
        WHERE code_hash = $1
        LIMIT 1`,
      [hashPairingCode(code)]
    );
    const attempt = attemptResult.rows[0];

    // Главная защита флоу: сессию забирает только тот браузер, который попытку
    // начал. Подсмотренный или присланный злоумышленником код бесполезен —
    // и ответ здесь такой же, как на несуществующий код, чтобы по разнице
    // ответов нельзя было проверять чужие коды на существование.
    if (!attempt || attempt.browser_secret_hash !== hashPairingBrowserSecret(browserSecret)) {
      return res.status(404).json({ detail: "Unknown pairing attempt", code: "PAIRING_NOT_FOUND" });
    }

    const status = classifyPairingStatus({
      status: attempt.status as PairingAttemptStatus,
      expiresAt: attempt.expires_at,
      now: Date.now(),
    });

    if (status === "expired" && (attempt.status === "PENDING" || attempt.status === "CLAIMED")) {
      await query(`UPDATE auth_pairing_attempts SET status = 'EXPIRED' WHERE id = $1`, [attempt.id]);
    }

    if (status !== "approved") {
      return res.json({ status });
    }

    const profile = attempt.telegram_profile;
    if (!profile?.id) {
      // APPROVED без профиля означал бы, что карточку подтвердили, а кто —
      // неизвестно. Такой попытке нельзя давать сессию.
      await query(`UPDATE auth_pairing_attempts SET status = 'EXPIRED' WHERE id = $1`, [attempt.id]);
      return res.json({ status: "expired" });
    }

    if (attempt.scope === "ADMIN") {
      let adminCandidateUsername = profile.username ?? null;
      if (!adminCandidateUsername) {
        const existingUser = await query<{ username: string | null }>(
          `SELECT username FROM users WHERE telegram_id = $1::bigint LIMIT 1`,
          [String(profile.id)]
        );
        adminCandidateUsername = existingUser.rows[0]?.username ?? null;
      }
      if (!canChooseAdminRole({ telegram_id: String(profile.id), username: adminCandidateUsername })) {
        await query(`UPDATE auth_pairing_attempts SET status = 'DENIED' WHERE id = $1`, [attempt.id]);
        recordAuthMetric({
          method: "PAIRING",
          platform: detectRequestPlatform(req),
          outcome: "ERROR",
          code: "ADMIN_SCOPE_NONE",
        });
        return res.status(403).json({ detail: "Admin scope unavailable", code: "ADMIN_SCOPE_NONE" });
      }
    }

    // Одноразовость: гасим попытку до выдачи сессии и только если она всё ещё
    // APPROVED. Два параллельных опроса (вкладка + фоновое обновление) не
    // должны обменять один код на две сессии.
    const consumed = await query<{ id: string }>(
      `UPDATE auth_pairing_attempts
          SET status = 'CONSUMED', consumed_at = NOW()
        WHERE id = $1 AND status = 'APPROVED'
        RETURNING id`,
      [attempt.id]
    );
    if (!consumed.rows[0]) {
      return res.json({ status: "expired" });
    }

    await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: String(profile.id),
        firstName: profile.first_name,
        lastName: profile.last_name,
        username: profile.username,
        avatarUrl: profile.photo_url,
      },
      authMethod: "PAIRING",
      entryRoleOverride: attempt.scope === "ADMIN" ? "ADMIN" : "USER",
    });
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());
    res.clearCookie(PAIRING_COOKIE_NAME, { ...pairingCookieOptions(), maxAge: undefined });

    recordAuthMetric({
      method: "PAIRING",
      platform: detectRequestPlatform(req),
      outcome: "SUCCESS",
    });

    // Кука сессии уходит именно с этим ответом — в банку того браузера,
    // который опрос и сделал. Ради этой строки всё и затевалось.
    return res.json({ status: "approved", redirectTo: attempt.redirect_to });
  })
);

authRouter.get(
  "/telegram/oidc/start",
  asyncHandler(async (req, res) => {
    if (!env.telegramOidc.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }
    const parsed = oidcStartSchema.parse(req.query ?? {});
    const redirectTo = sanitizeRedirectTo(parsed.redirectTo, "/app");
    const { state, nonce, codeVerifier, codeChallenge } = createOidcChallenge();
    await pruneExpiredAuthArtifacts();
    await query(
      `INSERT INTO auth_oidc_state (state, code_verifier, nonce, redirect_to, ip_hash, ua_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(secs => $7))`,
      [
        state,
        codeVerifier,
        nonce,
        redirectTo,
        hashRequestSide(req.ip),
        hashRequestSide(req.get("user-agent") || ""),
        env.telegramOidc.stateTtlSeconds,
      ]
    );

    const authorizeUrl = buildOidcAuthorizeUrl({
      state,
      nonce,
      codeChallenge,
      redirectUri: env.telegramOidc.redirectUri,
    });
    recordAuthMetric({
      method: "OIDC",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });
    return res.redirect(302, authorizeUrl);
  })
);

authRouter.get(
  "/telegram/oidc/callback",
  asyncHandler(async (req, res) => {
    if (!env.telegramOidc.enabled) {
      return res.status(404).json({ detail: "Not found", code: "NOT_FOUND" });
    }
    const parsed = oidcCallbackSchema.parse(req.query ?? {});
    await pruneExpiredAuthArtifacts();

    const stateResult = await query<{
      state: string;
      code_verifier: string;
      nonce: string | null;
      redirect_to: string;
      ip_hash: string | null;
      ua_hash: string | null;
      expires_at: string;
    }>(
      `DELETE FROM auth_oidc_state
       WHERE state = $1
       RETURNING state, code_verifier, nonce, redirect_to, ip_hash, ua_hash, expires_at`,
      [parsed.state]
    );
    const row = stateResult.rows[0];
    if (!row) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "OIDC_STATE_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          code: "OIDC_STATE_EXPIRED",
          detail: "OIDC state is missing or already used",
        })
      );
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "OIDC_STATE_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code: "OIDC_STATE_EXPIRED",
          detail: "OIDC state expired",
        })
      );
    }

    const currentIpHash = hashRequestSide(req.ip);
    const currentUaHash = hashRequestSide(req.get("user-agent") || "");
    if (row.ip_hash && currentIpHash && row.ip_hash !== currentIpHash) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "OIDC_STATE_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code: "OIDC_STATE_EXPIRED",
          detail: "OIDC request origin mismatch",
        })
      );
    }
    if (row.ua_hash && currentUaHash && row.ua_hash !== currentUaHash) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "OIDC_STATE_EXPIRED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code: "OIDC_STATE_EXPIRED",
          detail: "OIDC request agent mismatch",
        })
      );
    }

    let tokenSet: Awaited<ReturnType<typeof exchangeOidcCode>>;
    let verified: Awaited<ReturnType<typeof verifyOidcIdToken>>;
    try {
      tokenSet = await exchangeOidcCode({
        code: parsed.code,
        codeVerifier: row.code_verifier,
        redirectUri: env.telegramOidc.redirectUri,
      });
      verified = await verifyOidcIdToken({
        idToken: tokenSet.id_token!,
        expectedNonce: row.nonce ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OIDC_TOKEN_INVALID";
      const code = normalizeErrorCode(message.split(":")[0], "OIDC_TOKEN_INVALID");
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code,
      });
      console.warn("[auth] oidc callback token verification failed", {
        code,
        platform: detectRequestPlatform(req),
        ip: req.ip,
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code,
        })
      );
    }

    if (!/^\d+$/.test(verified.profile.id)) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "OIDC_TOKEN_INVALID",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code: "OIDC_TOKEN_INVALID",
          detail: "OIDC user identifier is invalid",
        })
      );
    }

    const replay = await registerReplayPayload({
      provider: "telegram_oidc",
      rawPayload: tokenSet.id_token!,
      subjectId: verified.profile.id,
      ttlSeconds: env.telegram.allowedMaxAuthAgeSec,
    });
    if (!replay.ok) {
      recordAuthMetric({
        method: "OIDC",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "AUTH_REPLAY_DETECTED",
      });
      return res.redirect(
        302,
        buildAuthErrorRedirectPath({
          redirectTo: row.redirect_to,
          code: "AUTH_REPLAY_DETECTED",
          detail: "Replay login payload rejected",
        })
      );
    }

    await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: verified.profile.id,
        firstName: verified.profile.first_name,
        lastName: verified.profile.last_name,
        username: verified.profile.username,
        avatarUrl: verified.profile.photo_url,
      },
      authMethod: "OIDC",
    });
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());
    recordAuthMetric({
      method: "OIDC",
      platform: detectRequestPlatform(req),
      outcome: "SUCCESS",
    });

    console.info("[auth] telegram oidc login success", {
      userId: req.session.userId,
      ip: req.ip,
      platform: detectRequestPlatform(req),
    });
    const { origin } = getAuthPublicUrls(req);
    const targetUrl = new URL(sanitizeRedirectTo(row.redirect_to, "/app"), origin).toString();
    return res.redirect(302, targetUrl);
  })
);

authRouter.get(
  "/telegram/direct",
  asyncHandler(async (req, res) => {
    const redirectTo = sanitizeRedirectTo(req.query.redirectTo, "/app");
    const { stickyBucket, decision } = shouldUseOidcFromCanary(req, res, redirectTo);
    if (decision.useOidc) {
      console.info("[auth] telegram direct route -> oidc", {
        reason: decision.reason,
        redirectTo,
        canaryPercent: env.telegramOidc.canaryPercent,
        stickyBucket,
        ip: req.ip,
      });
      return res.redirect(
        302,
        `/api/v1/auth/telegram/oidc/start?redirectTo=${encodeURIComponent(redirectTo)}`
      );
    }
    recordAuthMetric({
      method: "LEGACY_WIDGET",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });
    console.info("[auth] telegram direct route -> legacy", {
      reason: decision.reason,
      redirectTo,
      canaryPercent: env.telegramOidc.canaryPercent,
      stickyBucket,
      ip: req.ip,
    });
    const urls = getAuthPublicUrls(req);
    const callbackUrlWithRedirect = new URL(urls.callbackUrl);
    callbackUrlWithRedirect.searchParams.set("redirectTo", redirectTo);
    res.redirect(302, buildTelegramOAuthUrl({ origin: urls.origin, returnTo: callbackUrlWithRedirect.toString() }));
  })
);

authRouter.get(
  "/telegram/callback",
  asyncHandler(async (req, res) => {
    const rawQuery = req.query as Record<string, unknown>;
    const redirectTo = sanitizeRedirectTo(req.query.redirectTo, "/app");
    recordAuthMetric({
      method: "LEGACY_WIDGET",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });
    if (!rawQuery.id || !rawQuery.auth_date || !rawQuery.hash) {
      recordAuthMetric({
        method: "LEGACY_WIDGET",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "TELEGRAM_MISSING_FIELDS",
      });
      console.warn("[auth] telegram callback missing required fields", {
        ip: req.ip,
        ua: req.get("user-agent") || "",
        platform: detectRequestPlatform(req),
      });
      const { callbackUrl, fallbackUrl } = getAuthPublicUrls(req);
      const callbackUrlWithRedirect = new URL(callbackUrl);
      callbackUrlWithRedirect.searchParams.set("redirectTo", redirectTo);
      return res.type("html").send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Telegram Auth Redirect</title>
  </head>
  <body>
    <script>
      (function () {
        function toQueryFromObject(obj) {
          if (!obj || !obj.id || !obj.auth_date || !obj.hash) return "";
          var p = new URLSearchParams();
          if (obj.id != null) p.set("id", String(obj.id));
          if (obj.first_name != null) p.set("first_name", String(obj.first_name));
          if (obj.last_name != null) p.set("last_name", String(obj.last_name));
          if (obj.username != null) p.set("username", String(obj.username));
          if (obj.photo_url != null) p.set("photo_url", String(obj.photo_url));
          if (obj.auth_date != null) p.set("auth_date", String(obj.auth_date));
          if (obj.hash != null) p.set("hash", String(obj.hash));
          return p.toString();
        }

        function decodeBase64Url(input) {
          var b64 = input.replace(/-/g, "+").replace(/_/g, "/");
          while (b64.length % 4 !== 0) b64 += "=";
          return atob(b64);
        }

        function queryWithTelegramFields(raw) {
          if (!raw) return "";
          var params = new URLSearchParams(raw);
          if (params.get("id") && params.get("auth_date") && params.get("hash")) {
            return params.toString();
          }
          var packed = params.get("tgAuthResult");
          if (!packed) return "";
          try {
            var decoded = decodeURIComponent(packed);
            try {
              var asParams = new URLSearchParams(decoded);
              if (asParams.get("id") && asParams.get("auth_date") && asParams.get("hash")) {
                return asParams.toString();
              }
            } catch (_ignore) {}

            try {
              var json = JSON.parse(decodeBase64Url(decoded));
              var qs = toQueryFromObject(json);
              if (qs) return qs;
            } catch (_ignore2) {}
          } catch (_ignore3) {}
          return "";
        }

        var hash = window.location.hash ? window.location.hash.slice(1) : "";
        var hashQuery = queryWithTelegramFields(hash);
        if (hashQuery) {
          window.location.replace("${callbackUrlWithRedirect.toString()}&" + hashQuery);
          return;
        }

        var search = window.location.search ? window.location.search.slice(1) : "";
        var searchQuery = queryWithTelegramFields(search);
        if (searchQuery) {
          window.location.replace("${callbackUrlWithRedirect.toString()}&" + searchQuery);
          return;
        }

        var debug = encodeURIComponent("h=" + hash + ";s=" + search);
        window.location.replace("${fallbackUrl}?auth_error=telegram_missing_fields&debug=" + debug);
      })();
    </script>
  </body>
</html>`);
    }

    const payload = parseTelegramPayload(rawQuery);
    const verification = verifyTelegramAuth(payload);
    if (!verification.ok) {
      recordAuthMetric({
        method: "LEGACY_WIDGET",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: normalizeErrorCode(verification.reason, "TELEGRAM_VERIFICATION_FAILED"),
      });
      console.warn("[auth] telegram callback verification failed", {
        ip: req.ip,
        reason: verification.reason || "unknown",
        platform: detectRequestPlatform(req),
      });
      return res.status(401).json({ detail: verification.reason || "Telegram verification failed" });
    }
    await pruneExpiredAuthArtifacts();
    const callbackReplay = await registerReplayPayload({
      provider: "telegram_callback",
      rawPayload: `${payload.id}:${payload.auth_date}:${payload.hash}`,
      subjectId: payload.id,
      ttlSeconds: env.telegram.allowedMaxAuthAgeSec,
    });
    if (!callbackReplay.ok) {
      recordAuthMetric({
        method: "LEGACY_WIDGET",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "AUTH_REPLAY_DETECTED",
      });
      return res.status(409).json({ detail: "Replay login payload rejected", code: "AUTH_REPLAY_DETECTED" });
    }
    await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: payload.id,
        firstName: payload.first_name,
        lastName: payload.last_name,
        username: payload.username,
        avatarUrl: payload.photo_url,
      },
      authMethod: "LEGACY_WIDGET",
    });
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());
    recordAuthMetric({
      method: "LEGACY_WIDGET",
      platform: detectRequestPlatform(req),
      outcome: "SUCCESS",
    });
    console.info("[auth] telegram callback login success", {
      userId: req.session.userId,
      ip: req.ip,
      platform: detectRequestPlatform(req),
    });
    const { origin } = getAuthPublicUrls(req);
    const targetUrl = new URL(redirectTo, origin).toString();
    res.redirect(targetUrl);
  })
);

authRouter.post(
  "/telegram/webapp",
  asyncHandler(async (req, res) => {
    const parsed = webAppAuthSchema.parse(req.body);
    const forceLogin = Boolean((req.body as Record<string, unknown> | undefined)?.forceLogin === true);
    recordAuthMetric({
      method: "WEBAPP",
      platform: detectRequestPlatform(req),
      outcome: "ATTEMPT",
    });

    if (hasCookie(req, LOGOUT_GUARD_COOKIE_NAME) && !forceLogin) {
      recordAuthMetric({
        method: "WEBAPP",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "LOGOUT_GUARD_ACTIVE",
      });
      return res
        .status(409)
        .json({
          detail: "Session was explicitly logged out. Login via button is required.",
          code: "LOGOUT_GUARD_ACTIVE",
        });
    }

    const verification = verifyTelegramWebAppInitData(parsed.initData);
    if (!verification.ok || !verification.payload) {
      recordAuthMetric({
        method: "WEBAPP",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: normalizeErrorCode(verification.reason, "TELEGRAM_WEBAPP_INVALID"),
      });
      console.warn("[auth] telegram webapp verification failed", {
        ip: req.ip,
        reason: verification.reason || "unknown",
        platform: detectRequestPlatform(req),
      });
      return res.status(401).json({ detail: verification.reason || "Telegram WebApp verification failed" });
    }

    await pruneExpiredAuthArtifacts();
    const webappReplay = await registerReplayPayload({
      provider: "telegram_webapp",
      rawPayload: parsed.initData,
      subjectId: verification.payload.id,
      ttlSeconds: env.telegram.allowedMaxAuthAgeSec,
    });
    if (!webappReplay.ok) {
      recordAuthMetric({
        method: "WEBAPP",
        platform: detectRequestPlatform(req),
        outcome: "ERROR",
        code: "AUTH_REPLAY_DETECTED",
      });
      return res.status(409).json({ detail: "Replay login payload rejected", code: "AUTH_REPLAY_DETECTED" });
    }

    await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: verification.payload.id,
        firstName: verification.payload.first_name,
        lastName: verification.payload.last_name,
        username: verification.payload.username,
        avatarUrl: verification.payload.photo_url,
      },
      authMethod: "WEBAPP",
    });
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());
    recordAuthMetric({
      method: "WEBAPP",
      platform: detectRequestPlatform(req),
      outcome: "SUCCESS",
    });
    console.info("[auth] telegram webapp login success", {
      userId: req.session.userId,
      ip: req.ip,
      platform: detectRequestPlatform(req),
    });
    return res.json({ ok: true });
  })
);

authRouter.post(
  "/dev/login",
  asyncHandler(async (req, res) => {
    if (!env.devAuth.enabled) {
      return res.status(404).json({ detail: "Not found" });
    }

    if (env.devAuth.secret) {
      const providedSecret = req.header("x-dev-auth-secret");
      if (!providedSecret || providedSecret !== env.devAuth.secret) {
        return res.status(403).json({ detail: "Invalid dev auth secret" });
      }
    }

    const parsed = devLoginSchema.parse(req.body ?? {});
    const loginPayload = await resolveDevLoginPayload(parsed);

    const login = await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: loginPayload.id,
        firstName: loginPayload.first_name,
        username: loginPayload.username,
      },
      authMethod: "DEV",
    });
    if (!login) {
      return res.status(500).json({ detail: "Dev login failed", code: "DEV_LOGIN_FAILED" });
    }
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());

    await query(
      `UPDATE users
       SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [login.userId]
    );
    req.session.entryRole = "USER";

    const createdMembership = parsed.ensureTeam === false ? false : await ensureUserHasTeam(login.userId, req);

    await new Promise<void>((resolve, reject) => {
      req.session.save((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return res.json({
      ok: true,
      userId: login.userId,
      createdMembership,
      redirectTo: parsed.redirectTo || "/app",
    });
  })
);

authRouter.get(
  "/dev/login",
  asyncHandler(async (req, res) => {
    if (!env.devAuth.enabled) {
      return res.status(404).json({ detail: "Not found" });
    }

    if (env.devAuth.secret) {
      const providedSecret = req.query.secret;
      if (typeof providedSecret !== "string" || providedSecret !== env.devAuth.secret) {
        return res.status(403).json({ detail: "Invalid dev auth secret" });
      }
    }

    const parsed = devLoginSchema.parse({
      userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
      telegramId: typeof req.query.telegramId === "string" ? req.query.telegramId : undefined,
      username: typeof req.query.username === "string" ? req.query.username : undefined,
      ensureTeam: req.query.ensureTeam === "0" ? false : true,
      redirectTo: typeof req.query.redirectTo === "string" ? req.query.redirectTo : "/app",
    });

    const loginPayload = await resolveDevLoginPayload(parsed);

    const login = await completeOAuthLogin(req, res, {
      provider: "telegram",
      profile: {
        id: loginPayload.id,
        firstName: loginPayload.first_name,
        username: loginPayload.username,
      },
      authMethod: "DEV",
    });
    if (!login) {
      return res.status(500).json({ detail: "Dev login failed", code: "DEV_LOGIN_FAILED" });
    }
    res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());
    await query(
      `UPDATE users
       SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [login.userId]
    );
    req.session.entryRole = "USER";

    if (parsed.ensureTeam !== false) {
      await ensureUserHasTeam(login.userId, req);
    }

    await new Promise<void>((resolve, reject) => {
      req.session.save((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return res.redirect(parsed.redirectTo || "/app");
  })
);

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await attachAuthUser(req);
    if (!user) {
      return res.json({ authenticated: false });
    }

    const effectiveRole = getEffectiveEntryRole(req, user);
    const memberships = await getUserMemberships(user.id);
    const allowAdminChoice = canChooseAdminRole(user);
    const captainedTeamsRaw = Array.from(
      new Map(
        memberships
          .filter((m) => m.role === "CAPTAIN")
          .map((m) => [m.team_id, { id: m.team_id, name: m.team_name }])
      ).values()
    );
    const platformTeamsRaw =
      effectiveRole === "ADMIN" && allowAdminChoice
        ? (
            await query<{ id: string; name: string }>(
              `SELECT id, name FROM teams ORDER BY name ASC`
            )
          ).rows
        : [];
    const trustedAdminReady = isTrustedAdminReady(req.session.authMethod);
    const platformTeams = trustedAdminReady ? platformTeamsRaw : [];
    const teamAdminTeams = trustedAdminReady ? captainedTeamsRaw : [];
    const adminScope: AdminScope =
      platformTeams.length > 0 ? "PLATFORM" : teamAdminTeams.length > 0 ? "TEAM" : "NONE";
    const managedTeams =
      adminScope === "PLATFORM" ? platformTeams : adminScope === "TEAM" ? teamAdminTeams : [];
    const managedTeamIds =
      managedTeams.map((team) => team.id);
    const capabilities = buildCapabilities({
      effectiveRole,
      memberships,
      adminScope,
    });

    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        telegramUsername: user.username,
        avatar: user.avatar,
      },
      accountRole: effectiveRole,
      roleSelectionRequired: effectiveRole === null && allowAdminChoice,
      canChooseAdminRole: allowAdminChoice,
      isOwnerAdminEligible: allowAdminChoice,
      hasMemberships: memberships.length > 0,
      activeMembershipId: req.session.activeMembershipId || null,
      activeTeamId: req.session.activeTeamId || null,
      authMethod: req.session.authMethod ?? null,
      onboardingRequired: !user.onboarding_completed_at,
      capabilities,
      adminScope,
      managedTeamIds,
      managedTeams,
      availableRoles: memberships.map((m) => ({
        membershipId: m.id,
        teamId: m.team_id,
        teamName: m.team_name,
        role: m.role,
      })),
    });
  })
);

authRouter.post(
  "/context",
  requireAuth,
  asyncHandler(async (req, res) => {
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    if (effectiveRole !== "USER") {
      return res.status(403).json({ detail: "Team context is available only for user accounts" });
    }

    const parsed = contextSchema.parse(req.body);
    const membership = await getMembershipById(parsed.membershipId);
    if (!membership || membership.user_id !== req.authUser!.id) {
      return res.status(403).json({ detail: "Membership is not available for this user" });
    }

    req.session.activeMembershipId = membership.id;
    req.session.activeTeamId = membership.team_id;

    await writeAudit(req.authUser!.id, "auth.context.switch", {
      membershipId: membership.id,
      teamId: membership.team_id,
    });

    return res.json({ ok: true });
  })
);

authRouter.post(
  "/select-role",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = selectRoleSchema.parse(req.body);
    const user = req.authUser!;
    const allowAdminChoice = canChooseAdminRole(user);
    if (parsed.accountRole === "ADMIN" && !allowAdminChoice) {
      return res.status(403).json({ detail: "Admin role is not allowed for this account" });
    }
    if (!allowAdminChoice && parsed.accountRole !== "USER") {
      return res.status(403).json({ detail: "Only user role is available for this account" });
    }

    await query(
      `UPDATE users
       SET account_role = $2::account_role, role_selected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [user.id, parsed.accountRole]
    );

    req.session.entryRole = parsed.accountRole;

    delete req.session.activeMembershipId;
    delete req.session.activeTeamId;

    await writeAudit(user.id, "auth.account_role.select", { accountRole: parsed.accountRole });

    return res.json({ ok: true, accountRole: parsed.accountRole });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const userId = req.session.userId ?? null;
    await new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });
    if (userId) {
      await writeAudit(userId, "auth.logout");
    }
    res.clearCookie(env.session.cookieName);
    res.cookie(LOGOUT_GUARD_COOKIE_NAME, "1", {
      ...logoutGuardCookieOptions(),
      maxAge: LOGOUT_GUARD_TTL_MS,
    });
    return res.json({ ok: true });
  })
);
