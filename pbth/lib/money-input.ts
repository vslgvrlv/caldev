// Поле суммы: человек вводит цифры, на экране они разбиты на разряды, в форме
// остаётся «сырая» строка («1500» или «1500.5»), которую Number() читает как есть.
import { formatRub } from './format-rub';

/** Оставляет цифры и одну десятичную точку (запятая — тоже разделитель), не больше двух знаков после неё. */
export function sanitizeMoney(text: string): string {
  const cleaned = text.replace(',', '.').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned.replace(/^0+(?=\d)/, '');
  const whole = cleaned.slice(0, dot).replace(/^0+(?=\d)/, '') || '0';
  const frac = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${frac}`;
}

/** «1500» -> «1 500» (неразрывные пробелы), «1500.5» -> «1 500,5»; пусто — пусто. */
export function groupMoney(raw: string): string {
  if (!raw) return '';
  const dot = raw.indexOf('.');
  const whole = dot === -1 ? raw : raw.slice(0, dot);
  const grouped = formatRub(Number(whole || '0')).replace(/\s?₽$/, '');
  return dot === -1 ? grouped : `${grouped},${raw.slice(dot + 1)}`;
}
