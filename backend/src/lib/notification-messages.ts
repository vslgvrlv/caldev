// Тексты сообщений бота и пушей о событиях и долгах (трек 2 ревизии,
// решение Василия 10.11.2026, п. 8). Чистые функции: без базы и без сети.
//
// Правила текста: в каждом сообщении — название команды; событие — дата и
// время по поясу команды и место; ответ «Иду / Не иду» — кнопками прямо в
// сообщении и ссылка «Открыть событие». Слова «RSVP» людям не показываем.
//
// Telegram получает HTML (`parse_mode=HTML`), поэтому всё, что ввёл человек,
// экранируется. Пуш получает обычный текст.

import { DEFAULT_TEAM_TIMEZONE } from "./notification-schedule.js";

export type RsvpState = "UNANSWERED" | "PENDING" | "CONFIRMED" | "DECLINED";
export type RsvpAnswer = "yes" | "no";
export type EventMessageKind = "MANUAL" | "EVE" | "MORNING";

export type EventCard = {
  eventId: string;
  title: string;
  startAt: string | Date;
  location?: string | null;
  locationUrl?: string | null;
  teamName: string;
  timezone?: string | null;
};

export type InlineKeyboard = { inline_keyboard: Array<Array<Record<string, string>>> };

export type PushContent = {
  title: string;
  body: string;
  /** Адрес в приложении, который откроется по тапу (договорённость всех треков). */
  url: string;
  /** Тег уведомления: новое о том же событии заменяет старое, о другом — нет. */
  tag: string;
  /** Кнопки «Иду / Не иду» в пуше — там, где браузер их умеет. */
  actions?: Array<{ action: string; title: string }>;
};

export type BuiltMessage = {
  text: string;
  parseMode: "HTML";
  replyMarkup: InlineKeyboard;
  push: PushContent;
};

export const RSVP_CALLBACK_PREFIX = "rsvp";
export const PUSH_ACTION_YES = "rsvp-yes";
export const PUSH_ACTION_NO = "rsvp-no";

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeTimeZone(timeZone?: string | null): string {
  const tz = String(timeZone ?? "").trim() || DEFAULT_TEAM_TIMEZONE;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TEAM_TIMEZONE;
  }
}

