// #46: классификация исхода отправки уведомления для пер-получательского журнала
// notification_deliveries. Чистая функция — тестируется без БД.

export type DeliveryStatus = "SENT" | "QUEUED" | "FAILED";

export interface DeliveryClassification {
  status: DeliveryStatus;
  errorDetail?: string;
}

/**
 * SYNC → SENT, QUEUE → QUEUED. Любая ошибка перевешивает режим → FAILED
 * с человекочитаемым detail. Этого достаточно, чтобы показать капитану,
 * кому реально ушло, а кому нет.
 */
export function classifyDelivery(input: { mode?: "SYNC" | "QUEUE"; error?: unknown }): DeliveryClassification {
  if (input.error !== undefined && input.error !== null) {
    const errorDetail = input.error instanceof Error ? input.error.message : String(input.error);
    return { status: "FAILED", errorDetail };
  }
  return { status: input.mode === "QUEUE" ? "QUEUED" : "SENT" };
}
