import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Event } from '../types';
import { dayKey } from './home-feed';
import { sortEventsByStart } from './events';
import { pluralRu } from './plural';

// Чистая логика экрана календаря: точки под числами, события выбранного дня,
// заголовок дня, краски фона. Отрисовка — в views/CalendarView.tsx.

export { dayKey as isoOfDate };

/** ISO-дата `2026-11-14` в местной дате; битая строка — null. */
export function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Краски под числами по дням: одна на команду, в порядке начала событий.
 * Больше трёх сетка ui-kit сама сворачивает в «+», поэтому отдаём все.
 */
export function calendarMarks(events: Event[], paintOf: (teamId: string) => string): Record<string, string[]> {
  const marks: Record<string, string[]> = {};
  for (const event of sortEventsByStart(events)) {
    const key = dayKey(event.startDate);
    const list = marks[key] ?? (marks[key] = []);
    const paint = paintOf(event.teamId);
    if (!list.includes(paint)) list.push(paint);
  }
  return marks;
}

/** События выбранного дня по времени начала. */
export function eventsOfDay(events: Event[], iso: string): Event[] {
  return sortEventsByStart(events.filter((event) => dayKey(event.startDate) === iso));
}

const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Над панелью дня: «Суббота» и справа «14 ноября · 2 события». */
export function calendarDayHeading(date: Date, count: number): { title: string; sub: string } {
  const countText = count > 0 ? ` · ${count} ${pluralRu(count, 'событие', 'события', 'событий')}` : '';
  return {
    title: capitalize(format(date, 'EEEE', { locale: ru })),
    sub: `${format(date, 'd MMMM', { locale: ru })}${countText}`,
  };
}

/**
 * Краски фона: команды событий показанного месяца. Первой идёт команда ближайшего
 * к `now` предстоящего события, затем остальные по возрастанию; без повторов, до трёх.
 * Прошедшие события месяца идут после предстоящих, чтобы фон не пустовал.
 */
export function monthPaints(
  events: Event[],
  year: number,
  month: number,
  now: number,
  paintOf: (teamId: string) => string,
): string[] {
  const inMonth = sortEventsByStart(events).filter(
    (event) => event.startDate.getFullYear() === year && event.startDate.getMonth() + 1 === month,
  );
  const upcoming = inMonth.filter((event) => event.startDate.getTime() >= now);
  const past = inMonth.filter((event) => event.startDate.getTime() < now).reverse();
  const result: string[] = [];
  for (const event of [...upcoming, ...past]) {
    const paint = paintOf(event.teamId);
    if (!result.includes(paint)) result.push(paint);
    if (result.length === 3) break;
  }
  return result;
}
