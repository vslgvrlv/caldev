import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlowRequestLog, normalizeRequestPath } from "../../middleware/slow-request-log.js";

// Часы, которые двигаются только вручную: время запроса задаёт сам тест.
function makeClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function makeApp(delayMs: number) {
  const clock = makeClock();
  const app = express();
  app.use(createSlowRequestLog({ thresholdMs: 500, now: clock.now }));
  const router = express.Router();
  router.get("/events/:eventId", (_req, res) => {
    clock.advance(delayMs);
    res.status(200).json({ ok: true });
  });
  app.use("/api/v1", router);
  app.use((_req, res) => {
    clock.advance(delayMs);
    res.status(404).end();
  });
  return app;
}

function slowLines(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map((args) => JSON.parse(String(args[0])))
    .filter((line) => line.msg === "http.slow_request");
}

describe("slow request log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("пишет строку на запрос дольше 500 мс: метод, шаблон пути, код, время", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await request(makeApp(750))
      .get("/api/v1/events/3f1c2a9e-1b2c-4d5e-8f90-123456789abc?token=secret&user=42")
      .set("X-Forwarded-For", "203.0.113.7")
      .expect(200);

    const lines = slowLines(warn);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({
      level: "warn",
      method: "GET",
      route: "/api/v1/events/:eventId",
      statusCode: 200,
      durationMs: 750,
    });
    // Ничего о человеке и о параметрах запроса.
    expect(Object.keys(line).sort()).toEqual(["durationMs", "level", "method", "msg", "route", "statusCode", "ts"]);
    const raw = JSON.stringify(line);
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("3f1c2a9e");
    expect(raw).not.toContain("203.0.113.7");
  });

  it("молчит, если запрос уложился в 500 мс", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await request(makeApp(500)).get("/api/v1/events/abc").expect(200);
    expect(slowLines(warn)).toHaveLength(0);
  });

  it("без маршрута берёт путь, где id и токены заменены на :id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await request(makeApp(900)).get("/calendar/aB3dE5fG7hJ9kL1mN3pQ5r.ics?x=1").expect(404);
    const lines = slowLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "/calendar/:id.ics", statusCode: 404 });
    expect(JSON.stringify(lines[0])).not.toContain("aB3dE5fG");
  });
});

describe("normalizeRequestPath", () => {
  it("убирает query и значения из пути", () => {
    expect(normalizeRequestPath("/api/v1/teams/12345/members?limit=10")).toBe("/api/v1/teams/:id/members");
    expect(normalizeRequestPath("/api/v1/events/3f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe("/api/v1/events/:id");
    expect(normalizeRequestPath("/calendar/aB3dE5fG7hJ9kL1mN3pQ5r")).toBe("/calendar/:id");
    expect(normalizeRequestPath("/api/v1/auth/me")).toBe("/api/v1/auth/me");
  });
});
