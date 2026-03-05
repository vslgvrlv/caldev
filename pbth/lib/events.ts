import type { Event } from "../types";

export function sortEventsByStart(events: Event[]): Event[] {
  return [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
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
