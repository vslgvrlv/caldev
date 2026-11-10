// Ключ ответа «Иду / Не иду» прямо из пуша (трек 2 ревизии).
//
// Кнопка пуша срабатывает в service worker, без открытого приложения. Сессия
// там может быть уже просрочена, поэтому ответ несёт подписанный ключ: какое
// событие, чей ответ и до какого момента ключ годен. Ключ лежит только в
// зашифрованном содержимом пуша конкретному человеку (Web Push шифрует его
// ключами браузера), подделать его без секрета сервера нельзя. Права в
// команде сервер всё равно проверяет заново при записи ответа.

import { createHmac, timingSafeEqual } from "node:crypto";

export type RsvpTokenClaims = { eventId: string; userId: string; expiresAt: number };

const VERSION = "v1";

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("pbth:rsvp-push:v1").digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signRsvpToken(claims: RsvpTokenClaims, secret: string): string {
  const body = b64url(JSON.stringify({ e: claims.eventId, u: claims.userId, x: Math.floor(claims.expiresAt / 1000) }));
  const sig = createHmac("sha256", key(secret)).update(`${VERSION}.${body}`).digest();
  return `${VERSION}.${body}.${b64url(sig)}`;
}

export function verifyRsvpToken(token: string, secret: string, now: number = Date.now()): RsvpTokenClaims | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts;
  const expected = createHmac("sha256", key(secret)).update(`${VERSION}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: { e?: unknown; u?: unknown; x?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.e !== "string" || typeof parsed.u !== "string" || typeof parsed.x !== "number") return null;
  const expiresAt = parsed.x * 1000;
  if (now >= expiresAt) return null;
  return { eventId: parsed.e, userId: parsed.u, expiresAt };
}
