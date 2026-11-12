// Оформление команды: проверка значений и совпадение палитры с клиентом.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  normalizeLetters,
  TEAM_PAINTS,
  TEAM_SHAPE_COUNT,
  teamLookOf,
  teamLookPatchSchema,
} from "../../lib/team-look.js";

describe("буквы знака", () => {
  it("одна или две буквы или цифры, заглавными", () => {
    expect(normalizeLetters("hg")).toBe("HG");
    expect(normalizeLetters(" щ ")).toBe("Щ");
    expect(normalizeLetters("7я")).toBe("7Я");
  });
  it("пустая строка — сброс к буквам из названия", () => {
    expect(normalizeLetters("   ")).toBeNull();
  });
  it("три знака, пробел внутри, знаки и разметка — отказ", () => {
    expect(normalizeLetters("ABC")).toBeUndefined();
    expect(normalizeLetters("A B")).toBeUndefined();
    expect(normalizeLetters("<>")).toBeUndefined();
    expect(normalizeLetters("A&")).toBeUndefined();
    expect(normalizeLetters("🙂")).toBeUndefined();
  });
});

describe("тело запроса оформления", () => {
  it("краска только из палитры, регистр не важен", () => {
    expect(teamLookPatchSchema.parse({ paint: "#ff8a1f" })).toEqual({ paint: "#FF8A1F" });
    expect(teamLookPatchSchema.safeParse({ paint: "#123456" }).success).toBe(false);
    expect(teamLookPatchSchema.safeParse({ paint: "red" }).success).toBe(false);
    expect(teamLookPatchSchema.safeParse({ paint: "#FF8A1F;background:url(x)" }).success).toBe(false);
  });
  it("фигура — целое от 0 до 8", () => {
    expect(teamLookPatchSchema.parse({ shape: 8 })).toEqual({ shape: 8 });
    for (const shape of [-1, 9, 1.5, "2"]) {
      expect(teamLookPatchSchema.safeParse({ shape }).success).toBe(false);
    }
  });
  it("null сбрасывает поле, пустое тело и лишние поля — отказ", () => {
    expect(teamLookPatchSchema.parse({ paint: null, shape: null, letters: null })).toEqual({
      paint: null,
      shape: null,
      letters: null,
    });
    expect(teamLookPatchSchema.safeParse({}).success).toBe(false);
    expect(teamLookPatchSchema.safeParse({ paint: "#FF8A1F", logo: "https://example.com/x.png" }).success).toBe(false);
  });
});

describe("оформление в ответе", () => {
  it("команда без выбора — null, с выбором — три поля", () => {
    expect(teamLookOf({ mark_paint: null, mark_shape: null, mark_letters: null })).toBeNull();
    expect(teamLookOf({ mark_paint: null, mark_shape: 0, mark_letters: null })).toEqual({
      paint: null,
      shape: 0,
      letters: null,
      logo: null,
    });
  });
  it("логотип — путь приложения по имени файла; чужое значение в адрес не попадает", () => {
    const name = "0123456789abcdef0123456789abcdef";
    expect(teamLookOf({ mark_paint: null, mark_shape: null, mark_letters: null, mark_logo: name })).toEqual({
      paint: null,
      shape: null,
      letters: null,
      logo: `/api/v1/teams/logo/${name}.webp`,
    });
    for (const bad of ["../../etc/passwd", "https://example.com/x.png", name.toUpperCase(), name + "0"]) {
      expect(teamLookOf({ mark_paint: null, mark_shape: null, mark_letters: null, mark_logo: bad })).toBeNull();
    }
  });
});

describe("палитра сервера и клиента", () => {
  it("краски и число фигур совпадают с pbth/ui/team-mark.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const client = path.resolve(here, "../../../../pbth/ui/team-mark.ts");
    if (!fs.existsSync(client)) return; // сборка без фронтенда рядом
    const source = fs.readFileSync(client, "utf8");
    const paints = /TEAM_PAINTS = \[([^\]]+)\]/.exec(source)?.[1].match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(paints.map((p) => p.toUpperCase())).toEqual([...TEAM_PAINTS]);
    expect(Number(/TEAM_SHAPE_COUNT = (\d+)/.exec(source)?.[1])).toBe(TEAM_SHAPE_COUNT);
  });
});
