// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Role = "captain" | "trainer" | "player";
const ROLES: Role[] = ["player", "trainer", "captain"];
const guideUrl = (path: string) => fileURLToPath(new URL(`../../public/guide/${path}`, import.meta.url));
const guide = (name: Role) => readFileSync(guideUrl(`${name}.html`), "utf8");
const section = (page: string, id: string) =>
  page.match(new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? "";
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

describe("role guide pages: new look on ui-kit", () => {
  it("every page uses the ui-kit theme files, the product mark and the role switcher", () => {
    for (const role of ROLES) {
      const page = guide(role);
      expect(page).toContain('<html lang="ru" data-ui-theme="dark">');
      for (const href of ["ui-kit/ui-kit.css", "ui-kit/themes/pbth-fonts.css", "ui-kit/themes/pbth.css", "ui-kit/pbth-ui.css", "guide.css"]) {
        expect(page).toContain(`href="${href}"`);
      }
      expect(page).toContain("ui-i-hexagon");
      expect(visibleText(page)).toContain("Paintball TeamHub");
      expect(page).toContain('aria-labelledby="toc-title"');
      expect(page).toContain('class="ui-glass');
      // Переход между инструкциями ролей: три ссылки, текущая отмечена.
      for (const other of ROLES) expect(page).toContain(`href="${other}.html"`);
      expect(page.match(/aria-current="page"/g)).toHaveLength(1);
      // Своего оформления в странице нет: ни <style>, ни своих цветов, ни своих значков.
      expect(page).not.toMatch(/<style|style="|<path|<polygon/i);
      expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    }
    expect(readFileSync(guideUrl("guide.css"), "utf8")).not.toMatch(/backdrop-filter|gradient|box-shadow|transition:\s*all|text-transform/);
  });

  it("table of contents leads to existing sections, section anchors are unique", () => {
    for (const role of ROLES) {
      const page = guide(role);
      const ids = [...page.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
      const toc = page.match(/<nav class="toc[\s\S]*?<\/nav>/)?.[0] ?? "";
      const targets = [...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
      expect(targets.length).toBe(ids.length);
      for (const target of targets) expect(ids, `${role}: #${target}`).toContain(target);
    }
  });

  it("images exist, are light and carry size, lazy loading and decoding", () => {
    for (const role of ROLES) {
      const page = guide(role);
      const images = [...page.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
      expect(images.length).toBeGreaterThan(5);
      for (const tag of images) {
        const src = tag.match(/src="(img\/[^"]+\.webp)"/)?.[1];
        expect(src, tag).toBeTruthy();
        expect(existsSync(guideUrl(src as string)), `${role}: ${src}`).toBe(true);
        expect(statSync(guideUrl(src as string)).size, `${src} weighs more than 200 KB`).toBeLessThanOrEqual(200 * 1024);
        expect(tag).toMatch(/width="\d+"/);
        expect(tag).toMatch(/height="\d+"/);
        expect(tag).toContain('loading="lazy"');
        expect(tag).toContain('decoding="async"');
        expect(tag).toMatch(/alt="[^"]{6,}"/);
      }
    }
    // Лишних картинок в каталоге нет: каждая используется какой-нибудь страницей.
    const used = new Set(ROLES.flatMap((role) => [...guide(role).matchAll(/img\/([^"]+\.webp)/g)].map((m) => m[1])));
    expect(readdirSync(guideUrl("img")).filter((name: string) => !used.has(name))).toEqual([]);
  });

  it("does not describe things the app does not have", () => {
    for (const role of ROLES) {
      const text = visibleText(guide(role));
      // Старые разделы и кнопки, которых нет после ревизии 11.11.2026.
      expect(text).not.toMatch(/Требуют ответа|Показать все события|Открыть и ответить|Играю|Слежу|Ждет ответа|Создайте приглашение/);
      expect(text).not.toMatch(/пункт «Ещё»|вкладк[аи] «Главная»|Продолжить с Telegram|ещё не добавил твой Telegram|узнает тебя по нику/);
      expect(text).not.toMatch(/кнопк[ауи] «Оплатил»|сумму сбора|Отметьте поступившие платежи/);
      expect(text).not.toMatch(/штраф за поздний ответ|regevent/i);
      expect(text).not.toMatch(/TRAINING|MEETING|TOURNAMENT|CHAMPIONSHIP|кольц|матриц|вафл|контур|актуализир/);
    }
  });
});

describe("player guide", () => {
  const player = () => visibleText(guide("player"));

  it("follows the current screens in order", () => {
    expectInOrder(player(), [
      "Зачем это приложение", "Отвечать на события", "Заполнять рефлексию", "Смотреть свою посещаемость",
      "Вход", "«Подать заявку»", "«Войти через Telegram»", "«Открыть Telegram»", "«Это я, войти»",
      "Вошёл, а команды нет", "«Ввести код команды»",
      "Главный экран «Моё»", "кнопка «Команды»", "«Ждут ответа: N»", "«Показать»",
      "Ответить на событие", "«Передумал»", "«Иду на все»", "«Выйти»",
      "Календарь", "точки в цветах команд",
      "Экран события", "«Идут N из M»", "«Свободно»", "«Не ответили»", "«Не идут»", "«Казна команды»",
      "Расписание игр и счёт", "Наша команда всегда слева", "«Пойнты»",
      "Пойнты", "семь пойнтов", "«Твоя рефлексия заполнена»", "Порядок отмечают капитан или тренер",
      "Рефлексия — пять шагов", "«Меня выбили»", "«Дожил до конца»", "«Вывели за штраф»", "«Мой штраф»", "«Штраф партнёра»",
      "На разбежке", "За укрытием", "На перемещении", "«Поменять фланги местами»",
      "0 / 1 / 2 / 3+", "«Добавить ещё килл»", "1 — провалил", "5 — отлично", "«Пропустить»", "«Сохранить»", "«К списку пойнтов»",
      "Команда и посещаемость", "«Состав»", "«Посещаемость»", "Руководство", "Тренерский штаб", "Основной состав", "Резерв",
      "Карточка игрока", "Казна", "«Мой долг»", "«Должники»", "Общий остаток и историю операций видит только капитан.",
      "Профиль и календарь в телефоне", "«Авто-напоминания о событиях»", "«Подписаться по URL»", "«Скачать .ics (файл)»",
      "Памятка", "«Ждут ответа» должно быть равно нулю",
    ]);
  });

  it("keeps the message promises: new, moved and cancelled events, reminders", () => {
    const text = player();
    expect(text).toContain("О новом событии, переносе и отмене бот напишет сам.");
    expect(text).toContain("накануне в 19:00 и утром в день события");
    expect(text).toContain("перенос и отмена событий, на которые ты идёшь, приходят всегда");
    expect(text).toContain("Выключатель убирает и сообщения о новых событиях");
  });

  it("has no balance or history for the player and no finance picture", () => {
    expect(player()).not.toMatch(/общий баланс команды|История — все движения/);
    expect(guide("player")).not.toContain("img/finance.webp");
  });
});

describe("trainer guide", () => {
  const trainer = () => visibleText(guide("trainer"));

  it("covers the trainer's own work in order", () => {
    expectInOrder(trainer(), [
      "Что может делать тренер", "Создавать тренировки и сборы.", "Создавать несколько повторяющихся тренировок.",
      "Отмечать участников.", "Отмечать выигранные и проигранные пойнты.", "Смотреть итоговый разбор события.",
      "Принимать заявки в команду.", "Отправлять ссылку команды новым игрокам.",
      "Создать тренировку или сбор", "зелёный «плюс»", "«Тренировка» или «Сбор»", "включи «Повторять»", "«Создать событие»",
      "Участники увидят новое занятие",
      "Отметить участников", "«Напомнить»", "«Явка»", "«Сохранить явку»", "Будет сохранён точный состав занятия",
      "Отметить пойнты и вести разбор", "отдельный отрезок игры называется", "«Пойнты»", "«W» (выиграли)", "«L» (проиграли)",
      "«Разметка сходится со счётом»", "попадут в итоговый разбор события",
      "Посмотреть итоговый разбор", "«Разбор»", "«Итоги»", "«По пойнтам»", "конкретные темы для следующего занятия",
      "Что тренер не может делать", "Создавать и редактировать турниры, чемпионаты и спарринги.", "Вносить счёт игр",
      "Удалять участников команды.", "Менять роли участников.", "Управлять деньгами, сборами, долгами и штрафами.",
      "Для этих действий нужно обратиться к капитану", "Короткая памятка тренера",
    ]);
    for (const id of ["s2", "s3", "s4", "s5"]) {
      expect(section(guide("trainer"), id)).toContain("Что сделать");
      expect(section(guide("trainer"), id)).toContain("Что получится");
    }
    const summary = section(guide("trainer"), "s5");
    expect(summary).toContain("<li>Посмотри:<ul>");
    expect((summary.match(/Посмотри:/g) || []).length).toBe(1);
    for (const fragment of ["последовательность побед и поражений;", "где и когда команда чаще теряла игроков;", "какие действия приносили лучший результат;", "какие проблемы повторялись;", "насколько полно участники заполнили данные."]) {
      expect(trainer()).toContain(fragment);
    }
  });

  it("does not give the trainer captain actions", () => {
    expect(trainer()).not.toContain("Приглашать и удалять участников команды.");
    expect(trainer()).not.toMatch(/Нажми «Добавить»|запиши счёт/);
  });
});

describe("captain guide", () => {
  const captain = () => visibleText(guide("captain"));

  it("covers the captain's work in order", () => {
    expectInOrder(captain(), [
      "Завести команду и позвать игроков", "«Создать команду»", "владелец PBTH", "строку «Пригласить»", "«Поделиться»", "QR-код",
      "«Принять»", "экране «Заявки»", "Игроки попадут в состав по одной ссылке", "«Отозвать и выпустить новую»",
      "Создать событие", "зелёный «плюс»", "тренировка, сбор, турнир, чемпионат, спарринг", "«Повторять»",
      "Событие появится у участников команды",
      "Через три минуты после создания игрокам придёт сообщение с кнопками «Иду / Не иду». Запасным автоматические сообщения не приходят — их можно позвать кнопкой «Напомнить».",
      "О переносе и отмене события бот сообщает тем, кто идёт, сам.",
      "Проверить, кто придёт", "Посмотри ответы участников", "Нажми «Напомнить»", "В блоке «Кому дошло»", "«Изменить»",
      "У тебя будет актуальный список участников", "кнопками «Иду» и «Не иду» прямо в Telegram",
      "Добавить игры и записать счёт", "«Расписание игр»", "Нажми «Добавить»", "Результат нашей команды всегда указывается слева",
      "приложение создаст список игровых отрезков",
      "Указать порядок выигранных и проигранных отрезков", "отдельный отрезок игры называется", "«Пойнты»",
      "«W» (выиграли)", "«L» (проиграли)", "«Разметка сходится со счётом»", "Будет виден реальный ход игры",
      "Добавить заметки капитана", "комбинацию, которую разыгрывали", "узкая или широкая разбежка", "Наблюдения капитана попадут в общий разбор",
      "Посмотреть итоговый разбор события", "«Разбор»", "«Итоги»", "сильные и слабые места команды",
      "Вести деньги команды", "строку «Казна»", "«Записать трату»", "«Списать»", "«Напомнить всем должникам»",
      "Расчёт сбора по событию и отметка платежей пока недоступны.",
      "Вести состав команды", "Прими заявку нового участника", "«Роль в команде»", "«Тренер»", "«В резерв»", "«Журнал команды»",
      "Открыть свободные слоты", "«Открытое расписание»", "«Свободные слоты»", "«Открыть слоты»", "Подписчики команды получат уведомление", "кнопкой «Снять»",
      "Короткая памятка капитана", "После каждой игры: внести счёт", "По составу: пригласить участников",
    ]);
    for (const id of ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s10"]) {
      expect(section(guide("captain"), id), id).toContain("Что сделать");
      expect(section(guide("captain"), id), id).toContain("Что получится");
    }
    const summary = section(guide("captain"), "s6");
    expect(summary).toContain("<li>Посмотри:<ul>");
    expect((summary.match(/Посмотри:/g) || []).length).toBe(1);
    for (const fragment of ["как менялся результат по ходу игр;", "где и на каком этапе чаще выбывали наши игроки;", "какие варианты начала игры приносили лучший результат;", "какие тактические решения работали лучше;", "достаточно ли команда заполнила данных для надёжных выводов."]) {
      expect(captain()).toContain(fragment);
    }
  });

  it("does not promise a collection or payment marks", () => {
    expect(captain()).not.toMatch(/сумму сбора|Отметьте поступившие платежи|Создайте приглашение/);
  });
});
