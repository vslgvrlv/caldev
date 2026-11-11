import React from 'react';

export type FieldProps = {
  label: string;
  htmlFor?: string;
  /** Пояснение под полем. */
  hint?: string;
  /** Ошибка проверки у поля. */
  error?: string;
  children: React.ReactNode;
};

/** Поле формы: подпись обычным регистром, элемент, подсказка или ошибка. */
export const Field: React.FC<FieldProps> = ({ label, htmlFor, hint, error, children }) => (
  <div className="pbth-form__field">
    <label className="ui-label" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {error ? (
      <div className="pbth-form__error" role="alert" id={htmlFor ? `${htmlFor}-error` : undefined}>
        {error}
      </div>
    ) : hint ? (
      <div className="pbth-form__hint">{hint}</div>
    ) : null}
  </div>
);
