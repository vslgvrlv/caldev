import type { Event } from "../types";
import { Role } from "../types";

export function sortEventsByStart(events: Event[]): Event[] {
  return [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

// #60: показывать одно-тапный «Иду на серию» только для занятий серии,
// на которые игрок ещё не согласился. Уже согласившиеся занятия не нудят.
export function canCommitToSeries(event: Pick<Event, "seriesId" | "seriesCommitted">): boolean {
  return Boolean(event.seriesId) && event.seriesCommitted === false;
}

export function getEventEndTimestamp(event: Event): number {
  if (event.endDate instanceof Date) return event.endDate.getTime();
  if (event.endAt) {
    const parsed = new Date(event.endAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  // Fallback for legacy payloads without end date.
  return event.startDate.getTime() + 2 * 60 * 60 * 1000;
}

export function isEventOngoing(event: Event, nowTs: number): boolean {
  return event.startDate.getTime() <= nowTs && getEventEndTimestamp(event) > nowTs;
}

export function filterUpcomingAndOngoingEvents(events: Event[], nowTs: number): Event[] {
  return sortEventsByStart(events).filter((event) => getEventEndTimestamp(event) > nowTs);
}

export function filterFutureEvents(events: Event[], nowTs: number): Event[] {
  return sortEventsByStart(events).filter((event) => event.startDate.getTime() >= nowTs);
}

export function pickDashboardHeroEvent(events: Event[], nowTs: number): Event | null {
  const visibleEvents = filterUpcomingAndOngoingEvents(events, nowTs);
  const ongoingEvents = visibleEvents
    .filter((event) => isEventOngoing(event, nowTs))
    .sort((a, b) => getEventEndTimestamp(a) - getEventEndTimestamp(b));

  if (ongoingEvents.length > 0) {
    return ongoingEvents[0];
  }

  return visibleEvents[0] || null;
}

/**
 * Подсказки на главной капитану новой команды: пока он в команде один —
 * «Позови команду», пока нет ни одного события — «Создай первое событие».
 * Только капитану (и владельцу платформы в режиме капитана).
 */
export function captainHomeHints(params: { role: Role | null | undefined; membersCount: number; teamEventsCount: number }) {
  const isCaptain = params.role === Role.CAPTAIN || params.role === Role.ADMIN;
  return {
    inviteTeam: isCaptain && params.membersCount <= 1,
    createFirstEvent: isCaptain && params.teamEventsCount === 0,
  };
}

export type CaptainHomeHints = ReturnType<typeof captainHomeHints>;
