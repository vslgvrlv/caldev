// Даты для консоли и журнала: по-русски, без лишней точности.

import { pluralRu } from '../../lib/plural';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** «Сегодня», «Вчера», «12 ноября» (год — только если не текущий). */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  if (diff === -1) return 'Завтра';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function timeLabel(value: string | Date): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** «Сегодня в 20:30», «12 ноября в 20:30». */
export function dateTimeLabel(value: string | Date, now: Date = new Date()): string {
  return `${dayLabel(value, now)} в ${timeLabel(value)}`;
}

/** Давность для списка команд: «сегодня», «3 дня назад», «давно». */
export function sinceLabel(value: string | null, now: Date = new Date()): string {
  if (!value) return 'давно';
  const days = Math.round((startOfDay(now) - startOfDay(new Date(value))) / DAY_MS);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')} назад`;
  return 'больше года назад';
}

// Склонение — общий помощник фронта; имя `plural` сохранено для старых вызовов.
export { pluralRu as plural };

/** Записи журнала по дням, в порядке прихода (новые сверху). */
export function groupByDay<T extends { at: string }>(items: T[], now: Date = new Date()): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const day = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
