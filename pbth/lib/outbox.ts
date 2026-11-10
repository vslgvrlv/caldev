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
  // Сколько раз сервер отвечал отказом, который мог быть про саму запись
  // (403, 500). Нет сети, протухшая сессия и перегрузка сюда не идут: это не
  // вина записи, и копить на них счётчик значило бы хоронить честные данные.
  attempts: number;
  lastError?: string;
  // Статус последнего ответа сервера: по нему плашка объясняет человеку
  // причину словами. У записей, поставленных старой версией, его нет.
  lastStatus?: number;
  // Сервер отверг запись по существу (форма не проходит проверку, игра
  // удалена, состав изменился) или отказывал столько раз, что ждать дальше
  // бессмысленно. Повтор даст тот же отказ, поэтому запись останавливается и
  // показывается человеку: он решает — отправить ещё раз или убрать.
  blocked?: boolean;
};

export type FlushOutcome = 'sent' | 'retry' | 'blocked';

// Сколько отказов подряд терпим, прежде чем признать запись застрявшей. Три
// захода — это три открытия приложения или три возврата связи: достаточно,
// чтобы пережить смену роли или короткую аварию, и мало, чтобы запись не
// провисела «ожидающей» неделю.
export const MAX_SERVER_REFUSALS = 3;

// Отказ, который может быть про саму запись, а не про сеть или сессию. 401
// сюда не входит: он лечится новым входом и одинаков для всей очереди. 502,
// 503 и 504 — упал или перегружен сервер целиком, запись ни при чём.
export function countsAsServerRefusal(status: number | undefined): boolean {
  if (status === undefined) return false;
  if (status === 403) return true;
  return status >= 500 && status !== 502 && status !== 503 && status !== 504;
}

// Единственное место, где решается судьба записи. Вынесено отдельно, потому
// что именно тут легко потерять данные молча.
export function classifyFlushOutcome(result: {
  ok: boolean;
  status?: number;
  offline?: boolean;
  // Сколько отказов по этой записи уже засчитано до текущей попытки.
  attempts?: number;
}): FlushOutcome {
  if (result.ok) return 'sent';
  if (result.offline) return 'retry';
  const status = result.status ?? 0;
  if (status === 0) return 'retry';
  if (countsAsServerRefusal(status)) {
    // 403 после смены роли или 500 на конкретных данных повтором не лечатся,
    // но и с первого раза записывать их в приговор нельзя.
    return (result.attempts ?? 0) + 1 >= MAX_SERVER_REFUSALS ? 'blocked' : 'retry';
  }
  // 401 — сессия протухла, пока телефон лежал в кармане. Данные не виноваты,
  // после нового входа отправка пройдёт. 408, 429, 502–504 — авария на той
  // стороне, она проходит сама.
  if (status === 401 || status === 408 || status === 429 || status >= 500 || status < 400) return 'retry';
  return 'blocked';
}

// Причина застрявшей записи для человека. Сервер отвечает кодами на
// английском; игроку на поле нужна одна фраза: что случилось и можно ли
// что-то сделать.
export function describeOutboxProblem(entry: Pick<OutboxEntry, 'lastStatus'>): string {
  const status = entry.lastStatus;
  if (status === undefined) return 'Сервер не принял запись';
  if (status === 401) return 'Нужно войти заново';
  if (status === 403) return 'Нет прав на это действие';
  if (status === 404 || status === 410) return 'Игру или пойнт уже удалили';
  if (status === 409) return 'Данные на сервере уже изменились — например, поменялся состав';
  if (status >= 500) return 'Сервер не смог принять запись';
  return 'Сервер не принял данные';
}

export function summarizeOutbox(entries: OutboxEntry[]): { pending: number; blocked: number } {
  return {
    pending: entries.filter((entry) => !entry.blocked).length,
    blocked: entries.filter((entry) => entry.blocked).length,
  };
}

// Хранилище очереди передаётся снаружи, чтобы правила выше проверялись без
// браузера: в IndexedDB тесты не ходят.
export type OutboxStore = {
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: number): Promise<void>;
};

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

