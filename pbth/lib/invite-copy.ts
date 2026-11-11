import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { EVENT_LABELS } from '../constants';
import { pluralRu } from './plural';

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

/** «18 ноября» в заданном часовом поясе; битый или пустой пояс — пояс браузера. */
function dayMonthText(date: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: timeZone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  }
}

/**
 * «Приглашение действует до 18 ноября»; пусто, если срока нет. День — по поясу
 * команды, если он известен (он приходит только вместе с ближайшим событием),
 * иначе по поясу браузера.
 */
export function inviteValidUntil(expiresAt: string | null | undefined, timeZone?: string | null): string | null {
  const date = validDate(expiresAt);
  if (!date) return null;
  return `Приглашение действует до ${dayMonthText(date, timeZone)}`;
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
  return `${dayMonthText(date, timezone)} в ${time}`;
}

// Факты о команде на экранах приглашения и ближайшее событие в заявке. Поля
// необязательные: старый ответ сервера без них даёт `null`, и строки на экране
// просто нет. Название и место события сюда не входят: сервер их больше не
// шлёт, а из старого ответа они не читаются.

/**
 * Ближайшее событие для того, кто ещё не в команде: время, тип, пояс.
 * `startAt` — имя поля в старом ответе заявки; `title` и `location` старого
 * ответа не читаются.
 */
export type PublicEventInput = {
  startsAt?: string | null;
  startAt?: string | null;
  type?: string | null;
  timezone?: string | null;
};

export type InviteFactsInput = {
  membersCount?: number | null;
  nextEvent?: PublicEventInput | null;
};

/** «12 человек» и « в команде» отдельно: число выделяется. Нет числа — null. */
export function membersParts(count: number | null | undefined): { strong: string; rest: string } | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return null;
  return { strong: `${count} ${pluralRu(count, 'человек', 'человека', 'человек')}`, rest: ' в команде' };
}

/** Две строки ближайшего события: «Завтра в 19:00» и тип — «Тренировка». Без названия и места. */
export function nextEventLines(
  event: PublicEventInput | null | undefined,
  now: Date = new Date(),
): { when: string; details: string } | null {
  if (!event) return null;
  const when = eventWhenText(String(event.startsAt ?? event.startAt ?? ''), event.timezone, now);
  if (!when) return null;
  const type = (EVENT_LABELS as Record<string, string>)[String(event.type ?? '')] ?? '';
  return { when, details: type };
}
