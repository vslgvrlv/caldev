import React from 'react';
import { Row, Sheet, TeamMark, Icon } from '../../ui';
import type { TeamContext } from '../../types';
import { roleLabel } from '../../lib/labels';
import { teamCodeOf } from '../../lib/team-url';
import '../../shell/home.css';

export type TeamsPickerItem = { id: string; label: string; to: string };

export type TeamsPickerProps = {
  open: boolean;
  onClose: () => void;
  teams: TeamContext[];
  currentCode: string;
  /** Пункты меню команды от треков (заявки, журнал, открытое расписание). */
  items: TeamsPickerItem[];
  onPickTeam: (team: TeamContext) => void;
  onPickItem: (to: string) => void;
};

/** Выбор команды и пункты меню команды: то, что раньше выпадало из названия команды в шапке. */
export const TeamsPicker: React.FC<TeamsPickerProps> = ({ open, onClose, teams, currentCode, items, onPickTeam, onPickItem }) => {
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
        {items.length > 0 && <div className="pbth-teams__label">Текущая команда</div>}
        {items.map((item) => (
          <Row key={item.id} title={item.label} chevron onClick={() => onPickItem(item.to)} />
        ))}
      </div>
    </Sheet>
  );
};
