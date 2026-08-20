import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guide = (name: "captain" | "trainer") =>
  readFileSync(resolve(process.cwd(), "public", "guide", `${name}.html`), "utf8");

describe("role guide pages", () => {
  it("ships an accessible captain guide with the required operational sections", () => {
    const page = guide("captain");

    expect(page).toContain('<html lang="ru">');
    expect(page).toContain('<nav class="toc" aria-labelledby="toc-title">');
    expect(page).toContain('id="s9"');
    expect(page).toContain('Разметка не совпадает со счётом');
    expect(page).toContain('event → expenses → collection');
    expect(page).toContain(':focus-visible');
  });

  it("keeps trainer capabilities and captain-only boundaries explicit", () => {
    const page = guide("trainer");

    expect(page).toContain('TRAINING');
    expect(page).toContain('MEETING');
    expect(page).toContain('TOURNAMENT');
    expect(page).toContain('CHAMPIONSHIP');
    expect(page).toContain('Это граница роли, а не ошибка и не действие для обхода');
    expect(page).toContain('<nav class="toc" aria-labelledby="toc-title">');
    expect(page).toContain(':focus-visible');
  });
});
