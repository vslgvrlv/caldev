import type { User } from '../types';

export type LoginSessionView =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'session'; user: User };

/**
 * Есть ли у человека на экране входа живая сессия. Ответ `/auth/me` уже
 * получила оболочка при запуске и положила человека в `user`, поэтому экран
 * входа второй раз его не спрашивает: ждёт конца запуска и читает результат.
 */
export function resolveLoginSession(input: { bootstrapDone: boolean; user: User | null }): LoginSessionView {
  if (!input.bootstrapDone) return { kind: 'checking' };
  if (input.user) return { kind: 'session', user: input.user };
  return { kind: 'anonymous' };
}

/**
 * «Продолжить» из `?next=/admin` ведёт в консоль, если у сессии есть админский
 * охват (как и раньше, по ответу `/auth/me`): `adminScope` не пуст и не `NONE`.
 * Оболочка этого поля не хранит, поэтому экран читает его по нажатию, а не при загрузке.
 */
export function canContinueToAdmin(me: { authenticated?: boolean; adminScope?: string | null } | null | undefined): boolean {
  if (!me || !me.authenticated) return false;
  return Boolean(me.adminScope) && me.adminScope !== 'NONE';
}
