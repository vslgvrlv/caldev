import { describe, expect, it } from "vitest";
import { decideOidcCanary, normalizeCanaryPercent } from "../../lib/auth-canary.js";

describe("auth canary decision", () => {
  it("forces OIDC for admin path", () => {
    const result = decideOidcCanary({
      oidcEnabled: true,
      fallbackEnabled: true,
      canaryPercent: 10,
      isAdminPath: true,
      stickyBucket: 99,
      forceOverride: null,
    });
    expect(result.useOidc).toBe(true);
    expect(result.reason).toBe("admin_path");
  });

  it("respects explicit force override", () => {
    const result = decideOidcCanary({
      oidcEnabled: true,
      fallbackEnabled: true,
      canaryPercent: 10,
      isAdminPath: false,
      stickyBucket: 99,
      forceOverride: "off",
    });
    expect(result.useOidc).toBe(false);
    expect(result.reason).toBe("forced_off");
  });

  it("uses sticky bucket against percentage", () => {
    const inCanary = decideOidcCanary({
      oidcEnabled: true,
      fallbackEnabled: true,
      canaryPercent: 25,
      isAdminPath: false,
      stickyBucket: 7,
      forceOverride: null,
    });
    const outCanary = decideOidcCanary({
      oidcEnabled: true,
      fallbackEnabled: true,
      canaryPercent: 25,
      isAdminPath: false,
      stickyBucket: 80,
      forceOverride: null,
    });

    expect(inCanary.useOidc).toBe(true);
    expect(outCanary.useOidc).toBe(false);
  });

  it("clamps percent bounds", () => {
    expect(normalizeCanaryPercent(-10)).toBe(0);
    expect(normalizeCanaryPercent(140)).toBe(100);
  });
});
