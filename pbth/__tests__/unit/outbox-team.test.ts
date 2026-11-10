import { describe, expect, it } from 'vitest';
import { buildQueuedRequest, queuedRequestHeaders } from '../../api';
import { enqueue, flushOutbox, type OutboxEntry, type OutboxStore } from '../../lib/outbox';

// Запись, поставленная в очередь без сети в одной команде, уходит под этой
// командой, даже если отправка случилась уже на экране другой (ревизия
// 11.11.2026, заголовок X-PBTH-Team).
function memoryStore(): OutboxStore & { items: OutboxEntry[] } {
  let seq = 0;
  const items: OutboxEntry[] = [];
  return {
    items,
    async list() {
      return [...items];
    },
    async put(entry) {
      const id = entry.id ?? ++seq;
      const index = items.findIndex((item) => item.id === id);
      const record = { ...entry, id };
      if (index >= 0) items[index] = record;
      else items.push(record);
    },
    async remove(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
    },
  };
}

describe('команда записи в очереди без сети', () => {
  it('запоминается при постановке и уходит заголовком при отправке', async () => {
    const store = memoryStore();
    const queued = buildQueuedRequest(
      '/points/p-1/reflection',
      { method: 'PUT', body: { note: 'x' }, offlineQueue: { dedupeKey: 'reflection:p-1', label: 'Рефлексия' } },
      'team-alpha',
    );
    await enqueue(queued, store);
    expect(store.items[0]).toMatchObject({ teamId: 'team-alpha', path: '/points/p-1/reflection' });

    const sent: Array<Record<string, string> | undefined> = [];
    await flushOutbox(async (entry) => {
      sent.push(queuedRequestHeaders(entry));
    }, store);
    expect(sent).toEqual([{ 'X-PBTH-Team': 'team-alpha' }]);
    expect(store.items).toHaveLength(0);
  });

  it('запись старой версии без команды уходит как раньше — с текущей', () => {
    const legacy = { method: 'PUT', path: '/x', body: {}, dedupeKey: 'k', label: 'l', createdAt: 0, attempts: 0 } as OutboxEntry;
    expect(queuedRequestHeaders(legacy)).toBeUndefined();
  });
});
