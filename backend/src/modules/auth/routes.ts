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
import { pruneExpiredAuthArtifacts, registerReplayPayload, sha256Hex } from "../../lib/replay-guard.js";

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

function hasCookie(req: any, name: string): boolean {
  const rawCookie = req?.headers?.cookie;
  if (typeof rawCookie !== "string" || !rawCookie.trim()) return false;
  const target = `${name}=`;
  return rawCookie
    .split(";")
    .map((part: string) => part.trim())
    .some((part: string) => part.startsWith(target));
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

function getRequestPublicOrigin(req: any): string {
  const fallback = new URL(env.frontendUrl);
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    ?.trim();
  const host = forwardedHost || String(req.get("host") || "").split(",")[0]?.trim();
  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    ?.trim();
  const protocol = forwardedProto || fallback.protocol.replace(":", "");

  if (!host) {
    return env.frontendUrl;
  }
  return `${protocol}://${host}`;
}

function getAuthPublicUrls(req: any) {
  const origin = getRequestPublicOrigin(req);
  return {
    origin,
    callbackUrl: new URL("/api/v1/auth/telegram/callback", origin).toString(),
    appUrl: new URL("/app", origin).toString(),
    fallbackUrl: new URL("/", origin).toString(),
  };
}

async function completeTelegramLogin(
  req: any,
  res: any,
  payload: {
    id: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  },
  options?: { authMethod?: "WEBAPP" | "OIDC" | "LEGACY_WIDGET" | "DEV" }
) {
  const name = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim() || payload.username || `tg-${payload.id}`;
  const nickname = payload.username || `tg_${payload.id}`;

  const upsert = await query<{
    id: string;
    telegram_id: string;
    username: string | null;
    account_role: "ADMIN" | "USER" | null;
  }>(
    `INSERT INTO users (telegram_id, username, name, nickname, avatar, account_role, role_selected_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       name = EXCLUDED.name,
       nickname = EXCLUDED.nickname,
       avatar = EXCLUDED.avatar,
       updated_at = NOW()
     RETURNING id, telegram_id::text, username, account_role`,
    [payload.id, payload.username ?? null, name, nickname, payload.photo_url ?? null]
  );

  const userRow = upsert.rows[0];
  const userId = userRow.id;
  const allowAdminChoice = canChooseAdminRole({ telegram_id: userRow.telegram_id, username: userRow.username });

  if (!allowAdminChoice && !userRow.account_role) {
    await query(
      `UPDATE users
       SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });

  req.session.userId = userId;
  req.session.authMethod = options?.authMethod ?? "WEBAPP";
  if (allowAdminChoice) {
    delete req.session.entryRole;
  } else {
    req.session.entryRole = "USER";
  }

  const accountRole = req.session.entryRole ?? null;

  const memberships = accountRole === "USER" ? await getUserMemberships(userId) : [];
  if (accountRole === "USER" && memberships.length === 1) {
    req.session.activeMembershipId = memberships[0].id;
    req.session.activeTeamId = memberships[0].team_id;
  } else {
    delete req.session.activeMembershipId;
    delete req.session.activeTeamId;
  }

  await writeAudit(userId, "auth.telegram.login", {
    telegramId: payload.id,
    authMethod: req.session.authMethod,
  });

  await new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
  res.clearCookie(LOGOUT_GUARD_COOKIE_NAME, logoutGuardCookieOptions());

  return { userId };
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

authRouter.get(
  "/telegram/start",
  asyncHandler(async (_req, res) => {
    const urls = getAuthPublicUrls(_req);
    res.type("html").send(buildTelegramStartHtml({ callback: urls.callbackUrl, fallback: urls.fallbackUrl }));
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
      return res.status(401).json({ detail: "OIDC state is missing or already used", code: "OIDC_STATE_EXPIRED" });
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ detail: "OIDC state expired", code: "OIDC_STATE_EXPIRED" });
    }

    const currentIpHash = hashRequestSide(req.ip);
    const currentUaHash = hashRequestSide(req.get("user-agent") || "");
    if (row.ip_hash && currentIpHash && row.ip_hash !== currentIpHash) {
      return res.status(401).json({ detail: "OIDC request origin mismatch", code: "OIDC_STATE_EXPIRED" });
    }
    if (row.ua_hash && currentUaHash && row.ua_hash !== currentUaHash) {
      return res.status(401).json({ detail: "OIDC request agent mismatch", code: "OIDC_STATE_EXPIRED" });
    }

    const tokenSet = await exchangeOidcCode({
      code: parsed.code,
      codeVerifier: row.code_verifier,
      redirectUri: env.telegramOidc.redirectUri,
    });
    const verified = await verifyOidcIdToken({
      idToken: tokenSet.id_token!,
      expectedNonce: row.nonce ?? undefined,
    });

    if (!/^\d+$/.test(verified.profile.id)) {
      return res.status(401).json({ detail: "OIDC user identifier is invalid", code: "OIDC_TOKEN_INVALID" });
    }

    const replay = await registerReplayPayload({
      provider: "telegram_oidc",
      rawPayload: tokenSet.id_token!,
      subjectId: verified.profile.id,
      ttlSeconds: env.telegram.allowedMaxAuthAgeSec,
    });
    if (!replay.ok) {
      return res.status(409).json({ detail: "Replay login payload rejected", code: "AUTH_REPLAY_DETECTED" });
    }

    await completeTelegramLogin(
      req,
      res,
      {
        id: verified.profile.id,
        first_name: verified.profile.first_name,
        last_name: verified.profile.last_name,
        username: verified.profile.username,
        photo_url: verified.profile.photo_url,
      },
      { authMethod: "OIDC" }
    );

    console.info("[auth] telegram oidc login success", {
      userId: req.session.userId,
      ip: req.ip,
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
    if (env.telegramOidc.enabled && env.telegramOidc.fallbackEnabled) {
      return res.redirect(
        302,
        `/api/v1/auth/telegram/oidc/start?redirectTo=${encodeURIComponent(redirectTo)}`
      );
    }
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
    if (!rawQuery.id || !rawQuery.auth_date || !rawQuery.hash) {
      console.warn("[auth] telegram callback missing required fields", {
        ip: req.ip,
        ua: req.get("user-agent") || "",
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
      console.warn("[auth] telegram callback verification failed", {
        ip: req.ip,
        reason: verification.reason || "unknown",
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
      return res.status(409).json({ detail: "Replay login payload rejected", code: "AUTH_REPLAY_DETECTED" });
    }
    await completeTelegramLogin(req, res, payload, { authMethod: "LEGACY_WIDGET" });
    console.info("[auth] telegram callback login success", {
      userId: req.session.userId,
      ip: req.ip,
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

    if (hasCookie(req, LOGOUT_GUARD_COOKIE_NAME) && !forceLogin) {
      return res
        .status(409)
        .json({
          detail: "Session was explicitly logged out. Login via button is required.",
          code: "LOGOUT_GUARD_ACTIVE",
        });
    }

    const verification = verifyTelegramWebAppInitData(parsed.initData);
    if (!verification.ok || !verification.payload) {
      console.warn("[auth] telegram webapp verification failed", {
        ip: req.ip,
        reason: verification.reason || "unknown",
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
      return res.status(409).json({ detail: "Replay login payload rejected", code: "AUTH_REPLAY_DETECTED" });
    }

    await completeTelegramLogin(req, res, verification.payload, { authMethod: "WEBAPP" });
    console.info("[auth] telegram webapp login success", {
      userId: req.session.userId,
      ip: req.ip,
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

    const login = await completeTelegramLogin(req, res, loginPayload, { authMethod: "DEV" });

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

    const login = await completeTelegramLogin(req, res, loginPayload, { authMethod: "DEV" });
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
    const captainedTeamIds = Array.from(
      new Set(memberships.filter((m) => m.role === "CAPTAIN").map((m) => m.team_id))
    );
    const platformTeamIdsRaw =
      effectiveRole === "ADMIN" && allowAdminChoice
        ? (
            await query<{ id: string }>(
              `SELECT id FROM teams ORDER BY name ASC`
            )
          ).rows.map((r) => r.id)
        : [];
    const oidcAdminReady = !env.telegramOidc.adminRequired || req.session.authMethod === "OIDC";
    const platformTeamIds = oidcAdminReady ? platformTeamIdsRaw : [];
    const teamAdminTeamIds = oidcAdminReady ? captainedTeamIds : [];
    const adminScope: AdminScope =
      platformTeamIds.length > 0 ? "PLATFORM" : teamAdminTeamIds.length > 0 ? "TEAM" : "NONE";
    const managedTeamIds =
      adminScope === "PLATFORM" ? platformTeamIds : adminScope === "TEAM" ? teamAdminTeamIds : [];
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
      capabilities,
      adminScope,
      managedTeamIds,
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
