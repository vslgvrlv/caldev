// Чистая логика экрана события: состав, счётчики, права, подписи, проверка форм.
// Без React и без запросов: проверяется vitest, экран только раскладывает готовое.

import { EventType, Role, RSVPStatus, type Game } from '../types';
import { pluralRu } from './plural';

export type AttendeeRole = 'CAPTAIN' | 'TRAINER' | 'PLAYER';
export type AttendeeMemberStatus = 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
export type AttendeeRsvp = 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';

export interface EventAttendee {
  userId: string;
  name: string;
  nickname: string;
  avatar?: string;
  role: AttendeeRole;
  memberStatus: AttendeeMemberStatus;
  rsvpStatus: AttendeeRsvp;
}

// ───────────────────────── права ─────────────────────────

export interface EventPermissions {
  isAdminOrCaptain: boolean;
  /** Тренер управляет только тренировками и сборами (зеркалит правило бэкенда). */
  isTrainerManageableType: boolean;
  canDelete: boolean;
  canEdit: boolean;
  /** Явку «был / не был» отмечает капитан или штаб. */
  canManageAttendance: boolean;
  /** Таблица разбора — рабочая поверхность тренера и штаба. */
  canSeeTable: boolean;
  canRemind: boolean;
  canAddGame: boolean;
}

export function eventPermissions(params: {
  role: Role;
  type: EventType;
  hasDeleteHandler: boolean;
  hasEditHandler: boolean;
}): EventPermissions {
  const { role, type } = params;
  const isAdminOrCaptain = role === Role.ADMIN || role === Role.CAPTAIN;
  const isTrainerManageableType = type === EventType.TRAINING || type === EventType.MEETING;
  const staffMayManage = isAdminOrCaptain || (role === Role.TRAINER && isTrainerManageableType);
  return {
    isAdminOrCaptain,
    isTrainerManageableType,
    canDelete: params.hasDeleteHandler && staffMayManage,
    canEdit: params.hasEditHandler && staffMayManage,
    canManageAttendance: staffMayManage,
    canSeeTable: isAdminOrCaptain || role === Role.TRAINER,
    canRemind: staffMayManage,
    canAddGame: isAdminOrCaptain,
  };
}

/** Расписание игр и рефлексия нужны везде, где команда выходит на поле. */
export function hasGameSchedule(type: EventType): boolean {
  return (
    type === EventType.TOURNAMENT ||
    type === EventType.CHAMPIONSHIP ||
    type === EventType.FRIENDLY_MATCH ||
    type === EventType.TRAINING
  );
}

/** Блок «Свободные слоты» показывается капитану и тренеру (shell/ext/track4-slots). */
export function canManageSlots(viewerRole: Role): boolean {
  return viewerRole === Role.CAPTAIN || viewerRole === Role.TRAINER;
}

// ───────────────────────── время и деньги ─────────────────────────

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const pad = (n: number) => String(n).padStart(2, '0');

const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** «Сегодня, ср 11 ноября», «Завтра, чт 12 ноября», «пн 16 ноября», с годом, если он не нынешний. */
export function eventDateLabel(start: Date, now: Date = new Date()): string {
  const base = `${WEEKDAYS[start.getDay()]} ${start.getDate()} ${MONTHS_GEN[start.getMonth()]}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(start, now)) return `Сегодня, ${base}`;
  if (sameDay(start, tomorrow)) return `Завтра, ${base}`;
  if (sameDay(start, yesterday)) return `Вчера, ${base}`;
  return start.getFullYear() === now.getFullYear() ? base : `${base} ${start.getFullYear()}`;
}

export function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function resolveEnd(event: { endDate?: Date; endAt?: string }): Date | null {
  const end = event.endDate instanceof Date ? event.endDate : event.endAt ? new Date(event.endAt) : null;
  return end && !Number.isNaN(end.getTime()) ? end : null;
}

/** «до 22:00»; если событие кончается в другой день — «до 12 нояб., 22:00»; конца нет — пусто. */
export function eventUntilLabel(start: Date, end: Date | null): string {
  if (!end) return '';
  if (sameDay(start, end)) return `до ${timeLabel(end)}`;
  return `до ${end.getDate()} ${MONTHS_GEN[end.getMonth()].slice(0, 3)}., ${timeLabel(end)}`;
}

export type EventPhase = 'upcoming' | 'live' | 'past';

export function eventPhase(start: Date, end: Date | null, now: Date = new Date()): EventPhase {
  if (start.getTime() > now.getTime()) return 'upcoming';
  if (end && end.getTime() > now.getTime()) return 'live';
  // Конца нет: до конца дня начала считаем, что идёт.
  if (!end && sameDay(start, now)) return 'live';
  return 'past';
}

/** 1500 → «1 500 ₽» (неразрывные пробелы между разрядами и перед знаком рубля). */
export function formatRub(value: number): string {
  const n = Math.round(Number(value) || 0);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '−' : ''}${digits} ₽`;
}

