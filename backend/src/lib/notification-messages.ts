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

// ── Сообщения о новом, перенесённом и отменённом событии ──────────────────
// Спека event_announcements (решения Василия 11.11.2026). Тексты — дословно
// по спеке. У карточек с кнопками «Иду / Не иду» последний абзац — строка
// ответа: обработчик `rsvp` заменяет ровно его.

export const SERIES_CALLBACK_PREFIX = "series";

/** Строка после нажатия «Иду на все». */
export const SERIES_COMMITTED_LINE = "Ты ходишь на все занятия. Отказаться от отдельного можно в приложении.";

const WEEKDAY_SHORT: Record<number, string> = { 1: "пн", 2: "вт", 3: "ср", 4: "чт", 5: "пт", 6: "сб", 7: "вс" };

/** [2, 4] → «вт и чт»; [1, 3, 5] → «пн, ср и пт». Дни — ISO, 1 = понедельник. */
export function formatWeekdays(isoDays: number[]): string {
  const names = [...new Set(isoDays)]
    .filter((d) => WEEKDAY_SHORT[d])
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT[d]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/** «1 занятие», «3 занятия», «13 занятий». */
export function sessionsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "занятие" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "занятия" : "занятий";
  return `${n} ${word}`;
}

/** «20:30» по поясу команды. */
function formatTime(startAt: string | Date, timeZone?: string | null): string {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: safeTimeZone(timeZone), hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/** День недели по поясу команды, ISO (1 = понедельник). */
export function localIsoWeekday(startAt: string | Date, timeZone?: string | null): number {
  const date = startAt instanceof Date ? startAt : new Date(startAt);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(timeZone), weekday: "short" }).format(date);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[name] ?? 1;
}

export function seriesCallbackData(seriesId: string): string {
  return `${SERIES_CALLBACK_PREFIX}:yes:${seriesId}`;
}

