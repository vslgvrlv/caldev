import { describe, expect, it } from 'vitest';
import { EventType, Role, RSVPStatus, type Game } from '../../types';
import {
  attendanceEntries,
  buildAttendanceDraft,
  buildEditDraft,
  buildRoster,
  canManageSlots,
  eventDateLabel,
  eventPermissions,
  eventPhase,
  eventUntilLabel,
  formatRub,
  gameOptionLabel,
  hasGameSchedule,
  ownAnswer,
  reminderErrorText,
  rosterHeadline,
  rosterSub,
  seriesUpcomingText,
  sortSchedule,
  validateEditDraft,
  type EventAttendee,
} from '../../lib/event-view';

const person = (id: string, over: Partial<EventAttendee> = {}): EventAttendee => ({
  userId: id,
  name: `Игрок ${id}`,
  nickname: `n${id}`,
  role: 'PLAYER',
  memberStatus: 'ACTIVE',
  rsvpStatus: 'CONFIRMED',
  ...over,
});

describe('права на событие', () => {
  const base = { type: EventType.TOURNAMENT, hasDeleteHandler: true, hasEditHandler: true };
  it('капитан управляет всем', () => {
    const p = eventPermissions({ ...base, role: Role.CAPTAIN });
    expect(p).toMatchObject({ canDelete: true, canEdit: true, canManageAttendance: true, canRemind: true, canAddGame: true, canSeeTable: true });
  });
  it('тренер на турнире не правит и не напоминает, но видит разбор', () => {
    const p = eventPermissions({ ...base, role: Role.TRAINER });
    expect(p).toMatchObject({ canDelete: false, canEdit: false, canRemind: false, canManageAttendance: false, canAddGame: false, canSeeTable: true });
  });
  it('тренер на тренировке управляет, но игры не добавляет', () => {
    const p = eventPermissions({ ...base, type: EventType.TRAINING, role: Role.TRAINER });
    expect(p).toMatchObject({ canDelete: true, canEdit: true, canRemind: true, canManageAttendance: true, canAddGame: false });
  });
  it('игрок ничего не управляет; без обработчиков нет удаления и правки', () => {
    expect(eventPermissions({ ...base, role: Role.PLAYER })).toMatchObject({ canDelete: false, canEdit: false, canSeeTable: false });
    expect(eventPermissions({ ...base, role: Role.CAPTAIN, hasDeleteHandler: false, hasEditHandler: false })).toMatchObject({ canDelete: false, canEdit: false });
  });
  it('расписание игр и слоты', () => {
    expect(hasGameSchedule(EventType.MEETING)).toBe(false);
    expect(hasGameSchedule(EventType.TRAINING)).toBe(true);
    expect(canManageSlots(Role.PLAYER)).toBe(false);
    expect(canManageSlots(Role.TRAINER)).toBe(true);
  });
});

describe('время и деньги', () => {
  const now = new Date(2026, 10, 11, 12, 0);
  it('подпись даты', () => {
    expect(eventDateLabel(new Date(2026, 10, 11, 20, 30), now)).toBe('Сегодня, ср 11 ноября');
    expect(eventDateLabel(new Date(2026, 10, 12, 20, 30), now)).toBe('Завтра, чт 12 ноября');
    expect(eventDateLabel(new Date(2026, 10, 16, 9, 0), now)).toBe('пн 16 ноября');
    expect(eventDateLabel(new Date(2027, 0, 5, 9, 0), now)).toBe('вт 5 января 2027');
  });
  it('«до» и фаза', () => {
    const start = new Date(2026, 10, 11, 20, 30);
    expect(eventUntilLabel(start, new Date(2026, 10, 11, 22, 0))).toBe('до 22:00');
    expect(eventUntilLabel(start, new Date(2026, 10, 12, 1, 0))).toBe('до 12 ноя., 01:00');
    expect(eventUntilLabel(start, null)).toBe('');
    expect(eventPhase(start, new Date(2026, 10, 11, 22, 0), now)).toBe('upcoming');
    expect(eventPhase(new Date(2026, 10, 11, 11, 0), new Date(2026, 10, 11, 13, 0), now)).toBe('live');
    expect(eventPhase(new Date(2026, 10, 10, 11, 0), new Date(2026, 10, 10, 13, 0), now)).toBe('past');
  });
  it('рубли с неразрывными пробелами', () => {
    expect(formatRub(1500)).toBe('1 500 ₽');
    expect(formatRub(0)).toBe('0 ₽');
    expect(formatRub(1234567)).toBe('1 234 567 ₽');
  });
});

