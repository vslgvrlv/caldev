import { describe, expect, it } from 'vitest';
import {
  MAX_SERVER_REFUSALS,
  describeOutboxProblem,
  discardOutboxEntry,
  flushOutbox,
  retryOutboxEntry,
  summarizeOutbox,
  type OutboxEntry,
  type OutboxStore,
} from '../../lib/outbox';
import { toOfflineError } from '../../lib/offline';

// Очередь отправки живёт в IndexedDB, которой в тестах нет. Поэтому хранилище
// передаётся в flushOutbox снаружи — здесь это обычный список в памяти.
function memoryStore(initial: Array<Partial<OutboxEntry> & { id: number }>): OutboxStore & {
  all(): OutboxEntry[];
} {
  const rows = new Map<number, OutboxEntry>();
  for (const item of initial) {
    rows.set(item.id, {
      method: 'PUT',
      path: `/reflections/points/${item.id}/mine`,
      body: { note: `запись ${item.id}` },
      dedupeKey: `reflection:${item.id}`,
      label: 'Рефлексия за пойнт',
      createdAt: item.id * 1000,
      attempts: 0,
      ...item,
    } as OutboxEntry);
  }
  return {
    async list() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
    async put(entry) {
      if (entry.id !== undefined) rows.set(entry.id, { ...entry });
    },
    async remove(id) {
      rows.delete(id);
    },
    all() {
      return [...rows.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}

const refusal = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

// Сендер, который отвечает по записи из заранее заданной таблицы: id → ошибка.
// Ничего не заданное считается успехом.
function senderWith(failures: Record<number, unknown>) {
  const sent: number[] = [];
  const tried: number[] = [];
  const send = async (entry: OutboxEntry) => {
    tried.push(entry.id as number);
    if (failures[entry.id as number] !== undefined) throw failures[entry.id as number];
    sent.push(entry.id as number);
  };
  return { send, sent, tried };
}

describe('очередь: отказ по одной записи не держит остальные', () => {
  it('409 на средней записи — первая и третья уходят, средняя ждёт человека', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const sender = senderWith({ 2: refusal(409, 'NOT_IN_POINT_ROSTER') });

    await flushOutbox(sender.send, store);

    expect(sender.sent).toEqual([1, 3]);
    const left = store.all();
    expect(left.map((e) => e.id)).toEqual([2]);
    expect(left[0].blocked).toBe(true);
    expect(left[0].lastStatus).toBe(409);
  });

  it('403 на первой записи не останавливает очередь (раньше вставала целиком)', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const sender = senderWith({ 1: refusal(403, 'ROLE_REQUIRED') });

    await flushOutbox(sender.send, store);

    expect(sender.tried).toEqual([1, 2, 3]);
    expect(sender.sent).toEqual([2, 3]);
    const first = store.all()[0];
    expect(first.id).toBe(1);
    // Один отказ — ещё не приговор: роль могла смениться, сессия — обновиться.
    expect(first.blocked).toBeUndefined();
    expect(first.attempts).toBe(1);
    expect(first.lastStatus).toBe(403);
  });

  it('401 на первой записи тоже не останавливает очередь', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }]);
    const sender = senderWith({ 1: refusal(401) });

    await flushOutbox(sender.send, store);

    expect(sender.tried).toEqual([1, 2]);
    expect(sender.sent).toEqual([2]);
  });

  it('500 на одной записи не останавливает остальные', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }]);
    const sender = senderWith({ 1: refusal(500) });

    await flushOutbox(sender.send, store);

    expect(sender.sent).toEqual([2]);
    expect(store.all().map((e) => e.id)).toEqual([1]);
  });
});

