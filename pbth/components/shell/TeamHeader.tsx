import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { Team, TeamContext, User } from '../../types';
import { Avatar } from '../../ui';
import { roleLabel } from '../../lib/labels';
import { switchTeamPath, teamCodeOf } from '../../lib/team-url';
import { shellExtensions, type ShellExtContext } from '../../shell/extensions';

// Общая шапка экранов команды: кто я, какая команда, переключатель команд,
// пункты меню команды и значки от треков (pbth/shell/ext/). Смена команды
// меняет адрес и сохраняет раздел.

interface TeamHeaderProps {
  user: User;
  team: Team;
  teamCode: string;
  teams: TeamContext[];
}

export const TeamHeader: React.FC<TeamHeaderProps> = ({ user, team, teamCode, teams }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const ctx: ShellExtContext = { user, team, teamCode, role: team.role, teams };
  const menuItems = shellExtensions.teamMenu.filter((item) => !item.visible || item.visible(ctx));
  const badges = shellExtensions.headerBadges.filter((badge) => !badge.visible || badge.visible(ctx));
  const hasMultipleTeams = teams.length > 1;
  const canOpenMenu = hasMultipleTeams || menuItems.length > 0;
  // Владелец платформы видит все команды: сначала свои, потом остальные —
  // там он как владелец, в составе не числится (трек 3).
  const ownTeams = teams.filter((t) => t.via !== 'owner');
  const ownerTeams = teams.filter((t) => t.via === 'owner');
  const headerRole = team.via === 'owner' ? 'Владелец платформы' : roleLabel(team.role);

  React.useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActiveTeam = (t: TeamContext) => teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }) === teamCode;

  const switchTo = (target: TeamContext) => {
    setMenuOpen(false);
    const code = teamCodeOf({ teamId: target.teamId, shortCode: target.shortCode });
    if (code === teamCode) return;
    navigate(switchTeamPath(location.pathname, code));
  };

  return (
    <header
      className="relative z-30 flex justify-between items-center px-4 pb-1"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 1rem)' }}
    >
      <div className="flex items-center space-x-3 min-w-0">
        <Avatar name={user.name} src={user.avatar} size={40} />
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => canOpenMenu && setMenuOpen((v) => !v)}
            className="text-left min-w-0"
            aria-haspopup={canOpenMenu ? 'menu' : undefined}
            aria-expanded={canOpenMenu ? menuOpen : undefined}
            aria-label={hasMultipleTeams ? `Команда ${team.name}, сменить команду` : `Команда ${team.name}`}
          >
            <div className="flex items-center space-x-1 text-pb-subtext text-xs uppercase tracking-wide">
              <span>{team.shortCode}</span>
              <span className="w-1 h-1 bg-pb-primary rounded-full"></span>
              <span>{headerRole}</span>
            </div>
            <div className="flex items-center text-white font-bold text-lg">
              <span className="truncate">{team.name}</span>
              {canOpenMenu && (
                <ChevronDown
                  size={16}
                  className={`ml-1 shrink-0 text-pb-subtext transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                />
              )}
            </div>
          </button>

          {menuOpen && canOpenMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute left-0 top-full mt-2 z-40 w-64 rounded-xl bg-pb-surface border border-white/10 shadow-xl overflow-hidden"
              >
                {hasMultipleTeams && (
                  <div className="max-h-[60vh] overflow-y-auto">
                    {ownTeams.map((t) => (
                      <TeamOption key={t.teamId} team={t} active={isActiveTeam(t)} hint={roleLabel(t.role)} onPick={switchTo} />
                    ))}
                    {ownerTeams.length > 0 && (
                      <>
                        <div className="px-4 pt-3 pb-1 text-[11px] text-pb-subtext border-t border-white/10">
                          Остальные команды — ты там как владелец платформы
                        </div>
                        {ownerTeams.map((t) => (
                          <TeamOption key={t.teamId} team={t} active={isActiveTeam(t)} hint="Как владелец" onPick={switchTo} />
                        ))}
                      </>
                    )}
                  </div>
                )}
                {menuItems.length > 0 && (
                  <div className={hasMultipleTeams ? 'border-t border-white/10' : ''}>
                    {menuItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            navigate(item.to(ctx));
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-white hover:bg-white/5 transition-colors"
                        >
                          {Icon && <Icon size={16} className="text-pb-subtext" />}
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {badges.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          {badges.map(({ id, Component }) => (
            <Component key={id} {...ctx} />
          ))}
        </div>
      )}
    </header>
  );
};

const TeamOption: React.FC<{
  team: TeamContext;
  active: boolean;
  hint: string;
  onPick: (team: TeamContext) => void;
}> = ({ team, active, hint, onPick }) => (
  <button
    type="button"
    role="menuitemradio"
    aria-checked={active}
    onClick={() => onPick(team)}
    className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors ${active ? 'bg-white/5' : ''}`}
  >
    <div className="min-w-0">
      <div className="text-white font-semibold text-sm truncate">{team.teamName}</div>
      <div className="text-pb-subtext text-[11px]">{hint}</div>
    </div>
    {active && <Check size={16} className="text-pb-primary shrink-0" />}
  </button>
);
