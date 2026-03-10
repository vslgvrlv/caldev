import dotenv from "dotenv";

dotenv.config({ path: process.env.BACKEND_ENV_FILE || undefined });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asNumber(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric env var ${name}`);
  }
  return n;
}

function asBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

function asSameSite(value: string | undefined, fallback: "lax" | "none" | "strict"): "lax" | "none" | "strict" {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "lax" || normalized === "none" || normalized === "strict") {
    return normalized;
  }
  throw new Error("Invalid SESSION_COOKIE_SAMESITE. Allowed values: lax, none, strict");
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",
  port: asNumber(process.env.PORT || "8000", "PORT"),
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:3000",

  db: {
    host: required("DB_HOST", "127.0.0.1"),
    port: asNumber(required("DB_PORT", "5432"), "DB_PORT"),
    user: required("DB_USER", "pbth"),
    password: required("DB_PASSWORD", "pbth"),
    database: required("DB_NAME", "pbth"),
    ssl: asBoolean(process.env.DB_SSL, false),
  },

  session: {
    secret: required("SESSION_SECRET", "dev-only-change-me"),
    maxAgeMs: asNumber(process.env.SESSION_MAX_AGE_MS || String(1000 * 60 * 60 * 24 * 14), "SESSION_MAX_AGE_MS"),
    cookieName: process.env.SESSION_COOKIE_NAME || "pbth.sid",
    cookieDomain: (process.env.SESSION_COOKIE_DOMAIN || "").trim() || undefined,
    // `lax` is more compatible with Telegram Android WebView for same-origin mini apps.
    // `none` can cause session cookie persistence issues in some embedded browsers.
    cookieSameSite: asSameSite(process.env.SESSION_COOKIE_SAMESITE, "lax"),
  },

  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN", ""),
    allowedMaxAuthAgeSec: asNumber(process.env.TELEGRAM_MAX_AUTH_AGE_SEC || "600", "TELEGRAM_MAX_AUTH_AGE_SEC"),
    callbackUrl: required("TELEGRAM_CALLBACK_URL", "http://127.0.0.1:8000/api/v1/auth/telegram/callback"),
    botUsername: required("TELEGRAM_BOT_USERNAME", ""),
  },

  telegramOidc: {
    enabled: asBoolean(process.env.AUTH_OIDC_ENABLED, false),
    fallbackEnabled: asBoolean(process.env.AUTH_OIDC_FALLBACK_ENABLED, true),
    adminRequired: asBoolean(process.env.AUTH_OIDC_ADMIN_REQUIRED, false),
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID || "",
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET || "",
    redirectUri: process.env.TELEGRAM_OIDC_REDIRECT_URI || "",
    issuer: process.env.TELEGRAM_OIDC_ISSUER || "https://oauth.telegram.org",
    jwksUrl: process.env.TELEGRAM_OIDC_JWKS_URL || "https://oauth.telegram.org/.well-known/jwks.json",
    authorizeUrl: process.env.TELEGRAM_OIDC_AUTHORIZE_URL || "https://oauth.telegram.org/auth",
    tokenUrl: process.env.TELEGRAM_OIDC_TOKEN_URL || "https://oauth.telegram.org/token",
    stateTtlSeconds: asNumber(process.env.AUTH_OIDC_STATE_TTL_SEC || "600", "AUTH_OIDC_STATE_TTL_SEC"),
    clockSkewSeconds: asNumber(process.env.AUTH_OIDC_CLOCK_SKEW_SEC || "60", "AUTH_OIDC_CLOCK_SKEW_SEC"),
  },

  adminRoleAllowlist: {
    usernames: (process.env.ADMIN_ROLE_ALLOWLIST_USERNAMES || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
    telegramIds: (process.env.ADMIN_ROLE_ALLOWLIST_IDS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  },

  ics: {
    secret: required("ICS_TOKEN_SECRET", "dev-ics-secret"),
    defaultTimezone: process.env.APP_TIME_ZONE || "Europe/Moscow",
    recurringWindowDays: asNumber(process.env.ICS_RECURRING_WINDOW_DAYS || "45", "ICS_RECURRING_WINDOW_DAYS"),
  },

  rateLimit: {
    authWindowMs: asNumber(process.env.RATE_AUTH_WINDOW_MS || "60000", "RATE_AUTH_WINDOW_MS"),
    authMax: asNumber(process.env.RATE_AUTH_MAX || "20", "RATE_AUTH_MAX"),
    writeWindowMs: asNumber(process.env.RATE_WRITE_WINDOW_MS || "60000", "RATE_WRITE_WINDOW_MS"),
    writeMax: asNumber(process.env.RATE_WRITE_MAX || "120", "RATE_WRITE_MAX"),
  },

  notifications: {
    queueEnabled: asBoolean(process.env.NOTIFICATIONS_QUEUE_ENABLED, false),
    queueConcurrency: asNumber(process.env.NOTIFICATIONS_QUEUE_CONCURRENCY || "5", "NOTIFICATIONS_QUEUE_CONCURRENCY"),
    retryLimit: asNumber(process.env.NOTIFICATIONS_QUEUE_RETRY_LIMIT || "4", "NOTIFICATIONS_QUEUE_RETRY_LIMIT"),
    retryDelaySeconds: asNumber(process.env.NOTIFICATIONS_QUEUE_RETRY_DELAY_SECONDS || "20", "NOTIFICATIONS_QUEUE_RETRY_DELAY_SECONDS"),
  },

  devAuth: {
    enabled: asBoolean(process.env.DEV_AUTH_ENABLED, false),
    secret: process.env.DEV_AUTH_SECRET || "",
  },

  release: {
    id: process.env.RELEASE_ID || "dev",
    commit: process.env.RELEASE_COMMIT || "unknown",
    builtAt: process.env.RELEASE_BUILT_AT || "unknown",
  },
};

if (env.telegramOidc.enabled) {
  if (!env.telegramOidc.clientId) {
    throw new Error("Missing TELEGRAM_OIDC_CLIENT_ID while AUTH_OIDC_ENABLED=true");
  }
  if (!env.telegramOidc.clientSecret) {
    throw new Error("Missing TELEGRAM_OIDC_CLIENT_SECRET while AUTH_OIDC_ENABLED=true");
  }
  if (!env.telegramOidc.redirectUri) {
    throw new Error("Missing TELEGRAM_OIDC_REDIRECT_URI while AUTH_OIDC_ENABLED=true");
  }
}
