import { describe, expect, it } from "vitest";
import { announcementDueAt } from "../../lib/notification-schedule.js";

// Когда уходит сообщение о новом, перенесённом и отменённом событии (спека
// event_announcements, решения Василия 11.11.2026): через 3 минуты; ночью
// (22:00–09:00 по поясу команды) ждёт до 09:00, но только если от 09:00 до
// начала события не меньше 6 часов. Иначе уходит сразу, без звука.

const MSK = "Europe/Moscow";

describe("announcementDueAt", () => {
  it("днём — через 3 минуты, со звуком", () => {
    const now = new Date("2026-11-11T09:00:00Z"); // 12:00 МСК
    const start = new Date("2026-11-14T11:00:00Z");
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-11T09:03:00Z"), silent: false });
  });

  it("ночью, событие в 16:00 — ждёт до 09:00", () => {
    const now = new Date("2026-11-11T20:40:00Z"); // 23:40 МСК
    const start = new Date("2026-11-12T13:00:00Z"); // 16:00 МСК
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-12T06:00:00Z"), silent: false });
  });

  it("пример Василия: создано в 23:40, событие в 9:00 — сразу, без звука", () => {
    const now = new Date("2026-11-11T20:40:00Z"); // 23:40 МСК
    const start = new Date("2026-11-12T06:00:00Z"); // 09:00 МСК
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-11T20:43:00Z"), silent: true });
  });

  it("граница: событие в 14:59 — сразу без звука, в 15:00 — ждёт до 09:00", () => {
    const now = new Date("2026-11-12T00:30:00Z"); // 03:30 МСК, уже после полуночи
    expect(announcementDueAt(now, new Date("2026-11-12T11:59:00Z"), MSK)).toEqual({
      dueAt: new Date("2026-11-12T00:33:00Z"),
      silent: true,
    });
    expect(announcementDueAt(now, new Date("2026-11-12T12:00:00Z"), MSK)).toEqual({
      dueAt: new Date("2026-11-12T06:00:00Z"),
      silent: false,
    });
  });

  it("ночь считается по сроку отправки: в 21:58 срок уже в 22:01 — ночь", () => {
    const now = new Date("2026-11-11T18:58:00Z"); // 21:58 МСК
    const start = new Date("2026-11-13T15:00:00Z");
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-12T06:00:00Z"), silent: false });
  });

  it("в 08:57 срок в 09:00 — уже день", () => {
    const now = new Date("2026-11-12T05:57:00Z"); // 08:57 МСК
    const start = new Date("2026-11-12T08:00:00Z");
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-12T06:00:00Z"), silent: false });
  });

  it("пояс команды: 23:40 во Владивостоке — ночь, хотя в Москве день", () => {
    const now = new Date("2026-11-11T13:40:00Z"); // 23:40 Владивосток, 16:40 Москва
    const start = new Date("2026-11-12T06:00:00Z"); // 16:00 Владивосток
    expect(announcementDueAt(now, start, "Asia/Vladivostok")).toEqual({
      dueAt: new Date("2026-11-11T23:00:00Z"), // 09:00 Владивосток
      silent: false,
    });
    expect(announcementDueAt(now, start, MSK)).toEqual({ dueAt: new Date("2026-11-11T13:43:00Z"), silent: false });
  });

  it("задержка настраивается", () => {
    const now = new Date("2026-11-11T09:00:00Z");
    const start = new Date("2026-11-14T11:00:00Z");
    expect(announcementDueAt(now, start, MSK, 30).dueAt).toEqual(new Date("2026-11-11T09:00:30Z"));
  });
});
