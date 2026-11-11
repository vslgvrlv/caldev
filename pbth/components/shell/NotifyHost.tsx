import React from 'react';
import { subscribeNotify, type ConfirmRequest, type NotifyState } from '../../lib/notify';
import { UI } from '../../ui/uikit';
import './notify-host.css';

const TOAST_MS = 4000;
const ERROR_TOAST_MS = 6000;

// Показывает сообщения из pbth/lib/notify.ts через ui-kit: плашки — UI.toast,
// подтверждение — UI.dialog. Сам ничего не рисует. Монтируется один раз в корне.
export const NotifyHost: React.FC = () => {
  const [state, setState] = React.useState<NotifyState>({ toasts: [], confirm: null });

  React.useEffect(() => {
    UI.toast.configure({ closable: true });
    return subscribeNotify(setState);
  }, []);

  // Плашки: новая в состоянии — показать, исчезла из состояния — убрать.
  const shown = React.useRef(new Map<number, unknown>());
  React.useEffect(() => {
    const live = new Set(state.toasts.map((toast) => toast.id));
    for (const toast of state.toasts) {
      if (shown.current.has(toast.id)) continue;
      shown.current.set(
        toast.id,
        UI.toast.show({ text: toast.text, kind: toast.kind, timeout: toast.kind === 'error' ? ERROR_TOAST_MS : TOAST_MS }),
      );
    }
    for (const [id, uiId] of shown.current) {
      if (live.has(id)) continue;
      shown.current.delete(id);
      UI.toast.dismiss(uiId);
    }
  }, [state.toasts]);

  const { confirm } = state;
  React.useEffect(() => {
    if (!confirm) return;
    return openConfirm(confirm);
  }, [confirm]);

  return null;
};

function openConfirm(confirm: ConfirmRequest): () => void {
  const text = document.createElement('p');
  text.textContent = confirm.text;
  text.style.whiteSpace = 'pre-line';
  text.style.margin = '0';
  let done = false;
  const win = UI.dialog.open({
    content: text,
    // Esc, подложка и крестик — отказ.
    onClose: () => {
      if (!done) confirm.resolve(false);
    },
    actions: [
      { label: confirm.cancelLabel, onClick: () => confirm.resolve(false) },
      { label: confirm.confirmLabel, kind: confirm.danger ? 'danger' : 'primary', onClick: () => confirm.resolve(true) },
    ],
  });
  return () => {
    done = true;
    win.close();
  };
}
