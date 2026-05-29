import type { Event } from "../types";
import { RSVPStatus } from "../types";

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

function isAwaitingResponse(event: Event): boolean {
  return event.rsvpStatus === RSVPStatus.PENDING || event.rsvpStatus === RSVPStatus.UNANSWERED;
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

export interface DashboardEventSections {
  heroEvent: Event | null;
  heroEventIsOngoing: boolean;
  heroEventNeedsResponse: boolean;
  pendingEvents: Event[];
  upcomingEvents: Event[];
}

export function buildDashboardEventSections(events: Event[], nowTs: number): DashboardEventSections {
  const visibleEvents = filterUpcomingAndOngoingEvents(events, nowTs);
  const heroEvent = pickDashboardHeroEvent(visibleEvents, nowTs);
  const secondaryEvents = heroEvent
    ? visibleEvents.filter((event) => event.id !== heroEvent.id)
    : visibleEvents;

  return {
    heroEvent,
    heroEventIsOngoing: heroEvent ? isEventOngoing(heroEvent, nowTs) : false,
    heroEventNeedsResponse: heroEvent ? isAwaitingResponse(heroEvent) : false,
    pendingEvents: secondaryEvents.filter((event) => isAwaitingResponse(event)),
    upcomingEvents: secondaryEvents.filter((event) => !isAwaitingResponse(event)).slice(0, 3),
  };
}

export function getCountdownParts(targetDate: Date, nowTs: number) {
  const diffMs = Math.max(0, targetDate.getTime() - nowTs);
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;

  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    mins: String(mins).padStart(2, "0"),
  };
}
