import React from 'react';
import { sidenav, useUiMount, type Handle } from './uikit';

export type BottomNavItem = {
  href: string;
  label: string;
  /** Имя значка ui-kit. */
  icon: string;
  badge?: number | string;
  /** Только в листе «Ещё». */
  more?: boolean;
};

export type BottomNavProps = {
  items: BottomNavItem[];
  /** Текущий адрес: активный пункт берётся по нему. */
  path: string;
  /** Центральное действие («+»); `label` читает скринридер. */
  action?: { icon?: string; label: string; onClick: () => void };
  /** Переход без перезагрузки: передай `navigate` из react-router. Без него пункты — обычные ссылки. */
  onNavigate?: (href: string) => void;
};

type Cfg = BottomNavProps;

export function mountNav(host: HTMLElement, cfg: Cfg): Handle {
  let current = cfg;
  const nav = sidenav.mount(host, {
    groups: [{ items: cfg.items.map(({ href, label, icon, badge, more }) => ({ href, label, icon, badge, more })) }],
    path: cfg.path,
    mobile: 'bottom',
    floating: true,
    glass: true,
    action: cfg.action ? { icon: cfg.action.icon ?? 'plus', label: cfg.action.label, onClick: () => current.action?.onClick() } : undefined,
  });
  const onClick = (e: MouseEvent) => {
    if (!current.onNavigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/')) return;
    e.preventDefault();
    current.onNavigate(href);
  };
  host.addEventListener('click', onClick);
  return {
    update(next: Cfg) {
      const prev = current;
      current = next;
      nav.setActive(next.path);
      for (const it of next.items) {
        const was = prev.items.find((p) => p.href === it.href);
        if (was?.badge !== it.badge) nav.setBadge(it.href, it.badge ?? null);
      }
    },
    destroy() {
      host.removeEventListener('click', onClick);
      nav.el.remove();
      nav.bottom?.remove();
      host.querySelector('.ui-sidenav-more')?.remove();
    },
  };
}

/**
 * Плавающая нижняя панель жидкого стекла (`UI.sidenav` с `floating` и `glass`).
 * Структура пунктов задаётся при появлении; потом обновляются активный пункт и значки.
 */
export const BottomNav: React.FC<BottomNavProps> = (props) => {
  const cfg = React.useMemo(() => ({ ...props }), [props.items, props.path, props.action, props.onNavigate]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useUiMount(mountNav, cfg);
  return <div ref={ref} className="pbth-bottomnav" />;
};
