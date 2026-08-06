import { describe, expect, it } from "vitest";
import { compareDeltaOtb, computeDeltaOtb } from "../../lib/reflection-analytics.js";

// Формула §2.1 спеки — её Василий правил дважды, поэтому тест сторожит именно
// четыре ситуации из таблицы, а не «работает ли вычитание».
describe("computeDeltaOtb", () => {
  it("никого не потеряли и никого не отстрелили — равные составы", () => {
    expect(
      computeDeltaOtb({
        reflections: [
          { exitReason: "SURVIVED", exitPhase: null },
          { exitReason: "HIT", exitPhase: "COVER" },
        ],
        kills: [{ phase: "COVER" }, { phase: "ROTATION" }],
      })
    ).toEqual({ ourOtbLosses: 0, opponentOtbLosses: 0, deltaOtb: 0 });
  });

  it("отстреляли двоих, своих не потеряли — большинство +2", () => {
    expect(
      computeDeltaOtb({
        reflections: [{ exitReason: "SURVIVED", exitPhase: null }],
        kills: [{ phase: "BREAK" }, { phase: "BREAK" }, { phase: "COVER" }],
      }).deltaOtb
    ).toBe(2);
  });

  it("потеряли своего, никого не отстреляли — меньшинство −1", () => {
    expect(
      computeDeltaOtb({
        reflections: [
          { exitReason: "HIT", exitPhase: "BREAK" },
          { exitReason: "HIT", exitPhase: "ROTATION" },
        ],
        kills: [{ phase: "ROTATION" }],
      }).deltaOtb
    ).toBe(-1);
  });

  // Главная причина правки формулы: обоюдный отстрел на разбежке — это НЕ
  // «равные составы» и не «размен», а разница по количеству.
  it("двое наших против одного их на разбежке — это −1, а не размен", () => {
    expect(
      computeDeltaOtb({
        reflections: [
          { exitReason: "HIT", exitPhase: "BREAK" },
          { exitReason: "HIT", exitPhase: "BREAK" },
          { exitReason: "SURVIVED", exitPhase: null },
        ],
        kills: [{ phase: "BREAK" }],
      })
    ).toEqual({ ourOtbLosses: 2, opponentOtbLosses: 1, deltaOtb: -1 });
  });

  // Поражение за укрытием/на перемещении к разбежке отношения не имеет —
  // иначе дельта поехала бы на любом гейме.
  it("фазы COVER и ROTATION в дельту не входят ни с одной стороны", () => {
    expect(
      computeDeltaOtb({
        reflections: [{ exitReason: "HIT", exitPhase: "COVER" }],
        kills: [{ phase: "COVER" }, { phase: "ROTATION" }],
      })
    ).toEqual({ ourOtbLosses: 0, opponentOtbLosses: 0, deltaOtb: 0 });
  });

  // Штрафной вывод — не потеря на разбежке: соперник нас не отстрелил, и
  // записывать это ему в актив нельзя (#104).
  it("штрафной вывод на разбежке в дельту не входит", () => {
    expect(
      computeDeltaOtb({
        reflections: [
          { exitReason: "PENALTY", exitPhase: "BREAK" },
          { exitReason: "HIT", exitPhase: "BREAK" },
        ],
        kills: [{ phase: "BREAK" }],
      })
    ).toEqual({ ourOtbLosses: 1, opponentOtbLosses: 1, deltaOtb: 0 });
  });
});

describe("compareDeltaOtb", () => {
  it("капитан не проставил дельту — это не согласие, а отсутствие ответа", () => {
    expect(compareDeltaOtb(0, null)).toBeNull();
    expect(compareDeltaOtb(2, undefined)).toBeNull();
  });

  it("совпало — расхождения нет, разошлось — есть", () => {
    expect(compareDeltaOtb(-1, -1)).toBe(false);
    expect(compareDeltaOtb(-1, 0)).toBe(true);
    expect(compareDeltaOtb(0, 0)).toBe(false);
  });
});
