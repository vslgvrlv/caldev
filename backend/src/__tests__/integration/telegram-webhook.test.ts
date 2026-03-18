import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../../db/pool.js", () => ({
  query: queryMock,
}));

let app: express.Express;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "test-webhook-secret";
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || "https://staging.pbthub.ru";

  const { vendorRouter } = await import("../../modules/vendor/routes.js");
  app = express();
  app.use(express.json());
  app.use("/api/v1/vendor", vendorRouter);
});

beforeEach(() => {
  queryMock.mockReset();
});

describe("telegram webhook route", () => {
  it("responds to plain /start with login instructions instead of ignoring the chat", async () => {
    const res = await request(app)
      .post("/api/v1/vendor/telegram/webhook")
      .set("x-telegram-bot-api-secret-token", "test-webhook-secret")
      .send({
        message: {
          text: "/start",
          chat: { id: 99887766 },
          from: { id: 44556677, first_name: "Holy" },
        },
      });

    expect(res.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      method: "sendMessage",
      chat_id: "99887766",
      disable_web_page_preview: true,
    });
    expect(String(res.body.text)).toContain("одноразовый код");
    expect(res.body.reply_markup.inline_keyboard).toEqual([
      [{ text: "Открыть PBTH", url: "https://staging.pbthub.ru/login" }],
      [{ text: "Открыть admin", url: "https://staging.pbthub.ru/admin/login" }],
    ]);
  });
});
