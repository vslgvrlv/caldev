// Кому уходит сообщение о событии (спека event_announcements, раздел
// «Получатели»; решения Василия 11.11.2026). Чистая функция: на входе один
// участник команды, на выходе — слать или нет. Создатель действия отсеивается
// раньше, в запросе.
//
//   CREATED / EVENT       — не запасной, авто-напоминания не выключены, ответа нет или «думаю»;
//   CREATED / SERIES      — не запасной, авто-напоминания не выключены, на серию ещё не записан;
//   RESCHEDULED, CANCELLED — «иду» и «думаю» — всегда; не отвечавшие — если не
//                           запасной и авто-напоминания не выключены; отказавшимся — нет.
// В травме и в отпуске получают наравне со всеми.

import type { EffectiveRsvpStatus } from "../../lib/series-commitment.js";

export type AnnouncementKind = "CREATED" | "RESCHEDULED" | "CANCELLED";
export type AnnouncementScope = "EVENT" | "SERIES";

export type AudienceMember = {
  memberStatus: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION" | string;
  /** Ответ как в списке участников (`resolveEffectiveRsvp`). */
  state: EffectiveRsvpStatus;
  committedToSeries: boolean;
  autoRemindersOn: boolean;
};

export function receivesAnnouncement(kind: AnnouncementKind, scope: AnnouncementScope, m: AudienceMember): boolean {
  const reachable = m.memberStatus !== "RESERVE" && m.autoRemindersOn;
  if (kind === "CREATED") {
    if (!reachable) return false;
    if (scope === "SERIES") return !m.committedToSeries;
    return m.state === "UNANSWERED" || m.state === "PENDING";
  }
  if (m.state === "CONFIRMED" || m.state === "PENDING") return true;
  if (m.state === "DECLINED") return false;
  return reachable;
}
