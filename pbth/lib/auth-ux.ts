export type AuthScope = "USER" | "ADMIN" | "INVITE";
export type AuthPlatform = "android" | "ios" | "desktop" | "unknown";
export type AuthFlow = "MINIAPP" | "OIDC" | "UNKNOWN";

type AuthErrorMessageMap = {
  user: string;
  admin?: string;
  invite?: string;
};

const AUTH_ERROR_MESSAGES: Record<string, AuthErrorMessageMap> = {
  OIDC_STATE_EXPIRED: {
    user: "Ваша сессия входа устарела. Запустите вход через Telegram заново.",
  },
  OIDC_TOKEN_INVALID: {
    user: "Telegram не подтвердил вход. Повторите попытку.",
  },
  AUTH_REPLAY_DETECTED: {
    user: "Код входа уже использован. Запустите вход ещё раз.",
  },
  TELEGRAM_MISSING_FIELDS: {
    user: "Telegram не передал обязательные поля входа. Откройте Mini App заново.",
  },
  TELEGRAM_CALLBACK_JS_FAILED: {
    user: "Не удалось получить данные входа из Telegram. Повторите попытку.",
  },
  LOGOUT_GUARD_ACTIVE: {
    user: "Сессия была завершена после выхода. Нажмите «Войти» ещё раз.",
  },
  ADMIN_SCOPE_NONE: {
    user: "Для этого аккаунта недоступен вход в админ-режим.",
    admin: "Для этого аккаунта сейчас нет доступа к админке.",
  },
};

function tryReadParam(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
  if (normalized.includes("=") || normalized.includes("&")) {
    const params = new URLSearchParams(normalized);
    const candidate = params.get("auth_error") || params.get("code");
    if (candidate) return candidate;
  }
  return trimmed;
}

function normalizeErrorToken(value: string): string {
  return value
    .replace(/^error\s*[:=]\s*/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function normalizeAuthErrorCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidate = tryReadParam(raw);
  if (!candidate) return null;
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    decoded = candidate;
  }
  const token = normalizeErrorToken(decoded);
  if (!token) return null;
  return token.slice(0, 80);
}

export function resolveAuthErrorMessage(params: {
  code?: string | null;
  detail?: string | null;
  scope: AuthScope;
}): string {
  const code = normalizeAuthErrorCode(params.code);
  if (code && AUTH_ERROR_MESSAGES[code]) {
    const mapped = AUTH_ERROR_MESSAGES[code];
    if (params.scope === "ADMIN" && mapped.admin) return mapped.admin;
    if (params.scope === "INVITE" && mapped.invite) return mapped.invite;
    return mapped.user;
  }

  const detail = typeof params.detail === "string" ? params.detail.trim() : "";
  if (detail) {
    return `Ошибка авторизации: ${detail}`;
  }

  if (params.scope === "ADMIN") {
    return "Не удалось завершить вход в админку. Повторите попытку.";
  }
  if (params.scope === "INVITE") {
    return "Не удалось пройти авторизацию для инвайта. Повторите попытку.";
  }
  return "Не удалось завершить вход. Повторите попытку.";
}

export function detectAuthPlatform(input?: {
  telegramPlatform?: string | null;
  userAgent?: string | null;
}): AuthPlatform {
  const telegramPlatform = String(input?.telegramPlatform || "").toLowerCase();
  if (telegramPlatform.includes("android")) return "android";
  if (telegramPlatform.includes("ios") || telegramPlatform.includes("iphone") || telegramPlatform.includes("ipad")) {
    return "ios";
  }

  const userAgent = String(input?.userAgent || "").toLowerCase();
  if (userAgent.includes("android")) return "android";
  if (
    userAgent.includes("iphone") ||
    userAgent.includes("ipad") ||
    userAgent.includes("ipod") ||
    userAgent.includes("cpu os")
  ) {
    return "ios";
  }

  if (telegramPlatform || userAgent) return "desktop";
  return "unknown";
}

function currentAuthPlatform(): AuthPlatform {
  const tgPlatform = (window as any)?.Telegram?.WebApp?.platform;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return detectAuthPlatform({ telegramPlatform: tgPlatform, userAgent });
}

export function extractAuthError(err: unknown): { code: string | null; detail: string | null } {
  if (err && typeof err === "object") {
    const maybeCode = (err as any).code;
    const maybeDetail = (err as any).detail;
    const message = (err as any).message;
    const explicitCode = normalizeAuthErrorCode(typeof maybeCode === "string" ? maybeCode : null);
    const detail =
      typeof maybeDetail === "string"
        ? maybeDetail
        : typeof message === "string"
          ? message
          : null;

    if (typeof message === "string" && message.toLowerCase().includes("explicitly logged out")) {
      return { code: "LOGOUT_GUARD_ACTIVE", detail };
    }

    let inferredCode: string | null = null;
    if (!explicitCode && typeof message === "string") {
      const prefixMatch = message.trim().match(/^([A-Za-z0-9_]{3,80})\s*[:|]/);
      if (prefixMatch?.[1]) {
        inferredCode = normalizeAuthErrorCode(prefixMatch[1]);
      }
    }

    return { code: explicitCode || inferredCode, detail };
  }

  if (err instanceof Error) {
    return {
      code: normalizeAuthErrorCode(err.message),
      detail: err.message,
    };
  }

  return { code: null, detail: null };
}

export function sendAuthTelemetry(params: {
  scope: AuthScope;
  flow?: AuthFlow;
  event: string;
  code?: string | null;
  detail?: string | null;
  path?: string;
}) {
  if (typeof window === "undefined") return;

  const payload = {
    scope: params.scope,
    flow: params.flow || "UNKNOWN",
    event: params.event,
    code: normalizeAuthErrorCode(params.code || undefined) || undefined,
    detail: params.detail ? String(params.detail).slice(0, 180) : undefined,
    platform: currentAuthPlatform(),
    path: params.path || window.location.pathname,
    ts: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(
        "/api/v1/auth/telemetry/client",
        new Blob([body], { type: "application/json" })
      );
      if (sent) return;
    }
  } catch {
    // ignore telemetry transport errors
  }

  void fetch("/api/v1/auth/telemetry/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body,
  }).catch(() => {
    // ignore telemetry transport errors
  });
}
