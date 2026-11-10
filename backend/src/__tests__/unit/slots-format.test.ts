import { describe, expect, it } from "vitest";
import {
  appendVerdict,
  buildSlotBookedText,
  buildSlotOpenText,
  formatFreeSlots,
  formatSlotPrice,
  formatSlotWhen,
} from "../../modules/slots/format.js";

// Фиксированные даты, чтобы день недели не зависел от дня прогона.
// 2026-11-17 — вторник; 20:30 по Москве = 17:30 UTC.
const TUESDAY_2030 = "2026-11-17T17:30:00Z";
const NOW_SUNDAY = new Date("2026-11-15T09:00:00Z");

describe("тексты открытых слотов", () => {
  it("образец Василия: «У Holy Guns во вторник в 20:30 … свободный слот, 3000 ₽»", () => {
    expect(
      buildSlotOpenText({
        teamName: "Holy Guns",
        startAt: TUESDAY_2030,
        timeZone: "Europe/Moscow",
        location: "Точка",
        price: 3000,
        free: 1,
        now: NOW_SUNDAY,
      })
    ).toBe("У Holy Guns во вторник в 20:30 на площадке «Точка» свободный слот, 3000 ₽");
  });

  it("число мест и предлоги дней недели", () => {
    expect(formatFreeSlots(1)).toBe("свободный слот");
    expect(formatFreeSlots(2)).toBe("2 свободных слота");
    expect(formatFreeSlots(5)).toBe("5 свободных слотов");
    expect(formatFreeSlots(21)).toBe("21 свободный слот");
    expect(formatSlotWhen("2026-11-18T17:30:00Z", "Europe/Moscow", NOW_SUNDAY)).toBe("в среду в 20:30");
    expect(formatSlotWhen("2026-11-16T07:05:00Z", "Europe/Moscow", NOW_SUNDAY)).toBe("в понедельник в 10:05");
  });

  it("через неделю и дальше — с датой; часовой пояс команды", () => {
    expect(formatSlotWhen("2026-11-24T17:30:00Z", "Europe/Moscow", NOW_SUNDAY)).toBe("во вторник 24.11 в 20:30");
    expect(formatSlotWhen(TUESDAY_2030, "Asia/Yekaterinburg", NOW_SUNDAY)).toBe("во вторник в 22:30");
    expect(formatSlotWhen(TUESDAY_2030, "Нет/Такого", NOW_SUNDAY)).toBe("во вторник в 20:30");
  });

  it("цена: без копеек и бесплатно; без места — без площадки", () => {
    expect(formatSlotPrice(3000)).toBe("3000 ₽");
    expect(formatSlotPrice("1500.50")).toBe("1500,5 ₽");
    expect(formatSlotPrice(0)).toBe("бесплатно");
    expect(
      buildSlotOpenText({ teamName: "HG", startAt: TUESDAY_2030, price: 0, free: 3, now: NOW_SUNDAY })
    ).toBe("У HG во вторник в 20:30 3 свободных слота, бесплатно");
  });

  it("капитану: «<имя> занял слот»", () => {
    expect(
      buildSlotBookedText({
        guestName: "Иван",
        eventTitle: "Тренировка",
        startAt: TUESDAY_2030,
        price: 3000,
        booked: 2,
        capacity: 2,
        now: NOW_SUNDAY,
      })
    ).toBe("Иван занял слот\n«Тренировка», во вторник в 20:30, 3000 ₽. Мест больше нет.");
    expect(appendVerdict("Текст", "Ты записан.")).toBe("Текст\n\nТы записан.");
    expect(appendVerdict("", "Мест уже нет.")).toBe("Мест уже нет.");
  });
});
