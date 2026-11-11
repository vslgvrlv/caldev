import React from 'react';
import { Row, Sheet, TeamMark, Icon } from '../../ui';
import type { TeamContext } from '../../types';
import { roleLabel } from '../../lib/labels';
import { teamCodeOf } from '../../lib/team-url';
import '../../shell/home.css';

export type TeamsPickerProps = {
  open: boolean;
  onClose: () => void;
  teams: TeamContext[];
  currentCode: string;
  onPickTeam: (team: TeamContext) => void;
};

/**
 * Выбор команды в разделах команды (состав, казна, журнал) и в профиле. Пункты
 * меню команды (заявки, журнал, открытое расписание) — строками на экране
 * команды, консоль владельца — в профиле; здесь их нет. На «Моё» и в
 * «Календаре» вместо этой шторки — фильтр команд (`TeamsFilter`).
 */
export const TeamsPicker: React.FC<TeamsPickerProps> = ({ open, onClose, teams, currentCode, onPickTeam }) => {
  const own = teams.filter((t) => t.via !== 'owner');
  const owner = teams.filter((t) => t.via === 'owner');
  const row = (t: TeamContext, hint: string) => {
    const active = teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }) === currentCode;
    return (
      <Row
        key={t.teamId}
        lead={<TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={40} />}
        title={t.teamName}
        sub={hint}
        trailing={active ? <Icon name="check" size={20} label="Текущая команда" /> : undefined}
        onClick={() => onPickTeam(t)}
        aria-current={active ? 'true' : undefined}
      />
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title="Команды">
      <div className="pbth-teams">
        {own.map((t) => row(t, roleLabel(t.role)))}
        {owner.length > 0 && (
          <>
            <div className="pbth-teams__label">Остальные команды: ты там как владелец платформы</div>
            {owner.map((t) => row(t, 'Как владелец'))}
          </>
        )}
      </div>
    </Sheet>
  );
};
