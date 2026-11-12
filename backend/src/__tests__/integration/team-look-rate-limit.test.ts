// Предел частоты на оформление команды: смена знака и загрузка логотипа
// считаются вместе, на IP. Отказ приходит до проверки входа и до чтения тела.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
process.env.TELEGRAM_CALLBACK_URL =
  process.env.TELEGRAM_CALLBACK_URL || "http://127.0.0.1:8000/api/v1/auth/telegram/callback";
process.env.RATE_TEAM_LOOK_MAX = "3";
process.env.RATE_TEAM_LOOK_WINDOW_MS = "60000";

let app: typeof import("../../app.js").app;
const TEAM = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  ({ app } = await import("../../app.js"));
});

describe("предел частоты оформления", () => {
  it("четвёртый запрос за окно — 429 в общем формате, для загрузки и для смены знака", async () => {
    const statuses: number[] = [];
    statuses.push((await request(app).put(`/api/v1/teams/${TEAM}/logo`).set("Content-Type", "image/png").send(Buffer.from("x"))).status);
    statuses.push((await request(app).patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status);
    statuses.push((await request(app).delete(`/api/v1/teams/${TEAM}/logo`)).status);
    expect(statuses).toEqual([401, 401, 401]);

    const blocked = await request(app)
      .put(`/api/v1/teams/${TEAM}/logo`)
      .set("Content-Type", "image/png")
      .send(Buffer.alloc(64 * 1024));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect((await request(app).patch(`/api/v1/teams/${TEAM}/look`).send({ shape: 1 })).status).toBe(429);
  });

  it("чтение логотипа под этот предел не попадает", async () => {
    const res = await request(app).get(`/api/v1/teams/logo/${"0".repeat(32)}.webp`);
    expect(res.status).toBe(404);
  });
});
