import { describe, it, expect } from 'vitest';
import { groupAttendance, type AttendanceRsvp } from '../../lib/attendance';

const member = (rsvpStatus: AttendanceRsvp, userId = 'u') => ({
  userId,
  name: 'Player',
  nickname: 'pl',
  role: 'PLAYER' as const,
  rsvpStatus,
});

describe('groupAttendance', () => {
  it('buckets CONFIRMED as going and DECLINED as notGoing', () => {
    const result = groupAttendance([member('CONFIRMED', 'a'), member('DECLINED', 'b')]);
    expect(result.going.map((x) => x.userId)).toEqual(['a']);
    expect(result.notGoing.map((x) => x.userId)).toEqual(['b']);
  });

  it('treats both UNANSWERED and PENDING as silent (молчат)', () => {
    const result = groupAttendance([member('UNANSWERED', 'a'), member('PENDING', 'b')]);
    expect(result.silent.map((x) => x.userId)).toEqual(['a', 'b']);
    expect(result.going).toEqual([]);
    expect(result.notGoing).toEqual([]);
  });

  it('computes counts that sum to total', () => {
    const result = groupAttendance([
      member('CONFIRMED'),
      member('PENDING'),
      member('UNANSWERED'),
      member('DECLINED'),
    ]);
    expect(result.counts).toEqual({ going: 1, silent: 2, notGoing: 1, total: 4 });
  });

  it('returns empty groups for empty input', () => {
    const result = groupAttendance([]);
    expect(result).toEqual({
      going: [],
      silent: [],
      notGoing: [],
      counts: { going: 0, silent: 0, notGoing: 0, total: 0 },
    });
  });

  it('preserves input order within a group', () => {
    const result = groupAttendance([
      member('CONFIRMED', 'a'),
      member('CONFIRMED', 'b'),
      member('CONFIRMED', 'c'),
    ]);
    expect(result.going.map((x) => x.userId)).toEqual(['a', 'b', 'c']);
  });
});