/** «вторник, 22 ноября, 20:30» по поясу команды. */
export function formatEventWhen(startAt: string | Date, timeZone?: string | null): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(date.getTime())) return "";
  const tz = safeTimeZone(timeZone);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day}, ${time}`;
}

/** «22 ноября» по поясу команды — для списка долгов. */
export function formatShortDate(startAt: string | Date, timeZone?: string | null): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: safeTimeZone(timeZone), day: "numeric", month: "long" }).format(date);
}

/** «3 500 ₽». */
export function formatRub(amount: number): string {
  const rounded = Math.round(Number(amount || 0) * 100) / 100;
  return `${rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function locationHtml(location?: string | null, locationUrl?: string | null): string | null {
  const name = String(location ?? "").trim();
  if (!name) return null;
  const url = String(locationUrl ?? "").trim();
  if (url && /^https?:\/\//i.test(url)) return `<a href="${escapeHtml(url)}">${escapeHtml(name)}</a>`;
  return escapeHtml(name);
}

const HEADER_BY_KIND: Record<EventMessageKind, string> = {
  MANUAL: "напоминание о событии",
  EVE: "завтра событие",
  MORNING: "сегодня событие",
};

/** Последний абзац сообщения о событии: что сейчас с ответом человека. */
export function rsvpStatusLine(state: RsvpState): string {
  if (state === "CONFIRMED") return "Сейчас у тебя: иду. Передумаешь — нажми «Не иду».";
  if (state === "DECLINED") return "Сейчас у тебя: не иду. Передумаешь — нажми «Иду».";
  if (state === "PENDING") return "Сейчас у тебя: думаю. Идёшь?";
  return "Ответа от тебя пока нет. Идёшь?";
}

/** Строка после нажатия кнопки. */
export function rsvpAnsweredLine(status: "CONFIRMED" | "DECLINED"): string {
  return status === "CONFIRMED"
    ? "Ты идёшь. Передумаешь — нажми «Не иду»."
    : "Ты не идёшь. Передумаешь — нажми «Иду».";
}

export function rsvpCallbackData(answer: RsvpAnswer, eventId: string): string {
  return `${RSVP_CALLBACK_PREFIX}:${answer}:${eventId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Часть `callback_data` после `rsvp:` → ответ и событие. */
export function parseRsvpCallbackPayload(payload: string): { answer: RsvpAnswer; eventId: string } | null {
  const match = /^(yes|no):(.+)$/.exec(String(payload ?? ""));
  if (!match || !UUID_RE.test(match[2])) return null;
  return { answer: match[1] as RsvpAnswer, eventId: match[2].toLowerCase() };
}

export function rsvpKeyboard(eventId: string, eventUrl: string, withAnswers = true): InlineKeyboard {
  const rows: Array<Array<Record<string, string>>> = [];
  if (withAnswers) {
    rows.push([
      { text: "Иду", callback_data: rsvpCallbackData("yes", eventId) },
      { text: "Не иду", callback_data: rsvpCallbackData("no", eventId) },
    ]);
  }
  rows.push([{ text: "Открыть событие", url: eventUrl }]);
  return { inline_keyboard: rows };
}

export function linkKeyboard(text: string, url: string): InlineKeyboard {
  return { inline_keyboard: [[{ text, url }]] };
}

/**
 * Сообщение о событии с ответом кнопками: ручное «Напомнить» и оба
 * авто-напоминания. Последний абзац — всегда строка ответа: кнопка бота
 * заменяет ровно его (см. `replaceLastParagraph`).
 */
export function buildEventRsvpMessage(params: {
  card: EventCard;
  kind: EventMessageKind;
  state: RsvpState;
  eventUrl: string;
  customText?: string | null;
}): BuiltMessage {
  const { card } = params;
  const when = formatEventWhen(card.startAt, card.timezone);
  const place = locationHtml(card.location, card.locationUrl);
  const custom = String(params.customText ?? "").trim();
  const statusLine = rsvpStatusLine(params.state);

  const lines = [
    `<b>${escapeHtml(card.teamName)}</b> · ${HEADER_BY_KIND[params.kind]}`,
    escapeHtml(card.title),
    when,
    ...(place ? [`Место: ${place}`] : []),
  ];
  const paragraphs = [lines.join("\n")];
  if (custom) paragraphs.push(escapeHtml(custom));
  paragraphs.push(statusLine);

  const pushTitle = `${card.teamName}: ${card.title}`;
  const pushLines = [
    `${HEADER_BY_KIND[params.kind][0].toUpperCase()}${HEADER_BY_KIND[params.kind].slice(1)}, ${when}${card.location ? ` · ${String(card.location).trim()}` : ""}`,
    ...(custom ? [custom] : []),
    statusLine,
  ];

  return {
    text: paragraphs.join("\n\n"),
    parseMode: "HTML",
    replyMarkup: rsvpKeyboard(card.eventId, params.eventUrl),
    push: {
      title: pushTitle,
      body: pushLines.join("\n"),
      url: params.eventUrl,
      tag: `event-${card.eventId}`,
      actions: [
        { action: PUSH_ACTION_YES, title: "Иду" },
        { action: PUSH_ACTION_NO, title: "Не иду" },
      ],
    },
  };
}

/** HTML → обычный текст для пуша (ссылки схлопываются до подписи). */
export function htmlToPlain(html: string): string {
  return String(html ?? "")
    .replace(/<a\s+href="[^"]*">([^<]*)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type TelegramEntity = { offset: number; length: number; [key: string]: unknown };

/**
 * Замена последнего абзаца уже отправленного сообщения (то, что Telegram
 * прислал в нажатии кнопки: текст без разметки и её разметка отдельно).
 * Разметка остальной части сохраняется: ссылка на место остаётся ссылкой.
 */
export function replaceLastParagraph(
  text: string,
  entities: TelegramEntity[] | undefined,
  newLast: string
): { text: string; entities: TelegramEntity[] } | null {
  const source = String(text ?? "");
  const cut = source.lastIndexOf("\n\n");
  if (cut <= 0) return null;
  const head = source.slice(0, cut);
  const kept = (entities ?? []).filter((e) => Number(e.offset) + Number(e.length) <= head.length);
  return { text: `${head}\n\n${newLast}`, entities: kept };
}

export type DebtItem = { title: string; startAt: string | Date; amount: number };

const MAX_DEBT_ITEMS = 8;

/** Напоминание об оплате: сколько, за что и ссылка на казну команды. */
export function buildDebtMessage(params: {
  teamName: string;
  total: number;
  items: DebtItem[];
  timezone?: string | null;
  moneyUrl: string;
  customText?: string | null;
  tag: string;
}): BuiltMessage {
  const custom = String(params.customText ?? "").trim();
  const shown = params.items.slice(0, MAX_DEBT_ITEMS);
  const rest = params.items.length - shown.length;
  const itemLines = shown.map(
    (item) => `— ${item.title}, ${formatShortDate(item.startAt, params.timezone)}: ${formatRub(item.amount)}`
  );
  if (rest > 0) itemLines.push(`и ещё ${rest} — в казне`);

  const head = `<b>${escapeHtml(params.teamName)}</b> · оплата`;
  const totalLine = `За тобой ${formatRub(params.total)}.`;
  const paragraphs = [head];
  if (custom) paragraphs.push(escapeHtml(custom));
  paragraphs.push(itemLines.length ? [totalLine, "За что:", ...itemLines.map(escapeHtml)].join("\n") : totalLine);

  const pushItems = shown.map((item) => `${item.title} ${formatShortDate(item.startAt, params.timezone)} — ${formatRub(item.amount)}`);
  return {
    text: paragraphs.join("\n\n"),
    parseMode: "HTML",
    replyMarkup: linkKeyboard("Открыть казну", params.moneyUrl),
    push: {
      title: `${params.teamName}: оплата`,
      body: [custom, totalLine, pushItems.length ? `За что: ${pushItems.join("; ")}${rest > 0 ? ` и ещё ${rest}` : ""}` : ""]
        .filter(Boolean)
        .join("\n"),
      url: params.moneyUrl,
      tag: params.tag,
    },
  };
}
