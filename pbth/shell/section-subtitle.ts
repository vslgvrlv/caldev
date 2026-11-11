import React from 'react';

// Экран раздела может сказать шапке оболочки, что написать в подписи: календарь —
// показанный в сетке месяц. Пока экран не задал подпись, шапка пишет свою.

let current: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function set(value: string | null) {
  if (current === value) return;
  current = value;
  listeners.forEach((fn) => fn());
}

/** Подпись, заданная экраном; `null` — своя подпись шапки. Читает шапка раздела. */
export function useSectionSubtitleOverride(): string | null {
  return React.useSyncExternalStore(subscribe, () => current, () => null);
}

/** Экран задаёт подпись шапки; уходя с экрана, возвращает свою. */
export function useSectionSubtitle(value: string): void {
  React.useEffect(() => {
    set(value);
  }, [value]);
  React.useEffect(() => () => set(null), []);
}
