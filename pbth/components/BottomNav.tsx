import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Calendar, Users, User, Wallet } from 'lucide-react';
import { parseTeamPath, teamPath } from '../lib/team-url';

interface BottomNavProps {
  /** Команда, в разделы которой ведёт навигация. Нет команды — только профиль. */
  teamCode: string | null;
}

type NavKey = 'home' | 'calendar' | 'money' | 'roster' | 'me';

function activeKey(pathname: string): NavKey | null {
  if (pathname === '/me') return 'me';
  const parsed = parseTeamPath(pathname);
  if (!parsed) return null;
  switch (parsed.section) {
    case '':
      return 'home';
    case 'calendar':
      return 'calendar';
    case 'money':
      return 'money';
    case 'roster':
      return 'roster';
    default:
      return null;
  }
}

export const BottomNav: React.FC<BottomNavProps> = ({ teamCode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const current = activeKey(location.pathname);

  const NavItem = ({ navKey, to, icon: Icon, label }: { navKey: NavKey; to: string | null; icon: any; label: string }) => {
    const isActive = current === navKey;
    return (
      <button
        type="button"
        disabled={!to}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
          if (!to || location.pathname === to) return;
          navigate(to);
        }}
        className={`flex flex-col items-center justify-center w-full space-y-1 ${isActive ? 'text-pb-primary' : 'text-pb-subtext'} active:scale-95 transition-transform disabled:opacity-40`}
      >
        <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
        <span className="text-[10px] font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-pb-background/90 backdrop-blur-xl border-t border-white/10 pb-safe pt-2 px-2 z-40 h-[85px]">
      <nav className="max-w-md mx-auto h-full grid grid-cols-5 items-start pt-2" aria-label="Разделы">
        <NavItem navKey="home" to={teamCode ? teamPath(teamCode) : null} icon={Home} label="Главная" />
        <NavItem navKey="calendar" to={teamCode ? teamPath(teamCode, 'calendar') : null} icon={Calendar} label="Календарь" />
        <NavItem navKey="money" to={teamCode ? teamPath(teamCode, 'money') : null} icon={Wallet} label="Казна" />
        <NavItem navKey="roster" to={teamCode ? teamPath(teamCode, 'roster') : null} icon={Users} label="Команда" />
        <NavItem navKey="me" to="/me" icon={User} label="Профиль" />
      </nav>
    </div>
  );
};
