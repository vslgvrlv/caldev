// Одна база на весь офлайн — и снимки, и очередь отправки. Раздельное открытие
// одного имени с разными версиями роняет вторую из них VersionError'ом, причём
// только на устройстве, где база уже создана: в разработке такое не всплывает.

const DB_NAME = 'pbth-offline';
const DB_VERSION = 2;

export const SNAPSHOT_STORE = 'snapshots';
export const OUTBOX_STORE = 'outbox';

// Открытие базы в Safari умеет не отвечать вовсе: ни success, ни error, ни
// blocked. Без срока это вечный спиннер на старте, поэтому ждём ограниченно и
// дальше работаем как без офлайна.
const OPEN_DEADLINE_MS = 4000;

export function openOfflineDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    setTimeout(() => settle(null), OPEN_DEADLINE_MS);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      settle(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      // Опоздавшую базу закрываем: её уже никто не ждёт, а открытое соединение
      // блокирует следующее обновление версии.
      if (settled) {
        request.result.close();
        return;
      }
      settle(request.result);
    };
    // Приватный режим, переполненный диск, отозванные права — офлайна не будет,
    // но приложение обязано продолжать работать как раньше.
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  });
}
