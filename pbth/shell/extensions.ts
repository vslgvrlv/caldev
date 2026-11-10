import type { ComponentType } from 'react';
import type { Event, Role, Team, TeamContext, User } from '../types';

// Места для треков второй волны (спека ревизии, «Места для треков»).
//
// Трек не правит общие файлы. Он кладёт файл в `pbth/shell/ext/<имя>.tsx` с
// экспортом по умолчанию типа `ShellExtension` — оболочка соберёт его сама:
//   - `teamMenu`     — пункты меню команды (выпадает из названия команды в шапке);
//   - `headerBadges` — значки справа в шапке команды;
//   - `eventBlocks`  — блоки на экране события (ниже явки, выше сбора).
// Порядок — по `order` (меньше — выше), затем по имени файла.

export type ShellExtContext = {
  user: User;
  team: Team;
  /** Код команды в адресе: `teamPath(teamCode, 'requests')`. */
  teamCode: string;
  role: Role;
  teams: TeamContext[];
};

export type TeamMenuItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Адрес пункта; обычно `teamPath(ctx.teamCode, '<раздел>')`. */
  to: (ctx: ShellExtContext) => string;
  visible?: (ctx: ShellExtContext) => boolean;
  order?: number;
};

export type HeaderBadge = {
  id: string;
  Component: ComponentType<ShellExtContext>;
  visible?: (ctx: ShellExtContext) => boolean;
  order?: number;
};

export type EventBlockProps = ShellExtContext & {
  event: Event;
  /** Роль смотрящего в команде события. */
  viewerRole: Role;
  /** Перечитать данные команды после действия в блоке. */
  reload: () => Promise<void>;
};

export type EventBlock = {
  id: string;
  Component: ComponentType<EventBlockProps>;
  visible?: (props: EventBlockProps) => boolean;
  order?: number;
};

export type ShellExtension = {
  id: string;
  teamMenu?: TeamMenuItem[];
  headerBadges?: HeaderBadge[];
  eventBlocks?: EventBlock[];
};

type ExtModule = { default?: ShellExtension };

function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.order ?? 100) - (b.item.order ?? 100) || a.index - b.index)
    .map(({ item }) => item);
}

/** Собирает расширения из модулей; вынесено ради тестов. */
export function collectExtensions(modules: Record<string, ExtModule>) {
  const extensions = Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((ext): ext is ShellExtension => Boolean(ext && typeof ext === 'object'));
  return {
    extensions,
    teamMenu: byOrder(extensions.flatMap((ext) => ext.teamMenu ?? [])),
    headerBadges: byOrder(extensions.flatMap((ext) => ext.headerBadges ?? [])),
    eventBlocks: byOrder(extensions.flatMap((ext) => ext.eventBlocks ?? [])),
  };
}

const modules = import.meta.glob<ExtModule>('./ext/*.{ts,tsx}', { eager: true });

export const shellExtensions = collectExtensions(modules);
