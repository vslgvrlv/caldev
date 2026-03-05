import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { hashIcsToken } from "../../lib/ics.js";

export function buildIcsToken(tokenId: string, userId: string) {
  const signature = crypto.createHmac("sha256", env.ics.secret).update(`${tokenId}:${userId}`).digest("base64url");
  return `${tokenId}.${signature}`;
}

export function constantTimeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function validateIcsToken(rawToken: string, tokenId: string, userId: string, storedHash: string) {
  const expected = buildIcsToken(tokenId, userId);
  if (!constantTimeEqual(rawToken, expected)) {
    return false;
  }
  const computedHash = hashIcsToken(rawToken);
  return constantTimeEqual(computedHash, storedHash);
}
