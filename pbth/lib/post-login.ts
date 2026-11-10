import { sanitizeNext } from './login-next-param';

/**
 * Куда вести человека сразу после входа.
 *
 * - `admin` — консоль владельца платформы; её вход ведёт AdminConsoleView,
 *   приложение команды грузить нельзя (оно понизило бы сессию до USER).
 * - `invite` — человек пришёл по ссылке-приглашению. Он ещё не в команде,
 *   поэтому грузить приложение рано: /init ответит «нет команды», и раньше
 *   это давало системное окно и тупиковый экран вместо экрана приглашения.
 * - `app` — обычный вход в приложение команды.
 */
export type PostLoginAction =
  | { kind: 'admin' }
  | { kind: 'invite'; path: string }
  | { kind: 'app'; path: string };

export function isInvitePath(path: string | null | undefined): boolean {
  return /^\/invite\/[^/?#]+/.test(String(path || ''));
}

export function resolvePostLoginAction(target: string | null | undefined): PostLoginAction {
  const safe = sanitizeNext(target) ?? '/app';
  if (safe === '/admin' || safe.startsWith('/admin/') || safe.startsWith('/admin?')) return { kind: 'admin' };
  if (isInvitePath(safe)) return { kind: 'invite', path: safe };
  return { kind: 'app', path: '/app' };
}
