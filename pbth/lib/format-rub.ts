// Суммы в рублях: «3 000 ₽». Разряды и знак рубля отделены неразрывными
// пробелами, чтобы сумма не ломалась на две строки. Копейки показываются, только
// если они есть.

const NBSP = ' ';
const MINUS = '−';

function groupDigits(abs: number): string {
  const whole = Math.trunc(abs);
  const fraction = Math.round((abs - whole) * 100);
  // 12.999 -> 13.00: переносим округление в целую часть.
  const carry = fraction === 100 ? 1 : 0;
  const intPart = String(whole + carry).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const cents = fraction === 100 ? 0 : fraction;
  return cents === 0 ? intPart : `${intPart},${String(cents).padStart(2, '0')}`;
}

function finite(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** «1 500 ₽». Знак числа не показывает: сумма берётся по модулю. */
export function formatRub(value: number): string {
  return `${groupDigits(Math.abs(finite(value)))}${NBSP}₽`;
}

/** «+1 800 ₽» / «−12 000 ₽» (настоящий минус U+2212). Ноль — без знака. */
export function formatRubSigned(value: number, sign: 'plus' | 'minus' | 'none'): string {
  const abs = Math.abs(finite(value));
  if (sign === 'none' || abs === 0) return formatRub(abs);
  return `${sign === 'plus' ? '+' : MINUS}${formatRub(abs)}`;
}