describe('очередь: сети нет — идти дальше незачем', () => {
  it('пропала сеть на первой записи — остальные не трогаем', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const sender = senderWith({ 1: toOfflineError(new TypeError('Failed to fetch')) });

    await flushOutbox(sender.send, store);

    expect(sender.tried).toEqual([1]);
    expect(store.all().map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('отсутствие сети не считается отказом сервера', async () => {
    const store = memoryStore([{ id: 1 }]);
    const sender = senderWith({ 1: toOfflineError(new TypeError('Failed to fetch')) });

    for (let i = 0; i < 10; i += 1) await flushOutbox(sender.send, store);

    const only = store.all()[0];
    expect(only.attempts).toBe(0);
    expect(only.blocked).toBeUndefined();
  });
});

describe('очередь: застрявшая запись становится видной человеку', () => {
  it(`403 ${MAX_SERVER_REFUSALS} раза подряд — запись помечается как не принятая сервером`, async () => {
    const store = memoryStore([{ id: 1 }, { id: 2 }]);
    const sender = senderWith({ 1: refusal(403, 'ROLE_REQUIRED') });

    for (let i = 0; i < MAX_SERVER_REFUSALS - 1; i += 1) {
      await flushOutbox(sender.send, store);
      expect(store.all()[0].blocked).toBeUndefined();
    }
    await flushOutbox(sender.send, store);

    const stuck = store.all()[0];
    expect(stuck.blocked).toBe(true);
    expect(stuck.lastStatus).toBe(403);
  });

  it('401 сколько ни приходи — запись остаётся в очереди и ждёт нового входа', async () => {
    const store = memoryStore([{ id: 1 }]);
    const sender = senderWith({ 1: refusal(401) });

    for (let i = 0; i < 20; i += 1) await flushOutbox(sender.send, store);

    const only = store.all()[0];
    expect(only.blocked).toBeUndefined();
    expect(only.attempts).toBe(0);
    expect(only.lastStatus).toBe(401);
  });

  it('заблокированную запись очередь больше не трогает', async () => {
    const store = memoryStore([{ id: 1, blocked: true, lastStatus: 409 }, { id: 2 }]);
    const sender = senderWith({});

    await flushOutbox(sender.send, store);

    expect(sender.tried).toEqual([2]);
    expect(store.all().map((e) => e.id)).toEqual([1]);
  });

  it('«отправить ещё раз» снимает блокировку и сбрасывает счётчик, но не теряет данные', async () => {
    const store = memoryStore([
      { id: 1, blocked: true, attempts: 3, lastError: 'HTTP 409', lastStatus: 409, body: { note: 'длинный текст' } },
    ]);

    await retryOutboxEntry(1, store);

    const entry = store.all()[0];
    expect(entry.blocked).toBeFalsy();
    expect(entry.attempts).toBe(0);
    expect(entry.lastError).toBeUndefined();
    expect(entry.lastStatus).toBeUndefined();
    expect(entry.body).toEqual({ note: 'длинный текст' });

    const sender = senderWith({});
    await flushOutbox(sender.send, store);
    expect(sender.sent).toEqual([1]);
    expect(store.all()).toEqual([]);
  });

  it('«убрать» удаляет только выбранную запись', async () => {
    const store = memoryStore([
      { id: 1, blocked: true, lastStatus: 409 },
      { id: 2, blocked: true, lastStatus: 404 },
      { id: 3 },
    ]);

    await discardOutboxEntry(2, store);

    expect(store.all().map((e) => e.id)).toEqual([1, 3]);
  });
});

describe('очередь: счётчики для плашки', () => {
  it('считает ждущие и не принятые отдельно', async () => {
    const store = memoryStore([{ id: 1 }, { id: 2, blocked: true }, { id: 3, blocked: true }]);

    expect(summarizeOutbox(await store.list())).toEqual({ pending: 1, blocked: 2 });
  });
});

describe('очередь: причина отказа человеческими словами', () => {
  const entry = (status: number | undefined): OutboxEntry => ({
    method: 'PUT',
    path: '/x',
    body: {},
    dedupeKey: 'k',
    label: 'Рефлексия за пойнт',
    createdAt: 0,
    attempts: 1,
    lastStatus: status,
    blocked: true,
  });

  it('называет причину по статусу, без кодов и английских текстов сервера', () => {
    expect(describeOutboxProblem(entry(409))).toMatch(/изменил/i);
    expect(describeOutboxProblem(entry(404))).toMatch(/удал/i);
    expect(describeOutboxProblem(entry(403))).toMatch(/прав/i);
    expect(describeOutboxProblem(entry(400))).toMatch(/не принял/i);
    expect(describeOutboxProblem(entry(500))).toMatch(/сервер/i);
  });

  it('для записи без статуса (сделана старой версией) даёт нейтральную фразу', () => {
    const text = describeOutboxProblem(entry(undefined));
    expect(text.length).toBeGreaterThan(5);
    expect(text).not.toMatch(/undefined|HTTP/);
  });
});
