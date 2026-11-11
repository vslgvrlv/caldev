import React from 'react';
import { subscribeNotify, type ConfirmRequest, type NotifyState } from '../../lib/notify';
import type { UiKitModule } from '../../ui/uikit';
import './notify-host.css';

const TOAST_MS = 4000;
const ERROR_TOAST_MS = 6000;

type Kit = UiKitModule;

// ui-kit тяжёлый (250 КБ), а сообщения нужны не сразу: модуль подгружается при первом сообщении,
// в основную связку он не входит.
let kitPromise: Promise<Kit> | null = null;
const loadKit = () => (kitPromise ||= import('../../ui/uikit').then((kit) => (kit.toast.configure({ closable: true }), kit)));

// Показывает сообщения из pbth/lib/notify.ts через ui-kit: плашки — UI.toast,
// подтверждение — UI.dialog. Сам ничего не рисует. Монтируется один раз в корне.
export const NotifyHost: React.FC = () => {
  const [state, setState] = React.useState<NotifyState>({ toasts: [], confirm: null });
  const [kit, setKit] = React.useState<Kit | null>(null);

  React.useEffect(() => subscribeNotify(setState), []);

  const needKit = state.toasts.length > 0 || state.confirm !== null;
  React.useEffect(() => {
    if (!needKit || kit) return;
    let alive = true;
    loadKit().then((loaded) => alive && setKit(loaded));
    return () => {
      alive = false;
    };
  }, [needKit, kit]);

  // Плашки: новая в состоянии — показать, исчезла из состояния — убрать.
  const shown = React.useRef(new Map<number, unknown>());
  React.useEffect(() => {
    if (!kit) return;
    const live = new Set(state.toasts.map((item) => item.id));
    for (const item of state.toasts) {
      if (shown.current.has(item.id)) continue;
      shown.current.set(
        item.id,
        kit.toast.show({ text: item.text, kind: item.kind, timeout: item.kind === 'error' ? ERROR_TOAST_MS : TOAST_MS }),
      );
      // Плашка — жидкое стекло ui-kit (класс ставится на готовую плашку: у UI.toast нет опции класса).
      document.querySelectorAll('.ui-toast:not(.ui-lglass)').forEach((el) => el.classList.add('ui-lglass'));
    }
    for (const [id, uiId] of shown.current) {
      if (live.has(id)) continue;
      shown.current.delete(id);
      kit.toast.dismiss(uiId);
    }
  }, [kit, state.toasts]);

  const { confirm } = state;
  React.useEffect(() => {
    if (!confirm || !kit) return;
    return openConfirm(kit, confirm);
  }, [kit, confirm]);

  return null;
};

function openConfirm(kit: Kit, confirm: ConfirmRequest): () => void {  // ui-kit-allow: обёртка над UI.dialog, а не своё окно
  const text = document.createElement('p');
  text.textContent = confirm.text;
  text.style.whiteSpace = 'pre-line';
  text.style.margin = '0';
  let done = false;
  const win = kit.dialog.open({
    // Стекло ui-kit, как у шторок (ui/Sheet).
    className: 'ui-lglass pbth-sheet',
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
