import { beforeAll, describe, expect, it } from "vitest";

let env: typeof import("../../config/env.js").env;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL =
    process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  process.env.AUTH_YANDEX_ENABLED = "1";
  process.env.YANDEX_OAUTH_CLIENT_ID = "yandex-cid";
  process.env.YANDEX_OAUTH_CLIENT_SECRET = "yandex-secret";
  process.env.YANDEX_OAUTH_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/callback";
  process.env.YANDEX_OAUTH_LINK_REDIRECT_URI = "https://pbthub.ru/api/v1/auth/yandex/link/callback";
  ({ env } = await import("../../config/env.js"));
});

describe("yandex oauth env", () => {
  it("exposes provider config", () => {
    expect(env.yandexOAuth.enabled).toBe(true);
    expect(env.yandexOAuth.clientId).toBe("yandex-cid");
    expect(env.yandexOAuth.clientSecret).toBe("yandex-secret");
    expect(env.yandexOAuth.redirectUri).toContain("/auth/yandex/callback");
    expect(env.yandexOAuth.linkRedirectUri).toContain("/auth/yandex/link/callback");
    expect(env.yandexOAuth.authorizeUrl).toBe("https://oauth.yandex.ru/authorize");
    expect(env.yandexOAuth.tokenUrl).toBe("https://oauth.yandex.ru/token");
    expect(env.yandexOAuth.userInfoUrl).toBe("https://login.yandex.ru/info");
    expect(env.yandexOAuth.stateTtlSeconds).toBe(600);
    expect(env.yandexOAuth.pendingLinkTtlSeconds).toBe(300);
  });
});
