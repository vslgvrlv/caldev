import { beforeAll, describe, expect, it } from "vitest";

let buildTelegramBotApiUrl: typeof import("../../lib/telegram-bot.js").buildTelegramBotApiUrl;
let buildTelegramBotHeaders: typeof import("../../lib/telegram-bot.js").buildTelegramBotHeaders;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL =
    process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ buildTelegramBotApiUrl, buildTelegramBotHeaders } = await import("../../lib/telegram-bot.js"));
});

describe("telegram bot transport", () => {
  it("builds Bot API URLs from the default Telegram endpoint", () => {
    expect(buildTelegramBotApiUrl("123:token", "sendMessage")).toBe("https://api.telegram.org/bot123:token/sendMessage");
  });

  it("supports overriding the Bot API base URL for relay transports", () => {
    expect(buildTelegramBotApiUrl("123:token", "sendMessage", "https://relay.example.com/telegram")).toBe(
      "https://relay.example.com/telegram/bot123:token/sendMessage"
    );
  });

  it("adds a relay auth header when a relay token is configured", () => {
    expect(buildTelegramBotHeaders("relay-secret")).toEqual({
      "Content-Type": "application/json",
      "X-Telegram-Relay-Token": "relay-secret",
    });
  });
});
