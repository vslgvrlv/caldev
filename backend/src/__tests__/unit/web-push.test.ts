import { beforeAll, describe, it, expect } from "vitest";

// classifyWebPushError сама по себе не трогает env, но модуль web-push.ts
// импортирует config/env.ts целиком, а тот валидирует обязательные переменные
// при загрузке. Как и другие unit-тесты библиотек, что тянут env.ts (см.
// telegram-bot.test.ts), подставляем недостающие переменные до динамического
// импорта — иначе падает любой прогон без боевого .env.
let classifyWebPushError: typeof import("../../lib/web-push.js").classifyWebPushError;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL =
    process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ classifyWebPushError } = await import("../../lib/web-push.js"));
});

function webPushError(statusCode: number, message: string): Error {
  const error = new Error(message);
  (error as Error & { statusCode: number }).statusCode = statusCode;
  return error;
}

describe("classifyWebPushError", () => {
  it("marks HTTP 410 (Gone) as a stale subscription", () => {
    const result = classifyWebPushError(webPushError(410, "push service responded with 410"));
    expect(result).toEqual({ ok: false, gone: true, reason: "push service responded with 410" });
  });

  it("marks HTTP 404 (Not Found) as a stale subscription", () => {
    const result = classifyWebPushError(webPushError(404, "not found"));
    expect(result.gone).toBe(true);
  });

  it("does not mark other errors (e.g. 500, network) as stale", () => {
    const result = classifyWebPushError(webPushError(500, "push service error"));
    expect(result.gone).toBe(false);
  });

  it("falls back to String(error) when error is not an Error instance", () => {
    const result = classifyWebPushError("boom");
    expect(result.reason).toBe("boom");
  });
});
