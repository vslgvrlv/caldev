import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { installChunkReloadHandler, isChunkLoadError, isChunkReloadPending, reloadOnceForStaleChunk } from '../../lib/chunk-reload';
import { createSingleFlight } from '../../lib/single-flight';
import { CreateEventView } from '../../views/CreateEventView';
import { EventType } from '../../types';

// Хвосты волны 2, пункты 15–16: дубль события по второму нажатию и переход
// на экран, часть которого после выката уже удалена с сервера.

describe('15. «Создать событие» не отправляет второй раз, пока идёт запрос', () => {
  it('второе нажатие во время запроса ничего не отправляет', async () => {
    const flight = createSingleFlight();
    let finish: () => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = flight.run(send);
    expect(flight.busy).toBe(true);
    const second = await flight.run(send);
    expect(second).toEqual({ skipped: true });
    expect(send).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toEqual({ skipped: false, value: undefined });
    expect(flight.busy).toBe(false);
    // Запрос завершился (в том числе отказом) — можно отправить снова.
    await flight.run(async () => {
      throw new Error('нет сети');
    }).catch(() => {});
    expect(flight.busy).toBe(false);
    const third = flight.run(send);
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    await third;
  });

  it('кнопка на экране — «Создать событие»', () => {
    const html = renderToStaticMarkup(
      React.createElement(CreateEventView, {
        onBack: () => {},
        onCreate: async () => {},
        allowedTypes: [EventType.TRAINING],
        defaultType: EventType.TRAINING,
      }),
    );
    expect(html).toContain('Создать событие');
    expect(html).not.toContain('Создаём');
  });
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('16. часть экрана удалена после выката — одна перезагрузка, не цикл', () => {
  it('узнаёт ошибку загрузки части', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://pbthub.ru/assets/Dashboard-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('перезагружает один раз; вторая ошибка подряд — экран ошибки, без перезагрузки', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let now = 1_000_000;
    expect(reloadOnceForStaleChunk({ storage, reload, now: () => now })).toBe(true);
    // Пока перезагрузка не случилась, экран ошибку не показывает.
    expect(isChunkReloadPending()).toBe(true);
    now += 3_000;
    expect(reloadOnceForStaleChunk({ storage, reload, now: () => now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // Следующий выкат через час — снова одна перезагрузка.
    now += 3_600_000;
    expect(reloadOnceForStaleChunk({ storage, reload, now: () => now })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('без sessionStorage не перезагружает (нечем защититься от цикла)', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('vite:preloadError: первая ошибка — перезагрузка и событие погашено, вторая — уходит дальше', () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const reload = vi.fn();
    installChunkReloadHandler(target, { storage, reload, now: () => 5_000_000 });
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
