import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

// Ограничитель записи считает только запись. Экран ожидания заявки опрашивает
// `/join-requests` и `/team-requests` каждые 10 с; десять новичков на одном
// Wi-Fi площадки не должны съедать предел тем, кто в этот момент отвечает на
// явку. GET, HEAD и OPTIONS предел не тратят; ключ ограничителя прежний (IP).

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.RATE_WRITE_MAX = "3";
process.env.RATE_WRITE_WINDOW_MS = "60000";

let app: typeof import("../../app.js").app;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
});

describe("ограничитель записи", () => {
  it("чтение не тратит предел, запись — тратит", async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).get("/api/v1/join-requests/link/NOPE23");
      expect(res.status).toBe(404);
    }
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).head("/api/v1/join-requests/link/NOPE23")).status).not.toBe(429);
      expect((await request(app).options("/api/v1/team-requests/mine")).status).not.toBe(429);
    }

    // Три записи проходят до проверки входа, четвёртая упирается в предел.
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post("/api/v1/rsvp").send({});
      expect(res.status).not.toBe(429);
    }
    expect((await request(app).post("/api/v1/rsvp").send({})).status).toBe(429);
    expect((await request(app).delete("/api/v1/slots/events/x/book")).status).toBe(429);

    // Чтение после исчерпания предела записи по-прежнему отвечает.
    expect((await request(app).get("/api/v1/join-requests/link/NOPE23")).status).toBe(404);
  });
});
