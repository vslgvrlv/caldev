import React from 'react';
import { createPortal } from 'react-dom';
import { UI, type DialogAction } from './uikit';

export type SheetProps = {
  open: boolean;
  /** Человек закрыл шторку (крестик, Esc, подложка, кнопка с `close`). */
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** Кнопки внизу: `{ label, kind: 'primary' | 'danger', onClick, close }`. */
  actions?: DialogAction[];
};

/**
 * Нижняя шторка: `UI.dialog` (на телефоне ui-kit сам прижимает окно к низу).
 * Содержимое — обычные React-дети, они вставляются в тело окна порталом.
 */
export const Sheet: React.FC<SheetProps> = ({ open, onClose, title, subtitle, children, actions }) => {
  const [body, setBody] = React.useState<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;

  React.useEffect(() => {
    if (!open) return;
    const host = document.createElement('div');
    let closedByUs = false;
    const win = UI.dialog.open({
      title,
      subtitle,
      content: host,
      actions: actionsRef.current,
      onClose: () => {
        if (!closedByUs) onCloseRef.current();
      },
    });
    setBody(host);
    return () => {
      closedByUs = true;
      setBody(null);
      win.close();
    };
  }, [open, title, subtitle]);

  return body ? createPortal(children, body) : null;
};
