import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

describe("vite config", () => {
  it("does not proxy root ts modules that start with /api", () => {
    const proxy = viteConfig.server?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy && Object.keys(proxy)).not.toContain("/api");
    expect(proxy && Object.keys(proxy)).toContain("/api/v1");
  });
});
