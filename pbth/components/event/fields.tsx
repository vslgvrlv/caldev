import React from 'react';
import { Button } from '../../ui';

/** Поле формы окна: подпись ui-kit и элемент под ней. */
export const Field: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({ label, htmlFor, children }) => (
  <div className="pbth-event__field">
    <label className="ui-label" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
  </div>
);

/** Низ окна: «Отмена» и главное действие. */
export const SheetFooter: React.FC<{
  cancelLabel?: string;
  onCancel: () => void;
  submitLabel?: string;
  onSubmit?: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Кнопка отправки формы (`type=submit`) вместо onClick. */
  submit?: boolean;
}> = ({ cancelLabel = 'Отмена', onCancel, submitLabel, onSubmit, busy, disabled, submit }) => (
  <div className="pbth-event__footer">
    <Button variant="glass2" disabled={busy} onClick={onCancel}>
      {cancelLabel}
    </Button>
    {submitLabel ? (
      <Button variant="primary" type={submit ? 'submit' : 'button'} disabled={busy || disabled} onClick={submit ? undefined : onSubmit}>
        {submitLabel}
      </Button>
    ) : null}
  </div>
);
