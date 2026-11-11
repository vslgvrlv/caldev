// Сообщения человеку вместо системных `alert` / `confirm` (спека ревизии,
// «Места для треков → Сообщения»). Новых alert/confirm/prompt не добавлять.
//
// Модуль без React: им пользуются обработчики, которые живут вне дерева
// компонентов. Показывает их `NotifyHost` (pbth/components/shell/NotifyHost.tsx),
// смонтированный в корне приложения. Пока хоста нет (тесты, сбой загрузки),
// сообщения уходят в системные окна — человек всё равно должен их увидеть.

export type NotifyKind = 'success' | 'error' | 'info';

export type Toast = { id: number; kind: NotifyKind; text: string };

export type ConfirmRequest = {
  id: number;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

export type NotifyState = { toasts: Toast[]; confirm: ConfirmRequest | null };

type Listener = (state: NotifyState) => void;

const TOAST_MS = 4000;
const ERROR_TOAST_MS = 6000;

let seq = 0;
let state: NotifyState = { toasts: [], confirm: null };
const listeners = new Set<Listener>();
let hostMounted = 0;

function emit() {
  for (const listener of listeners) listener(state);
}

function push(kind: NotifyKind, text: string) {
  const message = String(text || '').trim();
  if (!message) return;
  if (hostMounted === 0) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message);
    return;
  }
  const toast: Toast = { id: ++seq, kind, text: message };
  state = { ...state, toasts: [...state.toasts.slice(-2), toast] };
  emit();
  setTimeout(() => dismissToast(toast.id), kind === 'error' ? ERROR_TOAST_MS : TOAST_MS);
}

export function dismissToast(id: number) {
  if (!state.toasts.some((toast) => toast.id === id)) return;
  state = { ...state, toasts: state.toasts.filter((toast) => toast.id !== id) };
  emit();
}

export const notify = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
  info: (text: string) => push('info', text),
};

/** Текст ошибки для человека: без «HTTP 500» и «unknown error». */
export function errorText(error: unknown, fallback = 'Что-то пошло не так. Попробуй ещё раз.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message || /^HTTP \d+$/.test(message) || /[a-z]{4,}/i.test(message) && !/[а-яё]/i.test(message)) {
    return fallback;
  }
  return message;
}

export function confirmAction(
  text: string,
  options?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  if (hostMounted === 0) {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return Promise.resolve(window.confirm(text));
    }
    return Promise.resolve(false);
  }
  // Второй запрос поверх открытого — первый считаем отменённым.
  state.confirm?.resolve(false);
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      id: ++seq,
      text,
      confirmLabel: options?.confirmLabel ?? 'Да',
      cancelLabel: options?.cancelLabel ?? 'Отмена',
      danger: Boolean(options?.danger),
      resolve: (ok) => {
        if (state.confirm?.id === request.id) {
          state = { ...state, confirm: null };
          emit();
        }
        resolve(ok);
      },
    };
    state = { ...state, confirm: request };
    emit();
  });
}

export function subscribeNotify(listener: Listener): () => void {
  listeners.add(listener);
  hostMounted += 1;
  listener(state);
  return () => {
    listeners.delete(listener);
    hostMounted = Math.max(0, hostMounted - 1);
  };
}

/** Только для тестов. */
export function resetNotifyForTests() {
  state.confirm?.resolve(false);
  state = { toasts: [], confirm: null };
  listeners.clear();
  hostMounted = 0;
}
