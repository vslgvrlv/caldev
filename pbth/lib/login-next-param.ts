/**
 * Sanitises a `?next=<path>` URL query parameter for the unified /login screen.
 *
 * The login view passes the user's chosen post-auth landing path to the
 * backend OAuth start endpoints (e.g. /api/v1/auth/yandex/start?redirectTo=…).
 * If we forwarded raw user input we'd open a classic post-login open-redirect
 * vector — attacker hands the victim `/login?next=https://evil.example` and
 * the browser follows the 302 after auth, sending session cookies to evil.
 *
 * Rules:
 *   - must be a relative path on THIS app (starts with `/`),
 *   - must not start with `//` (protocol-relative host injection),
 *   - must not contain `\r` `\n` `\t` (header smuggling),
 *   - bounded length so we never blow up URL builders downstream.
 *
 * Returns the sanitised path or `null` if the input is unsafe / empty.
 */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  if (trimmed.length > 256) return null;
  return trimmed;
}
