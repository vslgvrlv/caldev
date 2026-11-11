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
  /** Короткая подпись: ставится, только если полная не помещается в пункт панели. */
  short?: string;
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

/**
 * ui-kit берёт короткую подпись всегда, если она задана. Здесь полная подпись стоит по умолчанию,
 * короткая — только когда полная усекается; у каждого пункта есть `aria-label` с полной подписью.
 */
export function fitLabels(host: HTMLElement, items: BottomNavItem[], moreLabel = 'Ещё') {
  const bottom = host.querySelector('.ui-sidenav-bottom');
  if (!bottom?.querySelectorAll) return;
  const byHref = new Map(items.map((it) => [it.href, it]));
  bottom.querySelectorAll<HTMLElement>('a.ui-sidenav-bottom__item').forEach((a) => {
    const it = byHref.get(a.getAttribute('data-href') || '');
    const text = a.querySelector<HTMLElement>('.ui-sidenav__text');
    if (!it || !text) return;
    a.setAttribute('aria-label', it.label);
    text.textContent = it.label;
    if (it.short && text.scrollWidth > text.clientWidth) text.textContent = it.short;
  });
  bottom.querySelector('.ui-sidenav-bottom__more')?.setAttribute('aria-label', moreLabel);
}

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
  const fit = () => fitLabels(host, current.items);
  fit();
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) window.addEventListener('resize', fit);
  if (typeof document !== 'undefined') void document.fonts?.ready.then(fit);
  return {
    update(next: Cfg) {
      const prev = current;
      current = next;
      nav.setActive(next.path);
      fit();
      for (const it of next.items) {
        const was = prev.items.find((p) => p.href === it.href);
        if (was?.badge !== it.badge) nav.setBadge(it.href, it.badge ?? null);
      }
    },
    destroy() {
      host.removeEventListener('click', onClick);
      if (hasWindow) window.removeEventListener('resize', fit);
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
