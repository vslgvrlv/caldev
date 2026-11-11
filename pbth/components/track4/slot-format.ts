// Подписи открытых слотов на экранах. Чистые функции — проверяются без браузера.

import type { SlotOffer } from '../../api/track4';
import { pluralRu } from '../../lib/plural';

export { pluralRu };

/**
 * Записи гостем, которые ещё впереди (или идут сейчас): для карточки «Ты
 * записан гостем» на главной и в профиле. Ленту отдаёт `/slots/feed`.
 */
export function upcomingGuestBookings(bookings: SlotOffer[] | null | undefined, nowTs: number = Date.now()): SlotOffer[] {
  return (bookings || [])
    .filter((offer) => {
      const end = Date.parse(offer.endAt || offer.startAt);
      return Number.isFinite(end) && end > nowTs;
    })
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** 3000 → «3000 ₽», 0 → «бесплатно». */
export function slotPriceLabel(price: number | null | undefined): string {
  const value = Number(price ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 'бесплатно';
  return `${value.toLocaleString('ru-RU', { useGrouping: false, maximumFractionDigits: 2 })} ₽`;
}

/** Кнопка записи: «Записаться за 3000 ₽» или «Записаться бесплатно». */
export function bookButtonLabel(price: number | null | undefined): string {
  const label = slotPriceLabel(price);
  return label === 'бесплатно' ? 'Записаться бесплатно' : `Записаться за ${label}`;
}

/** «свободно 2 из 3», «мест нет». */
export function freeSlotsLabel(free: number, capacity: number): string {
  if (free <= 0) return 'мест нет';
  return `свободно ${free} из ${capacity}`;
}

/** Капитану: «Открыто 2 места по 3000 ₽, свободно 1» / «…, все заняты». */
export function openedLabel(capacity: number, price: number, free: number): string {
  const places = `${capacity} ${pluralRu(capacity, 'место', 'места', 'мест')}`;
  const tail = free > 0 ? `свободно ${free}` : 'все заняты';
  const cost = Number(price) > 0 ? `по ${slotPriceLabel(price)}` : 'бесплатно';
  return `Открыто ${places} ${cost}, ${tail}.`;
}

export function followersLabel(count: number): string {
  if (count <= 0) return 'подписчиков пока нет';
  return `${count} ${pluralRu(count, 'подписчик', 'подписчика', 'подписчиков')}`;
}

/** Цена из поля ввода: «3 000», «3000,5» → число; пусто или мусор — null. */
export function parsePriceInput(raw: string): number | null {
  const cleaned = String(raw || '').replace(/[\s ₽]/g, '').replace(',', '.');
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «вторник, 18 ноября, 20:30» в часовом поясе команды. */
export function slotWhenLabel(startAt: string, timeZone?: string | null): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return '';
  const zone = timeZone || 'Europe/Moscow';
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
  } catch {
    return slotWhenLabel(startAt, 'Europe/Moscow');
  }
  const weekday = WEEKDAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)] ?? '';
  const month = MONTHS[Number(parts.month) - 1] ?? '';
  return `${weekday}, ${parts.day} ${month}, ${parts.hour}:${parts.minute}`;
}

/** «Ты записан гостем: Holy Guns · Тренировка · вторник, 18 ноября, 20:30». */
export function guestBookingLabel(offer: Pick<SlotOffer, 'teamName' | 'title' | 'startAt' | 'timezone'>): string {
  return `Ты записан гостем: ${offer.teamName} · ${offer.title} · ${slotWhenLabel(offer.startAt, offer.timezone)}`;
}
