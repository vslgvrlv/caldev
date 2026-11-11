import { describe, expect, it } from 'vitest';
import { eventDetailsText, eventWhenText, inviteValidUntil, requestSentText } from '../../lib/invite-copy';

const now = new Date('2026-11-11T09:00:00Z');

describe('inviteValidUntil', () => {
  it('срок словами, без времени и секунд', () => {
    expect(inviteValidUntil('2026-11-18T12:34:56Z')).toBe('Приглашение действует до 18 ноября');
  });
  it('срок — по поясу команды, если он пришёл', () => {
    // 18 ноября 20:30 UTC: в Москве ещё 18-е, во Владивостоке уже 19-е.
    expect(inviteValidUntil('2026-11-18T20:30:00Z', 'Europe/Moscow')).toBe('Приглашение действует до 18 ноября');
    expect(inviteValidUntil('2026-11-18T20:30:00Z', 'Asia/Vladivostok')).toBe('Приглашение действует до 19 ноября');
    // битый пояс — без падения, по поясу браузера
    expect(inviteValidUntil('2026-11-18T12:00:00Z', 'Нет/Такого')).toBe('Приглашение действует до 18 ноября');
  });
  it('нет срока или он битый — строки нет', () => {
    expect(inviteValidUntil(null)).toBeNull();
    expect(inviteValidUntil('не дата')).toBeNull();
  });
});

describe('requestSentText', () => {
  it('сегодня, вчера и дата', () => {
    expect(requestSentText('2026-11-11T08:00:00Z', now)).toBe('Заявка отправлена сегодня');
    expect(requestSentText('2026-11-10T08:00:00Z', now)).toBe('Заявка отправлена вчера');
    expect(requestSentText('2026-11-01T08:00:00Z', now)).toBe('Заявка отправлена 1 ноября');
  });
});

describe('eventWhenText', () => {
  it('завтра и сегодня по часовому поясу события', () => {
    expect(eventWhenText('2026-11-12T16:00:00Z', 'Europe/Moscow', now)).toBe('Завтра в 19:00');
    expect(eventWhenText('2026-11-11T16:00:00Z', 'Europe/Moscow', now)).toBe('Сегодня в 19:00');
  });
  it('дальше — дата и время', () => {
    expect(eventWhenText('2026-11-20T16:00:00Z', 'Europe/Moscow', now)).toBe('20 ноября в 19:00');
  });
  it('дата дальше «завтра» — по поясу события', () => {
    expect(eventWhenText('2026-11-20T20:30:00Z', 'Europe/Moscow', now)).toBe('20 ноября в 23:30');
    expect(eventWhenText('2026-11-20T20:30:00Z', 'Asia/Vladivostok', now)).toBe('21 ноября в 06:30');
  });
});

describe('eventDetailsText', () => {
  it('название и место через точку', () => {
    expect(eventDetailsText('Тренировка', 'Арена')).toBe('Тренировка · Арена');
    expect(eventDetailsText('Тренировка', null)).toBe('Тренировка');
  });
});