describe('состав', () => {
  it('считает идущих, делит на пятёрки, дополняет свободными местами', () => {
    const attendees = [
      person('1', { role: 'CAPTAIN' }),
      ...['2', '3', '4', '5', '6'].map((id) => person(id)),
      person('7', { memberStatus: 'RESERVE' }),
      person('8', { rsvpStatus: 'UNANSWERED' }),
      person('9', { rsvpStatus: 'PENDING' }),
      person('10', { rsvpStatus: 'DECLINED' }),
    ];
    const roster = buildRoster({ attendees });
    expect(roster.goingCount).toBe(7);
    expect(roster.capacity).toBe(10);
    expect(roster.fives).toHaveLength(2);
    expect(roster.fives[0].people[0].role).toBe('CAPTAIN');
    expect(roster.fives[0].free).toBe(0);
    expect(roster.fives[1].people.map((p) => p.userId)).toEqual(['6', '7']);
    expect(roster.fives[1].free).toBe(3);
    expect(roster.silent.map((p) => p.userId)).toEqual(['8', '9']);
    expect(roster.declined.map((p) => p.userId)).toEqual(['10']);
    expect(roster.dots.map((row) => row.filter(Boolean).length)).toEqual([5, 2]);
    expect(rosterHeadline(roster)).toBe('Идут 7 из 10');
  });

  it('свободные места не больше остатка лимита', () => {
    const attendees = [person('1'), person('2'), person('3'), person('4'), person('5'), person('6')];
    const roster = buildRoster({ attendees, maxAttendees: 8 });
    expect(roster.capacity).toBe(8);
    expect(roster.fives[1].free).toBe(2);
  });

  it('тренеры идут отдельной группой и не занимают пятёрку; себя находит по id', () => {
    const roster = buildRoster({
      attendees: [person('t', { role: 'TRAINER' }), person('a'), person('me')],
      selfId: 'me',
    });
    expect(roster.staff.map((p) => p.userId)).toEqual(['t']);
    expect(roster.fives[0].people.map((p) => p.isSelf)).toEqual([false, true]);
    expect(roster.goingCount).toBe(3);
  });

  it('список не загружен: остаётся число из события', () => {
    const roster = buildRoster({ attendees: [], fallbackGoing: 4, maxAttendees: 12 });
    expect(roster.empty).toBe(true);
    expect(roster.goingCount).toBe(4);
    expect(roster.capacity).toBe(12);
    expect(roster.fives).toHaveLength(0);
    expect(rosterHeadline({ goingCount: 4, capacity: 0 })).toBe('Идут 4');
  });

  it('роль и статус по-русски', () => {
    expect(rosterSub({ role: 'CAPTAIN', memberStatus: 'ACTIVE' })).toBe('капитан');
    expect(rosterSub({ role: 'PLAYER', memberStatus: 'RESERVE' })).toBe('игрок · резерв');
    expect(rosterSub({ role: 'PLAYER', memberStatus: 'INJURED' })).toBe('игрок · травма');
    expect(rosterSub({ role: 'TRAINER', memberStatus: 'VACATION' })).toBe('тренер · в отпуске');
  });

  it('свой ответ', () => {
    expect(ownAnswer(RSVPStatus.CONFIRMED)).toBe('going');
    expect(ownAnswer(RSVPStatus.DECLINED)).toBe('declined');
    expect(ownAnswer(RSVPStatus.PENDING)).toBe('pending');
    expect(ownAnswer(RSVPStatus.UNANSWERED)).toBe('none');
  });
});

