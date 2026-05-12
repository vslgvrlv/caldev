import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.AUTH_YANDEX_ENABLED = "1";
process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";

let mod: typeof import("../../lib/yandex-oauth.js");

beforeAll(async () => {
  mod = await import("../../lib/yandex-oauth.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("yandex oauth helpers", () => {
  it("buildYandexAuthorizeUrl uses configured client_id, redirect_uri, state", () => {
    const url = mod.buildYandexAuthorizeUrl({ state: "S123", redirectUri: "https://example.ru/cb" });
    expect(url.startsWith("https://oauth.yandex.ru/authorize?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("yandex-cid");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.ru/cb");
    expect(parsed.searchParams.get("state")).toBe("S123");
    expect(parsed.searchParams.get("force_confirm")).toBe("yes");
  });

  it("exchangeYandexCode POSTs urlencoded form with client credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "AT", token_type: "bearer", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await mod.exchangeYandexCode({ code: "auth-code-xyz", redirectUri: "https://example.ru/cb" });

    expect(res.access_token).toBe("AT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth.yandex.ru/token");
    expect(init.method).toBe("POST");
    expect((init.headers as any)["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-xyz");
    expect(body.get("redirect_uri")).toBe("https://example.ru/cb");
    expect(body.get("client_id")).toBe("yandex-cid");
    expect(body.get("client_secret")).toBe("yandex-secret");
  });

  it("exchangeYandexCode throws on non-2xx with body snippet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mod.exchangeYandexCode({ code: "x", redirectUri: "y" })).rejects.toThrow(/YANDEX_TOKEN_FAILED:400/);
  });

  it("fetchYandexUserInfo parses id/login/email/name/avatar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "1234",
        login: "vasily",
        default_email: "v@yandex.ru",
        first_name: "Vasily",
        last_name: "Gavrilov",
        real_name: "Vasily Gavrilov",
        default_avatar_id: "avatar-id-9",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const info = await mod.fetchYandexUserInfo("ACCESS123");

    expect(info.id).toBe("1234");
    expect(info.login).toBe("vasily");
    expect(info.email).toBe("v@yandex.ru");
    expect(info.firstName).toBe("Vasily");
    expect(info.lastName).toBe("Gavrilov");
    expect(info.displayName).toBe("Vasily Gavrilov");
    expect(info.avatarUrl).toContain("avatar-id-9");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://login.yandex.ru/info");
    expect(url).toContain("format=json");
    expect((init.headers as any).Authorization).toBe("OAuth ACCESS123");
  });

  it("fetchYandexUserInfo throws on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.fetchYandexUserInfo("bad")).rejects.toThrow(/YANDEX_USERINFO_FAILED:401/);
  });
});
