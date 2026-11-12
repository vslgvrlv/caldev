import React from 'react';
import { Row, Sheet, TeamMark } from '../../ui';
import type { TeamContext } from '../../types';
import { roleLabel } from '../../lib/labels';
import '../../shell/home.css';

export type CreateTeamPickerProps = {
  open: boolean;
  onClose: () => void;
  /** Команды, где я могу создавать события. */
  teams: TeamContext[];
  onPick: (team: TeamContext) => void;
};

/** «Плюс» на «Моё» и в «Календаре», когда команд с правом создавать больше одной: сначала команда, потом форма. */
export const CreateTeamPicker: React.FC<CreateTeamPickerProps> = ({ open, onClose, teams, onPick }) => (
  <Sheet open={open} onClose={onClose} title="Новое событие" subtitle="В какой команде?">
    <div className="pbth-teams">
      {teams.map((t) => (
        <Row
          key={t.teamId}
          lead={<TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={40} />}
          title={t.teamName}
          sub={roleLabel(t.role)}
          chevron
          onClick={() => onPick(t)}
        />
      ))}
    </div>
  </Sheet>
);
