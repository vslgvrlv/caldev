export type OidcCanaryForceOverride = "on" | "off" | null;

export function normalizeCanaryPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.floor(value);
}

export function normalizeForceOverride(raw: unknown): OidcCanaryForceOverride {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "1" || value === "true" || value === "on") return "on";
  if (value === "0" || value === "false" || value === "off") return "off";
  return null;
}

export function parseCanaryBucket(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n)) return null;
  if (n < 0 || n > 99) return null;
  return n;
}

export function newCanaryBucket(): number {
  return Math.floor(Math.random() * 100);
}

export function decideOidcCanary(params: {
  oidcEnabled: boolean;
  fallbackEnabled: boolean;
  canaryPercent: number;
  isAdminPath: boolean;
  stickyBucket: number | null;
  forceOverride: OidcCanaryForceOverride;
}): {
  useOidc: boolean;
  reason:
    | "oidc_disabled"
    | "fallback_disabled"
    | "admin_path"
    | "forced_on"
    | "forced_off"
    | "canary_full"
    | "canary_disabled"
    | "bucket_missing"
    | "bucket_in"
    | "bucket_out";
} {
  if (!params.oidcEnabled) {
    return { useOidc: false, reason: "oidc_disabled" };
  }
  if (!params.fallbackEnabled) {
    return { useOidc: true, reason: "fallback_disabled" };
  }
  if (params.isAdminPath) {
    return { useOidc: true, reason: "admin_path" };
  }
  if (params.forceOverride === "on") {
    return { useOidc: true, reason: "forced_on" };
  }
  if (params.forceOverride === "off") {
    return { useOidc: false, reason: "forced_off" };
  }

  const percent = normalizeCanaryPercent(params.canaryPercent);
  if (percent >= 100) {
    return { useOidc: true, reason: "canary_full" };
  }
  if (percent <= 0) {
    return { useOidc: false, reason: "canary_disabled" };
  }

  if (params.stickyBucket === null) {
    return { useOidc: false, reason: "bucket_missing" };
  }

  return params.stickyBucket < percent
    ? { useOidc: true, reason: "bucket_in" }
    : { useOidc: false, reason: "bucket_out" };
}
