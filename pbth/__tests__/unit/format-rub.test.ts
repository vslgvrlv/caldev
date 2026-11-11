import { describe, expect, it } from 'vitest';
import { formatRub, formatRubSigned } from '../../lib/format-rub';
import { dayLabel, groupTransactionsByDay, transactionLine } from '../../lib/money-view';
import { TransactionType, type Transaction } from '../../types';

describe('formatRub', () => {
  it('разряды и знак рубля — неразрывные пробелы', () => {
    expect(formatRub(32000)).toBe('32 000 ₽');
    expect(formatRub(1500)).toBe('1 500 ₽');
    expect(formatRub(1234567)).toBe('1 234 567 ₽');
    expect(formatRub(500)).toBe('500 ₽');
  });
  it('ноль и нечисло — «0 ₽»', () => {
    expect(formatRub(0)).toBe('0 ₽');
    expect(formatRub(NaN)).toBe('0 ₽');
    expect(formatRub(undefined as unknown as number)).toBe('0 ₽');
  });
  it('копейки показываются, только если есть', () => {
    expect(formatRub(1500.5)).toBe('1 500,50 ₽');
    expect(formatRub(10.07)).toBe('10,07 ₽');
    expect(formatRub(12.999)).toBe('13 ₽');
  });
  it('без знака формат берёт модуль', () => {
    expect(formatRub(-500)).toBe('500 ₽');
  });
});

describe('formatRubSigned', () => {
  it('плюс и настоящий минус U+2212', () => {
    expect(formatRubSigned(1800, 'plus')).toBe('+1 800 ₽');
    expect(formatRubSigned(12000, 'minus')).toBe('−12 000 ₽');
    expect(formatRubSigned(12000, 'minus')).not.toContain('-');
  });
  it('без знака и ноль — без знака', () => {
    expect(formatRubSigned(3500, 'none')).toBe('3 500 ₽');
    expect(formatRubSigned(0, 'plus')).toBe('0 ₽');
    expect(formatRubSigned(0, 'minus')).toBe('0 ₽');
  });
  it('знак переданной суммы не удваивается', () => {
    expect(formatRubSigned(-100, 'minus')).toBe('−100 ₽');
  });
});

const tx = (p: Partial<Transaction>): Transaction => ({
  id: 'x',
  type: TransactionType.DEPOSIT,
  amount: 100,
  title: 'Взнос',
  date: new Date(2026, 10, 11, 10),
  status: 'COMPLETED',
  ...p,
});

describe('dayLabel', () => {
  const now = new Date(2026, 10, 11, 18);
  it('сегодня, вчера, дата, дата с годом', () => {
    expect(dayLabel(new Date(2026, 10, 11, 1), now)).toBe('Сегодня');
    expect(dayLabel(new Date(2026, 10, 10, 23), now)).toBe('Вчера');
    expect(dayLabel(new Date(2026, 10, 7), now)).toBe('7 ноября');
    expect(dayLabel(new Date(2025, 11, 31), now)).toBe('31 декабря 2025');
  });
});

describe('groupTransactionsByDay', () => {
  const now = new Date(2026, 10, 11, 18);
  it('группирует подряд идущие записи одного дня и не меняет порядок', () => {
    const a = tx({ id: 'a' });
    const b = tx({ id: 'b', date: new Date(2026, 10, 11, 9) });
    const c = tx({ id: 'c', date: new Date(2026, 10, 7) });
    const days = groupTransactionsByDay([a, b, c], now);
    expect(days.map((d) => [d.label, d.items.map((i) => i.id)])).toEqual([
      ['Сегодня', ['a', 'b']],
      ['7 ноября', ['c']],
    ]);
  });
  it('пусто — нет групп', () => {
    expect(groupTransactionsByDay([], now)).toEqual([]);
  });
});

describe('transactionLine', () => {
  it('приход от игрока: имя, назначение, плюс', () => {
    expect(transactionLine(tx({ userName: 'Анна', title: 'Взнос Анны' }))).toEqual({ title: 'Анна', sub: 'Взнос Анны', sign: 'plus', kind: 'person' });
  });
  it('расход без человека: назначение и подпись «Расход», минус', () => {
    expect(transactionLine(tx({ type: TransactionType.EXPENSE, title: 'Аренда' }))).toEqual({ title: 'Аренда', sub: 'Расход', sign: 'minus', kind: 'expense' });
  });
  it('начисление — без знака', () => {
    const line = transactionLine(tx({ type: TransactionType.FEE, userName: 'Анна', title: 'Взнос на турнир' }));
    expect(line.sign).toBe('none');
    expect(line.sub).toBe('Начисление · Взнос на турнир');
  });
});

import { buildEventFinanceViewModel } from '../../lib/event-finance-view-model';
import { Role } from '../../types';

describe('сборы события: суммы с неразрывным пробелом', () => {
  it('карточки итогов', () => {
    const vm = buildEventFinanceViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: { id: 'e', title: 't', type: 'TRAINING', startDate: '2026-11-11', financeState: 'COLLECTING' },
        summary: { chargedTotal: 12000, paidTotal: 4500, outstandingTotal: 7500, collectionRatePct: 37 },
        participants: [],
        payments: [],
      },
    });
    expect(vm.summaryCards[1].value).toBe('4 500 ₽');
    expect(vm.summaryCards[2].value).toBe('7 500 ₽');
  });
});
