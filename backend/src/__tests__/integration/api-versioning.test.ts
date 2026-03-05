import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

let app: any;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret";
  process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
  process.env.DB_PORT = process.env.DB_PORT || "5432";
  process.env.DB_NAME = process.env.DB_NAME || "pbth";
  process.env.DB_USER = process.env.DB_USER || "pbth";
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || "pbth";
  process.env.RELEASE_ID = process.env.RELEASE_ID || "test-release";
  process.env.RELEASE_COMMIT = process.env.RELEASE_COMMIT || "deadbeef";
  process.env.RELEASE_BUILT_AT = process.env.RELEASE_BUILT_AT || "2026-01-01T00:00:00Z";
  app = (await import("../../app.js")).app;
});

describe("API versioning + legacy alias", () => {
  it("serves v1 health endpoint", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("serves legacy /api health with deprecation headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(String(res.headers["deprecation"])).toBe("true");
    expect(res.headers["sunset"]).toBeTruthy();
  });

  it("returns OpenAPI spec", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.paths).toBeTruthy();
  });

  it("returns release version metadata", async () => {
    const res = await request(app).get("/api/v1/release/version");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      releaseId: "test-release",
      commit: "deadbeef",
      builtAt: "2026-01-01T00:00:00Z",
    });
  });
});
