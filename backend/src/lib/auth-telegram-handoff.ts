import crypto from "node:crypto";

type TrustedAuthMethod =
  | "WEBAPP"
  | "OIDC"
  | "LEGACY_WIDGET"
  | "DEV"
  | "BOT_HANDOFF"
  | "YANDEX_OAUTH"
  | null
  | undefined;

export type TelegramHandoffScope = "USER" | "ADMIN";
type TelegramHandoffProfile = {
  id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
};

type TelegramHandoffWebhookStart = {
  attemptKey: string;
  telegramChatId: string;
  telegramUserId: string;
  profile: TelegramHandoffProfile;
};

function sanitizeRelativeRedirect(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  return input;
}

export function buildTelegramHandoffDeepLink(botUsername: string, attemptKey: string): string {
  return `https://t.me/${botUsername}?start=login_${attemptKey}`;
}

export function buildTelegramHandoffAttemptKey(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function buildTelegramHandoffCompletionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function buildTelegramHandoffCompletionUrl(origin: string, token: string): string {
  const url = new URL("/api/v1/auth/telegram/handoff/complete", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function hashTelegramHandoffCompletionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function parseTelegramHandoffStartText(text: string): string | null {
  const match = text.match(/^\/start(?:@\w+)?\s+login_([A-Za-z0-9_-]+)$/);
  return match?.[1] || null;
}

export function isTelegramStartCommandText(text: string): boolean {
  return /^\/start(?:@\w+)?(?:\s+login_[A-Za-z0-9_-]+)?$/.test(text.trim());
}

export function parseTelegramHandoffWebhookStart(update: Record<string, any>): TelegramHandoffWebhookStart | null {
  const message = update?.message;
  const attemptKey = parseTelegramHandoffStartText(String(message?.text || ""));
  const fromId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (!attemptKey || fromId === undefined || fromId === null || chatId === undefined || chatId === null) {
    return null;
  }
  return {
    attemptKey,
    telegramChatId: String(chatId),
    telegramUserId: String(fromId),
    profile: {
      id: String(fromId),
      username: message?.from?.username ? String(message.from.username) : undefined,
      first_name: message?.from?.first_name ? String(message.from.first_name) : undefined,
      last_name: message?.from?.last_name ? String(message.from.last_name) : undefined,
      photo_url: message?.from?.photo_url ? String(message.from.photo_url) : undefined,
    },
  };
}

export function resolveTelegramHandoffRedirect(params: {
  scope: TelegramHandoffScope;
  redirectTo?: unknown;
}): string {
  const fallback = params.scope === "ADMIN" ? "/admin" : "/app";
  const safe = sanitizeRelativeRedirect(params.redirectTo);
  if (!safe) return fallback;
  if (params.scope === "ADMIN") {
    return safe.startsWith("/admin") ? safe : "/admin";
  }
  return safe.startsWith("/admin") ? "/app" : safe;
}

export function isTrustedAdminAuthMethod(authMethod: TrustedAuthMethod): boolean {
  // Trusted admin methods are full server-mediated OAuth flows with
  // state validation and replay-guard:
  //  - OIDC          — Telegram OIDC (signed JWT, replay-guarded).
  //  - BOT_HANDOFF   — one-shot server-issued token presented via the bot DM.
  //  - YANDEX_OAUTH  — OAuth2 + PKCE + replay-guard (migrations 023/024).
  // WEBAPP (Telegram Mini App initData) is intentionally NOT trusted:
  // initData is client-presented and trust-rooted in the host TG client,
  // which is acceptable for player surfaces but not for the admin gate.
  return (
    authMethod === "OIDC" ||
    authMethod === "BOT_HANDOFF" ||
    authMethod === "YANDEX_OAUTH"
  );
}

export function resolveOnboardingRequired(params: {
  onboardingCompletedAt: string | null;
  wasAutoCreated: boolean;
}): boolean {
  return params.wasAutoCreated && !params.onboardingCompletedAt;
}
