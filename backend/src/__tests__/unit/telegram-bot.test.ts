import { beforeAll, describe, expect, it } from "vitest";

let buildTelegramWebhookSendMessagePayload: typeof import("../../lib/telegram-bot.js").buildTelegramWebhookSendMessagePayload;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.TELEGRAM_CALLBACK_URL =
    process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
  ({ buildTelegramWebhookSendMessagePayload } = await import("../../lib/telegram-bot.js"));
});

describe("telegram bot helpers", () => {
  it("builds a sendMessage webhook payload with inline keyboard", () => {
    expect(
      buildTelegramWebhookSendMessagePayload(
        "99887766",
        "Holy, вход готов. Нажмите кнопку ниже.",
        {
          replyMarkup: {
            inline_keyboard: [[{ text: "Войти в PBTH", url: "https://staging.pbthub.ru/complete?token=abc" }]],
          },
        }
      )
    ).toEqual({
      method: "sendMessage",
      chat_id: "99887766",
      text: "Holy, вход готов. Нажмите кнопку ниже.",
      reply_markup: {
        inline_keyboard: [[{ text: "Войти в PBTH", url: "https://staging.pbthub.ru/complete?token=abc" }]],
      },
      disable_web_page_preview: true,
    });
  });
});
