import React from 'react';
import { Button, Glass, Icon, TeamMark } from '../../ui';
import '../../shell/home.css';

/** Все свои команды выключены в фильтре: спокойное пустое состояние вместо ленты и списка дня. */
export const AllTeamsHidden: React.FC<{ onShowAll: () => void }> = ({ onShowAll }) => (
  <Glass as="section" className="pbth-empty" aria-live="polite">
    <div className="pbth-empty__title">Все команды скрыты</div>
    <div className="pbth-empty__text">Включи нужные команды в ряду знаков сверху или покажи все сразу.</div>
    <div className="pbth-empty__actions">
      <Button icon="eye" onClick={onShowAll}>
        Показать все
      </Button>
    </div>
  </Glass>
);

export type RequestsNoticeItem = {
  id: string;
  teamId: string;
  teamName: string;
  shortCode?: string;
  text: string;
  onOpen: () => void;
};

/** Тихая стеклянная строка «<Команда>: N заявок ждут ответа» со стрелкой на экран заявок команды. */
export const RequestsNotice: React.FC<{ item: RequestsNoticeItem }> = ({ item }) => (
  <button type="button" className="ui-glass pbth-notice" onClick={item.onOpen}>
    <TeamMark teamId={item.teamId} name={item.teamName} code={item.shortCode} size={32} />
    <span className="pbth-notice__text">{item.text}</span>
    <Icon name="chevron-right" size={20} className="pbth-notice__chev" />
  </button>
);
