// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { existsSync, readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const guide = (name: "captain" | "trainer") => readFileSync(fileURLToPath(new URL(`../../public/guide/${name}.html`, import.meta.url)), "utf8");
const section = (page: string, id: string) => page.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`))?.[1] ?? "";
const visibleText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const expectInOrder = (text: string, fragments: string[]) => { let cursor = -1; for (const fragment of fragments) { const next = text.indexOf(fragment, cursor + 1); expect(next, `missing or out of order: ${fragment}`).toBeGreaterThan(cursor); cursor = next; } };

describe("role guide pages", () => {
  it("ships the approved captain guide without internal jargon", () => {
    const captain = guide("captain");
    expectInOrder(visibleText(captain), ["Создать событие", "Нажмите кнопку создания события", "тренировка, сбор, турнир или чемпионат", "Событие появится у участников команды", "Проверить, кто придёт", "Посмотрите ответы участников", "У вас будет актуальный список участников", "Добавить игры и записать счёт", "Найдите раздел «Расписание игр»", "Результат нашей команды всегда указывается слева", "приложение создаст список игровых отрезков", "Указать порядок выигранных и проигранных отрезков", "отдельный отрезок игры называется", "Для каждого пойнта укажите: «Выиграли» или «Проиграли»", "Будет виден реальный ход игры", "Добавить заметки капитана", "Укажите, какую тактику использовала команда", "Наблюдения капитана попадут в общий разбор", "Посмотреть итоговый разбор события", "В разделе «Расписание игр» нажмите «Разбор»", "Откройте вкладку «Итоги»", "сильные и слабые места команды", "Вести деньги команды", "После события добавьте расходы команды", "участники, которые ещё не заплатили", "Вести состав команды", "Создайте приглашение для нового участника", "актуальный состав команды", "Короткая памятка капитана", "После каждой игры: внести счёт", "По составу: пригласить участников"]);
    for (const id of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) { expect(section(captain, id)).toContain("Что сделать"); expect(section(captain, id)).toContain("Что получится"); }
  });

  it("ships the approved trainer guide without captain actions", () => {
    const trainer = guide("trainer");
    expectInOrder(visibleText(trainer), ["Что может делать тренер", "Создавать тренировки и сборы", "Смотреть итоговый разбор события", "Создать тренировку или сбор", "Выберите «Тренировка» или «Сбор»", "Участники увидят новое занятие", "Отметить участников", "Отметьте тех, кто фактически участвовал", "Будет сохранён точный состав занятия", "Записать результаты и заметки", "отдельный отрезок игры называется", "Для каждого пойнта выберите «Выиграли» или «Проиграли»", "попадут в итоговый разбор события", "Посмотреть итоговый разбор", "Откройте вкладку «Итоги»", "конкретные темы для следующего занятия", "Что тренер не может изменять", "Создавать и редактировать турниры и чемпионаты", "Для этих действий нужно обратиться к капитану", "Короткая памятка тренера", "Перед занятием: создать тренировку или сбор", "Организация турниров, состав и деньги"]);
    for (const id of ["s2", "s3", "s4", "s5"]) { expect(section(trainer, id)).toContain("Что сделать"); expect(section(trainer, id)).toContain("Что получится"); }
  });

  it("keeps access, image matrix and raw assets explicit", () => {
    const captain = guide("captain"); const trainer = guide("trainer");
    expect(captain).toContain('<html lang="ru">'); expect(trainer).toContain('<html lang="ru">'); expect(captain).toContain('aria-labelledby="toc-title"'); expect(trainer).toContain('aria-labelledby="toc-title"'); expect(captain).toContain(":focus-visible"); expect(trainer).toContain(":focus-visible");
    expect(section(captain, "s1")).toContain("img/event-create.webp"); expect(section(trainer, "s2")).toContain("img/event-create.webp"); expect(section(captain, "s5")).toContain("img/captain-report.webp"); expect(section(captain, "s6")).toContain("img/event-summary.webp"); expect(section(trainer, "s5")).toContain("img/event-summary.webp"); expect(section(captain, "s6")).not.toContain("img/points.webp"); expect(section(trainer, "s5")).not.toContain("img/points.webp");
    for (const name of ["event-create.webp", "captain-report.webp", "event-summary.webp"]) expect(existsSync(fileURLToPath(new URL(`../../public/guide/img/${name}`, import.meta.url)))).toBe(true);
    for (const page of [captain, trainer]) expect(visibleText(page)).not.toMatch(/TRAINING|MEETING|TOURNAMENT|CHAMPIONSHIP|W\/L|event\s*→\s*expenses\s*→\s*collection|кольц|матриц|вафл|контур|актуализир/i);
  });
});
