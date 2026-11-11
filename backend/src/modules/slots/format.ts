// Тексты уведомлений об открытых слотах. Чистые функции — проверяются без базы.
//
// Образец Василия (решение 27, 10.11.2026): «У Holy Guns во вторник в 20:30 в
// Точке свободный слот, 3000 ₽». Название места склонять автоматически нельзя
// («в Точка»), поэтому место идёт в кавычках: «на площадке „Точка“».

const DEFAULT_TIMEZONE = "Europe/Moscow";

const WEEKDAY_PHRASE: Record<string, string> = {
  Mon: "в понедельник",
  Tue: "во вторник",
  Wed: "в среду",
  Thu: "в четверг",
  Fri: "в пятницу",
  Sat: "в субботу",
  Sun: "в воскресенье",
};

function safeZone(timeZone: string | null | undefined): string {
  const zone = String(timeZone || "").trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function localDate(date: Date, timeZone: string): string {
  // en-CA даёт ГГГГ-ММ-ДД — удобно сравнивать дни.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** «во вторник в 20:30»; через неделю и дальше — с датой: «во вторник 18.11 в 20:30». */
export function formatSlotWhen(startAt: string | Date, timeZone?: string | null, now: Date = new Date()): string {
  const zone = safeZone(timeZone);
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(start);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start);
  const day = WEEKDAY_PHRASE[weekday] ?? "";
  const ahead = daysBetween(localDate(now, zone), localDate(start, zone));
  if (ahead >= 7 || ahead < 0) {
    const date = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "2-digit", month: "2-digit" }).format(start);
    return `${day} ${date} в ${time}`.trim();
  }
  return `${day} в ${time}`.trim();
}

/** 3000 → «3000 ₽», 1500.5 → «1500,5 ₽», 0 → «бесплатно». */
export function formatSlotPrice(price: number | string | null | undefined): string {
  const value = Number(price ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "бесплатно";
  return `${value.toLocaleString("ru-RU", { useGrouping: false, maximumFractionDigits: 2 })} ₽`;
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «свободный слот» / «2 свободных слота» / «5 свободных слотов». */
export function formatFreeSlots(free: number): string {
  if (free === 1) return "свободный слот";
  return `${free} ${pluralRu(free, "свободный слот", "свободных слота", "свободных слотов")}`;
}

export type SlotOpenTextInput = {
  teamName: string;
  startAt: string | Date;
  timeZone?: string | null;
  location?: string | null;
  price: number | string;
  free: number;
  now?: Date;
};

/** «У Holy Guns во вторник в 20:30 на площадке «Точка» свободный слот, 3000 ₽» */
export function buildSlotOpenText(input: SlotOpenTextInput): string {
  const when = formatSlotWhen(input.startAt, input.timeZone, input.now);
  const place = String(input.location || "").trim();
  const where = place ? ` на площадке «${place}»` : "";
  return `У ${input.teamName.trim()} ${when}${where} ${formatFreeSlots(input.free)}, ${formatSlotPrice(input.price)}`;
}

export type SlotBookedTextInput = {
  guestName: string;
  eventTitle: string;
  startAt: string | Date;
  timeZone?: string | null;
  price: number | string;
  booked: number;
  capacity: number;
  now?: Date;
};

/** Капитану и тренеру: «Иван занял слот» и подробности строкой ниже. */
export function buildSlotBookedText(input: SlotBookedTextInput): string {
  const when = formatSlotWhen(input.startAt, input.timeZone, input.now);
  const free = Math.max(0, input.capacity - input.booked);
  const left = free === 0 ? "Мест больше нет." : `Свободно ${free} из ${input.capacity}.`;
  return `${input.guestName.trim()} занял слот\n«${input.eventTitle.trim()}», ${when}, ${formatSlotPrice(input.price)}. ${left}`;
}

export type SlotRemovedTextInput = {
  teamName: string;
  eventTitle: string;
  startAt: string | Date;
  timeZone?: string | null;
  now?: Date;
};

/** Снятому гостю: «Holy Guns: тебя сняли со слота — Тренировка, во вторник в 20:30». */
export function buildSlotRemovedText(input: SlotRemovedTextInput): string {
  const when = formatSlotWhen(input.startAt, input.timeZone, input.now);
  return `${input.teamName.trim()}: тебя сняли со слота — ${input.eventTitle.trim()}, ${when}`;
}

/** Строка, которую бот дописывает к сообщению после нажатия кнопки. */
export const SLOT_VERDICT = {
  booked: "Ты записан.",
  already: "Ты уже записан.",
  full: "Мест уже нет.",
  closed: "Запись закрыта.",
  started: "Событие уже началось, запись закрыта.",
  member: "Ты в этой команде — слот тебе не нужен, отметь явку в приложении.",
  notFollower: "Ты отписался от команды — запись недоступна.",
  noUser: "Сначала войди в приложение PBTH через этот Telegram.",
  removed: "Гость снят, место снова свободно.",
  alreadyGone: "Гость уже снялся сам.",
  notManager: "Снять гостя может капитан или тренер команды.",
  notFound: "Событие не найдено или отменено.",
} as const;

export function appendVerdict(original: string | null | undefined, verdict: string): string {
  const base = String(original || "").trim();
  return base ? `${base}\n\n${verdict}` : verdict;
}
