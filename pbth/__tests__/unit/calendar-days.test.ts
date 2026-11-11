import { describe, expect, it } from 'vitest';
import { calendarDayHeading, calendarMarks, eventsOfDay, monthPaints, parseIso } from '../../lib/calendar-days';
import { EventType, RSVPStatus, type Event } from '../../types';

const at = (day: number, h = 10, month = 11) => new Date(2026, month - 1, day, h, 0);
const ev = (id: string, start: Date, teamId = 'a'): Event => ({
  id,
  teamId,
  type: EventType.TRAINING,
  title: id,
  startDate: start,
  endDate: new Date(start.getTime() + 3_600_000),
  rsvpStatus: RSVPStatus.UNANSWERED,
  attendeesCount: 0,
});
const paint = (id: string) => ({ a: '#FF8A1F', b: '#4FC3F7', c: '#FF6B57', d: '#A58BFF' })[id] ?? '#000';

describe('точки под числами', () => {
  it('одна точка на команду, даже если событий команды несколько', () => {
    const marks = calendarMarks([ev('1', at(14, 10)), ev('2', at(14, 16)), ev('3', at(14, 18))], paint);
    expect(marks['2026-11-14']).toEqual(['#FF8A1F']);
  });

  it('порядок точек — по времени начала событий', () => {
    const marks = calendarMarks([ev('1', at(14, 16), 'b'), ev('2', at(14, 10), 'a')], paint);
    expect(marks['2026-11-14']).toEqual(['#FF8A1F', '#4FC3F7']);
  });

  it('дни без событий не попадают в карту; разные дни — разные ключи', () => {
    const marks = calendarMarks([ev('1', at(3)), ev('2', at(5), 'b')], paint);
    expect(Object.keys(marks).sort()).toEqual(['2026-11-03', '2026-11-05']);
  });

  it('четыре команды в день отдаются все: сетка ui-kit покажет три и «+»', () => {
    const marks = calendarMarks(
      [ev('1', at(14, 9), 'a'), ev('2', at(14, 10), 'b'), ev('3', at(14, 11), 'c'), ev('4', at(14, 12), 'd')],
      paint,
    );
    expect(marks['2026-11-14']).toHaveLength(4);
  });
});

describe('события дня и заголовок', () => {
  it('события выбранного дня по времени', () => {
    const list = eventsOfDay([ev('late', at(14, 16)), ev('other', at(15)), ev('early', at(14, 9))], '2026-11-14');
    expect(list.map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('«Суббота» и «14 ноября · 2 события»', () => {
    expect(calendarDayHeading(at(14), 2)).toEqual({ title: 'Суббота', sub: '14 ноября · 2 события' });
    expect(calendarDayHeading(at(11), 1)).toEqual({ title: 'Среда', sub: '11 ноября · 1 событие' });
    expect(calendarDayHeading(at(12), 0)).toEqual({ title: 'Четверг', sub: '12 ноября' });
    expect(calendarDayHeading(at(12), 5).sub).toBe('12 ноября · 5 событий');
  });

  it('parseIso читает дату и отвергает мусор', () => {
    expect(parseIso('2026-11-14')?.getDate()).toBe(14);
    expect(parseIso('14.11.2026')).toBeNull();
  });
});

describe('краски фона месяца', () => {
  const now = at(11, 12).getTime();
  it('первой идёт команда ближайшего предстоящего события', () => {
    const events = [ev('past', at(3), 'c'), ev('next', at(12), 'b'), ev('far', at(20), 'a')];
    expect(monthPaints(events, 2026, 11, now, paint)).toEqual(['#4FC3F7', '#FF8A1F', '#FF6B57']);
  });
  it('события других месяцев не считаются; без событий — пусто; не больше трёх', () => {
    expect(monthPaints([ev('x', at(5, 10, 12))], 2026, 11, now, paint)).toEqual([]);
    const many = ['a', 'b', 'c', 'd'].map((t, i) => ev(t, at(12 + i), t));
    expect(monthPaints(many, 2026, 11, now, paint)).toHaveLength(3);
  });
});
