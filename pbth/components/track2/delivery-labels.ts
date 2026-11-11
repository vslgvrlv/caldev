// Подписи блока «Кому дошло» (спека event_announcements, 11.11.2026).
// Чистые функции: без React, их проверяют юнит-тесты.

export type BroadcastKind = 'REMINDER' | 'ANNOUNCEMENT_CREATED' | 'ANNOUNCEMENT_RESCHEDULED' | 'ANNOUNCEMENT_CANCELLED';

const LABELS: Record<BroadcastKind, string> = {
  REMINDER: '«Напомнить»',
  ANNOUNCEMENT_CREATED: 'Сообщение о новом событии',
  ANNOUNCEMENT_RESCHEDULED: 'Сообщение о переносе',
  ANNOUNCEMENT_CANCELLED: 'Сообщение об отмене',
};

/** Как назвать последнюю рассылку. Старый сервер вида не присылает — это «Напомнить». */
export function broadcastLabel(kind: BroadcastKind | undefined | null): string {
  return (kind && LABELS[kind]) || LABELS.REMINDER;
}

/** Строка о запасных: им не приходят ни авто-напоминания, ни сообщения о новых событиях. */
export function reserveLine(names: string[]): string | null {
  if (!names.length) return null;
  return `В запасе — автоматические сообщения не приходят: ${names.join(', ')}.`;
}
