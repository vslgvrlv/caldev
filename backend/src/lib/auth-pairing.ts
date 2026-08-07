// Вход по коду сопряжения (#109).
//
// Здесь только чистые функции: генерация и разбор кода, описание устройства,
// текст карточки подтверждения. Ничего сетевого и ничего из базы — чтобы всё,
// на чём держится безопасность флоу, проверялось юнит-тестами без окружения.

import crypto from "node:crypto";

export type PairingScope = "USER" | "ADMIN";

// Crockford Base32: из алфавита выкинуты I, L, O, U. Первые три — потому что
// человек переписывает код с экрана телефона в чат руками и путает их с 1 и 0;
// U выкинута, чтобы случайный код не сложился в неприличное слово.
export const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 8;

// 8 знаков по 32 варианта ≈ 40 бит. С пятиминутным TTL и лимитом попыток
// перебор нереален, а переписать вручную ещё не мучительно.
export const PAIRING_TTL_MS = 5 * 60 * 1000;

export function generatePairingCode(): string {
  // rejection sampling: 256 не делится на 32 нацело только в теории — 32
  // делит 256, поэтому остатка нет и смещения не возникает.
  const bytes = crypto.randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

// Человек присылает код как получится: строчными, с дефисом, с пробелом,
// с «I» вместо единицы. Всё это — тот же самый код, и отказывать тут значит
// возвращать его на экран за второй попыткой без всякой пользы.
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!PAIRING_CODE_ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

// Код на экране разбит пополам: так его удерживают в голове целиком, пока
// переключаются в другое приложение.
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Два пути доставки кода боту, и оба обязаны работать. Диплинк — удобство,
// голое сообщение — механизм: ровно на него человек переходит, когда переход
// по ссылке из PWA не сработал (инцидент 2026-08-06).
export function parsePairingCodeFromText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  const startMatch = trimmed.match(/^\/start(?:@\w+)?\s+pair[_-]?([A-Za-z0-9-]+)$/);
  if (startMatch) return normalizePairingCode(startMatch[1]);
  if (/^\/\w/.test(trimmed)) return null;
  return normalizePairingCode(trimmed);
}

