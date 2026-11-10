import { RSVPStatus } from '../types';

// Свой ответ на явку: кому его предлагать и как он сразу виден на экране.
//
// - Свой ответ даёт только тот, кто в составе команды события. Владелец
//   платформы в чужой команде (`via: 'owner'`) в составе не числится — сервер
//   на его ответ отдаёт 404, поэтому кнопок «Иду / Не иду / Думаю» у него нет
//   нигде: ни на экране события, ни на главной, ни в календаре. Сервер
//   помечает такие события `viewerInRoster: false`; старый ответ без поля —
//   как раньше (в составе).
// - После ответа список явки меняется сразу локально и перечитывается с
//   сервера, когда запрос завершился. Ответ более раннего чтения, пришедший
//   позже, не затирает новое состояние (`createLatestOnly`).

export function canAnswerRsvp(event: { viewerInRoster?: boolean } | null | undefined): boolean {
  return Boolean(event) && event!.viewerInRoster !== false;
}

/** Событие после своего ответа: статус и число идущих. */
export function applyRsvpToEvent<E extends { rsvpStatus: RSVPStatus; attendeesCount: number }>(
  event: E,
  status: RSVPStatus,
): E {
  const wasGoing = event.rsvpStatus === RSVPStatus.CONFIRMED;
  const isGoing = status === RSVPStatus.CONFIRMED;
  const diff = isGoing === wasGoing ? 0 : isGoing ? 1 : -1;
  return { ...event, rsvpStatus: status, attendeesCount: Math.max(0, (event.attendeesCount || 0) + diff) };
}

/** Список явки после своего ответа: меняется только своя строка. */
export function applyRsvpToAttendees<A extends { userId: string; rsvpStatus: string }>(
  attendees: A[],
  userId: string | null | undefined,
  status: RSVPStatus,
): A[] {
  if (!userId) return attendees;
  let changed = false;
  const next = attendees.map((item) => {
    if (item.userId !== userId || item.rsvpStatus === status) return item;
    changed = true;
    return { ...item, rsvpStatus: status };
  });
  return changed ? next : attendees;
}

/**
 * Последнее слово за последним действием: каждое чтение берёт номер, а
 * применяется, только если после него не было нового чтения или ответа.
 */
export function createLatestOnly() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isLatest(token: number): boolean {
      return token === current;
    },
  };
}

export type LatestOnly = ReturnType<typeof createLatestOnly>;

/**
 * Свой ответ на экране события: список меняется сразу, начатые раньше чтения
 * больше не применяются; когда запрос завершился (успешно или нет — после
 * отказа сервер вернёт прежний ответ), список перечитывается. Нет сети на
 * перечитывании — остаётся локальный ответ.
 */
export async function answerAndRefresh<L>(steps: {
  latest: LatestOnly;
  applyLocal: () => void;
  send: () => Promise<unknown> | unknown;
  load: () => Promise<L>;
  commit: (list: L) => void;
}): Promise<void> {
  steps.latest.next();
  steps.applyLocal();
  try {
    await steps.send();
  } catch {
    // Отказ показывает тот, кто отправлял; список всё равно перечитываем.
  }
  const token = steps.latest.next();
  try {
    const list = await steps.load();
    if (steps.latest.isLatest(token)) steps.commit(list);
  } catch {
    // Без сети — оставляем то, что уже на экране.
  }
}
