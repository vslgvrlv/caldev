import { describe, expect, it } from "vitest";
import {
  buildEventCancelledMessage,
  buildEventCreatedMessage,
  buildEventRescheduledMessage,
  buildSeriesCancelledMessage,
  buildSeriesCreatedMessage,
  buildSeriesRescheduledMessage,
  formatWeekdays,
  parseSeriesCallbackPayload,
  replaceLastParagraph,
  seriesCallbackData,
  SERIES_COMMITTED_LINE,
  sessionsLabel,
} from "../../lib/notification-messages.js";

// Тексты сообщений о новом, перенесённом и отменённом событии — дословно по
// спеке event_announcements (11.11.2026).

const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const SERIES_ID = "66666666-7777-4888-9999-000000000000";
const eventUrl = `https://pbthub.ru/t/holy/event/${EVENT_ID}`;
const calendarUrl = "https://pbthub.ru/t/holy/calendar";

const card = {
  eventId: EVENT_ID,
  title: "Закрытие сезона",
  startAt: "2026-11-14T11:00:00Z", // суббота, 14 ноября, 14:00 МСК
  location: "Точка",
  locationUrl: null,
  teamName: "Holy Guns",
  timezone: "Europe/Moscow",
};

const rsvpButtons = [
  [
    { text: "Иду", callback_data: `rsvp:yes:${EVENT_ID}` },
    { text: "Не иду", callback_data: `rsvp:no:${EVENT_ID}` },
  ],
  [{ text: "Открыть событие", url: eventUrl }],
];

// Вт и чт с 17 ноября по 29 декабря 2026, 20:30 МСК — 13 занятий.
function tueThuStarts(): Date[] {
  const out: Date[] = [];
  for (let d = new Date("2026-11-17T17:30:00Z"); d <= new Date("2026-12-29T17:30:00Z"); d = new Date(d.getTime() + 86_400_000)) {
    const wd = d.getUTCDay();
    if (wd === 2 || wd === 4) out.push(d);
  }
  return out;
}

describe("новое событие", () => {
  it("текст и кнопки — как в спеке", () => {
    const msg = buildEventCreatedMessage({ card, state: "UNANSWERED", eventUrl });
    expect(msg.text).toBe(
      ["<b>Holy Guns</b> · новое событие", "Закрытие сезона", "суббота, 14 ноября, 14:00", "Место: Точка", "", "Идёшь?"].join("\n")
    );
    expect(msg.parseMode).toBe("HTML");
    expect(msg.replyMarkup.inline_keyboard).toEqual(rsvpButtons);
    expect(msg.push).toMatchObject({ title: "Holy Guns: Закрытие сезона", url: eventUrl, tag: `event-${EVENT_ID}` });
    expect(msg.push.actions?.map((a) => a.title)).toEqual(["Иду", "Не иду"]);
  });

  it("последний абзац — строка ответа: кнопка «Иду» заменяет ровно её", () => {
    const msg = buildEventCreatedMessage({ card, state: "UNANSWERED", eventUrl });
    const replaced = replaceLastParagraph(msg.text, [], "Ты идёшь.");
    expect(replaced?.text.split("\n\n")[0]).toBe(msg.text.split("\n\n")[0]);
    expect(replaced?.text.endsWith("\n\nТы идёшь.")).toBe(true);
  });

  it("всё, что ввёл человек, экранируется", () => {
    const msg = buildEventCreatedMessage({
      card: { ...card, title: "Сбор <b>&</b>", teamName: "A&B <team>", location: "<Поле>" },
      state: "UNANSWERED",
      eventUrl,
    });
    expect(msg.text).toContain("<b>A&amp;B &lt;team&gt;</b> · новое событие");
    expect(msg.text).toContain("Сбор &lt;b&gt;&amp;&lt;/b&gt;");
    expect(msg.text).toContain("Место: &lt;Поле&gt;");
  });
});

describe("перенос", () => {
  it("было → стало, строка ответа как в напоминаниях", () => {
    const msg = buildEventRescheduledMessage({
      card: { ...card, startAt: "2026-11-15T09:00:00Z" }, // воскресенье, 15 ноября, 12:00
      previous: { startAt: "2026-11-14T11:00:00Z", location: "Точка" },
      state: "CONFIRMED",
      eventUrl,
    });
    expect(msg.text).toBe(
      [
        "<b>Holy Guns</b> · событие перенесено",
        "Закрытие сезона",
        "воскресенье, 15 ноября, 12:00",
        "Место: Точка",
        "Было: суббота, 14 ноября, 14:00",
        "",
        "Сейчас у тебя: иду. Передумаешь — нажми «Не иду».",
      ].join("\n")
    );
    expect(msg.replyMarkup.inline_keyboard).toEqual(rsvpButtons);
  });

  it("поменялось только место — «Было: Точка»", () => {
    const msg = buildEventRescheduledMessage({
      card: { ...card, location: "Арена" },
      previous: { startAt: card.startAt, location: "Точка" },
      state: "UNANSWERED",
      eventUrl,
    });
    expect(msg.text).toContain("Место: Арена\nБыло: Точка\n\nОтвета от тебя пока нет. Идёшь?");
  });

  it("поменялись и время, и место — оба в строке «Было», место экранируется", () => {
    const msg = buildEventRescheduledMessage({
      card: { ...card, startAt: "2026-11-15T09:00:00Z", location: "Арена" },
      previous: { startAt: card.startAt, location: "<Точка>" },
      state: "PENDING",
      eventUrl,
    });
    expect(msg.text).toContain("Было: суббота, 14 ноября, 14:00, &lt;Точка&gt;");
    expect(msg.text.endsWith("Сейчас у тебя: думаю. Идёшь?")).toBe(true);
  });
});

