import { describe, expect, it } from "vitest";
import { sanitizeRedirectTo, sanitizeRelativeRedirect } from "../../lib/safe-redirect.js";

describe("sanitizeRelativeRedirect — только путь внутри сайта", () => {
  it("пропускает обычные пути", () => {
    expect(sanitizeRelativeRedirect("/app")).toBe("/app");
    expect(sanitizeRelativeRedirect("/invite/0b6f6d2e-6c1a-4c55-9d0d-6a3e0f1b2c3d")).toBe(
      "/invite/0b6f6d2e-6c1a-4c55-9d0d-6a3e0f1b2c3d"
    );
    expect(sanitizeRelativeRedirect("/admin?tab=teams")).toBe("/admin?tab=teams");
  });

  it("отклоняет чужие адреса", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/app\\..\\evil",
      "javascript:alert(1)",
      "app",
      "/app\r\nLocation: https://evil.example",
      "",
      "/" + "a".repeat(600),
    ]) {
      expect(sanitizeRelativeRedirect(bad), bad).toBeNull();
    }
    expect(sanitizeRelativeRedirect(undefined)).toBeNull();
    expect(sanitizeRelativeRedirect(42)).toBeNull();
  });

  it("sanitizeRedirectTo подставляет запасной путь", () => {
    expect(sanitizeRedirectTo("/\\evil.example", "/app")).toBe("/app");
    expect(sanitizeRedirectTo(undefined, "/app/profile")).toBe("/app/profile");
  });
});
