import { describe, expect, it } from "vitest";
import { CSV_HEADER, renderTableCsv, type ReflectionCsvTable } from "../../lib/reflection-csv.js";

// CSV — то, ради чего таблица и существует: дальше разбор идёт в Excel.
// Сдвиг на одну колонку тихо переносит самооценку в чужую графу, поэтому
// раскладку сторожим тестом, а не глазами.

const table: ReflectionCsvTable = {
  positions: { "grid.300.far": "300Д", "snake.2.near": "Z2Б" },
  games: [
    {
      time: "10:00",
      opponent: "Соперник",
      score: "1:1",
      points: [
        {
          ordinal: 1,
          result: "WIN",
          deltaOtb: 1,
          deltaOtbMismatch: true,
          captainReport: {
            combination: "SNAKE_ATTACK",
            breakWidth: "WIDE",
            opponentBreakWidth: "NARROW",
            initiative: { snake: 1, center: 0, envelope: -1 },
            deltaOtb: 2,
            note: "разбежка была шире",
          },
          reflections: [
            {
              name: "Василий Гаврилов",
              nickname: "vasily",
              eliminated: true,
              deathPhase: "BREAK",
              deathPositionId: "grid.300.far",
              kills: [{ phase: "COVER", positionId: "snake.2.near" }],
              selfRating: 4,
              note: 'стоял на "тридцатке"; надо было идти дальше',
            },
          ],
        },
        {
          ordinal: 2,
          result: null,
          deltaOtb: 0,
          deltaOtbMismatch: null,
          captainReport: null,
          reflections: [],
        },
      ],
    },
  ],
};

const rows = () => renderTableCsv(table).split("\r\n");

describe("renderTableCsv", () => {
  it("заголовок и все строки одной ширины", () => {
    const widths = rows().map((line) => line.split(";").length);
    // Наивный split по ';' сломался бы на экранированной заметке, поэтому
    // ширину считаем только там, где кавычек нет.
    expect(widths[0]).toBe(CSV_HEADER.length);
    expect(widths[2]).toBe(CSV_HEADER.length);
  });

  it("укрытия подставляются кодами, а не идентификаторами", () => {
    const line = rows()[1];
    expect(line).toContain("300Д");
    expect(line).toContain("за укрытием · Z2Б");
    expect(line).not.toContain("grid.300.far");
  });

  // Выгрузку читает человек: «ROTATION» и «-1» он расшифровать не может
  // (Василий, 2026-07-31). Ни один код справочника не должен доехать до файла.
  it("коды справочников переводятся в подписи", () => {
    const line = rows()[1];
    expect(line).toContain("на разбежке");
    expect(line).toContain("атака по змеям");
    expect(line).toContain("широкая");
    // Инициатива: +1 — мы, 0 — поровну, −1 — они.
    expect(line).toContain("мы;поровну;они");
    for (const code of ["BREAK", "COVER", "ROTATION", "SNAKE_ATTACK", "NARROW", "WIDE"]) {
      expect(line).not.toContain(code);
    }
  });

  it("результат пойнта пишется словом, разметка пропущена — пусто", () => {
    expect(rows()[1]).toContain("выиграли");
    expect(rows()[2].startsWith("10:00;Соперник;1:1;2;;")).toBe(true);
  });

  // Пустой пойнт в выгрузке — это сигнал «команда рефлексию не заполняет».
  // Если такие строки выбрасывать, дыра в данных станет невидимой.
  it("пойнт без рефлексий всё равно даёт строку", () => {
    expect(rows()).toHaveLength(3);
  });

  it("заметка со спецсимволами экранируется по RFC 4180", () => {
    expect(rows()[1]).toContain('"стоял на ""тридцатке""; надо было идти дальше"');
  });

  it("расхождение с капитаном выводится словом, отсутствие ответа — пусто", () => {
    expect(rows()[1]).toContain(";да;");
    expect(rows()[2].split(";").slice(-8)[0]).toBe("");
  });
});
