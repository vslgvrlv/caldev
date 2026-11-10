// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

const viteConfigSourcePath = fileURLToPath(new URL("../../vite.config.ts", import.meta.url));

describe("vite config", () => {
  it("keeps the expected backend proxy entries", () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && Object.keys(proxy)).toContain("/api/");
    expect(proxy && Object.keys(proxy)).toContain("/calendar/");
  });

  it("does not proxy frontend modules whose names start with api or calendar", () => {
    // Vite сравнивает ключ прокси с началом адреса. Ключ '/api' забирал
    // модуль /api.ts, и в режиме разработки страница оставалась пустой.
    const proxy = viteConfig.server?.proxy ?? {};
    const keys = Object.keys(proxy);
    for (const modulePath of ["/api.ts", "/api.ts?t=1", "/calendar-utils.ts"]) {
      expect(keys.filter((key) => !key.startsWith("^") && modulePath.startsWith(key))).toEqual([]);
    }
    for (const backendPath of ["/api/v1/init", "/calendar/abc.ics"]) {
      expect(keys.some((key) => backendPath.startsWith(key))).toBe(true);
    }
  });

  it("keeps pwa shell assets outside the proxy table", () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && Object.keys(proxy)).not.toContain("/manifest.webmanifest");
    expect(proxy && Object.keys(proxy)).not.toContain("/icons");
  });

  it("wires the push notification handler into the generated service worker (#36)", () => {
    const source = readFileSync(viteConfigSourcePath, "utf8");
    expect(source).toContain("importScripts: ['/push-sw-handler.js']");
  });
});