describe("отмена", () => {
  it("без кнопок ответа, со ссылкой на календарь", () => {
    const msg = buildEventCancelledMessage({ card, calendarUrl });
    expect(msg.text).toBe(["<b>Holy Guns</b> · событие отменено", "Закрытие сезона", "суббота, 14 ноября, 14:00"].join("\n"));
    expect(msg.replyMarkup.inline_keyboard).toEqual([[{ text: "Открыть календарь", url: calendarUrl }]]);
    expect(msg.push.actions).toBeUndefined();
  });

  it("название экранируется", () => {
    expect(buildEventCancelledMessage({ card: { ...card, title: "<x>" }, calendarUrl }).text).toContain("&lt;x&gt;");
  });
});

describe("новая серия", () => {
  it("одно сообщение с кнопками «Иду на все» и «Открыть»", () => {
    const msg = buildSeriesCreatedMessage({
      seriesId: SERIES_ID,
      teamName: "Holy Guns",
      title: "Тренировка",
      location: "Точка",
      locationUrl: null,
      timezone: "Europe/Moscow",
      starts: tueThuStarts(),
      openUrl: eventUrl,
    });
    expect(msg.text).toBe(
      [
        "<b>Holy Guns</b> · новые занятия",
        "Тренировка",
        "вт и чт в 20:30, с 17 ноября по 29 декабря · 13 занятий",
        "Место: Точка",
        "",
        "Ходишь на все?",
      ].join("\n")
    );
    expect(msg.replyMarkup.inline_keyboard).toEqual([
      [{ text: "Иду на все", callback_data: `series:yes:${SERIES_ID}` }],
      [{ text: "Открыть", url: eventUrl }],
    ]);
    expect(msg.push.actions).toBeUndefined();
  });

  it("кнопка «Иду на все» укладывается в 64 байта и разбирается обратно", () => {
    const data = seriesCallbackData(SERIES_ID);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseSeriesCallbackPayload(data.slice("series:".length))).toEqual({ seriesId: SERIES_ID });
    expect(parseSeriesCallbackPayload("no:" + SERIES_ID)).toBeNull();
    expect(parseSeriesCallbackPayload("yes:xyz")).toBeNull();
  });

  it("строка после нажатия", () => {
    expect(SERIES_COMMITTED_LINE).toBe("Ты ходишь на все занятия. Отказаться от отдельного можно в приложении.");
  });

  it("дни недели и число занятий по-русски", () => {
    expect(formatWeekdays([2])).toBe("вт");
    expect(formatWeekdays([4, 2])).toBe("вт и чт");
    expect(formatWeekdays([1, 3, 5])).toBe("пн, ср и пт");
    expect(formatWeekdays([7, 6])).toBe("сб и вс");
    expect([1, 2, 5, 11, 21, 22, 25].map(sessionsLabel)).toEqual([
      "1 занятие",
      "2 занятия",
      "5 занятий",
      "11 занятий",
      "21 занятие",
      "22 занятия",
      "25 занятий",
    ]);
  });
});

describe("перенос и отмена серии", () => {
  it("«занятия перенесены»: с какого числа, новое время и место, строка «Было», без кнопок ответа", () => {
    const starts = tueThuStarts().map((d) => new Date(d.getTime() + 30 * 60_000)); // 21:00
    const msg = buildSeriesRescheduledMessage({
      teamName: "Holy Guns",
      title: "Тренировка",
      location: "Точка",
      locationUrl: null,
      timezone: "Europe/Moscow",
      starts,
      previous: { startAt: "2026-11-17T17:30:00Z", location: "Точка", weekdays: [2, 4] },
      openUrl: eventUrl,
    });
    expect(msg.text).toBe(
      [
        "<b>Holy Guns</b> · занятия перенесены",
        "Тренировка",
        "с 17 ноября: вт и чт в 21:00",
        "Место: Точка",
        "Было: вт и чт в 20:30",
      ].join("\n")
    );
    expect(msg.replyMarkup.inline_keyboard).toEqual([[{ text: "Открыть", url: eventUrl }]]);
  });

  it("«занятия отменены»: с какого числа и сколько занятий", () => {
    const msg = buildSeriesCancelledMessage({
      teamName: "Holy Guns",
      title: "Тренировка <A>",
      timezone: "Europe/Moscow",
      fromStartAt: "2026-11-17T17:30:00Z",
      count: 13,
      calendarUrl,
    });
    expect(msg.text).toBe(["<b>Holy Guns</b> · занятия отменены", "Тренировка &lt;A&gt;", "с 17 ноября · 13 занятий"].join("\n"));
    expect(msg.replyMarkup.inline_keyboard).toEqual([[{ text: "Открыть календарь", url: calendarUrl }]]);
  });
});
