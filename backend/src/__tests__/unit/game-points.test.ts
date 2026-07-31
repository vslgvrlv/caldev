import { describe, expect, it } from "vitest";
import { checkPointResults, parseScore } from "../../lib/game-points.js";

// Счёт вводится руками и целиком определяет, сколько пойнтов покажем игроку.
// Ошибка разбора здесь — это либо пропавшая форма рефлексии, либо сотня пустых.
describe("parseScore", () => {
  it("считает пойнты как сумму побед и поражений", () => {
    expect(parseScore("4:3")).toEqual({ our: 4, opponent: 3, total: 7 });
  });

  it("принимает дефис и тире — счёт пишут по-разному", () => {
    for (const score of ["4-3", "4 – 3", " 4—3 "]) {
      expect(parseScore(score)).toEqual({ our: 4, opponent: 3, total: 7 });
    }
  });

  it("сухой счёт — валидный гейм", () => {
    expect(parseScore("5:0")).toEqual({ our: 5, opponent: 0, total: 5 });
  });

  it("нет счёта — нет пойнтов", () => {
    expect(parseScore(null)).toBeNull();
    expect(parseScore("")).toBeNull();
    expect(parseScore("скоро")).toBeNull();
    expect(parseScore("4:")).toBeNull();
  });

  it("0:0 — гейм не сыгран, пойнтов быть не может", () => {
    expect(parseScore("0:0")).toBeNull();
  });

  // «40:30» — опечатка, а не гейм на 70 пойнтов.
  it("нереальный счёт отбрасывается, а не разворачивается в сотню пойнтов", () => {
    expect(parseScore("40:30")).toBeNull();
  });
});

describe("checkPointResults", () => {
  const score = { our: 4, opponent: 3, total: 7 };

  it("разметка сходится со счётом", () => {
    const results = ["WIN", "WIN", "WIN", "WIN", "LOSS", "LOSS", "LOSS"] as const;
    expect(checkPointResults(score, [...results])).toEqual({
      wins: 4,
      losses: 3,
      unmarked: 0,
      matchesScore: true,
    });
  });

  // Пока размечены не все пойнты, сходиться нечему: неполная разметка —
  // это «ещё не сделано», а не «сделано неправильно».
  it("неразмеченные пойнты не дают сойтись", () => {
    const r = checkPointResults(score, ["WIN", "WIN", "WIN", "WIN", "LOSS", "LOSS", null]);
    expect(r).toEqual({ wins: 4, losses: 2, unmarked: 1, matchesScore: false });
  });

  it("перекос в разметке ловится", () => {
    const r = checkPointResults(score, ["WIN", "WIN", "WIN", "WIN", "WIN", "LOSS", "LOSS"]);
    expect(r.matchesScore).toBe(false);
  });
});
