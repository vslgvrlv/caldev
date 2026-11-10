// Части приложения грузятся отдельно (`lazy` в routes.tsx). После выката
// старые части удаляются с сервера, а открытое приложение всё ещё ссылается на
// них: переход на такой экран падает с «Failed to fetch dynamically imported
// module». Лечится одной перезагрузкой — она подтянет новую сборку.
//
// Защита от цикла: перед перезагрузкой в sessionStorage пишется время. Если
// часть снова не загрузилась вскоре после перезагрузки, второй раз не
// перезагружаем — человек видит обычный экран ошибки с кнопкой «Обновить».

const MARK_KEY = 'pbth:chunk-reload-at';
/** Ошибка в пределах этого окна после перезагрузки считается «подряд». */
const REPEAT_WINDOW_MS = 60_000;

type MarkStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Перезагрузка уже запущена на этой странице: пока она не случилась, экран
// не показывает ошибку (Vite после погашенного `vite:preloadError` отдаёт
// пустой модуль, и lazy-экран падает уже другой ошибкой).
let reloadPending = false;

export function isChunkReloadPending(): boolean {
  return reloadPending;
}

export type ChunkReloadDeps = {
  storage: MarkStorage | null;
  reload: () => void;
  now?: () => number;
};

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_ERROR_RE.test(message);
}

/** true — перезагрузка запущена; false — уже перезагружали только что (или нечем отметить). */
export function reloadOnceForStaleChunk(deps: ChunkReloadDeps): boolean {
  const { storage, reload } = deps;
  if (!storage) return false;
  const now = (deps.now ?? Date.now)();
  try {
    const last = Number(storage.getItem(MARK_KEY) || 0);
    if (last && now - last < REPEAT_WINDOW_MS) return false;
    storage.setItem(MARK_KEY, String(now));
  } catch {
    return false;
  }
  reloadPending = true;
  reload();
  return true;
}

export function browserChunkReloadDeps(): ChunkReloadDeps {
  let storage: MarkStorage | null = null;
  try {
    storage = typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    storage = null;
  }
  return { storage, reload: () => window.location.reload() };
}

/**
 * Vite шлёт `vite:preloadError`, когда часть не загрузилась. Перезагружаем —
 * и гасим событие, чтобы ошибка не долетела до экрана. Второй раз подряд —
 * не гасим: ошибку поймает ErrorBoundary и покажет экран ошибки.
 */
export function installChunkReloadHandler(target: EventTarget, deps: ChunkReloadDeps): () => void {
  const onError = (event: Event) => {
    if (reloadOnceForStaleChunk(deps)) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}
