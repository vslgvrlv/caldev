import { env } from "../config/env.js";

export function getRequestPublicOrigin(input: {
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): string {
  const fallback = new URL(env.frontendUrl);
  const forwardedHost = String(input.forwardedHost || "")
    .split(",")[0]
    ?.trim();
  const host = forwardedHost || String(input.host || "").split(",")[0]?.trim();
  const forwardedProto = String(input.forwardedProto || "")
    .split(",")[0]
    ?.trim();
  const protocol = forwardedProto || fallback.protocol.replace(":", "");

  if (!host) {
    return env.frontendUrl;
  }

  const hostname = host.split(":")[0]?.trim().toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}://${host}`;
  }

  return env.frontendUrl;
}
