import React from 'react';
import { Button } from './Button';

export type ScreenBarProps = {
  /** Есть — слева стрелка «Назад». */
  onBack?: () => void;
  backLabel?: string;
  /** Знак команды или аватар перед заголовком. */
  mark?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Справа: кнопки-значки (`Button variant="ghost" icon=…`). */
  actions?: React.ReactNode;
};

/** Шапка внутреннего экрана. */
export const ScreenBar: React.FC<ScreenBarProps> = ({ onBack, backLabel = 'Назад', mark, title, subtitle, actions }) => (
  <header className="pbth-screenbar">
    {onBack ? <Button variant="ghost" icon="arrow-left" aria-label={backLabel} onClick={onBack} /> : null}
    {mark ? <span className="pbth-screenbar__mark">{mark}</span> : null}
    <div className="pbth-screenbar__titles">
      <h1 className="pbth-screenbar__title">{title}</h1>
      {subtitle ? <div className="pbth-screenbar__sub">{subtitle}</div> : null}
    </div>
    {actions ? <div className="pbth-screenbar__actions">{actions}</div> : null}
  </header>
);
