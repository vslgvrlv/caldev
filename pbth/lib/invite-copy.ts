import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { EVENT_LABELS } from '../constants';
import { roleLabel } from './labels';
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

/** Вторая строка ближайшего события: «Тренировка · Арена». */
export function eventDetailsText(title: string, location: string | null | undefined): string {
  return location ? `${title} · ${location}` : title;
}

// Факты о команде на экранах приглашения. Поля необязательные: старый ответ
// сервера без них даёт `null`, и строки на экране просто нет. Название и место
// события сюда не входят: сервер их больше не шлёт, а из старого ответа они не
// читаются.

export type InviteFactsInput = {
  inviter?: { name?: string | null } | null;
  membersCount?: number | null;
  nextEvent?: { startsAt: string; type?: string | null; timezone?: string | null } | null;
};

const INVITED_AS: Record<string, string> = { CAPTAIN: 'капитаном', TRAINER: 'тренером', PLAYER: 'игроком' };

/** Имя того, кто зовёт; пусто, если сервер его не прислал. */
export function inviterName(facts: InviteFactsInput | null | undefined): string | null {
  const name = String(facts?.inviter?.name ?? '').trim();
  return name || null;
}

/** «Капитан · зовёт тебя игроком»; без роли зовущего — «Зовёт тебя игроком». */
export function inviterSubText(inviterRole: string | null | undefined, invitedRole: string | null | undefined): string {
  const as = INVITED_AS[String(invitedRole ?? '').toUpperCase()] ?? 'в команду';
  const call = `зовёт тебя ${as}`;
  return inviterRole ? `${roleLabel(inviterRole)} · ${call}` : `${call[0].toUpperCase()}${call.slice(1)}`;
}

/** «12 человек» и « в команде» отдельно: число выделяется. Нет числа — null. */
export function membersParts(count: number | null | undefined): { strong: string; rest: string } | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return null;
  return { strong: `${count} ${pluralRu(count, 'человек', 'человека', 'человек')}`, rest: ' в команде' };
}

/** Две строки ближайшего события: «Завтра в 19:00» и тип — «Тренировка». Без названия и места. */
export function nextEventLines(
  event: InviteFactsInput['nextEvent'],
  now: Date = new Date(),
): { when: string; details: string } | null {
  if (!event) return null;
  const when = eventWhenText(event.startsAt, event.timezone, now);
  if (!when) return null;
  const type = (EVENT_LABELS as Record<string, string>)[String(event.type ?? '')] ?? '';
  return { when, details: type };
}

/**
 * Имя в абзаце выделяется, поэтому текст отдаём двумя частями. Сервер уже
 * отдаёт только первое имя, поэтому оно идёт как есть.
 */
export function requestWaitingParts(inviterName: string | null | undefined): { name: string | null; rest: string } {
  const name = String(inviterName ?? '').trim();
  return name
    ? { name, rest: ' увидит заявку и ответит. Мы пришлём уведомление.' }
    : { name: null, rest: 'Капитан увидит заявку и ответит. Мы пришлём уведомление.' };
}
