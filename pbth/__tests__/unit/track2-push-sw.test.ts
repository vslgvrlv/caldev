// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from 'node:fs';
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from 'node:url';
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// Обработчик пушей в service worker (трек 2): тап открывает `url` из пуша,
// кнопки «Иду / Не иду» пишут ответ по ключу без открытия приложения.

const source = readFileSync(fileURLToPath(new URL('../../public/push-sw-handler.js', import.meta.url)), 'utf8');

type Listener = (event: any) => void;

function makeWorker(opts: { clients?: any[]; fetchOk?: boolean } = {}) {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const fetches: Array<{ url: string; init: any }> = [];
  const clients = (opts.clients ?? []).map((c) => ({
    url: c.url,
    focus: () => Promise.resolve(undefined),
    navigate: (u: string) => {
      navigated.push(u);
      return Promise.resolve(undefined);
    },
  }));
  const self = {
    location: { origin: 'https://pbthub.ru' },
    addEventListener: (name: string, fn: Listener) => {
      listeners[name] = fn;
    },
    registration: {
      showNotification: (title: string, options: any) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (u: string) => {
        opened.push(u);
        return Promise.resolve(undefined);
      },
    },
  };
  const fetchImpl = (url: string, init: any) => {
    fetches.push({ url, init });
    const ok = opts.fetchOk !== false;
    return Promise.resolve({ ok, json: () => Promise.resolve(ok ? { ok: true, message: 'Ты идёшь.' } : { ok: false }) });
  };
  vm.runInNewContext(source, { self, fetch: fetchImpl, URL, JSON, Promise, Array, String, Boolean });
  return { listeners, shown, opened, navigated, fetches };
}

async function dispatch(listener: Listener, event: any) {
  let pending: Promise<unknown> = Promise.resolve();
  listener({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

const eventPush = {
  title: 'Holy Guns: Тренировка',
  body: 'Завтра событие',
  url: '/t/holy/event/abc',
  tag: 'event-abc',
  actions: [
    { action: 'rsvp-yes', title: 'Иду' },
    { action: 'rsvp-no', title: 'Не иду' },
  ],
  rsvp: { token: 'v1.body.sig' },
};

describe('push-sw-handler', () => {
  it('пуш о событии: свой тег, адрес события и кнопки ответа', async () => {
    const w = makeWorker();
    await dispatch(w.listeners.push, { data: { json: () => eventPush } });
    expect(w.shown[0].title).toBe('Holy Guns: Тренировка');
    expect(w.shown[0].options.tag).toBe('event-abc');
    expect(w.shown[0].options.data).toEqual({ url: '/t/holy/event/abc', rsvpToken: 'v1.body.sig' });
    expect(w.shown[0].options.actions.map((a: any) => a.title)).toEqual(['Иду', 'Не иду']);
  });

  it('пуш без ключа — без кнопок; чужой адрес не открывается', async () => {
    const w = makeWorker();
    await dispatch(w.listeners.push, { data: { json: () => ({ title: 'x', body: 'y', url: 'https://evil.example/x' }) } });
    expect(w.shown[0].options.actions).toBeUndefined();
    expect(w.shown[0].options.data.url).toBe('/app');
  });

  it('тап без открытого приложения открывает адрес из пуша', async () => {
    const w = makeWorker();
    await dispatch(w.listeners.notificationclick, {
      action: '',
      notification: { close: () => undefined, data: { url: '/t/holy/money' } },
    });
    expect(w.opened).toEqual(['/t/holy/money']);
  });

  it('тап при открытом приложении переводит его на адрес из пуша', async () => {
    const w = makeWorker({ clients: [{ url: 'https://pbthub.ru/t/holy' }] });
    await dispatch(w.listeners.notificationclick, {
      action: '',
      notification: { close: () => undefined, data: { url: '/t/holy/event/abc' } },
    });
    expect(w.navigated).toEqual(['/t/holy/event/abc']);
    expect(w.opened).toEqual([]);
  });

  it('кнопка «Иду» пишет ответ по ключу и показывает подтверждение', async () => {
    const w = makeWorker();
    await dispatch(w.listeners.notificationclick, {
      action: 'rsvp-yes',
      notification: { close: () => undefined, title: 'Holy Guns: Тренировка', tag: 'event-abc', data: { url: '/t/holy/event/abc', rsvpToken: 'v1.body.sig' } },
    });
    expect(w.fetches[0].url).toBe('/api/v1/rsvp/push');
    expect(JSON.parse(w.fetches[0].init.body)).toEqual({ token: 'v1.body.sig', status: 'CONFIRMED' });
    expect(w.shown[0].options.body).toBe('Ты идёшь.');
    expect(w.shown[0].options.tag).toBe('event-abc');
    expect(w.opened).toEqual([]);
  });

  it('отказ сервера — открываем событие, чтобы ответить в приложении', async () => {
    const w = makeWorker({ fetchOk: false });
    await dispatch(w.listeners.notificationclick, {
      action: 'rsvp-no',
      notification: { close: () => undefined, data: { url: '/t/holy/event/abc', rsvpToken: 'v1.body.sig' } },
    });
    expect(JSON.parse(w.fetches[0].init.body).status).toBe('DECLINED');
    expect(w.opened).toEqual(['/t/holy/event/abc']);
  });
});
