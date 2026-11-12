import React from 'react';
import { Icon, Seg, Sheet, Switch, TeamMark, teamPaint } from '../../ui';
import type { TeamContext } from '../../types';
import { roleLabel } from '../../lib/labels';
import { filterGroups, playingTeamIds, quickPick, showAll, showOnly, type HiddenTeams } from '../../lib/team-filter';
import '../../shell/home.css';

export type TeamsFilterProps = {
  open: boolean;
  onClose: () => void;
  /** Свои команды (членство). */
  teams: TeamContext[];
  hidden: HiddenTeams;
  onSetShown: (teamId: string, shown: boolean) => void;
  onSetHidden: (next: HiddenTeams) => void;
  /** «Открыть команду» — экран этой команды. */
  onOpenTeam: (team: TeamContext) => void;
};

const QUICK = [
  { value: 'all', label: 'Все' },
  { value: 'playing', label: 'Играю' },
];

/**
 * Шторка «Команды» на «Моё» и в «Календаре» (макет moe-filter): быстрый выбор
 * «Все · Играю», ниже команды группами по моей роли. У каждой — знак, название,
 * роль, выключатель показа в цвете краски команды и отдельная область
 * «Открыть команду» со стрелкой. Пункты меню команды (заявки, журнал,
 * открытое расписание) живут строками на экране команды, здесь их нет.
 */
export const TeamsFilter: React.FC<TeamsFilterProps> = ({ open, onClose, teams, hidden, onSetShown, onSetHidden, onOpenTeam }) => {
  const groups = filterGroups(teams);
  const pick = quickPick(hidden, teams);
  const onPick = React.useCallback(
    (value: string) => {
      if (value === 'all') onSetHidden(showAll());
      else if (value === 'playing') onSetHidden(showOnly(teams, playingTeamIds(teams)));
    },
    [onSetHidden, teams],
  );
  return (
    <Sheet open={open} onClose={onClose} title="Команды">
      <div className="pbth-tfilter">
        {/* Ручной набор — ни один сегмент не отмечен; сегменты ui-kit пустое значение не принимают, поэтому строим заново. */}
        <Seg key={pick || 'none'} items={QUICK} value={pick} onChange={onPick} label="Какие команды показывать" fill />
        {groups.map((group) => (
          <section key={group.id} className="pbth-tfilter__group" aria-label={group.title}>
            <div className="pbth-tfilter__head">
              <span className="pbth-tfilter__title">{group.title}</span>
              <span className="pbth-tfilter__count">{group.teams.length}</span>
            </div>
            {group.teams.map((t) => {
              const shown = !hidden.has(t.teamId);
              return (
                <div key={t.teamId} className="pbth-tfilter__row">
                  <button
                    type="button"
                    className="pbth-tfilter__open"
                    aria-label={`Открыть команду ${t.teamName}`}
                    onClick={() => onOpenTeam(t)}
                  >
                    <TeamMark teamId={t.teamId} name={t.teamName} code={t.shortCode} size={40} />
                    <span className="pbth-tfilter__main">
                      <span className="pbth-tfilter__name">{t.teamName}</span>
                      <span className="pbth-tfilter__role">{roleLabel(t.role).toLowerCase()}</span>
                    </span>
                    <Icon name="chevron-right" size={20} className="pbth-tfilter__chev" />
                  </button>
                  <span className="pbth-tfilter__switch" style={{ ['--ui-switch-on' as string]: teamPaint(t.teamId) }}>
                    <Switch checked={shown} onChange={(next) => onSetShown(t.teamId, next)} label={`Показывать события команды ${t.teamName}`} />
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </Sheet>
  );
};
