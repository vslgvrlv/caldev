import { describe, expect, it } from 'vitest';
import type { Event } from '../../types';
import { reconcileSelectedEvent } from '../../lib/event-refresh';

const event = (id: string, opponents: string[]): Event => ({
  id,
  title: `Event ${id}`,
  type: 'TOURNAMENT',
  startDate: new Date('2026-09-05T08:00:00Z'),
  schedule: opponents.map((opponent, index) => ({
    id: `${id}-${index}`,
    time: `0${index + 8}:00`,
    opponent,
  })),
} as Event);

describe('refreshing an open event', () => {
  it('replaces the stale detail object with the fresh schedule', () => {
    const selected = event('final', []);
    const fresh = event('final', ['Смоляне', 'Зайцы']);

    expect(reconcileSelectedEvent(selected, [fresh])?.schedule).toEqual(fresh.schedule);
  });

  it('closes a detail that disappeared from the accessible event list', () => {
    expect(reconcileSelectedEvent(event('deleted', []), [])).toBeNull();
  });
});
