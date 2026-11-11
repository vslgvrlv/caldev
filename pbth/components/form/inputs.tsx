import React from 'react';
import { groupMoney, sanitizeMoney } from '../../lib/money-input';

type Base = { id: string; error?: string; disabled?: boolean; placeholder?: string };

const describe = (id: string, error?: string) => (error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {});
const cls = (error?: string, extra = '') => `ui-input${error ? ' pbth-form__input--bad' : ''}${extra ? ` ${extra}` : ''}`;

export type TextInputProps = Base & {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  autoComplete?: string;
  onFocus?: () => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
};

/** Однострочное поле или, с `multiline`, область текста. Высота 44px. */
export const TextInput: React.FC<TextInputProps> = ({ id, value, onChange, error, multiline, rows = 3, ...rest }) =>
  multiline ? (
    <textarea
      id={id}
      className={cls(error, 'pbth-form__area')}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={rest.disabled}
      placeholder={rest.placeholder}
      {...describe(id, error)}
    />
  ) : (
    <input id={id} className={cls(error)} type="text" value={value} onChange={(e) => onChange(e.target.value)} {...rest} {...describe(id, error)} />
  );

export const DateInput: React.FC<Base & { value: string; onChange: (value: string) => void }> = ({ id, value, onChange, error, ...rest }) => (
  <input id={id} className={cls(error, 'pbth-form__native')} type="date" value={value} onChange={(e) => onChange(e.target.value)} {...rest} {...describe(id, error)} />
);

export const TimeInput: React.FC<Base & { value: string; onChange: (value: string) => void }> = ({ id, value, onChange, error, ...rest }) => (
  <input id={id} className={cls(error, 'pbth-form__native')} type="time" value={value} onChange={(e) => onChange(e.target.value)} {...rest} {...describe(id, error)} />
);

export type SelectOption = { value: string; label: string };

export const Select: React.FC<Base & { value: string; onChange: (value: string) => void; options: SelectOption[] }> = ({
  id,
  value,
  onChange,
  options,
  error,
  disabled,
}) => (
  <select id={id} className={`ui-select${error ? ' pbth-form__input--bad' : ''}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...describe(id, error)}>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

/** Сумма в рублях: разряды при вводе, знак ₽ справа. Значение наружу — строка цифр («1500» или «1500.5»). */
export const MoneyInput: React.FC<Base & { value: string; onChange: (raw: string) => void }> = ({ id, value, onChange, error, ...rest }) => (
  <div className="pbth-form__money">
    <input
      id={id}
      className={cls(error)}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={groupMoney(value)}
      onChange={(e) => onChange(sanitizeMoney(e.target.value))}
      {...rest}
      {...describe(id, error)}
    />
    <span className="pbth-form__rub" aria-hidden="true">
      {'₽'}
    </span>
  </div>
);
