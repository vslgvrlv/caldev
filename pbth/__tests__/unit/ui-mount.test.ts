import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI, createMountController, type Handle } from '../../ui/uikit';
import { mountFeed } from '../../ui/Feed';
import { mountMonth } from '../../ui/Month';
import { mountNav } from '../../ui/BottomNav';

const el = {} as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe('useUiMount: mount, update, destroy', () => {
  it('монтирует один раз, обновляет новым cfg и снимает при уходе', () => {
    const handle = { update: vi.fn(), destroy: vi.fn() };
    const mount = vi.fn((_el: HTMLElement, _cfg: { n: number }): Handle => handle);
    const ctl = createMountController(mount);
    const a = { n: 1 };
    ctl.attach(el, a);
    expect(mount).toHaveBeenCalledWith(el, a);

    ctl.update(a); // тот же объект — обновлять нечего
    expect(handle.update).not.toHaveBeenCalled();

    const b = { n: 2 };
    ctl.update(b);
    expect(handle.update).toHaveBeenCalledWith(b);

    ctl.dispose();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    ctl.update({ n: 3 }); // после снятия молчит
    expect(handle.update).toHaveBeenCalledTimes(1);
  });

  it('модулям с set вместо update (лента) отдаёт cfg в set', () => {
    const set = vi.fn();
    const ctl = createMountController<{ n: number }>(() => ({ set }));
    ctl.attach(el, { n: 1 });
    ctl.update({ n: 2 });
    expect(set).toHaveBeenCalledWith({ n: 2 });
  });
});

describe('обёртки передают настройки в ui-kit', () => {
  it('Feed: лента с order, lead, status и actions без свёртки пачек', () => {
    const mount = vi.spyOn(UI.feed, 'mount').mockReturnValue({} as Handle);
    const items = [{ id: 1, type: 'event', at: '2026-11-12T19:00:00+03:00', lead: '<i></i>', status: { text: 'иду' } }];
    mountFeed(el, { types: {}, items, order: 'asc', timeDisplay: undefined });
    const cfg = mount.mock.calls[0][1] as Record<string, unknown>;
    expect(cfg.order).toBe('asc');
    expect(cfg.group).toBe(false);
    expect(cfg.items).toBe(items);
  });

  it('Month: год, месяц и обработчики доходят до UI.month', () => {
    const mount = vi.spyOn(UI.month, 'mount').mockReturnValue({} as Handle);
    const onSelect = vi.fn();
    mountMonth(el, { year: 2026, month: 11, selected: '2026-11-14', onSelect });
    expect(mount).toHaveBeenCalledWith(el, { year: 2026, month: 11, selected: '2026-11-14', onSelect });
  });

  it('BottomNav: плавающая стеклянная панель с центральным действием, обновление и снятие', () => {
    const navEl = { remove: vi.fn() };
    const bottom = { remove: vi.fn() };
    const api = { el: navEl, bottom, setActive: vi.fn(), setBadge: vi.fn(), setAction: vi.fn() };
    const mount = vi.spyOn(UI.sidenav, 'mount').mockReturnValue(api as never);
    const listeners: Record<string, (e: unknown) => void> = {};
    const host = {
      addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f),
      removeEventListener: vi.fn(),
      querySelector: () => ({ remove: vi.fn() }),
    } as unknown as HTMLElement;
    const onClick = vi.fn();
    const onNavigate = vi.fn();
    const items = [
      { href: '/app', label: 'Моё', icon: 'house' },
      { href: '/teams', label: 'Команды', icon: 'users' },
    ];
    const handle = mountNav(host, { items, path: '/app', action: { label: 'Добавить', onClick }, onNavigate });
    const cfg = mount.mock.calls[0][1] as Record<string, any>;
    expect(cfg.floating).toBe(true);
    expect(cfg.glass).toBe(true);
    expect(cfg.mobile).toBe('bottom');
    expect(cfg.path).toBe('/app');
    expect(cfg.action.icon).toBe('plus');
    cfg.action.onClick();
    expect(onClick).toHaveBeenCalled();

    // клик по ссылке пункта идёт через router, а не перезагрузкой
    const preventDefault = vi.fn();
    listeners.click({ button: 0, defaultPrevented: false, preventDefault, target: { closest: () => ({ getAttribute: () => '/teams' }) } });
    expect(onNavigate).toHaveBeenCalledWith('/teams');
    expect(preventDefault).toHaveBeenCalled();

    handle.update!({ items: [{ ...items[0], badge: 2 }, items[1]], path: '/teams', onNavigate });
    expect(api.setActive).toHaveBeenCalledWith('/teams');
    expect(api.setBadge).toHaveBeenCalledWith('/app', 2);

    handle.destroy!();
    expect(navEl.remove).toHaveBeenCalled();
    expect(bottom.remove).toHaveBeenCalled();
  });
});
