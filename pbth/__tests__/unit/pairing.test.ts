import { describe, expect, it } from 'vitest';
import {
  formatPairingCountdown,
  nextPollDelayMs,
  pairingSecondsLeft,
  pairingStatusMessage,
  restorePairingAttempt,
  shouldKeepPolling,
  type PairingScreenState,
} from '../../lib/pairing';

describe('nextPollDelayMs', () => {
  it('первые секунды опрашивает часто — человек жмёт «Это я» почти сразу', () => {
    expect(nextPollDelayMs(0)).toBe(1_000);
    expect(nextPollDelayMs(19_999)).toBe(1_000);
  });

  it('дальше разрежает, чтобы не греть батарею весь TTL', () => {
    expect(nextPollDelayMs(20_000)).toBe(2_000);
    expect(nextPollDelayMs(59_999)).toBe(2_000);
    expect(nextPollDelayMs(60_000)).toBe(4_000);
    expect(nextPollDelayMs(280_000)).toBe(4_000);
  });

  it('интервал только растёт', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= 300_000; elapsed += 1_000) {
      const delay = nextPollDelayMs(elapsed);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });
});

describe('pairingSecondsLeft', () => {
  const now = Date.parse('2026-08-06T18:00:00Z');

  it('считает остаток по метке сервера', () => {
    expect(pairingSecondsLeft('2026-08-06T18:05:00Z', now)).toBe(300);
    expect(pairingSecondsLeft('2026-08-06T18:00:30Z', now)).toBe(30);
  });

  it('не уходит в минус после истечения', () => {
    expect(pairingSecondsLeft('2026-08-06T17:59:00Z', now)).toBe(0);
  });

  it('переживает мусор вместо даты', () => {
    expect(pairingSecondsLeft('когда-нибудь', now)).toBe(0);
  });
});

describe('formatPairingCountdown', () => {
  it('показывает минуты и секунды', () => {
    expect(formatPairingCountdown(300)).toBe('5:00');
    expect(formatPairingCountdown(65)).toBe('1:05');
    expect(formatPairingCountdown(9)).toBe('0:09');
    expect(formatPairingCountdown(0)).toBe('0:00');
  });

  it('не рисует отрицательное время', () => {
    expect(formatPairingCountdown(-10)).toBe('0:00');
  });
});

describe('restorePairingAttempt', () => {
  const now = Date.parse('2026-09-05T06:00:00Z');
  const attempt = {
    scope: 'USER' as const,
    redirectTo: '/app',
    code: 'WD3F-Q7PR',
    botUrl: 'https://t.me/pbthub_bot?start=pair_WD3FQ7PR',
    botUsername: 'pbthub_bot',
    expiresAt: '2026-09-05T06:05:00Z',
    startedAt: now,
  };

  it('восстанавливает живую попытку после remount страницы', () => {
    expect(restorePairingAttempt(JSON.stringify(attempt), 'USER', '/app', now)).toEqual(attempt);
  });

  it('не восстанавливает истёкшую или чужую по scope/redirect попытку', () => {
    expect(restorePairingAttempt(JSON.stringify(attempt), 'USER', '/app', now + 301_000)).toBeNull();
    expect(restorePairingAttempt(JSON.stringify(attempt), 'ADMIN', '/app', now)).toBeNull();
    expect(restorePairingAttempt(JSON.stringify(attempt), 'USER', '/admin', now)).toBeNull();
  });

  it('переживает повреждённое localStorage-значение', () => {
    expect(restorePairingAttempt('{broken', 'USER', '/app', now)).toBeNull();
  });
});

describe('shouldKeepPolling', () => {
  it('крутится, пока исход не решён', () => {
    expect(shouldKeepPolling('waiting')).toBe(true);
    expect(shouldKeepPolling('claimed')).toBe(true);
  });

  it('останавливается на всём, что само уже не изменится', () => {
    for (const state of ['idle', 'starting', 'approved', 'denied', 'expired', 'error'] as PairingScreenState[]) {
      expect(shouldKeepPolling(state)).toBe(false);
    }
  });
});

describe('pairingStatusMessage', () => {
  it('различает «код ещё не дошёл» и «дошёл, ждём нажатия»', () => {
    // Без этой разницы человек, отправивший код, шлёт его второй раз.
    expect(pairingStatusMessage('waiting')).not.toBe(pairingStatusMessage('claimed'));
    expect(pairingStatusMessage('claimed')).toContain('Код получен');
  });

  it('из каждого тупика показывает путь вперёд', () => {
    expect(pairingStatusMessage('expired')).toContain('новый');
    expect(pairingStatusMessage('error')).toContain('ещё раз');
    expect(pairingStatusMessage('denied')).toContain('не работает');
  });
});
