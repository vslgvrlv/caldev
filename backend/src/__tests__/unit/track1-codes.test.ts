import { describe, expect, it } from "vitest";
import { generateJoinCode, normalizeJoinCode } from "../../modules/teams/join-link.js";
import { shortCodeBase } from "../../modules/team-requests/service.js";
import { canDecideJoinRequests } from "../../modules/join-requests/service.js";
import { parseJoinPayload } from "../../bot-callbacks/join.js";

describe("код ссылки команды", () => {
  it("шесть знаков без похожих букв и цифр", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it("набранный руками код приводится к виду из базы", () => {
    expect(normalizeJoinCode("ab3-k7q")).toBe("AB3K7Q");
    expect(normalizeJoinCode(" ab3 k7q ")).toBe("AB3K7Q");
    expect(normalizeJoinCode("../etc")).toBeNull();
    expect(normalizeJoinCode("")).toBeNull();
  });
});

describe("короткий код новой команды из названия", () => {
  it.each([
    ["Дневной Дозор", "DD"],
    ["Holy Guns", "HG"],
    ["Тигры", "TIGR"],
    ["  ", "TEAM"],
    ["Я", "YA"],
    ["A", "TEAM"],
  ])("%s → %s", (name, code) => {
    expect(shortCodeBase(name)).toBe(code);
  });
});

describe("кто решает заявки на вступление", () => {
  it("капитан и тренер — да, игрок и посторонний — нет", () => {
    expect(canDecideJoinRequests("CAPTAIN")).toBe(true);
    expect(canDecideJoinRequests("TRAINER")).toBe(true);
    expect(canDecideJoinRequests("PLAYER")).toBe(false);
    expect(canDecideJoinRequests(null)).toBe(false);
  });

  it("кнопка бота разбирается строго", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseJoinPayload(`approve:${id}`)).toEqual({ decision: "approve", requestId: id });
    expect(parseJoinPayload(`decline:${id}`)).toEqual({ decision: "decline", requestId: id });
    expect(parseJoinPayload(`delete:${id}`)).toBeNull();
    expect(parseJoinPayload("approve:not-a-uuid")).toBeNull();
  });
});
