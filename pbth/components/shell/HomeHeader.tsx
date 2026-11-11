import React from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Button, Glass, TeamMark } from '../../ui';
import type { TeamContext } from '../../types';
import { teamCodeOf } from '../../lib/team-url';
import '../../shell/home.css';

export type HomeHeaderProps = {
  title: string;
  /** Текущее время: подпись даты под названием. */
  now: number;
  teams: TeamContext[];
  currentCode: string;
  /** Тихая строка под датой: режим, в котором игрок смотрит команду («Владелец платформы»). */
  modeNote?: string;
  /** Значки справа (расширения шапки команды). */
  badges?: React.ReactNode;
  onPickTeam: (team: TeamContext) => void;
  onOpenTeams: () => void;
};

/** Стеклянная шапка главной: название, дата, ряд знаков команд игрока и кнопка выбора команд. */
/** Прокручивает ряд знаков так, чтобы текущая команда была видна целиком. */
export function scrollMarkIntoView(row: HTMLElement, mark: HTMLElement) {
  const left = mark.offsetLeft - row.offsetLeft;
  if (left < row.scrollLeft) row.scrollLeft = left;
  else if (left + mark.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + mark.offsetWidth - row.clientWidth;
}

export const HomeHeader: React.FC<HomeHeaderProps> = ({ title, now, teams, currentCode, modeNote, badges, onPickTeam, onOpenTeams }) => {
  const rowRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    const mark = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && mark) scrollMarkIntoView(row, mark);
  }, [currentCode, teams.length]);
  return (
  <Glass as="header" className="pbth-homebar">
    <div className="pbth-homebar__top">
      <div>
        <h1 className="pbth-homebar__title">{title}</h1>
        <div className="pbth-homebar__sub">{format(new Date(now), 'EEEEEE, d MMMM', { locale: ru })}</div>
      </div>
      <div className="pbth-homebar__tools">
        {badges}
        <Button variant="ghost" icon="sliders-horizontal" onClick={onOpenTeams}>
          Команды
        </Button>
      </div>
    </div>
    {modeNote && <div className="pbth-homebar__sub">{modeNote}</div>}
    {teams.length > 0 && (
      <div ref={rowRef} className="pbth-homebar__marks" role="list" aria-label="Команды">
        {teams.map((t) => {
          const current = teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }) === currentCode;
          return (
            <button
              key={t.teamId}
              type="button"
              role="listitem"
              className="pbth-homebar__mark"
              aria-current={current ? 'true' : undefined}
              aria-label={`Главная команды ${t.teamName}`}
              onClick={() => onPickTeam(t)}
            >
              <TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={40} />
            </button>
          );
        })}
      </div>
    )}
  </Glass>
);
};
