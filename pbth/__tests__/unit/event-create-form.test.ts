import { describe, expect, it } from 'vitest';
import { validateCreateEvent, type CreateEventDraft } from '../../lib/event-create-form';
import { groupMoney, sanitizeMoney } from '../../lib/money-input';

const draft: CreateEventDraft = {
  title: ' Тренировка ',
  type: 'TRAINING',
  date: '2026-11-20',
  time: '19:00',
  location: 'Бункер',
  locationUrl: '',
  locationAddress: '',
  description: '',
  cost: '1500',
};
const noRepeat = { enabled: false, weekdays: [] as never[], untilDate: '' };

describe('validateCreateEvent', () => {
  it('собирает прежний запрос: форма + startDate + cost числом, без recurrence', () => {
    const r = validateCreateEvent(draft, noRepeat);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.payload).sort()).toEqual(
        ['cost', 'date', 'description', 'location', 'locationAddress', 'locationUrl', 'recurrence', 'startDate', 'time', 'title', 'type'].sort(),
      );
      expect(r.payload.cost).toBe(1500);
      expect(r.payload.recurrence).toBeUndefined();
      expect(r.payload.startDate.getTime()).toBe(new Date('2026-11-20T19:00').getTime());
    }
  });
  it('пустая стоимость — 0', () => {
    const r = validateCreateEvent({ ...draft, cost: '' }, noRepeat);
    expect(r.ok && r.payload.cost).toBe(0);
  });
  it('название и дата — ошибки у своих полей', () => {
    const r = validateCreateEvent({ ...draft, title: '  ', date: '' }, noRepeat);
    expect(r).toEqual({ ok: false, errors: { title: 'Пожалуйста, введите название события', date: 'Пожалуйста, выберите дату' } });
  });
  it('серия: без дней — ошибка дней, без даты окончания — ошибка даты', () => {
    expect(validateCreateEvent(draft, { enabled: true, weekdays: [], untilDate: '2026-12-01' })).toEqual({
      ok: false,
      errors: { weekdays: 'Выберите хотя бы один день недели' },
    });
    expect(validateCreateEvent(draft, { enabled: true, weekdays: ['MON'], untilDate: '' })).toEqual({
      ok: false,
      errors: { until: 'Укажите дату, до которой повторять' },
    });
  });
  it('серия целиком — recurrence в запросе', () => {
    const r = validateCreateEvent(draft, { enabled: true, weekdays: ['MON', 'THU'], untilDate: '2026-12-31' });
    expect(r.ok && r.payload.recurrence).toEqual({ enabled: true, weekdays: ['MON', 'THU'], untilDate: '2026-12-31' });
  });
});

describe('поле суммы', () => {
  it('чистит ввод', () => {
    expect(sanitizeMoney('1 500 ₽')).toBe('1500');
    expect(sanitizeMoney('1500,5')).toBe('1500.5');
    expect(sanitizeMoney('12.345.6')).toBe('12.34');
    expect(sanitizeMoney('007')).toBe('7');
    expect(sanitizeMoney('abc')).toBe('');
  });
  it('разряды неразрывным пробелом', () => {
    expect(groupMoney('')).toBe('');
    expect(groupMoney('1500')).toBe('1 500');
    expect(groupMoney('1234567.5')).toBe('1 234 567,5');
    expect(groupMoney('0.')).toBe('0,');
  });
});
