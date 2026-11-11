import { describe, expect, it } from 'vitest';
import { resolveLoginSession } from '../../lib/login-session';

const user = { id: 'u1', name: 'Аня', nickname: 'anya' };

describe('resolveLoginSession', () => {
  it('пока оболочка запускается, экран ждёт и сам ничего не спрашивает', () => {
    expect(resolveLoginSession({ bootstrapDone: false, user: null })).toEqual({ kind: 'checking' });
    expect(resolveLoginSession({ bootstrapDone: false, user })).toEqual({ kind: 'checking' });
  });

  it('после запуска без человека — обычный вход', () => {
    expect(resolveLoginSession({ bootstrapDone: true, user: null })).toEqual({ kind: 'anonymous' });
  });

  it('после запуска с человеком — «Продолжить как»', () => {
    expect(resolveLoginSession({ bootstrapDone: true, user })).toEqual({ kind: 'session', user });
  });
});
