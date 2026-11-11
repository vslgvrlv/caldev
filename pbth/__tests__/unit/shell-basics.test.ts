import { afterEach, describe, expect, it, vi } from 'vitest';
import { playerStatusLabel, roleLabel, rsvpLabel } from '../../lib/labels';
import { confirmAction, errorText, notify, resetNotifyForTests, subscribeNotify, type NotifyState } from '../../lib/notify';
import { isTelegramMiniApp, readMiniAppInitData } from '../../shell/telegram';

describe('роли и статусы по-русски', () => {
  it('роли', () => {
    expect(roleLabel('CAPTAIN')).toBe('Капитан');
    expect(roleLabel('TRAINER')).toBe('Тренер');
    expect(roleLabel('PLAYER')).toBe('Игрок');
    expect(roleLabel('player')).toBe('Игрок');
    expect(roleLabel('???')).toBe('Участник');
  });

  it('статусы игрока и ответы', () => {
    expect(playerStatusLabel('INJURED')).toBe('Травма');
    expect(rsvpLabel('CONFIRMED')).toBe('Иду');
    expect(rsvpLabel('DECLINED')).toBe('Не иду');
  });
});

describe('сообщения вместо alert', () => {
  afterEach(() => resetNotifyForTests());

  it('при смонтированном хосте показывает плашку и подтверждение', async () => {
    let state: NotifyState = { toasts: [], confirm: null };
    const unsubscribe = subscribeNotify((next) => {
      state = next;
    });
    notify.success('Готово');
    expect(state.toasts.map((t) => [t.kind, t.text])).toEqual([['success', 'Готово']]);

    const answer = confirmAction('Удалить?');
    expect(state.confirm?.text).toBe('Удалить?');
    state.confirm?.resolve(true);
    await expect(answer).resolves.toBe(true);
    expect(state.confirm).toBeNull();
    unsubscribe();
  });

  it('без хоста падает в системное окно, чтобы человек всё равно увидел', () => {
    const alert = vi.fn();
    vi.stubGlobal('window', { alert });
    notify.error('Ошибка');
    expect(alert).toHaveBeenCalledWith('Ошибка');
    vi.unstubAllGlobals();
  });

  it('технический текст ошибки не показывается человеку', () => {
    expect(errorText(new Error('HTTP 500'), 'Не вышло')).toBe('Не вышло');
    expect(errorText(new Error('Active team context mismatch'), 'Не вышло')).toBe('Не вышло');
    expect(errorText(new Error('Событие уже началось'), 'Не вышло')).toBe('Событие уже началось');
  });
});

describe('Mini App — по данным запуска, а не по наличию скрипта', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubWindow = (overrides: { initData?: string; hash?: string; stored?: string | null }) => {
    vi.stubGlobal('window', {
      Telegram: { WebApp: { initData: overrides.initData ?? '' } },
      location: { hash: overrides.hash ?? '' },
      sessionStorage: { getItem: () => overrides.stored ?? null },
    });
  };

  it('обычный браузер со скриптом Telegram — не Mini App', () => {
    stubWindow({});
    expect(isTelegramMiniApp()).toBe(false);
  });

  it('данные из SDK', () => {
    stubWindow({ initData: 'query_id=1&hash=abc' });
    expect(readMiniAppInitData()).toBe('query_id=1&hash=abc');
  });

  it('данные из адреса — до загрузки скрипта', () => {
    stubWindow({ hash: '#tgWebAppData=query_id%3D1%26hash%3Dabc&tgWebAppVersion=7.0' });
    expect(readMiniAppInitData()).toBe('query_id=1&hash=abc');
  });

  it('данные, сохранённые скриптом, — после смены адреса', () => {
    stubWindow({ stored: JSON.stringify({ tgWebAppData: 'query_id=2&hash=def' }) });
    expect(readMiniAppInitData()).toBe('query_id=2&hash=def');
  });
});

describe('нижняя панель: подсветка пункта', () => {
  it('разделы вне панели (заявки, журнал) не подсвечивают ничего, разделы панели — свой пункт', async () => {
    const { navActivePath } = await import('../../components/shell/ShellNav');
    expect(navActivePath('/t/hg')).toBe('/t/hg');
    expect(navActivePath('/t/hg/calendar')).toBe('/t/hg/calendar');
    expect(navActivePath('/t/hg/roster')).toBe('/t/hg/roster');
    expect(navActivePath('/me')).toBe('/me');
    expect(navActivePath('/t/hg/requests')).toBe('/-');
    expect(navActivePath('/t/hg/journal')).toBe('/-');
  });
});
