import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { homePaints, pickHomeEvents } from '../lib/home-feed';
import { rosterHeadline } from '../lib/team-roster';
import { parseTeamPath, switchTeamPath, teamPath } from '../lib/team-url';
import type { Event, Team, TeamContext } from '../types';

// Шапка раздела оболочки (принятый макет 11.11): стеклянная панель с крупным
// названием экрана, подписью, кнопкой «Команды» и рядом знаков команд.
// Здесь — чистая логика шапки: какие разделы её получают, что в ней написано,
// какие краски у фона раздела, куда ведёт знак команды.

/** Разделы команды со стеклянной шапкой оболочки. Заявки, событие, новое событие, карточка игрока — со своей шапкой «назад». */
const HEAD_SECTIONS = new Set(['', 'calendar', 'roster', 'money', 'journal']);

export function hasSectionHead(pathname: string): boolean {
  if (pathname === '/me') return true;
  const parsed = parseTeamPath(pathname);
  if (!parsed) return false;
  return HEAD_SECTIONS.has(parsed.section) && parsed.rest.length === 0;
}

export type SectionHeadText = { title: string; subtitle?: string };

/** Заголовок и подпись шапки раздела. */
export function sectionHeadText(
  pathname: string,
  input: { now: number; team?: Pick<Team, 'name' | 'role' | 'via'> | null; membersCount?: number },
): SectionHeadText {
  const { now, team } = input;
  if (pathname === '/me') return { title: 'Профиль' };
  const section = parseTeamPath(pathname)?.section ?? '';
  const day = format(new Date(now), 'EEEEEE, d MMMM', { locale: ru });
  switch (section) {
    case '':
      // Экран показывает события всех команд игрока — поэтому «Моё», а не «Главная».
      return { title: 'Моё', subtitle: day };
    case 'calendar':
      return { title: 'Календарь', subtitle: format(new Date(now), 'LLLL yyyy', { locale: ru }) };
    case 'roster':
      return {
        title: team?.name || 'Команда',
        subtitle: team ? rosterHeadline(input.membersCount ?? 0, team.role, team.via) : undefined,
      };
    case 'money':
      return { title: 'Казна', subtitle: team?.name };
    case 'journal':
      return { title: team?.name || 'Команда', subtitle: 'журнал команды' };
    default:
      return { title: team?.name || '' };
  }
}

/**
 * Краски фона раздела: три пятна (сверху, ниже слева, в углу).
 * «Моё» — команды ближайших событий (первая — ближайшего), календарь и
 * разделы команды — краска текущей команды, профиль — краски своих команд.
 * Если красок меньше трёх, второе пятно повторяет первое: у одной команды
 * фон остаётся в её цвете, как в макете экрана команды.
 */
export function sectionPaints(
  pathname: string,
  input: { now: number; events: Event[]; team?: Pick<Team, 'id'> | null; teams: TeamContext[]; paintOf: (teamId: string) => string },
): string[] {
  const { events, team, teams, paintOf, now } = input;
  let list: string[] = [];
  const section = pathname === '/me' ? 'me' : parseTeamPath(pathname)?.section ?? '';
  if (section === '') {
    const { hero, rest } = pickHomeEvents(events, now);
    list = homePaints(hero ? [hero, ...rest] : rest, paintOf);
    if (list.length === 0 && team) list = [paintOf(team.id)];
  } else if (section === 'me') {
    for (const t of teams.filter((x) => x.via !== 'owner')) {
      const p = paintOf(t.teamId);
      if (!list.includes(p)) list.push(p);
      if (list.length === 3) break;
    }
  } else if (team) {
    list = [paintOf(team.id)];
  }
  if (list.length === 0) return [];
  if (list.length === 1) return [list[0], list[0]];
  return list.slice(0, 3);
}

/** Куда ведёт знак команды в шапке: тот же раздел другой команды; из профиля — на «Моё» команды. */
export function markTarget(pathname: string, code: string): string {
  if (!parseTeamPath(pathname)) return teamPath(code);
  return switchTeamPath(pathname, code);
}

/**
 * Помещается ли строка шапки: название слева, справа значки и «Команды».
 * Не помещается — «Команды» становится значком без подписи (`true`).
 * `labelWidth` — сколько добавляет подпись «Команды» к значку.
 */
export function shouldCompact(m: { rowWidth: number; titleWidth: number; toolsWidth: number; labelWidth: number; compact: boolean; gap?: number }): boolean {
  const gap = m.gap ?? 12;
  const fullTools = m.toolsWidth + (m.compact ? m.labelWidth : 0);
  return Math.ceil(m.titleWidth) + gap + Math.ceil(fullTools) > Math.floor(m.rowWidth);
}

export type TeamScreenRow = { id: string; label: string; to: string; icon: string };

/** Значки строк меню команды на экране команды (ui-kit, набор Lucide). */
const MENU_ICONS: Record<string, string> = {
  journal: 'history',
  'open-schedule': 'calendar-days',
};

/**
 * Пункты меню команды строками на экране команды. «Заявки» там уже есть своей
 * строкой с числом, «Консоль владельца» живёт в профиле — их не повторяем.
 */
export function teamScreenRows(items: Array<{ id: string; label: string; to: string }>): TeamScreenRow[] {
  return items
    .filter((item) => item.id !== 'requests' && item.id !== 'console')
    .map((item) => ({ ...item, icon: MENU_ICONS[item.id] ?? 'list' }));
}