// ───────────────────────── состав ─────────────────────────

const FIVE_TITLES = ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая'];

export function fiveTitle(index: number): string {
  return `${FIVE_TITLES[index] ?? `${index + 1}-я`} пятёрка`;
}

/** Подпись под именем: роль и особый статус по-русски, без значений из базы. */
export function rosterSub(attendee: Pick<EventAttendee, 'role' | 'memberStatus'>): string {
  const role = attendee.role === 'CAPTAIN' ? 'капитан' : attendee.role === 'TRAINER' ? 'тренер' : 'игрок';
  const status =
    attendee.memberStatus === 'RESERVE'
      ? 'резерв'
      : attendee.memberStatus === 'INJURED'
        ? 'травма'
        : attendee.memberStatus === 'VACATION'
          ? 'в отпуске'
          : '';
  return status ? `${role} · ${status}` : role;
}

export interface RosterPerson extends EventAttendee {
  isSelf: boolean;
}

export interface RosterFive {
  title: string;
  people: RosterPerson[];
  /** Свободные места, дополняющие последнюю пятёрку до пяти. */
  free: number;
}

/** Точками показываются до 15 мест, дальше они не помещаются в строку карточки. */
export const ROSTER_DOTS_MAX = 15;

export interface RosterBar {
  going: number;
  capacity: number;
  /** Доля занятых мест, 0–100. */
  percent: number;
}

export interface Roster {
  goingCount: number;
  /** Сколько мест всего: лимит события или весь состав. */
  capacity: number;
  /** Идущие тренеры и штаб (в пятёрки не входят). */
  staff: RosterPerson[];
  fives: RosterFive[];
  /** Точки: пятёрки по пять; `true` — место занято идущим. Пусто, когда мест больше `ROSTER_DOTS_MAX`. */
  dots: boolean[][];
  /** Полоса заполнения вместо точек, когда мест больше `ROSTER_DOTS_MAX`; иначе `null`. */
  bar: RosterBar | null;
  /** «Не ответили»: без ответа и «думаю». */
  silent: RosterPerson[];
  declined: RosterPerson[];
  /** Состава нет совсем (загрузка не удалась): остаётся только число. */
  empty: boolean;
}

const memberOrder = (p: EventAttendee) => (p.role === 'CAPTAIN' ? 0 : p.memberStatus === 'RESERVE' ? 2 : 1);

export function buildRoster(params: {
  attendees: EventAttendee[];
  selfId?: string | null;
  maxAttendees?: number;
  /** Число идущих из события — пока список участников не загружен. */
  fallbackGoing?: number;
}): Roster {
  const { attendees, selfId, maxAttendees, fallbackGoing = 0 } = params;
  const people: RosterPerson[] = attendees.map((a) => ({ ...a, isSelf: Boolean(selfId) && a.userId === selfId }));
  const going = people.filter((p) => p.rsvpStatus === 'CONFIRMED');
  const staff = going.filter((p) => p.role === 'TRAINER');
  const players = going
    .filter((p) => p.role !== 'TRAINER')
    .map((p, index) => ({ p, index }))
    .sort((a, b) => memberOrder(a.p) - memberOrder(b.p) || a.index - b.index)
    .map(({ p }) => p);

  const goingCount = going.length || fallbackGoing;
  const rosterSize = attendees.length;
  const limit = maxAttendees && maxAttendees > 0 ? maxAttendees : 0;
  const capacity = Math.max(limit || rosterSize, goingCount);

  const fives: RosterFive[] = [];
  for (let i = 0; i < players.length; i += 5) {
    fives.push({ title: fiveTitle(fives.length), people: players.slice(i, i + 5), free: 0 });
  }
  const last = fives[fives.length - 1];
  if (last) {
    const gap = 5 - last.people.length;
    const roomLeft = Math.max(0, capacity - goingCount);
    last.free = Math.max(0, Math.min(gap, roomLeft));
  }

  const dots: boolean[][] = [];
  const useBar = capacity > ROSTER_DOTS_MAX;
  for (let i = 0; !useBar && i < capacity; i += 5) {
    const row: boolean[] = [];
    for (let j = i; j < Math.min(i + 5, capacity); j += 1) row.push(j < goingCount);
    dots.push(row);
  }

  return {
    goingCount,
    capacity,
    staff,
    fives,
    dots,
    bar: useBar ? { going: goingCount, capacity, percent: Math.min(100, Math.round((goingCount / capacity) * 100)) } : null,
    silent: people.filter((p) => p.rsvpStatus === 'UNANSWERED' || p.rsvpStatus === 'PENDING'),
    declined: people.filter((p) => p.rsvpStatus === 'DECLINED'),
    empty: rosterSize === 0,
  };
}

