import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Event } from '../types';
import { EventType, RSVPStatus } from '../types';
import { EVENT_LABELS } from '../constants';
import { getEventEndTimestamp, isEventOngoing, pickDashboardHeroEvent, sortEventsByStart } from './events';
import { pluralRu } from './plural';
import { canAnswerRsvp } from './rsvp';

// Чистая логика новой главной: ближайшее событие, лента по дням, подписи дней,
// счётчик «идут N из M» точками пятёрками. Отрисовка — в views/Dashboard.tsx.

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Разница в календарных днях от `now` до `date` (0 — сегодня, 1 — завтра). */
export function dayOffset(date: Date, now: number): number {
  return Math.round((startOfDay(date) - startOfDay(new Date(now))) / DAY_MS);
}

export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Будущие и идущие события, кроме ближайшего: они идут в ленту. Первым — ближайшее. */
export function pickHomeEvents(events: Event[], nowTs: number): { hero: Event | null; rest: Event[] } {
  const hero = pickDashboardHeroEvent(events, nowTs);
  const rest = sortEventsByStart(events).filter(
    (event) => event.id !== hero?.id && getEventEndTimestamp(event) > nowTs,
  );
  return { hero, rest };
}

export type DayGroup = { key: string; date: Date; events: Event[] };

/** События по дням по возрастанию; внутри дня — по времени начала. */
export function groupEventsByDay(events: Event[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const event of sortEventsByStart(events)) {
    const key = dayKey(event.startDate);
    let group = byKey.get(key);
    if (!group) {
      group = { key, date: event.startDate, events: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}

/**
 * Заголовок дня над панелью: «Сегодня», «Завтра», дальше день недели.
 * Справа от него: у сегодня и завтра «чт, 12 ноября», у остальных «14 ноября»;
 * если событий больше одного — «· 2 события».
 */
export function dayHeading(date: Date, now: number, count: number): { title: string; sub: string } {
  const offset = dayOffset(date, now);
  const near = offset === 0 || offset === 1;
  const title = offset === 0 ? 'Сегодня' : offset === 1 ? 'Завтра' : capitalize(format(date, 'EEEE', { locale: ru }));
  const dateText = near ? format(date, 'EEEEEE, d MMMM', { locale: ru }) : format(date, 'd MMMM', { locale: ru });
  const countText = count > 1 ? ` · ${count} ${pluralRu(count, 'событие', 'события', 'событий')}` : '';
  return { title, sub: `${dateText}${countText}` };
}

/** Дата в блоке ближайшего события: «Сегодня, ср 11 ноября», «Суббота, 14 ноября»; идущее — «Идёт сейчас, …». */
export function heroDateLabel(event: Event, now: number): string {
  const date = event.startDate;
  if (isEventOngoing(event, now)) return `Идёт сейчас, ${format(date, 'EEEEEE d MMMM', { locale: ru })}`;
  const offset = dayOffset(date, now);
  if (offset === 0) return `Сегодня, ${format(date, 'EEEEEE d MMMM', { locale: ru })}`;
  if (offset === 1) return `Завтра, ${format(date, 'EEEEEE d MMMM', { locale: ru })}`;
  return capitalize(format(date, 'EEEE, d MMMM', { locale: ru }));
}

export function timeLabel(date: Date): string {
  return format(date, 'HH:mm');
}

/** «до 22:00», если у события есть настоящее время окончания; запасные два часа не показываем. */
export function endLabel(event: Pick<Event, 'endDate' | 'endAt'>): string | null {
  if (event.endDate instanceof Date && Number.isFinite(event.endDate.getTime())) return `до ${timeLabel(event.endDate)}`;
  if (event.endAt) {
    const parsed = new Date(event.endAt);
    if (Number.isFinite(parsed.getTime())) return `до ${timeLabel(parsed)}`;
  }
  return null;
}

/** Подпись типа и места: «Тренировка · «Арена»». */
export function eventSubline(event: Pick<Event, 'type' | 'location'>): string {
  const type = EVENT_LABELS[event.type] ?? '';
  const place = (event.location || '').trim();
  return [type, place ? `«${place.replace(/[«»]/g, '')}»` : ''].filter(Boolean).join(' · ');
}

/**
 * Название строки ленты. Событие без своего названия («Тренировка») подписывается командой;
 * у игрока из нескольких команд к названию добавляется команда: «Holy Guns · Кубок Москвы».
 */
export function feedTitle(event: Pick<Event, 'type' | 'title'>, teamName: string, multiTeam: boolean): string {
  const title = (event.title || '').trim();
  const generic = !title || title.toLowerCase() === (EVENT_LABELS[event.type] ?? '').toLowerCase();
  if (generic) return teamName || title;
  return multiTeam && teamName ? `${teamName} · ${title}` : title;
}

/** Значок типа события из набора ui-kit. */
export function eventTypeIcon(type: EventType): string {
  switch (type) {
    case EventType.TRAINING:
      return 'activity';
    case EventType.TOURNAMENT:
    case EventType.CHAMPIONSHIP:
      return 'trophy';
    case EventType.FRIENDLY_MATCH:
      return 'swords';
    case EventType.MEETING:
      return 'users';
    default:
      return 'calendar';
  }
}

/** Чем занят ответ игрока: нужно ли предлагать «Иду / Не иду». */
export function needsAnswer(event: Event): boolean {
  return canAnswerRsvp(event) && (event.rsvpStatus === RSVPStatus.PENDING || event.rsvpStatus === RSVPStatus.UNANSWERED);
}

/** Отметка своего ответа справа от времени в ленте; «думаю» приглушённая, кнопки ответа остаются. */
export function answerStatus(event: Event): { text: string; tone: 'success' | 'muted'; icon: string } | null {
  if (!canAnswerRsvp(event)) return null;
  if (event.rsvpStatus === RSVPStatus.CONFIRMED) return { text: 'иду', tone: 'success', icon: 'check' };
  if (event.rsvpStatus === RSVPStatus.DECLINED) return { text: 'не иду', tone: 'muted', icon: 'x' };
  if (event.rsvpStatus === RSVPStatus.PENDING) return { text: 'думаю', tone: 'muted', icon: 'circle-help' };
  return null;
}

/** События, на которые игрок ещё не дал ответа (без ответа и «думаю»), в том же порядке. */
export function awaitingEvents(events: Event[]): Event[] {
  return events.filter(needsAnswer);
}

/** «Ждут ответа: N» — события без ответа в ленте под ближайшим событием; ближайшее не считается. */
export function awaitingCount(rest: Event[]): number {
  return awaitingEvents(rest).length;
}

/** Что показывает лента: все события или только ждущие ответа. Когда ждущих не осталось, фильтр сам выключается. */
export function visibleFeedEvents(rest: Event[], onlyAwaiting: boolean): Event[] {
  if (!onlyAwaiting) return rest;
  const awaiting = awaitingEvents(rest);
  return awaiting.length > 0 ? awaiting : rest;
}

/** Подпись уведомления о неотвеченных событиях. */
export function awaitingText(count: number): string {
  return `Ждут ответа: ${count}`;
}

const MAX_DOTS = 30;

/**
 * Счётчик явки точками: закрашены идущие, пустые — места, которых ещё ждём.
 * Число мест известно только у событий с лимитом; без него точек ровно по числу идущих.
 */
export function attendanceDots(going: number, max?: number | null): { filled: number; empty: number; groups: number[] } {
  const filled = Math.max(0, Math.trunc(Number(going) || 0));
  const limit = Number(max) > 0 ? Math.trunc(Number(max)) : 0;
  const total = Math.min(MAX_DOTS, Math.max(filled, limit));
  const shownFilled = Math.min(filled, total);
  const groups: number[] = [];
  for (let left = total; left > 0; left -= 5) groups.push(Math.min(5, left));
  return { filled: shownFilled, empty: total - shownFilled, groups };
}

/** «идут 7 из 10», «идут 3», «пока никто не идёт». */
export function attendanceText(going: number, max?: number | null): string {
  const n = Math.max(0, Math.trunc(Number(going) || 0));
  if (n === 0) return Number(max) > 0 ? `пока никто не идёт, мест ${Math.trunc(Number(max))}` : 'пока никто не идёт';
  const verb = n === 1 ? 'идёт' : 'идут';
  return Number(max) > 0 ? `${verb} ${n} из ${Math.trunc(Number(max))}` : `${verb} ${n}`;
}

/** Краски фона: сначала ближайшего события, затем других ближайших, без повторов, не больше трёх. */
export function homePaints(events: Event[], paintOf: (teamId: string) => string): string[] {
  const result: string[] = [];
  for (const event of events) {
    const paint = paintOf(event.teamId);
    if (!result.includes(paint)) result.push(paint);
    if (result.length === 3) break;
  }
  return result;
}
