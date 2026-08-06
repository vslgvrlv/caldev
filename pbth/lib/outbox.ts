// Очередь отправки (#105). Заполненная на турнире рефлексия обязана пережить
// отсутствие сети: игрок нажал «Сохранить» — для него это конец истории,
// дальше доставка наша забота.
//
// В очередь попадают ТОЛЬКО явно помеченные вызовы. Слепая постановка всех
// мутаций опасна: удаление события, выход из серии и снятие из состава
// необратимы, и «отложенное удаление», всплывшее через сутки, хуже отказа.

import { OUTBOX_STORE, openOfflineDatabase } from './idb';
import { isOfflineError } from './offline';

export type OutboxEntry = {
  id?: number;
  method: string;
  path: string;
  body: unknown;
  // Ключ схлопывания: повторное сохранение той же рефлексии не должно
  // отправляться дважды. Все очередящиеся ручки — перезапись (upsert по
  // уникальному ключу), поэтому побеждает последняя запись.
  dedupeKey: string;
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  // Сервер отверг запрос по существу (например, форма не проходит валидацию).
  // Повтор даст тот же отказ, поэтому запись останавливается и показывается
  // человеку, а не крутится в очереди вечно.
  blocked?: boolean;
};

export type FlushOutcome = 'sent' | 'retry' | 'blocked';

// Единственное место, где решается судьба записи. Вынесено отдельно, потому
// что именно тут легко потерять данные молча.
export function classifyFlushOutcome(result: { ok: boolean; status?: number; offline?: boolean }): FlushOutcome {
  if (result.ok) return 'sent';
  if (result.offline) return 'retry';
  const status = result.status ?? 0;
  // 5xx и таймауты — авария на той стороне, она проходит сама.
  if (status >= 500 || status === 408 || status === 429 || status === 0) return 'retry';
  // 401/403 — сессия протухла, пока телефон лежал в кармане. Данные не виноваты,
  // после нового входа отправка пройдёт.
  if (status === 401 || status === 403) return 'retry';
  return 'blocked';
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void) => void,
  fallback: T
): Promise<T> {
  return openOfflineDatabase().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) {
          resolve(fallback);
          return;
        }
        let settled = false;
        const done = (value: T) => {
          if (settled) return;
          settled = true;
          resolve(value);
          db.close();
        };
        try {
          const tx = db.transaction(OUTBOX_STORE, mode);
          run(tx.objectStore(OUTBOX_STORE), done);
          tx.onerror = () => done(fallback);
          tx.onabort = () => done(fallback);
        } catch {
          done(fallback);
        }
      })
  );
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const entries = await withStore<OutboxEntry[]>(
    'readonly',
    (store, resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as OutboxEntry[]) || []);
      request.onerror = () => resolve([]);
    },
    []
  );
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

export async function enqueue(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>): Promise<void> {
  const existing = await listOutbox();
  const duplicate = existing.find((item) => item.dedupeKey === entry.dedupeKey);
  await withStore<void>(
    'readwrite',
    (store, resolve) => {
      // Схлопывание сохраняет исходное время: очередь должна уходить в том же
      // порядке, в каком человек заполнял, даже если что-то переписывалось.
      const record: OutboxEntry = {
        ...entry,
        id: duplicate?.id,
        createdAt: duplicate?.createdAt ?? Date.now(),
        attempts: 0,
      };
      const request = store.put(record);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => resolve(undefined);
    },
    undefined
  );
  notify();
}

async function updateEntry(entry: OutboxEntry): Promise<void> {
  await withStore<void>(
    'readwrite',
    (store, resolve) => {
      const request = store.put(entry);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => resolve(undefined);
    },
    undefined
  );
}

async function removeEntry(id: number): Promise<void> {
  await withStore<void>(
    'readwrite',
    (store, resolve) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => resolve(undefined);
    },
    undefined
  );
}

type Listener = (state: { pending: number; blocked: number }) => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void notify();
  return () => listeners.delete(listener);
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const entries = await listOutbox();
  const state = {
    pending: entries.filter((e) => !e.blocked).length,
    blocked: entries.filter((e) => e.blocked).length,
  };
  listeners.forEach((listener) => listener(state));
}

let flushing = false;

// send передаётся снаружи, чтобы очередь не знала про api.ts и не тянула за
// собой половину приложения (а заодно проверялась без сети и без браузера).
export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

export async function flushOutbox(send: OutboxSender): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const entries = await listOutbox();
    for (const entry of entries) {
      if (entry.blocked || entry.id === undefined) continue;
      let outcome: FlushOutcome;
      let message = '';
      try {
        await send(entry);
        outcome = 'sent';
      } catch (error) {
        const status = (error as { status?: number }).status;
        message = error instanceof Error ? error.message : String(error);
        outcome = classifyFlushOutcome({ ok: false, status, offline: isOfflineError(error) });
      }

      if (outcome === 'sent') {
        await removeEntry(entry.id);
        continue;
      }
      if (outcome === 'retry') {
        await updateEntry({ ...entry, attempts: entry.attempts + 1, lastError: message });
        // Сеть снова пропала — дальше по очереди идти незачем, порядок важнее
        // скорости: следующие записи отправятся, когда связь вернётся.
        break;
      }
      await updateEntry({ ...entry, attempts: entry.attempts + 1, lastError: message, blocked: true });
    }
  } finally {
    flushing = false;
    await notify();
  }
}
