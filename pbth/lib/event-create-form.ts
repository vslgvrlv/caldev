// Проверка формы «Новое событие» без React: что отправлять и какую ошибку
// показать у какого поля. Тексты ошибок и форма запроса — прежние.
import { buildRecurrence, type RecurrencePayload, type Weekday } from './recurrence';

export type CreateEventDraft = {
  title: string;
  type: string;
  date: string;
  time: string;
  location: string;
  locationUrl: string;
  locationAddress: string;
  description: string;
  cost: string;
};

export type CreateEventErrors = Partial<Record<'title' | 'date' | 'weekdays' | 'until' | 'form', string>>;

export type CreateEventPayload = Omit<CreateEventDraft, 'cost'> & {
  startDate: Date;
  cost: number;
  recurrence: RecurrencePayload | undefined;
};

export type CreateEventResult = { ok: true; payload: CreateEventPayload } | { ok: false; errors: CreateEventErrors };

export function validateCreateEvent(
  draft: CreateEventDraft,
  repeat: { enabled: boolean; weekdays: Weekday[]; untilDate: string },
): CreateEventResult {
  const errors: CreateEventErrors = {};
  if (!draft.title.trim()) errors.title = 'Пожалуйста, введите название события';
  if (!draft.date) errors.date = 'Пожалуйста, выберите дату';
  if (errors.title || errors.date) return { ok: false, errors };

  const startDate = new Date(`${draft.date}T${draft.time || '00:00'}`);
  if (Number.isNaN(startDate.getTime())) return { ok: false, errors: { date: 'Некорректная дата' } };

  const recurrence = buildRecurrence({ enabled: repeat.enabled, weekdays: repeat.weekdays, untilDate: repeat.untilDate });
  if (recurrence.kind === 'error') {
    return { ok: false, errors: repeat.weekdays.length === 0 ? { weekdays: recurrence.message } : { until: recurrence.message } };
  }

  return {
    ok: true,
    payload: {
      ...draft,
      startDate,
      cost: draft.cost ? Number(draft.cost) : 0,
      recurrence: recurrence.kind === 'ok' ? recurrence.value : undefined,
    },
  };
}
