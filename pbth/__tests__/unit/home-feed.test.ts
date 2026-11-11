import { describe, expect, it } from 'vitest';
import {
  answerStatus,
  attendanceDots,
  attendanceText,
  dayHeading,
  endLabel,
  eventSubline,
  feedTitle,
  groupEventsByDay,
  heroDateLabel,
  homePaints,
  needsAnswer,
  pickHomeEvents,
  timeLabel,
} from '../../lib/home-feed';
import { EventType, RSVPStatus, type Event } from '../../types';

// Местное время: тест не зависит от пояса машины.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const NOW = at(11, 18, 0).getTime();

const ev = (id: string, start: Date, patch: Partial<Event> = {}): Event => ({
  id,
  teamId: 't1',
  type: EventType.TRAINING,
  title: `Событие ${id}`,
  startDate: start,
  endDate: new Date(start.getTime() + 90 * 60_000),
  rsvpStatus: RSVPStatus.UNANSWERED,
  attendeesCount: 0,
  ...patch,
});

describe('ближайшее событие и остальные', () => {
  it('ближайшее — отдельно, остальные по возрастанию, прошедшие не попадают', () => {
    const { hero, rest } = pickHomeEvents(
      [ev('c', at(14, 10)), ev('past', at(10, 10)), ev('a', at(11, 20, 30)), ev('b', at(12, 19))],
      NOW,
    );
    expect(hero?.id).toBe('a');
    expect(rest.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('идущее сейчас событие — ближайшее', () => {
    const { hero } = pickHomeEvents([ev('later', at(11, 20)), ev('now', at(11, 17, 30))], NOW);
    expect(hero?.id).toBe('now');
  });

  it('нет событий — нет ближайшего', () => {
    expect(pickHomeEvents([], NOW)).toEqual({ hero: null, rest: [] });
  });
});

describe('группировка по дням', () => {
  it('день один раз, внутри дня по времени, дни по возрастанию', () => {
    const groups = groupEventsByDay([ev('s2', at(14, 16)), ev('t', at(12, 19)), ev('s1', at(14, 10))]);
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([['t'], ['s1', 's2']]);
    expect(groups.map((g) => g.key)).toEqual(['2026-11-12', '2026-11-14']);
  });
});

describe('подписи дней', () => {
  it('сегодня, завтра и дальше день недели', () => {
    expect(dayHeading(at(11, 20), NOW, 1)).toEqual({ title: 'Сегодня', sub: 'ср, 11 ноября' });
    expect(dayHeading(at(12, 19), NOW, 1)).toEqual({ title: 'Завтра', sub: 'чт, 12 ноября' });
    expect(dayHeading(at(14, 10), NOW, 2)).toEqual({ title: 'Суббота', sub: '14 ноября · 2 события' });
    expect(dayHeading(at(17, 20), NOW, 5).sub).toBe('17 ноября · 5 событий');
    expect(dayHeading(at(22, 11), NOW, 1)).toEqual({ title: 'Воскресенье', sub: '22 ноября' });
  });

  it('день считается по календарю, а не по 24 часам', () => {
    const late = at(11, 23, 30).getTime();
    expect(dayHeading(at(12, 0, 30), late, 1).title).toBe('Завтра');
  });

  it('дата в блоке ближайшего события', () => {
    expect(heroDateLabel(ev('a', at(11, 20, 30)), NOW)).toBe('Сегодня, ср 11 ноября');
    expect(heroDateLabel(ev('b', at(12, 19)), NOW)).toBe('Завтра, чт 12 ноября');
    expect(heroDateLabel(ev('c', at(14, 10)), NOW)).toBe('Суббота, 14 ноября');
    expect(heroDateLabel(ev('d', at(11, 17, 30)), NOW)).toBe('Идёт сейчас, ср 11 ноября');
  });
});

describe('время, место, ответ', () => {
  it('время и «до»; запасные два часа без конца события не показываются', () => {
    expect(timeLabel(at(11, 20, 30))).toBe('20:30');
    expect(endLabel(ev('a', at(11, 20, 30), { endDate: at(11, 22) }))).toBe('до 22:00');
    expect(endLabel({ endDate: undefined, endAt: undefined })).toBeNull();
  });

  it('подпись: тип и место в кавычках', () => {
    expect(eventSubline({ type: EventType.TOURNAMENT, location: 'Гвардеец' })).toBe('Турнир · «Гвардеец»');
    expect(eventSubline({ type: EventType.TRAINING, location: '' })).toBe('Тренировка');
  });

  it('название строки: без своего названия — команда; из нескольких команд — команда и название', () => {
    expect(feedTitle({ type: EventType.TRAINING, title: 'Тренировка' }, 'Дневной Дозор', true)).toBe('Дневной Дозор');
    expect(feedTitle({ type: EventType.TOURNAMENT, title: 'Кубок Москвы, 3 этап' }, 'Holy Guns', true)).toBe('Holy Guns · Кубок Москвы, 3 этап');
    expect(feedTitle({ type: EventType.TOURNAMENT, title: 'Кубок Москвы, 3 этап' }, 'Holy Guns', false)).toBe('Кубок Москвы, 3 этап');
    expect(feedTitle({ type: EventType.TRAINING, title: '' }, '', false)).toBe('');
  });

  it('отметка ответа: иду зелёная, не иду приглушённая, без ответа нет; у чужой команды нет', () => {
    expect(answerStatus(ev('a', at(12, 9), { rsvpStatus: RSVPStatus.CONFIRMED }))).toMatchObject({ text: 'иду', tone: 'success' });
    expect(answerStatus(ev('a', at(12, 9), { rsvpStatus: RSVPStatus.DECLINED }))).toMatchObject({ text: 'не иду', tone: 'muted' });
    expect(answerStatus(ev('a', at(12, 9)))).toBeNull();
    expect(answerStatus(ev('a', at(12, 9), { rsvpStatus: RSVPStatus.CONFIRMED, viewerInRoster: false }))).toBeNull();
  });

  it('кнопки ответа нужны без ответа и при «думаю», но не чужой команде', () => {
    expect(needsAnswer(ev('a', at(12, 9)))).toBe(true);
    expect(needsAnswer(ev('a', at(12, 9), { rsvpStatus: RSVPStatus.PENDING }))).toBe(true);
    expect(needsAnswer(ev('a', at(12, 9), { rsvpStatus: RSVPStatus.CONFIRMED }))).toBe(false);
    expect(needsAnswer(ev('a', at(12, 9), { viewerInRoster: false }))).toBe(false);
  });
});

describe('счётчик явки пятёрками', () => {
  it('7 из 10: две пятёрки, семь закрашены', () => {
    expect(attendanceDots(7, 10)).toEqual({ filled: 7, empty: 3, groups: [5, 5] });
    expect(attendanceText(7, 10)).toBe('идут 7 из 10');
  });

  it('без лимита точек ровно по числу идущих; неполная пятёрка последняя', () => {
    expect(attendanceDots(3)).toEqual({ filled: 3, empty: 0, groups: [3] });
    expect(attendanceDots(12)).toEqual({ filled: 12, empty: 0, groups: [5, 5, 2] });
    expect(attendanceText(3)).toBe('идут 3');
    expect(attendanceText(1)).toBe('идёт 1');
  });

  it('никто не идёт; идущих больше лимита; предел точек', () => {
    expect(attendanceDots(0)).toEqual({ filled: 0, empty: 0, groups: [] });
    expect(attendanceText(0)).toBe('пока никто не идёт');
    expect(attendanceText(0, 8)).toBe('пока никто не идёт, мест 8');
    expect(attendanceDots(12, 10).filled).toBe(12);
    expect(attendanceDots(80).groups.reduce((a, b) => a + b, 0)).toBe(30);
  });
});

describe('краски фона', () => {
  it('сначала ближайшего события, затем других, без повторов, не больше трёх', () => {
    const paintOf = (id: string) => ({ a: '#1', b: '#2', c: '#1', d: '#3', e: '#4' })[id] ?? '#0';
    const events = ['a', 'c', 'b', 'd', 'e'].map((team, i) => ev(`e${i}`, at(12, 9 + i), { teamId: team }));
    expect(homePaints(events, paintOf)).toEqual(['#1', '#2', '#3']);
    expect(homePaints([], paintOf)).toEqual([]);
  });
});
