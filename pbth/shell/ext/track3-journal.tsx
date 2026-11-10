import { ScrollText, Shield } from 'lucide-react';
import type { ShellExtension, TeamMenuItem } from '../extensions';

// Иконки lucide шире типа пункта меню (размер может быть строкой) — сужаем.
type MenuIcon = NonNullable<TeamMenuItem['icon']>;
import { teamPath } from '../../lib/team-url';
import { Role } from '../../types';

// Трек 3: журнал команды — капитану (и владельцу платформы, у него права
// капитана); консоль — владельцу. Владельца узнаём по списку команд: чужие
// команды с пометкой `via: 'owner'` сервер отдаёт только ему.
const ext: ShellExtension = {
  id: 'track3-owner',
  teamMenu: [
    {
      id: 'journal',
      label: 'Журнал команды',
      icon: ScrollText as MenuIcon,
      to: (ctx) => teamPath(ctx.teamCode, 'journal'),
      visible: (ctx) => ctx.role === Role.CAPTAIN,
      order: 60,
    },
    {
      id: 'console',
      label: 'Консоль владельца',
      icon: Shield as MenuIcon,
      to: () => '/admin',
      visible: (ctx) => ctx.teams.some((t) => t.via === 'owner'),
      order: 90,
    },
  ],
};

export default ext;