describe('игры и формы', () => {
  const game = (id: string, time: string): Game => ({ id, time, opponent: `Соперник ${id}` });
  it('игры по времени, «8:00» раньше «16:00»', () => {
    expect(sortSchedule([game('b', '16:00'), game('a', '8:00'), game('c', 'без времени')]).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(sortSchedule(undefined)).toEqual([]);
  });
  it('подпись игры в выборе', () => {
    expect(gameOptionLabel({ ...game('a', '12:00'), pitZone: 'NEAR', gamePair: 'FIRST' })).toBe('12:00 · Соперник a · Ближняя пит · Первая пара');
    expect(gameOptionLabel(game('a', '12:00'))).toBe('12:00 · Соперник a · пит ? · пара ?');
  });

  const event = { title: 'Тренировка', startDate: new Date(2026, 10, 11, 20, 30), cost: 1500 };
  it('черновик правки: конец по умолчанию +2 часа', () => {
    const draft = buildEditDraft(event);
    expect(draft).toMatchObject({ date: '2026-11-11', startTime: '20:30', endTime: '22:30', cost: '1500' });
  });
  it('проверка правки', () => {
    const draft = buildEditDraft(event);
    const ok = validateEditDraft(draft);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.patch).toMatchObject({ title: 'Тренировка', cost: 1500, location: undefined });
    expect(validateEditDraft({ ...draft, title: ' ' })).toEqual({ ok: false, error: 'Введи название события.' });
    expect(validateEditDraft({ ...draft, date: '' })).toMatchObject({ ok: false });
    expect(validateEditDraft({ ...draft, endTime: '20:30' })).toEqual({ ok: false, error: 'Окончание должно быть позже начала.' });
    expect(validateEditDraft({ ...draft, cost: '-5' })).toEqual({ ok: false, error: 'Некорректная стоимость.' });
    expect(validateEditDraft({ ...draft, cost: 'abc' })).toEqual({ ok: false, error: 'Некорректная стоимость.' });
    const free = validateEditDraft({ ...draft, cost: '' });
    expect(free.ok && free.patch.cost).toBeUndefined();
  });
  it('явка: сохранённое важнее намерения', () => {
    const attendees = [person('1'), person('2', { rsvpStatus: 'DECLINED' }), person('3', { rsvpStatus: 'UNANSWERED' })];
    expect(buildAttendanceDraft(attendees, null)).toEqual({ '1': true, '2': false, '3': false });
    expect(buildAttendanceDraft(attendees, [{ userId: '1', present: false }, { userId: '2', present: true }])).toEqual({ '1': false, '2': true, '3': false });
    expect(attendanceEntries(attendees, { '1': true })).toEqual([
      { userId: '1', present: true },
      { userId: '2', present: false },
      { userId: '3', present: false },
    ]);
  });
  it('тексты', () => {
    expect(reminderErrorText(403, false)).toMatch(/Нет прав/);
    expect(reminderErrorText(400, true)).toMatch(/добавь игры/);
    expect(reminderErrorText(500, false)).toMatch(/Проверь сеть/);
    expect(seriesUpcomingText(0)).toBe('Запишись сразу на все занятия серии.');
    expect(seriesUpcomingText(3)).toBe('Впереди ещё 3 занятия. Запишись сразу на все.');
    expect(seriesUpcomingText(5)).toBe('Впереди ещё 5 занятий. Запишись сразу на все.');
  });
});

import { slotsTileSub } from '../../lib/event-view';
import { avatarPhotoSrc } from '../../ui/team-mark';

describe('плитка слотов', () => {
  it('открытые слоты — места и цена, иначе подсказка', () => {
    expect(slotsTileSub({ open: true, capacity: 3, price: 3000 })).toBe('3 места · 3 000 ₽');
    expect(slotsTileSub({ open: true, capacity: 1, price: 0 })).toBe('1 место · бесплатно');
    expect(slotsTileSub({ open: true, capacity: 5, price: 500 })).toBe('5 мест · 500 ₽');
    expect(slotsTileSub({ open: false, capacity: 3, price: 3000 })).toBe('места и цена');
    expect(slotsTileSub(null)).toBe('места и цена');
  });
});

describe('фото или инициалы', () => {
  it('берёт фото только с нормальным адресом', () => {
    expect(avatarPhotoSrc('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(avatarPhotoSrc('/uploads/a.jpg')).toBe('/uploads/a.jpg');
    expect(avatarPhotoSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(avatarPhotoSrc('  ')).toBeNull();
    expect(avatarPhotoSrc(null)).toBeNull();
    expect(avatarPhotoSrc(undefined)).toBeNull();
  });
  it('внешний генератор и чужие схемы не используются', () => {
    expect(avatarPhotoSrc('https://ui-avatars.com/api/?name=A')).toBeNull();
    expect(avatarPhotoSrc('javascript:alert(1)')).toBeNull();
    expect(avatarPhotoSrc('//evil.example.com/a.jpg')).toBeNull();
  });
});
