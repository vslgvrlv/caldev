import { describe, expect, it } from 'vitest';
import { summarizeReminderResult } from '../../components/track2/reminder-result';

// Итог «Напомнить» (трек 2): пуши считаются отправкой; кому не ушло — по именам и с причиной.

describe('итог ручной рассылки', () => {
  it('все получили пушем — не «Отправлено: 0»', () => {
    const summary = summarizeReminderResult({
      attempted: 3,
      sent: 3,
      pushed: 3,
      telegram: 0,
      queued: 0,
      skippedNoTelegram: 0,
      recipients: [
        { userId: '1', name: 'Петя', nickname: 'p', status: 'SENT', channel: 'WEBPUSH', reason: null },
        { userId: '2', name: 'Вася', nickname: 'v', status: 'SENT', channel: 'WEBPUSH', reason: null },
        { userId: '3', name: 'Коля', nickname: 'k', status: 'SENT', channel: 'TELEGRAM', reason: null },
      ],
    });
    expect(summary).toEqual({ kind: 'success', text: 'Напоминание ушло 3 людям.' });
  });

  it('«Напомнить (5)», а ушло троим — кому не ушло и почему', () => {
    const summary = summarizeReminderResult(
      {
        attempted: 5,
        sent: 3,
        queued: 0,
        skippedNoTelegram: 1,
        recipients: [
          { userId: '1', name: 'Петя', nickname: 'p', status: 'SENT', channel: 'TELEGRAM', reason: null },
          { userId: '2', name: 'Вася', nickname: 'v', status: 'SENT', channel: 'TELEGRAM', reason: null },
          { userId: '3', name: 'Коля', nickname: 'k', status: 'SENT', channel: 'WEBPUSH', reason: null },
          { userId: '4', name: 'Миша', nickname: 'm', status: 'FAILED', channel: 'TELEGRAM', reason: 'не запускал бота в Telegram' },
          { userId: '5', name: 'Гоша', nickname: 'g', status: 'NO_CHANNEL', channel: null, reason: 'нет канала: не входил через Telegram и не включил уведомления' },
        ],
      },
      5
    );
    expect(summary.kind).toBe('error');
    expect(summary.text).toBe(
      'Напоминание ушло 3 из 5. Не ушло: Миша — не запускал бота в Telegram; Гоша — нет канала: не входил через Telegram и не включил уведомления.'
    );
  });

  it('кнопка обещала пятерых, двое успели ответить сами', () => {
    const summary = summarizeReminderResult(
      {
        attempted: 3,
        sent: 3,
        queued: 0,
        skippedNoTelegram: 0,
        recipients: ['a', 'b', 'c'].map((id) => ({ userId: id, name: id, nickname: id, status: 'SENT' as const, channel: 'TELEGRAM' as const, reason: null })),
      },
      5
    );
    expect(summary.text).toBe('Напоминание ушло 3 людям. Ещё 2 ответили сами — им не слали.');
  });

  it('некому напоминать', () => {
    expect(summarizeReminderResult({ attempted: 0, sent: 0, queued: 0, skippedNoTelegram: 0 }).kind).toBe('info');
  });

  it('старый ответ сервера без списка получателей', () => {
    expect(summarizeReminderResult({ attempted: 2, sent: 1, queued: 1, skippedNoTelegram: 0 }).text).toBe('Напоминание ушло 2 людям.');
  });
});
