import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BottomNav, type BottomNavItem } from '../../ui';
import { parseTeamPath, teamPath } from '../../lib/team-url';
import '../../shell/home.css';

export type ShellNavProps = {
  /** Команда, в разделы которой ведёт панель. Нет команды — только профиль. */
  teamCode: string | null;
  /** Центральное действие «плюс» (создать событие): только тем, кому это сейчас доступно. */
  canCreate?: boolean;
  /** Своё действие «плюса» (выбор команды на «Моё» и в «Календаре»); без него — форма команды панели. */
  onCreate?: () => void;
};

/**
 * Пункты панели как в принятом макете: «Моё», «Календарь», «Команды», «Профиль»;
 * «плюс» ставится между ними. Листа «Ещё» нет: «Казна» — строкой на экране команды
 * и в меню события, пункты меню команды — строками на экране команды и в «Командах».
 */
export function shellNavItems(teamCode: string | null): BottomNavItem[] {
  const me: BottomNavItem = { href: '/me', label: 'Профиль', icon: 'user' };
  if (!teamCode) return [me];
  return [
    { href: teamPath(teamCode), label: 'Моё', icon: 'house' },
    { href: teamPath(teamCode, 'calendar'), label: 'Календарь', icon: 'calendar' },
    { href: teamPath(teamCode, 'roster'), label: 'Команды', icon: 'users' },
    me,
  ];
}

/** Разделы команды, которые подсвечивают «Команды»: состав, казна, заявки, журнал. */
const TEAM_SECTIONS = new Set(['roster', 'money', 'requests', 'journal']);

/**
 * Адрес для подсветки пункта. ui-kit сопоставляет по префиксу, и любой раздел подсвечивал бы «Моё»:
 * разделы команды подсвечивают «Команды», экран события и новое событие — ничего.
 */
export function navActivePath(pathname: string): string {
  const parsed = parseTeamPath(pathname);
  if (!parsed) return pathname;
  if (parsed.section === '' || parsed.section === 'calendar') return pathname;
  if (TEAM_SECTIONS.has(parsed.section) && !(parsed.section === 'roster' && parsed.rest.length > 0)) {
    return teamPath(parsed.team, 'roster');
  }
  return '/-';
}

/** Плавающая стеклянная нижняя панель оболочки: пункты команды, профиль и «плюс». */
export const ShellNav: React.FC<ShellNavProps> = ({ teamCode, canCreate, onCreate }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = React.useMemo(() => shellNavItems(teamCode), [teamCode]);
  const onCreateRef = React.useRef(onCreate);
  onCreateRef.current = onCreate;
  const action = React.useMemo(
    () =>
      canCreate && teamCode
        ? {
            label: 'Создать событие',
            onClick: () => (onCreateRef.current ? onCreateRef.current() : navigate(teamPath(teamCode, 'new'))),
          }
        : undefined,
    [canCreate, teamCode, navigate],
  );

  // Набор пунктов и «плюс» ui-kit задаёт при появлении, поэтому при смене команды или права панель строится заново.
  return <BottomNav key={`${teamCode ?? ''}|${action ? 1 : 0}`} items={items} path={navActivePath(pathname)} action={action} onNavigate={navigate} />;
};
