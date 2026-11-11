import React from 'react';
import { Icon, Switch } from '../../ui';
import '../../views/team/team.css';

/** Строка настройки с выключателем ui-kit. Нажатие по строке переключает так же, как по самому выключателю. */
export const SwitchRow: React.FC<{
  icon: string;
  title: string;
  sub?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}> = ({ icon, title, sub, checked, disabled, onChange, testId }) => (
  <label className="pbth-switchrow" data-testid={testId}>
    <span className="pbth-iconlead ui-glass2">
      <Icon name={icon} />
    </span>
    <span className="pbth-switchrow__main">
      <span className="pbth-switchrow__title">{title}</span>
      {sub ? <span className="pbth-switchrow__sub">{sub}</span> : null}
    </span>
    <Switch checked={checked} disabled={disabled} onChange={onChange} label={title} />
  </label>
);
