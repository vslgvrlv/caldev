import { afterEach, describe, expect, it, vi } from "vitest";

describe("telegram oidc token exchange", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses Basic auth and omits client_secret from the form body", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:dummy-token";
    process.env.TELEGRAM_BOT_USERNAME = "dummy_bot";
    process.env.TELEGRAM_OIDC_CLIENT_ID = "987654321";
    process.env.TELEGRAM_OIDC_CLIENT_SECRET = "oidc-secret";
    process.env.TELEGRAM_OIDC_TOKEN_URL = "https://oauth.telegram.org/token";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: "jwt-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeOidcCode } = await import("../../lib/telegram-oidc.js");
    await exchangeOidcCode({
      code: "auth-code",
      codeVerifier: "verifier-123",
      redirectUri: "https://pbthub.ru/api/v1/auth/telegram/oidc/callback",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth.telegram.org/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from("987654321:oidc-secret").toString("base64")}`,
    });

    const params = new URLSearchParams(String(init.body || ""));
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("redirect_uri")).toBe("https://pbthub.ru/api/v1/auth/telegram/oidc/callback");
    expect(params.get("client_id")).toBe("987654321");
    expect(params.get("code_verifier")).toBe("verifier-123");
    expect(params.get("client_secret")).toBeNull();
  });
});
