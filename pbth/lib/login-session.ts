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
