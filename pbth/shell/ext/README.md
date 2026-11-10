# Расширения оболочки

Файл `<трек>-<что>.tsx` с экспортом по умолчанию типа `ShellExtension`
(`pbth/shell/extensions.ts`). Оболочка подхватывает все `*.ts`/`*.tsx` этой папки
сама, общие файлы править не нужно.

```tsx
import { Inbox } from 'lucide-react';
import type { ShellExtension } from '../extensions';
import { teamPath } from '../../lib/team-url';

const ext: ShellExtension = {
  id: 'track1-requests',
  teamMenu: [{
    id: 'requests',
    label: 'Заявки',
    icon: Inbox,
    to: (ctx) => teamPath(ctx.teamCode, 'requests'),
    visible: (ctx) => ctx.role === 'CAPTAIN' || ctx.role === 'TRAINER',
  }],
  // headerBadges: [{ id, Component }]   — значок справа в шапке команды
  // eventBlocks: [{ id, Component }]    — блок на экране события
};
export default ext;
```
