// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { existsSync, readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const guide = (name: "captain" | "trainer" | "player") =>
  readFileSync(fileURLToPath(new URL(`../../public/guide/${name}.html`, import.meta.url)), "utf8");
const section = (page: string, id: string) =>
  page.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`))?.[1] ?? "";
const visibleText = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const expectInOrder = (text: string, fragments: string[]) => {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = text.indexOf(fragment, cursor + 1);
    expect(next, `missing or out of order: ${fragment}`).toBeGreaterThan(cursor);
    cursor = next;
  }
};

describe("role guide pages", () => {
  it("ships the approved captain guide without internal jargon", () => {
    const captain = guide("captain");
    expectInOrder(visibleText(captain), [
      "Завести команду и позвать игроков", "нажмите «Создать команду»", "нажмите «Пригласить»",
      "Принимайте заявки", "Игроки попадут в состав по одной ссылке",
      "Создать событие", "Нажмите кнопку создания события", "тренировка, сбор, турнир или чемпионат",
      "Событие появится у участников команды",
      "Через три минуты после создания игрокам придёт сообщение с кнопками «Иду / Не иду». Запасным автоматические сообщения не приходят — их можно позвать кнопкой «Напомнить».",
      "Проверить, кто придёт", "Посмотрите ответы участников",
      "Нажмите «Напомнить»", "В блоке «Кому дошло»", "У вас будет актуальный список участников",
      "кнопками «Иду» и «Не иду» прямо в Telegram", "Добавить игры и записать счёт",
      "Найдите раздел «Расписание игр»", "Результат нашей команды всегда указывается слева",
      "приложение создаст список игровых отрезков", "Указать порядок выигранных и проигранных отрезков",
      "отдельный отрезок игры называется", "Для каждого пойнта укажите: «Выиграли» или «Проиграли»",
      "Будет виден реальный ход игры", "Добавить заметки капитана",
      "Укажите, какую тактику использовала команда", "Наблюдения капитана попадут в общий разбор",
      "Посмотреть итоговый разбор события", "В разделе «Расписание игр» нажмите «Разбор»",
      "Откройте вкладку «Итоги»", "сильные и слабые места команды", "Вести деньги команды",
      "После события добавьте расходы команды", "Будет понятно, сколько команда потратила",
      "Вести состав команды", "Нажмите «Пригласить» и отправьте ссылку команды", "актуальный состав команды",
      "Открыть свободные слоты", "Нажмите «Открыть слоты»", "Подписчики команды получат уведомление",
      "Короткая памятка капитана", "После каждой игры: внести счёт", "По составу: пригласить участников",
    ]);
    for (const id of ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s10"]) {
      expect(section(captain, id)).toContain("Что сделать");
      expect(section(captain, id)).toContain("Что получится");
    }
  });

  it("ships the approved trainer guide without captain actions", () => {
    const trainer = guide("trainer");
    expectInOrder(visibleText(trainer), [
      "Что может делать тренер", "Создавать тренировки и сборы", "Смотреть итоговый разбор события",
      "Создать тренировку или сбор", "Выберите «Тренировка» или «Сбор»", "Участники увидят новое занятие",
      "Отметить участников", "Отметьте тех, кто фактически участвовал", "Будет сохранён точный состав занятия",
      "Записать результаты и заметки", "отдельный отрезок игры называется",
      "Для каждого пойнта выберите «Выиграли» или «Проиграли»", "попадут в итоговый разбор события",
      "Посмотреть итоговый разбор", "Откройте вкладку «Итоги»", "конкретные темы для следующего занятия",
      "Что тренер не может изменять", "Создавать и редактировать турниры и чемпионаты",
      "Для этих действий нужно обратиться к капитану", "Короткая памятка тренера",
      "Перед занятием: создать тренировку или сбор", "Организация турниров, состав и деньги",
    ]);
    for (const id of ["s2", "s3", "s4", "s5"]) {
      expect(section(trainer, id)).toContain("Что сделать");
      expect(section(trainer, id)).toContain("Что получится");
    }
  });

  it("keeps every designer-required canonical copy detail", () => {
    const captain = visibleText(guide("captain"));
    const trainer = visibleText(guide("trainer"));
    for (const fragment of [
      "Отметьте, как начинали игру мы и соперник.",
      "Добавьте короткую заметку: что получилось и что нужно изменить.",
      "Посмотрите:", "как менялся результат по ходу игр;", "где и на каком этапе чаще выбывали наши игроки;",
      "какие варианты начала игры приносили лучший результат", "какие тактические решения работали лучше",
      "достаточно ли команда заполнила данных для надёжных выводов.", "При необходимости измените его статус.",
    ]) expect(captain).toContain(fragment);
    for (const fragment of [
      "Откройте нужную игру.", "Проверьте, что количество побед и поражений совпадает со счётом.",
      "Добавьте короткие наблюдения по игре.", "Посмотрите:", "последовательность побед и поражений;",
      "где и когда команда чаще теряла игроков;", "какие действия приносили лучший результат;",
      "какие проблемы повторялись;", "насколько полно участники заполнили данные.",
    ]) expect(trainer).toContain(fragment);
    const captainSummary = section(guide("captain"), "s6");
    const trainerSummary = section(guide("trainer"), "s5");
    expect(captainSummary).toContain("<li>Посмотрите:<ul>");
    expect(trainerSummary).toContain("<li>Посмотрите:<ul>");
    expect((captainSummary.match(/Посмотрите:/g) || []).length).toBe(1);
    expect((trainerSummary.match(/Посмотрите:/g) || []).length).toBe(1);
  });

  it("keeps the remaining canonical operational copy verbatim", () => {
    const captain = visibleText(guide("captain"));
    const trainer = visibleText(guide("trainer"));
    expectInOrder(captain, [
      "Откройте нужное событие.", "Если время или место изменились, отредактируйте событие.",
      "После окончания игры запишите счёт.", "Нажмите «Пойнты» рядом с нужной игрой.",
      "Проверьте, что количество побед и поражений совпадает со счётом игры.",
      "Проверьте долги и историю операций.",
      "Будет понятно, сколько команда потратила и кто ещё не заплатил.",
      "Расчёт сбора по событию и отметка платежей пока недоступны.",
      "Примите заявку нового участника.", "При необходимости сделайте участника тренером.",
    ]);
    expectInOrder(trainer, [
      "Создавать тренировки и сборы.", "Создавать несколько повторяющихся тренировок.", "Отмечать участников.",
      "Записывать результаты игр.", "Добавлять заметки к игровым отрезкам.", "Смотреть итоговый разбор события.",
      "Принимать заявки в команду.", "Отправлять ссылку команды новым игрокам.",
      "Для повторяющихся занятий создайте сразу несколько событий.", "Откройте тренировку или сбор.",
      "Посмотрите ответы команды.", "Отметьте тех, кто фактически участвовал.",
      "Создавать и редактировать турниры и чемпионаты.", "Удалять участников команды.",
      "Менять роли участников.", "Управлять деньгами, сборами, долгами и штрафами.",
    ]);
  });

  it("keeps access, image matrix and raw assets explicit", () => {
    const captain = guide("captain");
    const trainer = guide("trainer");
    expect(captain).toContain('<html lang="ru">');
    expect(trainer).toContain('<html lang="ru">');
    expect(captain).toContain('aria-labelledby="toc-title"');
    expect(trainer).toContain('aria-labelledby="toc-title"');
    expect(captain).toContain(":focus-visible");
    expect(trainer).toContain(":focus-visible");
    expect(section(captain, "s1")).toContain("img/event-create.webp");
    expect(section(trainer, "s2")).toContain("img/event-create.webp");
    expect(section(captain, "s5")).toContain("img/captain-report.webp");
    expect(section(captain, "s6")).toContain("img/event-summary.webp");
    expect(section(trainer, "s5")).toContain("img/event-summary.webp");
    expect(section(captain, "s6")).not.toContain("img/points.webp");
    expect(section(trainer, "s5")).not.toContain("img/points.webp");
    for (const name of ["event-create.webp", "captain-report.webp", "event-summary.webp"]) {
      expect(existsSync(fileURLToPath(new URL(`../../public/guide/img/${name}`, import.meta.url)))).toBe(true);
    }
    for (const page of [captain, trainer]) {
      expect(visibleText(page)).not.toMatch(/TRAINING|MEETING|TOURNAMENT|CHAMPIONSHIP|W\/L|event\s*→\s*expenses\s*→\s*collection|кольц|матриц|вафл|контур|актуализир/i);
    }
  });

  // Ревизия 11.11.2026: вход кодом и ссылка команды вместо личных приглашений,
  // сбор по событию спрятан, игрок не видит баланс и историю казны. Инструкции
  // не должны обещать того, чего на экранах нет.
  it("does not describe screens the revision removed", () => {
    const captain = visibleText(guide("captain"));
    const player = visibleText(guide("player"));
    expect(captain).not.toMatch(/сумму сбора|Отметьте поступившие платежи|Создайте приглашение/);
    expect(player).not.toMatch(/Продолжить с Telegram|ещё не добавил твой Telegram|узнает тебя по нику/);
    expect(player).not.toMatch(/общий баланс команды|История — все движения/);
    expect(player).toContain("«Войти и подать заявку»");
    expect(player).toContain("Общий баланс и историю операций видит только капитан.");
    // Сообщения о новом, перенесённом и отменённом событии (спека event_announcements).
    expect(player).toContain("О новом событии, переносе и отмене бот напишет сам.");
    expect(guide("player")).not.toContain("img/finance.webp");
    // Тренер принимает заявки и делится ссылкой команды; убрать из состава может только капитан.
    expect(visibleText(guide("trainer"))).not.toContain("Приглашать и удалять участников команды.");
  });
});
