// Повторяющиеся события (#52). Чистая валидация формы повтора перед отправкой.
// Бэкенд (миграция 009 event_series) уже принимает recurrence {enabled, weekdays, untilDate}.

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface RecurrenceInput {
  enabled: boolean;
  weekdays: Weekday[];
  untilDate: string; // YYYY-MM-DD
}

export interface RecurrencePayload {
  enabled: true;
  weekdays: Weekday[];
  untilDate: string;
}

export type RecurrenceResult =
  | { kind: 'none' }
  | { kind: 'ok'; value: RecurrencePayload }
  | { kind: 'error'; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Превращает состояние формы повтора в результат:
 * - выключено → none (recurrence не отправляем);
 * - включено и валидно → ok с payload;
 * - включено и невалидно → error с человекочитаемым сообщением.
 */
export function buildRecurrence(input: RecurrenceInput): RecurrenceResult {
  if (!input.enabled) return { kind: 'none' };
  if (!input.weekdays || input.weekdays.length === 0) {
    return { kind: 'error', message: 'Выберите хотя бы один день недели' };
  }
  if (!input.untilDate) {
    return { kind: 'error', message: 'Укажите дату, до которой повторять' };
  }
  if (!DATE_RE.test(input.untilDate)) {
    return { kind: 'error', message: 'Дата должна быть в формате ГГГГ-ММ-ДД' };
  }
  return { kind: 'ok', value: { enabled: true, weekdays: input.weekdays, untilDate: input.untilDate } };
}
