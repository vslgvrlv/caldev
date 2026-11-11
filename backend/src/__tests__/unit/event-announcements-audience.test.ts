import { describe, expect, it } from "vitest";
import { receivesAnnouncement, type AudienceMember } from "../../modules/announcements/audience.js";

// Кому уходит сообщение о событии — таблица «Получатели» спеки event_announcements.

const base: AudienceMember = { memberStatus: "ACTIVE", state: "UNANSWERED", committedToSeries: false, autoRemindersOn: true };
const m = (over: Partial<AudienceMember>): AudienceMember => ({ ...base, ...over });

describe("receivesAnnouncement", () => {
  it("новое событие: без ответа и «думаю» — да; «иду» и «не иду» — нет", () => {
    expect(receivesAnnouncement("CREATED", "EVENT", m({}))).toBe(true);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ state: "PENDING" }))).toBe(true);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ state: "CONFIRMED" }))).toBe(false);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ state: "DECLINED" }))).toBe(false);
  });

  it("новое событие: запасной и выключивший авто-напоминания — нет; травма и отпуск — да", () => {
    expect(receivesAnnouncement("CREATED", "EVENT", m({ memberStatus: "RESERVE" }))).toBe(false);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ autoRemindersOn: false }))).toBe(false);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ memberStatus: "INJURED" }))).toBe(true);
    expect(receivesAnnouncement("CREATED", "EVENT", m({ memberStatus: "VACATION" }))).toBe(true);
  });

  it("новая серия: уже записанный на серию — нет", () => {
    expect(receivesAnnouncement("CREATED", "SERIES", m({}))).toBe(true);
    expect(receivesAnnouncement("CREATED", "SERIES", m({ committedToSeries: true }))).toBe(false);
    expect(receivesAnnouncement("CREATED", "SERIES", m({ memberStatus: "RESERVE" }))).toBe(false);
  });

  it("перенос и отмена: «иду» и «думаю» — всегда, даже запасному и выключившему; отказавшимся — нет", () => {
    for (const kind of ["RESCHEDULED", "CANCELLED"] as const) {
      expect(receivesAnnouncement(kind, "EVENT", m({ state: "CONFIRMED", memberStatus: "RESERVE" }))).toBe(true);
      expect(receivesAnnouncement(kind, "EVENT", m({ state: "PENDING", autoRemindersOn: false }))).toBe(true);
      expect(receivesAnnouncement(kind, "EVENT", m({ state: "DECLINED" }))).toBe(false);
      expect(receivesAnnouncement(kind, "EVENT", m({}))).toBe(true);
      expect(receivesAnnouncement(kind, "EVENT", m({ memberStatus: "RESERVE" }))).toBe(false);
      expect(receivesAnnouncement(kind, "EVENT", m({ autoRemindersOn: false }))).toBe(false);
    }
  });
});
