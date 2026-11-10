// Итог ручной рассылки «Напомнить» — одной строкой для `notify`, без чисел-загадок:
// сколько ушло и кому не ушло с причиной. Пуши считаются наравне с Telegram.

import type { ReminderSendResult } from '../../api/track2';

export type ReminderSummary = { kind: 'success' | 'error' | 'info'; text: string };

const MAX_NAMES = 4;

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function summarizeReminderResult(result: ReminderSendResult, expected?: number): ReminderSummary {
  const attempted = Number(result?.attempted || 0);
  if (attempted === 0) {
    return { kind: 'info', text: 'Напоминать некому: все уже ответили.' };
  }
  const recipients = Array.isArray(result.recipients) ? result.recipients : [];
  const delivered = recipients.length
    ? recipients.filter((r) => r.status === 'SENT' || r.status === 'QUEUED').length
    : Number(result.sent || 0) + Number(result.queued || 0);
  const notDelivered = recipients.filter((r) => r.status === 'FAILED' || r.status === 'NO_CHANNEL');

  const parts: string[] = [];
  if (delivered === attempted) {
    parts.push(`Напоминание ушло ${delivered} ${plural(delivered, 'человеку', 'людям', 'людям')}.`);
  } else {
    parts.push(`Напоминание ушло ${delivered} из ${attempted}.`);
  }
  if (notDelivered.length) {
    const shown = notDelivered.slice(0, MAX_NAMES).map((r) => `${r.name} — ${r.reason || 'не удалось отправить'}`);
    const rest = notDelivered.length - shown.length;
    parts.push(`Не ушло: ${shown.join('; ')}${rest > 0 ? ` и ещё ${rest}` : ''}.`);
  }
  if (typeof expected === 'number' && expected > attempted) {
    // Кнопка обещала «Напомнить (5)», а кто-то успел ответить, пока экран был открыт.
    const answered = expected - attempted;
    parts.push(`Ещё ${answered} ${plural(answered, 'ответил', 'ответили', 'ответили')} сами — им не слали.`);
  }
  return { kind: notDelivered.length ? 'error' : 'success', text: parts.join(' ') };
}
