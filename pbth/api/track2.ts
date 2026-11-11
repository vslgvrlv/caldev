// Трек 2 «Явка»: запросы к своим ручкам (спека ревизии, «Клиент API»).
import { request } from '../api';

export type ReminderAudience = 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'SILENT' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
export type ReminderTemplate = 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';

export type DeliveryStatus = 'SENT' | 'QUEUED' | 'FAILED' | 'NO_CHANNEL';

export type ReminderRecipient = {
  userId: string;
  name: string;
  nickname: string;
  status: DeliveryStatus;
  channel: 'TELEGRAM' | 'WEBPUSH' | null;
  reason: string | null;
};

export type ReminderSendResult = {
  attempted: number;
  /** Ушло сразу любым каналом (Telegram или пуш). */
  sent: number;
  pushed?: number;
  telegram?: number;
  queued: number;
  skippedNoTelegram: number;
  recipients?: ReminderRecipient[];
};

export function sendEventReminder(payload: {
  eventId: string;
  audience: ReminderAudience;
  template: ReminderTemplate;
  gameId?: string;
}): Promise<ReminderSendResult> {
  return request(`/notifications/events/${payload.eventId}/remind`, {
    method: 'POST',
    body: { audience: payload.audience, template: payload.template, gameId: payload.gameId },
  });
}

export type EventDeliveryReport = {
  eventId: string;
  autoRemindersEnabled: boolean;
  lastBroadcast: null | {
    /** Вид рассылки; старый сервер не присылает — значит «Напомнить». */
    kind?: 'REMINDER' | 'ANNOUNCEMENT_CREATED' | 'ANNOUNCEMENT_RESCHEDULED' | 'ANNOUNCEMENT_CANCELLED';
    at: string;
    total: number;
    delivered: number;
    failed: number;
    noChannel: number;
    items: Array<{ userId: string; name: string; nickname: string; status: DeliveryStatus; channel: string | null; reason: string | null }>;
  };
  auto: Array<{
    userId: string;
    name: string;
    nickname: string;
    count: number;
    lastAt: string;
    lastSlot: 'EVE' | 'MORNING';
    lastStatus: DeliveryStatus;
    lastReason: string | null;
  }>;
  members: Array<{
    userId: string;
    name: string;
    nickname: string;
    rsvpStatus: 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
    autoRemindersOff: boolean;
    /** В запасе: автоматические сообщения не приходят. */
    reserve?: boolean;
    channels: { telegram: boolean; push: boolean };
  }>;
};

export function getEventDelivery(eventId: string): Promise<EventDeliveryReport> {
  return request(`/reminders/events/${eventId}/delivery`);
}

export type ReminderSettings = { autoEventReminders: boolean };

export function getReminderSettings(): Promise<ReminderSettings> {
  return request('/reminders/settings');
}

export function setReminderSettings(settings: ReminderSettings): Promise<ReminderSettings> {
  return request('/reminders/settings', { method: 'PUT', body: settings });
}

/** Сигнал экрану «кому дошло»: рассылка только что ушла, перечитать журнал. */
export const REMINDERS_SENT_EVENT = 'pbth:track2:reminders-sent';

export function announceRemindersSent(eventId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REMINDERS_SENT_EVENT, { detail: { eventId } }));
}
