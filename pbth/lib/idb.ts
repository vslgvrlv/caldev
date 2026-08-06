// Одна база на весь офлайн — и снимки, и очередь отправки. Раздельное открытие
// одного имени с разными версиями роняет вторую из них VersionError'ом, причём
// только на устройстве, где база уже создана: в разработке такое не всплывает.

const DB_NAME = 'pbth-offline';
const DB_VERSION = 2;

export const SNAPSHOT_STORE = 'snapshots';
export const OUTBOX_STORE = 'outbox';

export function openOfflineDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
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
    request.onsuccess = () => resolve(request.result);
    // Приватный режим, переполненный диск, отозванные права — офлайна не будет,
    // но приложение обязано продолжать работать как раньше.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
