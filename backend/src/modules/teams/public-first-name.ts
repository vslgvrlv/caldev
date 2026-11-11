// Имя для открытых экранов приглашения (`/invite/:token`, `/join/:code`).
//
// `users.name` — свободный текст. При входе через Telegram без имени туда
// пишется `@username` или `tg-<числовой id>` (lib/oauth-login.ts), а люди
// вписывают в имя телефон, почту или ссылку. Ручки открыты любому, у кого
// есть ссылка, поэтому наружу уходит только первое слово и только если оно
// похоже на имя; фамилия не уходит никогда.
//
// Проверки на всё значение (мусор во втором слове — признак того, что в поле
// не имя): пусто; начинается с `tg-` или `@`; есть цифры; есть `@`, `+`, `/`,
// `:`; есть доменная точка (`mail.ru`, `t.me`).
// Проверки на первое слово: не длиннее 24 символов; только буквы, дефис и
// апостроф допустимы между буквами.

const MAX_LENGTH = 24;
const LETTERS_ONLY = /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u;
const CONTACT_MARKS = /[@+/:]/;
const DOMAIN_DOT = /\.[\p{L}\p{M}]{2,}/u;
const DIGITS = /\p{Nd}/u;

export function publicFirstName(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").normalize("NFC").trim();
  if (!value) return null;
  if (/^tg-/i.test(value) || value.startsWith("@")) return null;
  if (DIGITS.test(value) || CONTACT_MARKS.test(value) || DOMAIN_DOT.test(value)) return null;
  const first = value.split(/\s+/u)[0];
  if (!first || [...first].length > MAX_LENGTH) return null;
  if (!LETTERS_ONLY.test(first)) return null;
  return first;
}
