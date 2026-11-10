// Данные на устройстве, которые принадлежат вошедшему человеку: снимки для
// работы без сети, очередь неотправленного, последняя открытая команда.
//
// При выходе их надо стереть. Иначе следующий вошедший на этом телефоне видел
// бы чужой состав из снимка, а неотправленные записи прошлого человека ушли бы
// на сервер под новой учёткой.

import { OUTBOX_STORE, SNAPSHOT_STORE, openOfflineDatabase } from './idb';
import { forgetLastTeam } from './team-url';

const LOCAL_KEYS = ['pbth:last-team'];

async function clearStore(db: IDBDatabase, store: string): Promise<void> {
  if (!db.objectStoreNames.contains(store)) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Стирает снимки, очередь отправки и память о командах на этом устройстве. */
export async function clearDeviceData(): Promise<void> {
  forgetLastTeam();
  try {
    for (const key of LOCAL_KEYS) window.localStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
  const db = await openOfflineDatabase();
  if (!db) return;
  try {
    await clearStore(db, SNAPSHOT_STORE);
    await clearStore(db, OUTBOX_STORE);
  } finally {
    db.close();
  }
}
