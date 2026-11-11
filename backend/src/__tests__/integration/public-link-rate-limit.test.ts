import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Открытые ручки ссылок приглашения отвечают без входа, а код ссылки команды —
// 6 символов. Предел — 30 запросов в минуту на IP на каждую ручку; 31-й
// получает 429 в общем формате ошибки. Другой IP, другая ручка и остальные
// ручки предел не делят. IP берётся из X-Forwarded-For (`trust proxy` = 1).

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
// Предел по умолчанию: тест проверяет именно 30 в минуту.
delete process.env.RATE_PUBLIC_LINK_MAX;
delete process.env.RATE_PUBLIC_LINK_WINDOW_MS;

let app: typeof import("../../app.js").app;

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
});

const get = (path: string, ip: string) => request(app).get(path).set("X-Forwarded-For", ip);

describe("ограничитель открытых ручек ссылок", () => {
  it("ссылка команды: 30 запросов проходят, 31-й — 429; другой IP не затронут", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 30; i += 1) {
      const res = await get(`/api/v1/join-requests/link/NOPE${String(i).padStart(2, "0")}`, ip);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("JOIN_LINK_NOT_FOUND");
    }
    const limited = await get("/api/v1/join-requests/link/NOPE99", ip);
    expect(limited.status).toBe(429);
    expect(Object.keys(limited.body).sort()).toEqual(["code", "correlationId", "detail"]);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();

    // Другой IP — свой счётчик.
    expect((await get("/api/v1/join-requests/link/NOPE99", "203.0.113.11")).status).toBe(404);
    // Остальные ручки того же роутера с того же IP — без нового предела.
    expect((await get("/api/v1/join-requests/mine", ip)).status).toBe(401);
    // Другая открытая ручка — свой счётчик.
    expect((await get(`/api/v1/teams/invites/${randomUUID()}`, ip)).status).toBe(404);
  });

  it("приглашение: 30 запросов проходят, 31-й — 429; другой IP не затронут", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < 30; i += 1) {
      const res = await get(`/api/v1/teams/invites/${randomUUID()}`, ip);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("INVITE_NOT_FOUND");
    }
    const limited = await get(`/api/v1/teams/invites/${randomUUID()}`, ip);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Object.keys(limited.body).sort()).toEqual(["code", "correlationId", "detail"]);

    expect((await get(`/api/v1/teams/invites/${randomUUID()}`, "203.0.113.21")).status).toBe(404);
    // Принятие приглашения (POST) — прежние правила: без входа 401, не 429.
    expect((await request(app).post(`/api/v1/teams/invites/${randomUUID()}/accept`).set("X-Forwarded-For", ip)).status).not.toBe(429);
    // Ссылка команды с того же IP — свой счётчик.
    expect((await get("/api/v1/join-requests/link/NOPE00", ip)).status).toBe(404);
  });
});
