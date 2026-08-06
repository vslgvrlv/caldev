// Офлайн-слой (#105). Турнир — единственное место, где рефлексия имеет смысл,
// и ровно там нет сети. До этого модуля приложение не различало «сервер сказал
// нет» и «сети нет»: оба случая приходили в один catch, поэтому в поле человек
// видел вечный спиннер или экран логина, за которым опять нужна сеть.
//
// Здесь два разных предмета, намеренно в одном файле:
//   1. Классификация ошибки — чистая, тестируемая, без браузера.
//   2. Снимки данных в IndexedDB — пломба от «приложение не открывается».

import { SNAPSHOT_STORE, openOfflineDatabase } from './idb';

export const OFFLINE_ERROR_CODE = 'OFFLINE';

export type OfflineAwareError = Error & {
  code?: string;
  detail?: string;
  status?: number;
};

// fetch отвергает промис TypeError'ом и БЕЗ статуса — ответа не было вообще.
// Любая ошибка со статусом пришла с сервера, значит сеть жива.
export function isOfflineError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as OfflineAwareError;
  if (candidate.code === OFFLINE_ERROR_CODE) return true;
  if (typeof candidate.status === 'number') return false;
  return candidate instanceof TypeError;
}

export function toOfflineError(cause: unknown): OfflineAwareError {
  const error = new Error('Нет сети') as OfflineAwareError;
  error.code = OFFLINE_ERROR_CODE;
  error.detail = cause instanceof Error ? cause.message : 'network unavailable';
  return error;
}

// Возраст снимка показывается человеку, поэтому округляем как в разговоре, а не
// как в логах: важно понять «данные свежие» или «это состав недельной давности».
export function formatSnapshotAge(savedAt: number, now: number): string {
  const minutes = Math.floor((now - savedAt) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  return `${days} дн назад`;
}

export const SNAPSHOT_INIT = 'init';
export const SNAPSHOT_AUTH_ME = 'auth-me';
export const SNAPSHOT_FIELD_POSITIONS = 'field-positions';

export type Snapshot<T> = { value: T; savedAt: number };

export async function saveSnapshot(key: string, value: unknown): Promise<void> {
  const db = await openOfflineDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).put({ value, savedAt: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function dropSnapshot(key: string): Promise<void> {
  const db = await openOfflineDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const db = await openOfflineDatabase();
  if (!db) return null;
  const snapshot = await new Promise<Snapshot<T> | null>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const request = tx.objectStore(SNAPSHOT_STORE).get(key);
      request.onsuccess = () => {
        const raw = request.result as Snapshot<T> | undefined;
        resolve(raw && typeof raw.savedAt === 'number' ? raw : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return snapshot;
}
