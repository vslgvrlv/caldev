import { describe, expect, it } from "vitest";
import { publicFirstName } from "../../modules/teams/public-first-name.js";

// Имя зовущего на открытых экранах приглашения. `users.name` — свободный
// текст: при входе через Telegram без имени туда пишется `@username` или
// `tg-<id>`, люди вписывают телефон и почту. Наружу уходит только первое
// имя, и только если оно похоже на имя.

describe("publicFirstName", () => {
  it("имя и фамилия — только имя", () => {
    expect(publicFirstName("Денис Голев")).toBe("Денис");
    expect(publicFirstName("  Тренер   Тренеров ")).toBe("Тренер");
    expect(publicFirstName("Денис")).toBe("Денис");
    expect(publicFirstName("Ivan Petrov")).toBe("Ivan");
  });

  it("дефис и апостроф внутри имени допустимы", () => {
    expect(publicFirstName("Анна-Мария Иванова")).toBe("Анна-Мария");
    expect(publicFirstName("O'Brien")).toBe("O'Brien");
    expect(publicFirstName("D’Artagnan")).toBe("D’Artagnan");
  });

  it("дефис или апостроф по краям — не имя", () => {
    expect(publicFirstName("-Анна")).toBeNull();
    expect(publicFirstName("Анна-")).toBeNull();
    expect(publicFirstName("'Анна")).toBeNull();
    expect(publicFirstName("Анна--Мария")).toBeNull();
  });

  it("пусто — null", () => {
    expect(publicFirstName("")).toBeNull();
    expect(publicFirstName("  ")).toBeNull();
    expect(publicFirstName("\t\n")).toBeNull();
    expect(publicFirstName(null)).toBeNull();
    expect(publicFirstName(undefined)).toBeNull();
  });

  it("служебные имена Telegram — null", () => {
    expect(publicFirstName("tg-123")).toBeNull();
    expect(publicFirstName("tg-970000001")).toBeNull();
    expect(publicFirstName("TG-970000001")).toBeNull();
    expect(publicFirstName("@nick")).toBeNull();
    expect(publicFirstName("@nick_cap")).toBeNull();
  });

  it("телефон, почта, ссылка — null, даже во втором слове", () => {
    expect(publicFirstName("+7 999 123-45-67")).toBeNull();
    expect(publicFirstName("89991234567")).toBeNull();
    expect(publicFirstName("ivan@mail.ru")).toBeNull();
    expect(publicFirstName("Иван ivan@mail.ru")).toBeNull();
    expect(publicFirstName("Иван +79991234567")).toBeNull();
    expect(publicFirstName("Иван t.me/ivan")).toBeNull();
    expect(publicFirstName("https://example.com")).toBeNull();
    expect(publicFirstName("Иван vk.com")).toBeNull();
    expect(publicFirstName("Иван mail.ru")).toBeNull();
    expect(publicFirstName("Иван:секрет")).toBeNull();
  });

  it("цифры где угодно — null", () => {
    expect(publicFirstName("Иван2")).toBeNull();
    expect(publicFirstName("Иван Петров 2")).toBeNull();
    expect(publicFirstName("Иван ٣")).toBeNull();
  });

  it("не только буквы — null; эмодзи в имени — null", () => {
    expect(publicFirstName("🔥")).toBeNull();
    expect(publicFirstName("Денис🔥")).toBeNull();
    expect(publicFirstName("Ден_ис")).toBeNull();
    expect(publicFirstName("Денис!")).toBeNull();
    expect(publicFirstName("Ден​ис")).toBeNull();
    // Эмодзи во втором слове не уходит: наружу идёт только первое слово.
    expect(publicFirstName("Денис 🔥")).toBe("Денис");
  });

  it("длиннее 24 символов — null; ровно 24 — имя", () => {
    expect(publicFirstName("А".repeat(24))).toBe("А".repeat(24));
    expect(publicFirstName("А".repeat(25))).toBeNull();
    expect(publicFirstName(`${"Б".repeat(25)} Иванов`)).toBeNull();
  });

  it("буквы в разложенной форме приводятся к составной", () => {
    expect(publicFirstName("Йозеф".normalize("NFD"))).toBe("Йозеф");
  });

  it("точка без домена после неё (инициал) — первое слово остаётся", () => {
    expect(publicFirstName("Анна К.")).toBe("Анна");
  });
});
