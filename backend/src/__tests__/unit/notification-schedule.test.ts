import { describe, expect, it } from "vitest";
import { autoReminderWindows, dueAutoReminder, zonedTimeToUtc } from "../../lib/notification-schedule.js";

// Расписание авто-напоминаний: накануне 19:00–22:00 и утром 09:00–12:00 по
// поясу команды; утреннее — только событиям с 11:00 и позже.

describe("zonedTimeToUtc", () => {
  it("Москва: 19:00 местного = 16:00 UTC", () => {
    expect(zonedTimeToUtc(2026, 11, 21, 19, 0, "Europe/Moscow").toISOString()).toBe("2026-11-21T16:00:00.000Z");
  });

  it("Владивосток: 09:00 местного = 23:00 UTC накануне", () => {
    expect(zonedTimeToUtc(2026, 11, 22, 9, 0, "Asia/Vladivostok").toISOString()).toBe("2026-11-21T23:00:00.000Z");
  });

  it("Берлин летом и зимой — разный сдвиг", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 19, 0, "Europe/Berlin").toISOString()).toBe("2026-07-01T17:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 19, 0, "Europe/Berlin").toISOString()).toBe("2026-12-01T18:00:00.000Z");
  });

  it("неизвестный пояс — Москва, без падения", () => {
    expect(zonedTimeToUtc(2026, 11, 21, 19, 0, "Mars/Olympus").toISOString()).toBe("2026-11-21T16:00:00.000Z");
  });
});

describe("autoReminderWindows", () => {
  it("событие в 20:30 по Москве: накануне 19–22 и утром 09–12", () => {
    const start = new Date("2026-11-22T17:30:00Z"); // 20:30 МСК
    const windows = autoReminderWindows(start, "Europe/Moscow");
    expect(windows.map((w) => [w.slot, w.slotKey, w.windowStart.toISOString(), w.windowEnd.toISOString()])).toEqual([
      ["EVE", "EVE:2026-11-22", "2026-11-21T16:00:00.000Z", "2026-11-21T19:00:00.000Z"],
      ["MORNING", "MORNING:2026-11-22", "2026-11-22T06:00:00.000Z", "2026-11-22T09:00:00.000Z"],
    ]);
  });

  it("раннее событие (10:00) — только вечернее", () => {
    const start = new Date("2026-11-22T07:00:00Z"); // 10:00 МСК
    expect(autoReminderWindows(start, "Europe/Moscow").map((w) => w.slot)).toEqual(["EVE"]);
  });

  it("событие ровно в 11:00 — утреннее есть и заканчивается к 11:00", () => {
    const start = new Date("2026-11-22T08:00:00Z"); // 11:00 МСК
    const morning = autoReminderWindows(start, "Europe/Moscow").find((w) => w.slot === "MORNING");
    expect(morning?.windowEnd.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("дата события берётся по поясу команды, а не по UTC", () => {
    // 23:30 UTC 21-го — это уже 22-е во Владивостоке (09:30).
    const start = new Date("2026-11-21T23:30:00Z");
    const windows = autoReminderWindows(start, "Asia/Vladivostok");
    expect(windows[0].slotKey).toBe("EVE:2026-11-22");
    expect(windows[0].windowStart.toISOString()).toBe("2026-11-21T09:00:00.000Z"); // 19:00 21-го по Владивостоку
  });
});

describe("dueAutoReminder", () => {
  const start = new Date("2026-11-22T17:30:00Z"); // 20:30 МСК, 22-е

  it("до 19:00 накануне — ничего", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-21T15:59:00Z"))).toBeNull();
  });

  it("19:05 накануне — вечернее", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-21T16:05:00Z"))?.slot).toBe("EVE");
  });

  it("сервер поднялся в 21:30 — вечернее ещё пора", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-21T18:30:00Z"))?.slot).toBe("EVE");
  });

  it("ночью — ничего", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-21T20:00:00Z"))).toBeNull();
  });

  it("09:10 в день события — утреннее", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-22T06:10:00Z"))?.slotKey).toBe("MORNING:2026-11-22");
  });

  it("после начала — ничего", () => {
    expect(dueAutoReminder(start, "Europe/Moscow", new Date("2026-11-22T17:31:00Z"))).toBeNull();
  });

  it("одно и то же событие в разных поясах — разные моменты", () => {
    // 20:30 по Екатеринбургу (UTC+5) — 15:30 UTC.
    const ekb = new Date("2026-11-22T15:30:00Z");
    const at = new Date("2026-11-21T14:05:00Z"); // 19:05 Екатеринбург, 17:05 Москва
    expect(dueAutoReminder(ekb, "Asia/Yekaterinburg", at)?.slot).toBe("EVE");
    expect(dueAutoReminder(ekb, "Europe/Moscow", at)).toBeNull();
  });

  it("событие сегодня в 20:00, создано в 19:30 — вечернего окна уже нет, утреннее прошло", () => {
    const today = new Date("2026-11-21T17:00:00Z"); // 20:00 МСК 21-го
    expect(dueAutoReminder(today, "Europe/Moscow", new Date("2026-11-21T16:30:00Z"))).toBeNull();
  });
});
