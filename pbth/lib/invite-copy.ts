import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

// Тексты экранов приглашения и заявки: даты словами, без времени и секунд там,
// где оно не нужно. Чистые функции — проверяются в vitest.

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat('sv-SE').format(date);
  }
}

function shiftDay(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** «Приглашение действует до 18 ноября»; пусто, если срока нет. */
export function inviteValidUntil(expiresAt: string | null | undefined): string | null {
  const date = validDate(expiresAt);
  if (!date) return null;
  return `Приглашение действует до ${format(date, 'd MMMM', { locale: ru })}`;
}

/** «Заявка отправлена сегодня» / «вчера» / «18 ноября». */
export function requestSentText(createdAt: string | null | undefined, now: Date = new Date()): string {
  const date = validDate(createdAt);
  if (!date) return 'Заявка отправлена';
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Заявка отправлена сегодня';
  if (key === dayKey(shiftDay(now, -1))) return 'Заявка отправлена вчера';
  return `Заявка отправлена ${format(date, 'd MMMM', { locale: ru })}`;
}

/** «Завтра в 19:00» / «Сегодня в 19:00» / «18 ноября в 19:00» — по часовому поясу события. */
export function eventWhenText(startAt: string, timezone: string | null | undefined, now: Date = new Date()): string {
  const date = validDate(startAt);
  if (!date) return '';
  let time: string;
  try {
    time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone || undefined }).format(date);
  } catch {
    time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  const key = dayKey(date, timezone || undefined);
  if (key === dayKey(now, timezone || undefined)) return `Сегодня в ${time}`;
  if (key === dayKey(shiftDay(now, 1), timezone || undefined)) return `Завтра в ${time}`;
  return `${format(date, 'd MMMM', { locale: ru })} в ${time}`;
}

/** Вторая строка ближайшего события: «Тренировка · Арена». */
export function eventDetailsText(title: string, location: string | null | undefined): string {
  return location ? `${title} · ${location}` : title;
}