// В базе лежит только хэш: код живёт на экране пользователя, и утечка дампа
// не должна давать возможность забрать чужую сессию.
export function hashPairingCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// Секрет httpOnly-куки pbth.pair. Главная защита флоу: забрать сессию может
// только тот браузер, который попытку начал, поэтому подсмотренный или
// присланный злоумышленником код бесполезен.
export function buildPairingBrowserSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPairingBrowserSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function buildPairingDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=pair_${code}`;
}

function sanitizeRelativeRedirect(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  return input;
}

export function resolvePairingRedirect(params: {
  scope: PairingScope;
  redirectTo?: unknown;
}): string {
  const fallback = params.scope === "ADMIN" ? "/admin" : "/app";
  const safe = sanitizeRelativeRedirect(params.redirectTo);
  if (!safe) return fallback;
  if (params.scope === "ADMIN") {
    return safe.startsWith("/admin") ? safe : "/admin";
  }
  return safe.startsWith("/admin") ? "/app" : safe;
}

// Описание устройства для карточки подтверждения. Смысл строки — дать человеку
// узнать себя («да, это мой айфон, я только что нажал войти») или не узнать.
// Поэтому здесь грубые крупные признаки, а не точный разбор User-Agent:
// «Safari 26.1.2 on iOS» ничего не добавляет к «iPhone · Safari».
export function describePairingDevice(userAgent: unknown): string | null {
  if (typeof userAgent !== "string" || userAgent.trim().length === 0) return null;
  const ua = userAgent;

  const platform =
    /iPhone/i.test(ua) ? "iPhone" :
    /iPad/i.test(ua) ? "iPad" :
    /Android/i.test(ua) ? "Android" :
    /Macintosh|Mac OS X/i.test(ua) ? "Mac" :
    /Windows/i.test(ua) ? "Windows" :
    /Linux/i.test(ua) ? "Linux" :
    null;

  // Порядок проверок важен: Edge и Chrome представляются Safari, а Chrome —
  // ещё и Edge. Кто назвался последним, тот и настоящий.
  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /YaBrowser/i.test(ua) ? "Яндекс.Браузер" :
    /OPR\/|Opera/i.test(ua) ? "Opera" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Safari\//i.test(ua) ? "Safari" :
    null;

  const parts = [platform, browser].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPairingConfirmationText(params: {
  firstName?: string | null;
  code: string;
  host: string;
  deviceLabel?: string | null;
  requestedIp?: string | null;
}): string {
  // Форма скопирована с карточки, которую при входе присылает сам Telegram
  // (обращение по имени, домен, устройство, IP, явное «если это не вы»):
  // она проверена на миллионах людей и уже им знакома. Своё здесь только код —
  // Telegram знает контекст сам, а бот обязан дать сверить.
  const greeting = params.firstName ? `${escapeHtml(params.firstName)}, ` : "";
  const lines = [
    `${greeting}получен запрос на вход в Paintball TeamHub на <b>${escapeHtml(params.host)}</b>.`,
    "",
    `Код на экране: <code>${escapeHtml(formatPairingCode(params.code))}</code>`,
  ];
  if (params.deviceLabel) lines.push(`Устройство: ${escapeHtml(params.deviceLabel)}`);
  if (params.requestedIp) lines.push(`IP: ${escapeHtml(params.requestedIp)}`);
  lines.push(
    "",
    "Сверьте код с тем, что показывает приложение. Если совпадает — нажмите «Это я, войти».",
    "Если вы не запрашивали вход — нажмите «Это не я» или просто проигнорируйте это сообщение."
  );
  return lines.join("\n");
}

export function buildPairingConfirmationKeyboard(attemptId: string): Record<string, unknown> {
  // callback_query, а не URL-кнопки: нажатие обрабатывается прямо в чате и
  // ничего не открывает. Ровно то, что просил Василий — «подтверждаю вход,
  // не перехожу по ссылке».
  return {
    inline_keyboard: [
      [
        { text: "✅ Это я, войти", callback_data: `pair:approve:${attemptId}` },
        { text: "✋ Это не я", callback_data: `pair:deny:${attemptId}` },
      ],
    ],
  };
}

export type PairingCallbackAction = { action: "approve" | "deny"; attemptId: string };

export function parsePairingCallbackData(data: unknown): PairingCallbackAction | null {
  if (typeof data !== "string") return null;
  const match = data.match(/^pair:(approve|deny):([0-9a-fA-F-]{36})$/);
  if (!match) return null;
  return { action: match[1] as "approve" | "deny", attemptId: match[2] };
}

export type PairingAttemptStatus =
  | "PENDING"
  | "CLAIMED"
  | "APPROVED"
  | "CONSUMED"
  | "DENIED"
  | "EXPIRED";

// Что видит опрос из браузера. CLAIMED отделён от PENDING не ради красоты:
// человек, отправивший код боту, должен увидеть на экране, что код дошёл, —
// иначе он отправляет его второй раз и получает вторую карточку.
export type PairingClientStatus = "pending" | "claimed" | "approved" | "denied" | "expired";

export function classifyPairingStatus(params: {
  status: PairingAttemptStatus;
  expiresAt: Date | string;
  now: Date | number;
}): PairingClientStatus {
  const now = typeof params.now === "number" ? params.now : params.now.getTime();
  const expiresAt = typeof params.expiresAt === "string"
    ? Date.parse(params.expiresAt)
    : params.expiresAt.getTime();

  if (params.status === "DENIED") return "denied";
  // Просроченность считается по часам, а не по колонке status: фоновой
  // чистки может не быть, а попытка обязана умереть ровно в срок.
  if (params.status === "EXPIRED") return "expired";
  if (params.status === "APPROVED") return "approved";
  // CONSUMED — сессия уже выдана. Для опроса это не «войдено», а «этот код
  // отработал»: второй раз по нему зайти нельзя, флоу начинается заново.
  if (params.status === "CONSUMED") return "expired";
  if (now >= expiresAt) return "expired";
  return params.status === "CLAIMED" ? "claimed" : "pending";
}
