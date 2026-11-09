import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachRequestContext } from "../../middleware/request-context.js";

// personal-os#1436: строка http.request не несёт персональных данных —
// ни IP, ни id пользователя, ни query и значений из пути.
function makeApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(attachRequestContext);
  app.use((req, _res, next) => {
    (req as any).authUser = { id: "7d0f4a3e-5b6c-4d7e-8f90-abcdefabcdef" };
    next();
  });
  const router = express.Router();
  router.get("/events/:eventId", (_req, res) => res.status(200).json({ ok: true }));
  app.use("/api/v1", router);
  app.use((_req, res) => res.status(404).end());
  return app;
}

function requestLines(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map((args) => JSON.parse(String(args[0])))
    .filter((line) => line.msg === "http.request");
}

describe("http.request log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("пишет шаблон пути, метод, код и время без IP, id пользователя и query", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(makeApp())
      .get("/api/v1/events/3f1c2a9e-1b2c-4d5e-8f90-123456789abc?token=secret&phone=79990000000")
      .set("X-Forwarded-For", "203.0.113.7")
      .expect(200);

    const lines = requestLines(info);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(Object.keys(line).sort()).toEqual(
      ["correlationId", "durationMs", "level", "method", "msg", "route", "statusCode", "ts"].sort(),
    );
    expect(line.route).toBe("/api/v1/events/:eventId");
    const raw = JSON.stringify(line);
    for (const secret of ["203.0.113.7", "secret", "79990000000", "3f1c2a9e", "7d0f4a3e"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("путь без маршрута — нормализован, без query", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(makeApp()).get("/calendar/AbCdEfGhIjKlMnOpQrSt.ics?x=1").expect(404);
    const [line] = requestLines(info);
    expect(line.route).toBe("/calendar/:id.ics");
  });
});
