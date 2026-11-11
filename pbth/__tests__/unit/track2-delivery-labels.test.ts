import { describe, expect, it } from 'vitest';
import { broadcastLabel, reserveLine } from '../../components/track2/delivery-labels';

// «Кому дошло» (спека event_announcements, 11.11.2026): последняя рассылка
// подписана по виду; запасные — отдельной строкой.

describe('подпись последней рассылки', () => {
  it('ручное «Напомнить» и старые ответы сервера без вида', () => {
    expect(broadcastLabel('REMINDER')).toBe('«Напомнить»');
    expect(broadcastLabel(undefined)).toBe('«Напомнить»');
  });

  it('сообщения о новом событии, переносе и отмене', () => {
    expect(broadcastLabel('ANNOUNCEMENT_CREATED')).toBe('Сообщение о новом событии');
    expect(broadcastLabel('ANNOUNCEMENT_RESCHEDULED')).toBe('Сообщение о переносе');
    expect(broadcastLabel('ANNOUNCEMENT_CANCELLED')).toBe('Сообщение об отмене');
  });
});

describe('строка запасных', () => {
  it('по именам, с подписью; нет запасных — нет строки', () => {
    expect(reserveLine(['Петя', 'Коля'])).toBe('В запасе — автоматические сообщения не приходят: Петя, Коля.');
    expect(reserveLine([])).toBeNull();
  });
});
