import { format, isSameDay, isSameYear, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { TransactionType, type Transaction } from '../types';

// Подача операций казны: заголовки дней и подписи строк. Суммы и порядок записей
// не пересчитываются.

export type TransactionDay = { key: string; label: string; items: Transaction[] };

/** «Сегодня», «Вчера», «10 ноября», для другого года — «10 ноября 2025». */
export function dayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) return 'Сегодня';
  if (isSameDay(date, subDays(now, 1))) return 'Вчера';
  return format(date, isSameYear(date, now) ? 'd MMMM' : 'd MMMM yyyy', { locale: ru });
}

/** Подряд идущие операции одного дня — в одну группу, порядок записей сохраняется. */
export function groupTransactionsByDay(transactions: Transaction[], now: Date = new Date()): TransactionDay[] {
  const days: TransactionDay[] = [];
  for (const item of transactions) {
    const key = format(item.date, 'yyyy-MM-dd');
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: dayLabel(item.date, now), items: [item] });
  }
  return days;
}

export type TransactionLine = {
  title: string;
  sub: string;
  sign: 'plus' | 'minus' | 'none';
  kind: 'person' | 'expense' | 'team';
};

/**
 * Строка операции. Приход — «+», расход — «−», начисление игроку («FEE») — без
 * знака: это его долг, а не деньги в казне.
 */
export function transactionLine(t: Transaction): TransactionLine {
  const person = t.userName?.trim();
  const sign = t.type === TransactionType.EXPENSE ? 'minus' : t.type === TransactionType.FEE ? 'none' : 'plus';
  const kind = person ? 'person' : t.type === TransactionType.EXPENSE ? 'expense' : 'team';
  const what = t.type === TransactionType.FEE ? `Начисление · ${t.title}` : t.title;
  if (person) return { title: person, sub: what, sign, kind };
  return {
    title: t.title,
    sub: t.type === TransactionType.EXPENSE ? 'Расход' : t.type === TransactionType.FEE ? 'Начисление' : 'Команда',
    sign,
    kind,
  };
}