const indexedDbStore: OutboxStore = {
  async list() {
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
  },
  async put(entry) {
    await withStore<void>(
      'readwrite',
      (store, resolve) => {
        const request = store.put(entry);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => resolve(undefined);
      },
      undefined
    );
  },
  async remove(id) {
    await withStore<void>(
      'readwrite',
      (store, resolve) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => resolve(undefined);
      },
      undefined
    );
  },
};

export async function listOutbox(store: OutboxStore = indexedDbStore): Promise<OutboxEntry[]> {
  return store.list();
}

export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>,
  store: OutboxStore = indexedDbStore
): Promise<void> {
  const existing = await store.list();
  const duplicate = existing.find((item) => item.dedupeKey === entry.dedupeKey);
  // Схлопывание сохраняет исходное время: очередь должна уходить в том же
  // порядке, в каком человек заполнял, даже если что-то переписывалось. Новая
  // запись с тем же ключом заменяет и застрявшую: человек сам заполнил форму
  // заново, значит, прежний вариант ему уже не нужен.
  const record: OutboxEntry = {
    ...entry,
    id: duplicate?.id,
    createdAt: duplicate?.createdAt ?? Date.now(),
    attempts: 0,
  };
  await store.put(record);
  await notify(store);
}

// «Отправить ещё раз»: снимаем остановку и обнуляем счёт, данные не трогаем.
// Саму отправку запускает вызывающий, потому что только он знает, как ходить в
// сеть.
export async function retryOutboxEntry(id: number, store: OutboxStore = indexedDbStore): Promise<void> {
  const entries = await store.list();
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  const { blocked: _blocked, lastError: _lastError, lastStatus: _lastStatus, ...rest } = entry;
  await store.put({ ...rest, attempts: 0 });
  await notify(store);
}

// «Убрать»: запись уходит насовсем и никогда не будет отправлена. Подтверждение
// спрашивает экран, здесь решение уже принято.
export async function discardOutboxEntry(id: number, store: OutboxStore = indexedDbStore): Promise<void> {
  await store.remove(id);
  await notify(store);
}

type Listener = (state: { pending: number; blocked: number }) => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void notify();
  return () => listeners.delete(listener);
}

async function notify(store: OutboxStore = indexedDbStore): Promise<void> {
  if (listeners.size === 0) return;
  const state = summarizeOutbox(await store.list());
  listeners.forEach((listener) => listener(state));
}

let flushing = false;

// send передаётся снаружи, чтобы очередь не знала про api.ts и не тянула за
// собой половину приложения (а заодно проверялась без сети и без браузера).
export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

export async function flushOutbox(send: OutboxSender, store: OutboxStore = indexedDbStore): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const entries = await store.list();
    for (const entry of entries) {
      if (entry.blocked || entry.id === undefined) continue;
      let outcome: FlushOutcome;
      let message = '';
      let status: number | undefined;
      let offline = false;
      try {
        await send(entry);
        outcome = 'sent';
      } catch (error) {
        status = (error as { status?: number }).status;
        message = error instanceof Error ? error.message : String(error);
        offline = isOfflineError(error);
        outcome = classifyFlushOutcome({ ok: false, status, offline, attempts: entry.attempts });
      }

      if (outcome === 'sent') {
        await store.remove(entry.id);
        continue;
      }

      // Сети нет — запись не менялась, ничего не пишем. И дальше по очереди
      // идти незачем: остальные упрутся в то же самое, а порядок важнее
      // скорости — они уйдут, когда связь вернётся.
      if (offline) break;

      // Любой ответ сервера — отказ по одной записи. Остальные записи с ней не
      // связаны (все ручки очереди — перезапись по своему ключу), поэтому
      // отказ не должен останавливать очередь: раньше одна запись с 403 вставала
      // в голове и держала за собой все следующие рефлексии.
      await store.put({
        ...entry,
        attempts: entry.attempts + (countsAsServerRefusal(status) ? 1 : 0),
        lastError: message,
        lastStatus: status,
        ...(outcome === 'blocked' ? { blocked: true } : {}),
      });
    }
  } finally {
    flushing = false;
    await notify(store);
  }
}
