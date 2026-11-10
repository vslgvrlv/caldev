import { describe, expect, it } from 'vitest';
import { isInvitePath, resolvePostLoginAction } from '../../lib/post-login';

// Куда вести человека сразу после входа. 10.11.2026 новичок по приглашению
// после входа попадал на /app с окном «вы не состоите ни в одной команде»:
// приложение грузилось раньше, чем он принимал приглашение. Эти проверки
// держат правило: вход по приглашению ведёт на экран приглашения.
describe('resolvePostLoginAction', () => {
  it('приглашение → экран приглашения, без загрузки приложения', () => {
    expect(resolvePostLoginAction('/invite/0b6f6d2e-6c1a-4c55-9d0d-6a3e0f1b2c3d')).toEqual({
      kind: 'invite',
      path: '/invite/0b6f6d2e-6c1a-4c55-9d0d-6a3e0f1b2c3d',
    });
  });

  it('обычный вход и пустая цель → приложение', () => {
    expect(resolvePostLoginAction('/app')).toEqual({ kind: 'app', path: '/app' });
    expect(resolvePostLoginAction('/app/calendar')).toEqual({ kind: 'app', path: '/app' });
    expect(resolvePostLoginAction(undefined)).toEqual({ kind: 'app', path: '/app' });
    expect(resolvePostLoginAction('')).toEqual({ kind: 'app', path: '/app' });
  });

  // Ссылка на событие открывает событие после входа (ревизия 11.11.2026).
  it('экран приложения → туда же после входа', () => {
    expect(resolvePostLoginAction('/t/dta/event/e-1')).toEqual({ kind: 'app', path: '/t/dta/event/e-1' });
    expect(resolvePostLoginAction('/t/dta/calendar')).toEqual({ kind: 'app', path: '/t/dta/calendar' });
    expect(resolvePostLoginAction('/me')).toEqual({ kind: 'app', path: '/me' });
    expect(resolvePostLoginAction('/join/ABC123')).toEqual({ kind: 'app', path: '/join/ABC123' });
  });

  it('служебные и публичные страницы → вход /app', () => {
    expect(resolvePostLoginAction('/login')).toEqual({ kind: 'app', path: '/app' });
    expect(resolvePostLoginAction('/support')).toEqual({ kind: 'app', path: '/app' });
    expect(resolvePostLoginAction('//evil.example/t/dta')).toEqual({ kind: 'app', path: '/app' });
  });

  it('админка остаётся за консолью владельца', () => {
    expect(resolvePostLoginAction('/admin')).toEqual({ kind: 'admin' });
    expect(resolvePostLoginAction('/admin/teams')).toEqual({ kind: 'admin' });
    // Похожий путь — не админка.
    expect(resolvePostLoginAction('/administrator')).toEqual({ kind: 'app', path: '/app' });
  });

  it('чужой адрес не становится целью перехода', () => {
    for (const bad of ['//evil.example/invite/x', '/\\evil.example/invite/x', 'https://evil.example/invite/x']) {
      expect(resolvePostLoginAction(bad), bad).toEqual({ kind: 'app', path: '/app' });
    }
  });

  it('пустое приглашение — не приглашение', () => {
    expect(isInvitePath('/invite/')).toBe(false);
    expect(isInvitePath('/invite')).toBe(false);
    expect(isInvitePath(null)).toBe(false);
    expect(isInvitePath('/invite/abc')).toBe(true);
  });
});
