import { useEffect, useRef } from 'react';
import * as raw from '../vendor/ui-kit/0.43.0/ui-kit.esm.js';
import iconsUrl from '../vendor/ui-kit/0.43.0/icons.svg?url';

// Единственное место, которое знает версию ui-kit в vendor/. Остальной код
// берёт модули отсюда: UI.feed, UI.month, UI.toast и так далее.

export type Handle = {
  el?: HTMLElement;
  update?: (cfg: any) => void;
  set?: (cfg: any) => void;
  destroy?: () => void;
};

export type DialogAction = {
  label: string;
  kind?: 'primary' | 'danger';
  onClick?: (e: Event) => unknown;
  close?: boolean;
};

export type DialogOptions = {
  title?: string;
  subtitle?: string;
  content?: HTMLElement | string;
  actions?: DialogAction[];
  size?: 'md' | 'lg' | 'xl';
  className?: string;
  esc?: boolean;
  backdrop?: boolean;
  onClose?: (reason?: string) => void;
  beforeClose?: (reason: 'x' | 'esc' | 'backdrop') => boolean | Promise<boolean>;
};

export type ToastOptions = {
  text: string;
  kind?: 'success' | 'error' | 'info';
  timeout?: number;
  action?: { label: string; onClick: () => void };
};

export interface UiKit {
  VERSION: string;
  icons: { configure(o: { href: string }): void };
  toast: {
    show(o: ToastOptions): unknown;
    dismiss(id?: unknown): void;
    configure(o: Record<string, unknown>): void;
    clear(): void;
  };
  dialog: { open(o: DialogOptions): { close(): void; el: HTMLElement; body: HTMLElement; setTitle(t: string): void }; closeAll(): void };
  feed: { mount(el: HTMLElement, cfg: Record<string, unknown>): Handle };
  month: { mount(el: HTMLElement, cfg: Record<string, unknown>): Handle };
  seg: { mount(el: HTMLElement, cfg: Record<string, unknown>): { get(): string; set(v: string): void; el: HTMLElement } };
  sidenav: {
    mount(
      el: HTMLElement,
      cfg: Record<string, unknown>,
    ): {
      el: HTMLElement;
      bottom: HTMLElement | null;
      setActive(path: string): void;
      setBadge(href: string, text: string | number | null): void;
      setAction(a: unknown): void;
    };
  };
}

export const UI = raw as unknown as UiKit;

// Спрайт значков лежит рядом с копией ui-kit и отдаётся с того же адреса.
export const ICONS_HREF: string = iconsUrl;
UI.icons.configure({ href: ICONS_HREF });

/** Подключает модуль ui-kit к узлу React: mount → update → destroy. */
export type MountController<C> = {
  attach(el: HTMLElement, cfg: C): void;
  update(cfg: C): void;
  dispose(): void;
};

export function createMountController<C>(mountFn: (el: HTMLElement, cfg: C) => Handle): MountController<C> {
  let handle: Handle | null = null;
  let last: C | undefined;
  return {
    attach(el, cfg) {
      handle = mountFn(el, cfg);
      last = cfg;
    },
    update(cfg) {
      if (!handle || cfg === last) return;
      last = cfg;
      if (handle.update) handle.update(cfg);
      else if (handle.set) handle.set(cfg);
    },
    dispose() {
      handle?.destroy?.();
      handle = null;
      last = undefined;
    },
  };
}

/**
 * `mountFn` вызывается один раз при появлении узла, дальше каждое новое `cfg`
 * уходит в `update` (или `set`), при уходе экрана — `destroy`.
 * Чтобы не обновлять модуль на каждый рендер, держи `cfg` в `useMemo`.
 */
export function useUiMount<C>(mountFn: (el: HTMLElement, cfg: C) => Handle, cfg: C) {
  const ref = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mountFn);
  mountRef.current = mountFn;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const ctl = useRef<MountController<C> | null>(null);
  if (!ctl.current) ctl.current = createMountController<C>((el, c) => mountRef.current(el, c));

  useEffect(() => {
    const controller = ctl.current!;
    if (ref.current) controller.attach(ref.current, cfgRef.current);
    return () => controller.dispose();
  }, []);

  useEffect(() => {
    ctl.current!.update(cfg);
  }, [cfg]);

  return ref;
}
