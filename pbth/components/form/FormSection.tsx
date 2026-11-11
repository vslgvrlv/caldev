import React from 'react';
import { Glass } from '../../ui';

/** Стеклянная панель формы с заголовком. */
export const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Glass as="section" className="pbth-form__section" aria-label={title}>
    <h2 className="pbth-form__title">{title}</h2>
    <div className="pbth-form__body">{children}</div>
  </Glass>
);
