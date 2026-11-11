// Расписание авто-напоминаний о явке (трек 2 ревизии, решение Василия
// 10.11.2026, п. 8): неответившим — накануне в 19:00 и утром в день события,
// по часовому поясу команды. Чистые функции: считают, какое напоминание
// «пора» для события в данный момент. Кому и как слать — `modules/reminders`.
//
// Окна, а не точки: сервер проверяет раз в несколько минут и может быть
// перезапущен, поэтому напоминание «пора» весь интервал окна. Повтор внутри
// окна исключает уникальная запись в `event_auto_reminders` (ключ — событие,
// человек, слот и дата события), а не таймер.
//
// Правила:
//   - «Накануне» (EVE): с 19:00 до 22:00 дня перед событием. Позже не шлём:
//     ночью людей не будим, утром придёт второе.
//   - «Утро» (MORNING): с 09:00 до 12:00 в день события, и только если событие
//     начинается не раньше 11:00 — за два часа и больше. Раннему событию
//     (игровой день с 10:00) утреннее напоминание бесполезно: люди уже в
//     дороге, им хватает вечернего.
//   - Ни одно окно не заходит за начало события.

export const DEFAULT_TEAM_TIMEZONE = "Europe/Moscow";

export const AUTO_REMINDER_RULES = {
  eveHour: 19,
  eveUntilHour: 22,
  morningHour: 9,
  morningUntilHour: 12,
  /** Утреннее — только если событие начинается не раньше этого часа. */
  morningMinStartHour: 11,
} as const;

export type AutoReminderSlot = "EVE" | "MORNING";

export type DueAutoReminder = {
  slot: AutoReminderSlot;
  /** Ключ повтора: слот + дата события по поясу команды. Перенос на другой день — новый ключ. */
  slotKey: string;
  windowStart: Date;
  windowEnd: Date;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function safeTimeZone(timeZone: string | null | undefined): string {
  const tz = String(timeZone ?? "").trim() || DEFAULT_TEAM_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TEAM_TIMEZONE;
  }
}

/** Дата и время момента по поясу. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, number> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    // В части сред полночь приходит как 24.
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/** Момент, когда по поясу `timeZone` наступает `year-month-day hour:minute`. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const tz = safeTimeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMs(new Date(guess), tz);
  // Второй проход — на случай перехода на летнее время между догадкой и ответом.
  const corrected = guess - offsetMs(new Date(result), tz);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

function shiftDay(parts: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dateKey(parts: { year: number; month: number; day: number }): string {
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/** Окна обоих напоминаний для события; утреннего может не быть. */
export function autoReminderWindows(startAt: Date, timeZone: string | null | undefined): DueAutoReminder[] {
  const tz = safeTimeZone(timeZone);
  const start = localParts(startAt, tz);
  const eventDay = { year: start.year, month: start.month, day: start.day };
  const key = dateKey(eventDay);
  const windows: DueAutoReminder[] = [];

  const eve = shiftDay(eventDay, -1);
  const eveStart = zonedTimeToUtc(eve.year, eve.month, eve.day, AUTO_REMINDER_RULES.eveHour, 0, tz);
  const eveEnd = zonedTimeToUtc(eve.year, eve.month, eve.day, AUTO_REMINDER_RULES.eveUntilHour, 0, tz);
  windows.push({
    slot: "EVE",
    slotKey: `EVE:${key}`,
    windowStart: eveStart,
    windowEnd: new Date(Math.min(eveEnd.getTime(), startAt.getTime())),
  });

  if (start.hour >= AUTO_REMINDER_RULES.morningMinStartHour) {
    const mStart = zonedTimeToUtc(eventDay.year, eventDay.month, eventDay.day, AUTO_REMINDER_RULES.morningHour, 0, tz);
    const mEnd = zonedTimeToUtc(eventDay.year, eventDay.month, eventDay.day, AUTO_REMINDER_RULES.morningUntilHour, 0, tz);
    windows.push({
      slot: "MORNING",
      slotKey: `MORNING:${key}`,
      windowStart: mStart,
      windowEnd: new Date(Math.min(mEnd.getTime(), startAt.getTime())),
    });
  }
  return windows;
}

// Сообщения о новом, перенесённом и отменённом событии (спека
// event_announcements, решения Василия 11.11.2026). Уходят через 3 минуты:
// за это время капитан успевает поправить опечатку или удалить событие.
// Ночью (22:00–09:00 по поясу команды) сообщение ждёт до 09:00 — но только
// если от 09:00 до начала события не меньше 6 часов. Иначе (игра в 9:00, сбор
// в 7:00) ждать нельзя: уходит сразу, без звука.
export const ANNOUNCEMENT_RULES = {
  delaySeconds: 180,
  nightFromHour: 22,
  morningHour: 9,
  /** Ждать утра, только если от 09:00 до начала события не меньше стольких часов. */
  minLeadHours: 6,
} as const;

export type AnnouncementDue = { dueAt: Date; silent: boolean };

/** Когда слать сообщение о событии и со звуком ли. Для серии `eventStartAt` — первое затронутое занятие. */
export function announcementDueAt(
  now: Date,
  eventStartAt: Date,
  timeZone: string | null | undefined,
  delaySeconds: number = ANNOUNCEMENT_RULES.delaySeconds
): AnnouncementDue {
  const tz = safeTimeZone(timeZone);
  const base = new Date(now.getTime() + Math.max(0, delaySeconds) * 1000);
  const local = localParts(base, tz);
  const night = local.hour >= ANNOUNCEMENT_RULES.nightFromHour || local.hour < ANNOUNCEMENT_RULES.morningHour;
  if (!night) return { dueAt: base, silent: false };

  const day = { year: local.year, month: local.month, day: local.day };
  const morningDay = local.hour >= ANNOUNCEMENT_RULES.nightFromHour ? shiftDay(day, 1) : day;
  const candidate = zonedTimeToUtc(morningDay.year, morningDay.month, morningDay.day, ANNOUNCEMENT_RULES.morningHour, 0, tz);
  if (eventStartAt.getTime() - candidate.getTime() >= ANNOUNCEMENT_RULES.minLeadHours * 3_600_000) {
    return { dueAt: candidate, silent: false };
  }
  return { dueAt: base, silent: true };
}

/** Какое напоминание пора слать сейчас; `null` — никакое. */
export function dueAutoReminder(
  startAt: Date,
  timeZone: string | null | undefined,
  now: Date
): DueAutoReminder | null {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) return null;
  if (now.getTime() >= startAt.getTime()) return null;
  for (const window of autoReminderWindows(startAt, timeZone)) {
    if (now.getTime() >= window.windowStart.getTime() && now.getTime() < window.windowEnd.getTime()) {
      return window;
    }
  }
  return null;
}
