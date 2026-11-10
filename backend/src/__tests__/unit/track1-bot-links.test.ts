import { describe, expect, it } from "vitest";

// Кнопка «Открыть команду» под сообщениями «Тебя приняли в команду» и
// «Команда создана» ставится всегда — так же, как «Открыть событие» в
// напоминаниях трека 2, — а не только при адресе https.

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.FRONTEND_URL = "http://127.0.0.1:3221";

describe("кнопка-ссылка трека 1", () => {
  it("ставится и на адресе http", async () => {
    const { linkKeyboard } = await import("../../modules/join-requests/delivery.js");
    expect(linkKeyboard("Открыть команду", "/t/dd")).toEqual({
      inline_keyboard: [[{ text: "Открыть команду", url: "http://127.0.0.1:3221/t/dd" }]],
    });
  });
});