/** Часть `callback_data` после `series:` → серия. */
export function parseSeriesCallbackPayload(payload: string): { seriesId: string } | null {
  const match = /^yes:(.+)$/.exec(String(payload ?? ""));
  if (!match || !UUID_RE.test(match[1])) return null;
  return { seriesId: match[1].toLowerCase() };
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function announcementPush(params: {
  teamName: string;
  title: string;
  header: string;
  lines: string[];
  url: string;
  tag: string;
  withAnswers?: boolean;
}): PushContent {
  return {
    title: `${params.teamName}: ${params.title}`,
    body: [capitalize(params.header), ...params.lines.map(htmlToPlain)].filter(Boolean).join("\n"),
    url: params.url,
    tag: params.tag,
    ...(params.withAnswers
      ? {
          actions: [
            { action: PUSH_ACTION_YES, title: "Иду" },
            { action: PUSH_ACTION_NO, title: "Не иду" },
          ],
        }
      : {}),
  };
}

function sameText(a?: string | null, b?: string | null): boolean {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/** Новое событие: «Идёшь?» и кнопки «Иду / Не иду». */
export function buildEventCreatedMessage(params: {
  card: EventCard;
  state: "UNANSWERED" | "PENDING";
  eventUrl: string;
}): BuiltMessage {
  const { card } = params;
  const header = "новое событие";
  const when = formatEventWhen(card.startAt, card.timezone);
  const place = locationHtml(card.location, card.locationUrl);
  const lines = [escapeHtml(card.title), when, ...(place ? [`Место: ${place}`] : [])];
  const statusLine = params.state === "PENDING" ? rsvpStatusLine("PENDING") : "Идёшь?";
  return {
    text: [[`<b>${escapeHtml(card.teamName)}</b> · ${header}`, ...lines].join("\n"), statusLine].join("\n\n"),
    parseMode: "HTML",
    replyMarkup: rsvpKeyboard(card.eventId, params.eventUrl),
    push: announcementPush({
      teamName: card.teamName,
      title: card.title,
      header: `${header}, ${when}${card.location ? ` · ${String(card.location).trim()}` : ""}`,
      lines: [statusLine],
      url: params.eventUrl,
      tag: `event-${card.eventId}`,
      withAnswers: true,
    }),
  };
}

/** Строка «Было»: прежнее время, прежнее место или оба. */
function previousLine(params: {
  timeChanged: boolean;
  placeChanged: boolean;
  previousWhen: string;
  previousLocation?: string | null;
}): string | null {
  const parts: string[] = [];
  if (params.timeChanged) parts.push(params.previousWhen);
  if (params.placeChanged) {
    const prev = String(params.previousLocation ?? "").trim();
    parts.push(prev ? escapeHtml(prev) : "место не указано");
  }
  return parts.length ? `Было: ${parts.join(", ")}` : null;
}

/** Перенос: новое время и место, «Было», строка ответа как в напоминаниях. */
export function buildEventRescheduledMessage(params: {
  card: EventCard;
  previous: { startAt: string | Date; location?: string | null };
  state: RsvpState;
  eventUrl: string;
}): BuiltMessage {
  const { card } = params;
  const header = "событие перенесено";
  const when = formatEventWhen(card.startAt, card.timezone);
  const place = locationHtml(card.location, card.locationUrl);
  const was = previousLine({
    timeChanged: new Date(params.previous.startAt).getTime() !== new Date(card.startAt).getTime(),
    placeChanged: !sameText(params.previous.location, card.location),
    previousWhen: formatEventWhen(params.previous.startAt, card.timezone),
    previousLocation: params.previous.location,
  });
  const lines = [escapeHtml(card.title), when, ...(place ? [`Место: ${place}`] : []), ...(was ? [was] : [])];
  const statusLine = rsvpStatusLine(params.state);
  return {
    text: [[`<b>${escapeHtml(card.teamName)}</b> · ${header}`, ...lines].join("\n"), statusLine].join("\n\n"),
    parseMode: "HTML",
    replyMarkup: rsvpKeyboard(card.eventId, params.eventUrl),
    push: announcementPush({
      teamName: card.teamName,
      title: card.title,
      header: `${header}, ${when}${card.location ? ` · ${String(card.location).trim()}` : ""}`,
      lines: [...(was ? [was] : []), statusLine],
      url: params.eventUrl,
      tag: `event-${card.eventId}`,
      withAnswers: true,
    }),
  };
}

/** Отмена: без кнопок ответа, ссылка на календарь команды. */
export function buildEventCancelledMessage(params: {
  card: Pick<EventCard, "eventId" | "title" | "startAt" | "teamName" | "timezone">;
  calendarUrl: string;
}): BuiltMessage {
  const { card } = params;
  const header = "событие отменено";
  const when = formatEventWhen(card.startAt, card.timezone);
  return {
    text: [`<b>${escapeHtml(card.teamName)}</b> · ${header}`, escapeHtml(card.title), when].join("\n"),
    parseMode: "HTML",
    replyMarkup: linkKeyboard("Открыть календарь", params.calendarUrl),
    push: announcementPush({
      teamName: card.teamName,
      title: card.title,
      header: `${header}, ${when}`,
      lines: [],
      url: params.calendarUrl,
      tag: `event-${card.eventId}`,
    }),
  };
}

/** «вт и чт в 20:30» по занятиям серии. */
function seriesRhythm(starts: Array<string | Date>, timeZone?: string | null): string {
  if (!starts.length) return "";
  const days = starts.map((s) => localIsoWeekday(s, timeZone));
  return `${formatWeekdays(days)} в ${formatTime(starts[0], timeZone)}`;
}

/** Новая серия: одно сообщение с кнопками «Иду на все» и «Открыть». */
export function buildSeriesCreatedMessage(params: {
  seriesId: string;
  teamName: string;
  title: string;
  location?: string | null;
  locationUrl?: string | null;
  timezone?: string | null;
  /** Занятия серии по порядку. */
  starts: Array<string | Date>;
  openUrl: string;
}): BuiltMessage {
  const header = "новые занятия";
  const starts = params.starts;
  const first = formatShortDate(starts[0], params.timezone);
  const last = formatShortDate(starts[starts.length - 1], params.timezone);
  const range = first === last ? first : `с ${first} по ${last}`;
  const rhythm = `${seriesRhythm(starts, params.timezone)}, ${range} · ${sessionsLabel(starts.length)}`;
  const place = locationHtml(params.location, params.locationUrl);
  const lines = [escapeHtml(params.title), rhythm, ...(place ? [`Место: ${place}`] : [])];
  const statusLine = "Ходишь на все?";
  return {
    text: [[`<b>${escapeHtml(params.teamName)}</b> · ${header}`, ...lines].join("\n"), statusLine].join("\n\n"),
    parseMode: "HTML",
    replyMarkup: {
      inline_keyboard: [
        [{ text: "Иду на все", callback_data: seriesCallbackData(params.seriesId) }],
        [{ text: "Открыть", url: params.openUrl }],
      ],
    },
    push: announcementPush({
      teamName: params.teamName,
      title: params.title,
      header,
      lines: [rhythm, ...(params.location ? [`Место: ${String(params.location).trim()}`] : []), statusLine],
      url: params.openUrl,
      tag: `series-${params.seriesId}`,
    }),
  };
}

/** Серия перенесена: с какого числа, новое время и место, «Было»; без кнопок ответа. */
export function buildSeriesRescheduledMessage(params: {
  teamName: string;
  title: string;
  location?: string | null;
  locationUrl?: string | null;
  timezone?: string | null;
  /** Затронутые занятия после переноса, по порядку. */
  starts: Array<string | Date>;
  previous: { startAt: string | Date; location?: string | null; weekdays: number[] };
  openUrl: string;
  tag?: string;
}): BuiltMessage {
  const header = "занятия перенесены";
  const tz = params.timezone;
  const newRhythm = seriesRhythm(params.starts, tz);
  const prevRhythm = `${formatWeekdays(params.previous.weekdays)} в ${formatTime(params.previous.startAt, tz)}`;
  const timeChanged =
    newRhythm !== prevRhythm || formatShortDate(params.starts[0], tz) !== formatShortDate(params.previous.startAt, tz);
  const was = previousLine({
    timeChanged,
    placeChanged: !sameText(params.previous.location, params.location),
    previousWhen: prevRhythm,
    previousLocation: params.previous.location,
  });
  const place = locationHtml(params.location, params.locationUrl);
  const lines = [
    escapeHtml(params.title),
    `с ${formatShortDate(params.starts[0], tz)}: ${newRhythm}`,
    ...(place ? [`Место: ${place}`] : []),
    ...(was ? [was] : []),
  ];
  return {
    text: [`<b>${escapeHtml(params.teamName)}</b> · ${header}`, ...lines].join("\n"),
    parseMode: "HTML",
    replyMarkup: linkKeyboard("Открыть", params.openUrl),
    push: announcementPush({
      teamName: params.teamName,
      title: params.title,
      header,
      lines: lines.slice(1),
      url: params.openUrl,
      tag: params.tag ?? "series",
    }),
  };
}

/** Серия отменена: с какого числа и сколько занятий; без кнопок ответа. */
export function buildSeriesCancelledMessage(params: {
  teamName: string;
  title: string;
  timezone?: string | null;
  fromStartAt: string | Date;
  count: number;
  calendarUrl: string;
  tag?: string;
}): BuiltMessage {
  const header = "занятия отменены";
  const line = `с ${formatShortDate(params.fromStartAt, params.timezone)} · ${sessionsLabel(params.count)}`;
  return {
    text: [`<b>${escapeHtml(params.teamName)}</b> · ${header}`, escapeHtml(params.title), line].join("\n"),
    parseMode: "HTML",
    replyMarkup: linkKeyboard("Открыть календарь", params.calendarUrl),
    push: announcementPush({
      teamName: params.teamName,
      title: params.title,
      header,
      lines: [line],
      url: params.calendarUrl,
      tag: params.tag ?? "series",
    }),
  };
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
