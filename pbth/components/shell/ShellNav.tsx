import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BottomNav, type BottomNavItem } from '../../ui';
import { teamPath } from '../../lib/team-url';
import '../../shell/home.css';

export type ShellNavProps = {
  /** Команда, в разделы которой ведёт панель. Нет команды — только профиль. */
  teamCode: string | null;
  /** Центральное действие «плюс» (создать событие): только тем, кому это сейчас доступно. */
  canCreate?: boolean;
};

export function shellNavItems(teamCode: string | null): BottomNavItem[] {
  const me: BottomNavItem = { href: '/me', label: 'Профиль', icon: 'user' };
  if (!teamCode) return [me];
  return [
    { href: teamPath(teamCode), label: 'Главная', icon: 'house' },
    { href: teamPath(teamCode, 'calendar'), label: 'Календарь', icon: 'calendar' },
    { href: teamPath(teamCode, 'roster'), label: 'Команда', icon: 'users' },
    me,
    // Пятый пункт уходит в «Ещё».
    { href: teamPath(teamCode, 'money'), label: 'Казна', icon: 'wallet', more: true },
  ];
}

/** Плавающая стеклянная нижняя панель оболочки: пункты команды, профиль и «плюс». */
export const ShellNav: React.FC<ShellNavProps> = ({ teamCode, canCreate }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = React.useMemo(() => shellNavItems(teamCode), [teamCode]);
  const action = React.useMemo(
    () =>
      canCreate && teamCode
        ? { label: 'Создать событие', onClick: () => navigate(teamPath(teamCode, 'new')) }
        : undefined,
    [canCreate, teamCode, navigate],
  );

  // Лист «Ещё» ui-kit сам не закрывается после перехода по ссылке в нём.
  React.useEffect(() => {
    document.querySelector('.ui-sidenav-more')?.setAttribute('hidden', '');
  }, [pathname]);

  // Набор пунктов и «плюс» ui-kit задаёт при появлении, поэтому при смене команды или права панель строится заново.
  return <BottomNav key={`${teamCode ?? ''}|${action ? 1 : 0}`} items={items} path={pathname} action={action} onNavigate={navigate} />;
};
