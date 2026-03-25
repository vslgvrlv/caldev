import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

describe("vite config", () => {
  it("keeps the expected backend proxy entries", () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && Object.keys(proxy)).toContain("/api");
    expect(proxy && Object.keys(proxy)).toContain("/calendar");
  });

  it("keeps pwa shell assets outside the proxy table", () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && Object.keys(proxy)).not.toContain("/manifest.webmanifest");
    expect(proxy && Object.keys(proxy)).not.toContain("/icons");
  });
});
