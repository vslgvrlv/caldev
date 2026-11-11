// Суммы в рублях: «3 000 ₽», «−500 ₽», «+1 800 ₽». Разряды и знак рубля отделены
// неразрывными пробелами, минус — настоящий (U+2212) и без пробела перед числом.
// Копейки показываются, только если они есть, и всегда двумя цифрами (в базе
// numeric с двумя знаками). Не число — тире: ошибка данных не должна выглядеть
// как «0 ₽».
//
// ui-kit-allow: `UI.stat.fmt(v, 'money')` округляет до целых рублей и копейки теряет.

const NBSP = ' '; // ui-kit-allow: см. выше, готовый fmt копейки не держит
const MINUS = '−';
const DASH = '—';

function toFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Модуль суммы в копейках, округление до двух знаков. */
function absCents(n: number): number {
  return Math.round(Math.abs(n) * 100);
}

function body(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const intPart = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return rest === 0 ? intPart : `${intPart},${String(rest).padStart(2, '0')}`;
}

/** «1 500 ₽», «−500 ₽», «0 ₽»; не число — «—». Знак сохраняется. */
export function formatRub(value: unknown): string {
  const n = toFinite(value);
  if (n === null) return DASH;
  const cents = absCents(n);
  return `${n < 0 && cents > 0 ? MINUS : ''}${body(cents)}${NBSP}₽`; // ui-kit-allow: UI.stat.fmt(v,'money') округляет до целых и теряет копейки
}

/** Как formatRub, но положительной сумме добавляет «+»: «+1 800 ₽». Ноль — без знака. */
export function formatRubSigned(value: unknown): string {
  const n = toFinite(value);
  if (n === null) return DASH;
  return n > 0 && absCents(n) > 0 ? `+${formatRub(n)}` : formatRub(n);
}
