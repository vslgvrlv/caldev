import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { Team, TeamContext, User } from '../../types';
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

  React.useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

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
        <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-pb-primary to-blue-500 p-[2px]">
          <img
            src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=0F0F0F&color=fff`}
            alt=""
            className="w-full h-full rounded-full object-cover border-2 border-pb-background"
          />
        </div>
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
              <span>{roleLabel(team.role)}</span>
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
                {hasMultipleTeams &&
                  teams.map((t) => {
                    const isActive = teamCodeOf({ teamId: t.teamId, shortCode: t.shortCode }) === teamCode;
                    return (
                      <button
                        key={t.teamId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        onClick={() => switchTo(t)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors ${isActive ? 'bg-white/5' : ''}`}
                      >
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-sm truncate">{t.teamName}</div>
                          <div className="text-pb-subtext text-[11px]">{roleLabel(t.role)}</div>
                        </div>
                        {isActive && <Check size={16} className="text-pb-primary shrink-0" />}
                      </button>
                    );
                  })}
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