/** «Идут 7 из 10»; мест неизвестно — «Идут 7». */
export function rosterHeadline(roster: Pick<Roster, 'goingCount' | 'capacity'>): string {
  return roster.capacity > 0 ? `Идут ${roster.goingCount} из ${roster.capacity}` : `Идут ${roster.goingCount}`;
}

/** Подпись полосы заполнения: «идут 15 из 30». */
export function rosterBarLabel(bar: Pick<RosterBar, 'going' | 'capacity'>): string {
  return `идут ${bar.going} из ${bar.capacity}`;
}

export function silentLabel(count: number): string {
  return `${count} ${pluralRu(count, 'не ответил', 'не ответили', 'не ответили')}`;
}

// ───────────────────────── свой ответ ─────────────────────────

export type OwnAnswer = 'none' | 'going' | 'declined' | 'pending';

export function ownAnswer(status: RSVPStatus | string | undefined): OwnAnswer {
  if (status === RSVPStatus.CONFIRMED) return 'going';
  if (status === RSVPStatus.DECLINED) return 'declined';
  if (status === RSVPStatus.PENDING) return 'pending';
  return 'none';
}

// ───────────────────────── игры ─────────────────────────

export const timeToMinutes = (time: string): number => {
  const m = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

/** Хронологически: «8:00» идёт раньше «16:00», а не после. */
export function sortSchedule(schedule: Game[] | undefined): Game[] {
  return [...(schedule || [])].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

export function normalizeTimeForInput(time: string): string {
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export const PIT_ZONE_LABELS: Record<'NEAR' | 'FAR', string> = {
  NEAR: 'Ближняя пит-зона',
  FAR: 'Дальняя пит-зона',
};

export const PIT_ZONE_BADGE: Record<'NEAR' | 'FAR', string> = { NEAR: 'Ближняя', FAR: 'Дальняя' };

export const GAME_PAIR_LABELS: Record<'FIRST' | 'SECOND', string> = { FIRST: 'Первая пара', SECOND: 'Вторая пара' };

// ───────────────────────── формы ─────────────────────────

export interface EditDraft {
  title: string;
  location: string;
  locationUrl: string;
  locationAddress: string;
  cost: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
}

export type EditPatch = {
  title: string;
  location?: string;
  locationUrl?: string;
  locationAddress?: string;
  startISO: string;
  endISO: string;
  cost?: number;
  description?: string;
};

/** Начальные значения окна «Изменить событие»: конца нет — по умолчанию +2 часа. */
export function buildEditDraft(event: {
  title?: string;
  location?: string;
  locationUrl?: string;
  cost?: number | null;
  description?: string;
  startDate: Date;
  endDate?: Date;
  endAt?: string;
}): EditDraft {
  const start = event.startDate;
  const end = resolveEnd(event) ?? new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: event.title || '',
    location: event.location || '',
    locationUrl: event.locationUrl || '',
    locationAddress: '',
    cost: event.cost !== undefined && event.cost !== null ? String(event.cost) : '',
    description: event.description || '',
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startTime: timeLabel(start),
    endTime: timeLabel(end),
  };
}

export type EditResult = { ok: true; patch: EditPatch } | { ok: false; error: string };

export function validateEditDraft(draft: EditDraft): EditResult {
  if (!draft.title.trim()) return { ok: false, error: 'Введи название события.' };
  if (!draft.date || !draft.startTime || !draft.endTime) return { ok: false, error: 'Заполни дату, время начала и окончания.' };
  const start = new Date(`${draft.date}T${draft.startTime}`);
  const end = new Date(`${draft.date}T${draft.endTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: 'Некорректные дата или время.' };
  if (end.getTime() <= start.getTime()) return { ok: false, error: 'Окончание должно быть позже начала.' };
  const costRaw = draft.cost.trim();
  const cost = costRaw ? Number(costRaw) : undefined;
  if (costRaw && (cost === undefined || Number.isNaN(cost) || cost < 0)) return { ok: false, error: 'Некорректная стоимость.' };
  return {
    ok: true,
    patch: {
      title: draft.title.trim(),
      location: draft.location.trim() || undefined,
      locationUrl: draft.locationUrl.trim() || undefined,
      locationAddress: draft.locationAddress.trim() || undefined,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      cost,
      description: draft.description.trim() || undefined,
    },
  };
}

/** Начальная отметка явки: сохранённое «был / не был», а где его нет — намерение (идёт → был). */
export function buildAttendanceDraft(
  attendees: Pick<EventAttendee, 'userId' | 'rsvpStatus'>[],
  saved?: { userId: string; present: boolean }[] | null,
): Record<string, boolean> {
  const savedMap = new Map((saved || []).map((row) => [row.userId, row.present]));
  const draft: Record<string, boolean> = {};
  for (const attendee of attendees) {
    draft[attendee.userId] = savedMap.has(attendee.userId)
      ? Boolean(savedMap.get(attendee.userId))
      : attendee.rsvpStatus === 'CONFIRMED';
  }
  return draft;
}

export function attendanceEntries(
  attendees: Pick<EventAttendee, 'userId'>[],
  draft: Record<string, boolean>,
): { userId: string; present: boolean }[] {
  return attendees.map((a) => ({ userId: a.userId, present: Boolean(draft[a.userId]) }));
}

export type ReminderAudience = 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
export type ReminderTemplate = 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';

export const REMINDER_AUDIENCES: { value: ReminderAudience; label: string }[] = [
  { value: 'ALL', label: 'Всем' },
  { value: 'RESPONDED', label: 'Ответившим' },
  { value: 'UNANSWERED', label: 'Не ответившим' },
  { value: 'CONFIRMED', label: 'Только идущим' },
  { value: 'PENDING', label: 'Только думающим' },
  { value: 'DECLINED', label: 'Только отказавшимся' },
];

export const REMINDER_TEMPLATES: { value: ReminderTemplate; label: string }[] = [
  { value: 'EVENT_REMINDER', label: 'Обычное напоминание' },
  { value: 'WARMUP_REMINDER', label: 'Разминка по событию' },
  { value: 'ROLE_REMINDER', label: 'Роли и задачи' },
  { value: 'GAME_GATHERING', label: 'Сбор перед игрой' },
  { value: 'GAME_WARMUP', label: 'Начало разминки (игра)' },
];

export const isGameReminderTemplate = (template: ReminderTemplate): boolean =>
  template === 'GAME_GATHERING' || template === 'GAME_WARMUP';

/** Подпись игры в выборе напоминания: «12:00 · Ястребы · Ближняя пит · Первая пара». */
export function gameOptionLabel(game: Game): string {
  const pit = game.pitZone ? `${PIT_ZONE_BADGE[game.pitZone]} пит` : 'пит ?';
  const pair = game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'пара ?';
  return `${game.time} · ${game.opponent} · ${pit} · ${pair}`;
}

/** Текст ошибки отправки напоминания для человека. */
export function reminderErrorText(status: number | undefined, gameTemplate: boolean): string {
  if (status === 403) return 'Нет прав напоминать по этому событию.';
  if (status === 400 && gameTemplate) return 'Для напоминания об игре добавь игры в расписание.';
  return 'Не удалось отправить напоминание. Проверь сеть и попробуй ещё раз.';
}

/** Занятий впереди для баннера серии. */
export function seriesUpcomingText(count: number): string {
  if (count <= 0) return 'Запишись сразу на все занятия серии.';
  return `Впереди ещё ${count} ${pluralRu(count, 'занятие', 'занятия', 'занятий')}. Запишись сразу на все.`;
}

/** Иконка (имя Lucide из набора ui-kit) по типу события. */
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
    case EventType.MAINTENANCE:
      return 'settings';
    default:
      return 'calendar-days';
  }
}

// ───────── плитка «Слоты» ─────────

/** Блок слотов сообщает экрану своё состояние, чтобы плитка панели показала места и цену. */
export const SLOTS_STATE_EVENT = 'pbth:slots-state';

export type SlotsTileState = { open: boolean; capacity: number; price: number } | null | undefined;

/** «3 места · 3 000 ₽» у открытых слотов, «места и цена» — пока не открыты. */
export function slotsTileSub(slot: SlotsTileState): string {
  if (!slot || !slot.open) return 'места и цена';
  const places = `${slot.capacity} ${pluralRu(slot.capacity, 'место', 'места', 'мест')}`;
  return `${places} · ${slot.price > 0 ? formatRub(slot.price) : 'бесплатно'}`;
}
