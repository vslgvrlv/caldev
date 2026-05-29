import { describe, expect, it } from "vitest";
import {
  buildTelegramHandoffCompletionUrl,
  buildTelegramHandoffDeepLink,
  isTelegramStartCommandText,
  isTrustedAdminAuthMethod,
  parseTelegramHandoffWebhookStart,
  parseTelegramHandoffStartText,
  resolveTelegramHandoffRedirect,
  resolveOnboardingRequired,
} from "../../lib/auth-telegram-handoff.js";

describe("telegram bot handoff auth helpers", () => {
  it("builds deep link payload for bot handoff attempts", () => {
    expect(buildTelegramHandoffDeepLink("pbth_auth_bot", "abc123attempt")).toBe(
      "https://t.me/pbth_auth_bot?start=login_abc123attempt"
    );
  });

  it("parses /start login payloads and ignores unrelated texts", () => {
    expect(parseTelegramHandoffStartText("/start login_abc123attempt")).toBe("abc123attempt");
    expect(parseTelegramHandoffStartText("/start something_else")).toBeNull();
    expect(parseTelegramHandoffStartText("plain text")).toBeNull();
  });

  it("recognizes plain /start commands without handoff payload", () => {
    expect(isTelegramStartCommandText("/start")).toBe(true);
    expect(isTelegramStartCommandText("/start@pbth_staging_bot")).toBe(true);
    expect(isTelegramStartCommandText("/start login_abc123attempt")).toBe(true);
    expect(isTelegramStartCommandText("/help")).toBe(false);
    expect(isTelegramStartCommandText("plain text")).toBe(false);
  });

  it("extracts webhook /start payload with telegram identity snapshot", () => {
    expect(
      parseTelegramHandoffWebhookStart({
        message: {
          text: "/start@pbth_auth_bot login_abc123attempt",
          chat: { id: 99887766 },
          from: {
            id: 44556677,
            username: "holy_guns",
            first_name: "Holy",
            last_name: "Guns",
            photo_url: "https://cdn.example/avatar.jpg",
          },
        },
      })
    ).toEqual({
      attemptKey: "abc123attempt",
      telegramChatId: "99887766",
      telegramUserId: "44556677",
      profile: {
        id: "44556677",
        username: "holy_guns",
        first_name: "Holy",
        last_name: "Guns",
        photo_url: "https://cdn.example/avatar.jpg",
      },
    });
    expect(parseTelegramHandoffWebhookStart({ message: { text: "/start hello" } })).toBeNull();
  });

  it("normalizes redirect target by scope", () => {
    expect(resolveTelegramHandoffRedirect({ scope: "USER", redirectTo: "/events/1" })).toBe("/events/1");
    expect(resolveTelegramHandoffRedirect({ scope: "USER", redirectTo: "/admin" })).toBe("/app");
    expect(resolveTelegramHandoffRedirect({ scope: "ADMIN", redirectTo: "/admin/audit" })).toBe("/admin/audit");
    expect(resolveTelegramHandoffRedirect({ scope: "ADMIN", redirectTo: "/app" })).toBe("/admin");
    expect(resolveTelegramHandoffRedirect({ scope: "ADMIN", redirectTo: "https://evil.example" })).toBe("/admin");
  });

  it("builds clean completion URLs on the site origin", () => {
    expect(buildTelegramHandoffCompletionUrl("https://staging.pbthub.ru", "tok-123")).toBe(
      "https://staging.pbthub.ru/api/v1/auth/telegram/handoff/complete?token=tok-123"
    );
  });

  it("treats OIDC, BOT_HANDOFF, and YANDEX_OAUTH as trusted admin auth methods", () => {
    // Trusted admin methods are full server-mediated OAuth flows with
    // state validation and replay-guard (PKCE for Yandex, signed JWT for
    // Telegram OIDC, server-issued one-shot token for the bot handoff).
    // WEBAPP (Telegram Mini App initData) stays OFF this list by design:
    // initData is client-presented and trust-rooted in the host TG client.
    expect(isTrustedAdminAuthMethod("OIDC")).toBe(true);
    expect(isTrustedAdminAuthMethod("BOT_HANDOFF")).toBe(true);
    expect(isTrustedAdminAuthMethod("YANDEX_OAUTH")).toBe(true);
    expect(isTrustedAdminAuthMethod("WEBAPP")).toBe(false);
    expect(isTrustedAdminAuthMethod("LEGACY_WIDGET")).toBe(false);
    expect(isTrustedAdminAuthMethod("DEV")).toBe(false);
    expect(isTrustedAdminAuthMethod(null)).toBe(false);
    expect(isTrustedAdminAuthMethod(undefined)).toBe(false);
  });

  it("does NOT grant trusted admin status to YANDEX_OAUTH or other non-Telegram providers", () => {
    // Even if a user has account_role='ADMIN' historically, a session
    // established via Yandex (or VK / future providers) must not pass the
    // admin gate. ADMIN is gated to Telegram-trusted methods only.
    expect(isTrustedAdminAuthMethod("YANDEX_OAUTH")).toBe(false);
    expect(isTrustedAdminAuthMethod("LEGACY_WIDGET")).toBe(false);
    expect(isTrustedAdminAuthMethod("DEV")).toBe(false);
    expect(isTrustedAdminAuthMethod(undefined)).toBe(false);
  });

  it("requires soft onboarding only for first-login handoff users without completion timestamp", () => {
    expect(resolveOnboardingRequired({ onboardingCompletedAt: null, wasAutoCreated: true })).toBe(true);
    expect(resolveOnboardingRequired({ onboardingCompletedAt: "2026-03-17T10:00:00.000Z", wasAutoCreated: true })).toBe(
      false
    );
    expect(resolveOnboardingRequired({ onboardingCompletedAt: null, wasAutoCreated: false })).toBe(false);
  });
});
