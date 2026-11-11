import React from 'react';

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Подпись для скринридера, если рядом нет видимой. */
  label?: string;
  id?: string;
};

/** Выключатель ui-kit: `input.ui-switch`, состояние читает сам чекбокс. */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled, label, id }) => (
  <input
    id={id}
    className="ui-switch"
    type="checkbox"
    role="switch"
    checked={checked}
    disabled={disabled}
    aria-label={label}
    onChange={(e) => onChange(e.currentTarget.checked)}
  />
);
