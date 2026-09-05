import type { Event } from '../types';

// EventDetailView keeps the event object that was clicked. When /init refreshes
// the list, that object does not update by itself, so a newly published
// schedule remained invisible until a full page reload.
export function reconcileSelectedEvent(
  selected: Event | null,
  events: Event[],
): Event | null {
  if (!selected) return null;
  return events.find((event) => event.id === selected.id) || null;
}
