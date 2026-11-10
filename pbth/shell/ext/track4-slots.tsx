import { Ticket } from 'lucide-react';
import type { ShellExtension } from '../extensions';
import { SlotsEventBlock } from '../../components/track4/SlotsEventBlock';
import { SlotsHeaderBadge } from '../../components/track4/SlotsHeaderBadge';
import { slotsPath } from '../../api/track4';
import { Role } from '../../types';

// Трек 4 «Открытые слоты» в оболочке команды:
//   - меню команды: «Открытое расписание» — включить, ссылка и QR для
//     подписки, число подписчиков (капитан и тренер);
//   - шапка: значок «Свободные слоты» — лента слотов команд, на которые я подписан;
//   - событие: блок «Свободные слоты» у капитана и тренера.
const ext: ShellExtension = {
  id: 'track4-slots',
  teamMenu: [
    {
      id: 'open-schedule',
      label: 'Открытое расписание',
      // Обёртка: тип иконки в `TeamMenuItem` уже, чем у lucide (size — только число).
      icon: (props: { size?: number; className?: string }) => <Ticket {...props} />,
      to: (ctx) => slotsPath.team(ctx.team.id),
      visible: (ctx) => ctx.role === Role.CAPTAIN || ctx.role === Role.TRAINER,
      order: 60,
    },
  ],
  headerBadges: [{ id: 'free-slots', Component: SlotsHeaderBadge, order: 60 }],
  eventBlocks: [
    {
      id: 'free-slots',
      Component: SlotsEventBlock,
      visible: (props) => props.viewerRole === Role.CAPTAIN || props.viewerRole === Role.TRAINER,
      order: 60,
    },
  ],
};

export default ext;
