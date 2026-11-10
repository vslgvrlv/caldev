import { describe, expect, it } from "vitest";
import {
  buildDebtMessage,
  buildEventRsvpMessage,
  formatEventWhen,
  formatRub,
  parseRsvpCallbackPayload,
  replaceLastParagraph,
  rsvpAnsweredLine,
  rsvpCallbackData,
} from "../../lib/notification-messages.js";
import { signRsvpToken, verifyRsvpToken } from "../../lib/notification-rsvp-token.js";

const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const card = {
  eventId: EVENT_ID,
  title: "Тренировка <вечер>",
  startAt: "2026-11-22T17:30:00Z",
  location: "Точка",
  locationUrl: "https://yandex.ru/maps/-/abc",
  teamName: "Holy Guns",
  timezone: "Europe/Moscow",
};
const url = `https://pbthub.ru/t/holy/event/${EVENT_ID}`;

describe("сообщение о событии", () => {
  it("дата и время — по поясу команды", () => {
    expect(formatEventWhen("2026-11-22T17:30:00Z", "Europe/Moscow")).toBe("воскресенье, 22 ноября, 20:30");
    expect(formatEventWhen("2026-11-22T17:30:00Z", "Asia/Vladivostok")).toBe("понедельник, 23 ноября, 03:30");
  });

  it("команда, событие, время, место, строка ответа; кнопки и ссылка", () => {
    const msg = buildEventRsvpMessage({ card, kind: "EVE", state: "UNANSWERED", eventUrl: url });
    expect(msg.text).toBe(
      [
        "<b>Holy Guns</b> · завтра событие",
        "Тренировка &lt;вечер&gt;",
        "воскресенье, 22 ноября, 20:30",
        'Место: <a href="https://yandex.ru/maps/-/abc">Точка</a>',
        "",
        "Ответа от тебя пока нет. Идёшь?",
      ].join("\n")
    );
    expect(msg.replyMarkup.inline_keyboard).toEqual([
      [
        { text: "Иду", callback_data: `rsvp:yes:${EVENT_ID}` },
        { text: "Не иду", callback_data: `rsvp:no:${EVENT_ID}` },
      ],
      [{ text: "Открыть событие", url }],
    ]);
    expect(msg.text).not.toMatch(/rsvp/i);
  });

  it("пуш: ссылка на событие, тег события, кнопки «Иду / Не иду»", () => {
    const msg = buildEventRsvpMessage({ card, kind: "MORNING", state: "PENDING", eventUrl: url });
    expect(msg.push.url).toBe(url);
    expect(msg.push.tag).toBe(`event-${EVENT_ID}`);
    expect(msg.push.title).toBe("Holy Guns: Тренировка <вечер>");
    expect(msg.push.body).toContain("Сегодня событие, воскресенье, 22 ноября, 20:30 · Точка");
    expect(msg.push.actions?.map((a) => a.title)).toEqual(["Иду", "Не иду"]);
    expect(msg.push.body).not.toMatch(/rsvp/i);
  });

  it("свой текст капитана экранируется и стоит перед строкой ответа", () => {
    const msg = buildEventRsvpMessage({ card, kind: "MANUAL", state: "CONFIRMED", eventUrl: url, customText: "Берём <маски>" });
    const paragraphs = msg.text.split("\n\n");
    expect(paragraphs[1]).toBe("Берём &lt;маски&gt;");
    expect(paragraphs[2]).toBe("Сейчас у тебя: иду. Передумаешь — нажми «Не иду».");
  });

  it("callback_data укладывается в 64 байта и разбирается обратно", () => {
    const data = rsvpCallbackData("yes", EVENT_ID);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseRsvpCallbackPayload(data.slice("rsvp:".length))).toEqual({ answer: "yes", eventId: EVENT_ID });
    expect(parseRsvpCallbackPayload("maybe:" + EVENT_ID)).toBeNull();
    expect(parseRsvpCallbackPayload("yes:not-a-uuid")).toBeNull();
  });

  it("после нажатия меняется только последний абзац, разметка начала остаётся", () => {
    const plain = "Holy Guns · завтра событие\nТренировка\nвоскресенье, 22 ноября, 20:30\nМесто: Точка\n\nОтвета от тебя пока нет. Идёшь?";
    const entities = [
      { type: "bold", offset: 0, length: 9 },
      { type: "text_link", offset: plain.indexOf("Точка"), length: 5, url: "https://x" },
    ];
    const replaced = replaceLastParagraph(plain, entities, rsvpAnsweredLine("CONFIRMED"));
    expect(replaced?.text.endsWith("\n\nТы идёшь. Передумаешь — нажми «Не иду».")).toBe(true);
    expect(replaced?.entities).toEqual(entities);
    expect(replaceLastParagraph("без абзацев", [], "x")).toBeNull();
  });
});

describe("напоминание об оплате", () => {
  it("сумма, за что и ссылка на казну, без «Подробности в приложении»", () => {
    const msg = buildDebtMessage({
      teamName: "Holy Guns",
      total: 3500,
      items: [
        { title: "Тренировка", startAt: "2026-11-12T17:00:00Z", amount: 1500 },
        { title: "Кубок", startAt: "2026-11-20T07:00:00Z", amount: 2000 },
      ],
      timezone: "Europe/Moscow",
      moneyUrl: "https://pbthub.ru/t/holy/money",
      tag: "debt-team",
    });
    expect(msg.text).toContain("<b>Holy Guns</b> · оплата");
    expect(msg.text).toContain(`За тобой ${formatRub(3500)}.`);
    expect(msg.text).toContain(`— Тренировка, 12 ноября: ${formatRub(1500)}`);
    expect(msg.text).toContain(`— Кубок, 20 ноября: ${formatRub(2000)}`);
    expect(msg.text).not.toContain("Подробности в приложении");
    expect(msg.replyMarkup.inline_keyboard).toEqual([[{ text: "Открыть казну", url: "https://pbthub.ru/t/holy/money" }]]);
    expect(msg.push.url).toBe("https://pbthub.ru/t/holy/money");
  });
});

describe("ключ ответа из пуша", () => {
  const secret = "s3cret";
  const claims = { eventId: EVENT_ID, userId: "u-1", expiresAt: Date.now() + 60_000 };

  it("подписанный ключ проверяется", () => {
    const token = signRsvpToken(claims, secret);
    expect(verifyRsvpToken(token, secret)).toEqual({ ...claims, expiresAt: Math.floor(claims.expiresAt / 1000) * 1000 });
  });

  it("чужой секрет, подмена и просрочка — отказ", () => {
    const token = signRsvpToken(claims, secret);
    expect(verifyRsvpToken(token, "other")).toBeNull();
    const [v, , sig] = token.split(".");
    const forged = `${v}.${Buffer.from(JSON.stringify({ e: EVENT_ID, u: "u-2", x: 9e9 })).toString("base64url")}.${sig}`;
    expect(verifyRsvpToken(forged, secret)).toBeNull();
    expect(verifyRsvpToken(token, secret, claims.expiresAt + 1000)).toBeNull();
    expect(verifyRsvpToken("мусор", secret)).toBeNull();
  });
});
