import { describe, expect, it } from "vitest";
import {
  detectAuthPlatform,
  extractAuthError,
  normalizeAuthErrorCode,
  resolveTelegramLoginTransport,
  resolveAuthErrorMessage,
} from "../../lib/auth-ux";

describe("auth error mapping", () => {
  it("normalizes code from mixed query payloads", () => {
    expect(normalizeAuthErrorCode("oidc_state_expired")).toBe("OIDC_STATE_EXPIRED");
    expect(normalizeAuthErrorCode("auth_error=auth_replay_detected")).toBe("AUTH_REPLAY_DETECTED");
  });

  it("returns explicit message for known OIDC code", () => {
    const message = resolveAuthErrorMessage({ code: "OIDC_STATE_EXPIRED", scope: "USER" });
    expect(message).toContain("сесс");
  });

  it("returns admin-friendly access message", () => {
    const message = resolveAuthErrorMessage({ code: "ADMIN_SCOPE_NONE", scope: "ADMIN" });
    expect(message).toContain("админ");
  });

  it("returns explicit message for expired handoff link", () => {
    const message = resolveAuthErrorMessage({ code: "HANDOFF_TOKEN_EXPIRED", scope: "USER" });
    expect(message.toLowerCase()).toContain("ссылка");
  });

  it("falls back to backend detail for unknown code", () => {
    const detail = "HTTP 401";
    expect(resolveAuthErrorMessage({ code: "SOMETHING_ELSE", detail, scope: "USER" })).toContain(detail);
  });

  it("extracts logout guard code from api detail", () => {
    const parsed = extractAuthError({ message: "Session was explicitly logged out. Login via button is required." });
    expect(parsed.code).toBe("LOGOUT_GUARD_ACTIVE");
  });
});

describe("auth platform detection", () => {
  it("detects Android from Telegram platform", () => {
    expect(detectAuthPlatform({ telegramPlatform: "android", userAgent: "Mozilla/5.0" })).toBe("android");
  });

  it("detects iOS from user-agent", () => {
    expect(
      detectAuthPlatform({
        telegramPlatform: "",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15",
      })
    ).toBe("ios");
  });

  it("falls back to desktop when no mobile marker is present", () => {
    expect(
      detectAuthPlatform({
        telegramPlatform: "web",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      })
    ).toBe("desktop");
  });
});

describe("telegram login transport selection", () => {
  it("uses webapp transport only when initData is present", () => {
    expect(
      resolveTelegramLoginTransport({
        hasTelegramWebApp: true,
        initData: "query_id=abc123",
      })
    ).toBe("WEBAPP");
  });

  it("falls back to oidc when webapp object exists but initData is empty", () => {
    expect(
      resolveTelegramLoginTransport({
        hasTelegramWebApp: true,
        initData: "   ",
      })
    ).toBe("OIDC");
  });

  it("uses oidc when telegram webapp object is missing", () => {
    expect(
      resolveTelegramLoginTransport({
        hasTelegramWebApp: false,
        initData: "",
      })
    ).toBe("OIDC");
  });
});
