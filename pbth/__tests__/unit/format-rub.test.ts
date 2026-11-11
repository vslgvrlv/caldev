import { describe, expect, it } from 'vitest';
import { formatRub, formatRubSigned } from '../../lib/format-rub';
import { bigSumSize, dayLabel, groupTransactionsByDay, transactionLine } from '../../lib/money-view';
import { TransactionType, type Transaction } from '../../types';

describe('formatRub', () => {
  it('положительные: разряды и знак рубля — неразрывные пробелы', () => {
    expect(formatRub(32000)).toBe('32\u00A0000\u00A0₽');
    expect(formatRub(1234567)).toBe('1\u00A0234\u00A0567\u00A0₽');
    expect(formatRub(500)).toBe('500\u00A0₽');
  });
  it('отрицательные сохраняют знак: настоящий минус, без пробела перед числом', () => {
    expect(formatRub(-500)).toBe('\u2212500\u00A0₽');
    expect(formatRub(-2500.75)).toBe('\u22122\u00A0500,75\u00A0₽');
    expect(formatRub(-0.5)).toBe('\u22120,50\u00A0₽');
    expect(formatRub(-500)).not.toContain('-');
  });
  it('ноль и то, что округляется в ноль, — без знака', () => {
    expect(formatRub(0)).toBe('0\u00A0₽');
    expect(formatRub(-0)).toBe('0\u00A0₽');
    expect(formatRub(-0.001)).toBe('0\u00A0₽');
  });
  it('копейки только если есть, всегда две цифры', () => {
    expect(formatRub(1500.5)).toBe('1\u00A0500,50\u00A0₽');
    expect(formatRub(0.5)).toBe('0,50\u00A0₽');
    expect(formatRub(10.07)).toBe('10,07\u00A0₽');
    expect(formatRub(12.999)).toBe('13\u00A0₽');
    expect(formatRub(1234567.5)).toBe('1\u00A0234\u00A0567,50\u00A0₽');
  });
  it('не число — тире, а не «0 ₽»', () => {
    for (const bad of ['abc', {}, [], Infinity, -Infinity, NaN, undefined, null, '', true]) {
      expect(formatRub(bad)).toBe('\u2014');
      expect(formatRubSigned(bad)).toBe('\u2014');
    }
  });
  it('число строкой читается как число', () => {
    expect(formatRub('1500.25')).toBe('1\u00A0500,25\u00A0₽');
  });
});

describe('formatRubSigned', () => {
  it('плюс положительным, минус отрицательным, ноль без знака', () => {
    expect(formatRubSigned(1800)).toBe('+1\u00A0800\u00A0₽');
    expect(formatRubSigned(-12000)).toBe('\u221212\u00A0000\u00A0₽');
    expect(formatRubSigned(0)).toBe('0\u00A0₽');
    expect(formatRubSigned(0.001)).toBe('0\u00A0₽');
  });
});

describe('bigSumSize', () => {
  it('огромный → 28 → 20 по длине строки', () => {
    expect(bigSumSize(formatRub(32000))).toBe('xl');
    expect(bigSumSize(formatRub(132000))).toBe('l');
    expect(bigSumSize(formatRub(1234567))).toBe('l');
    expect(bigSumSize(formatRub(1234567.5))).toBe('l');
    expect(bigSumSize(formatRub(-1234567890.5))).toBe('m');
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

describe('сборы события: знак сохраняется', () => {
  it('отрицательное «осталось собрать» не превращается в положительное', () => {
    const vm = buildEventFinanceViewModel({
      currentUserRole: Role.CAPTAIN,
      detail: {
        event: { id: 'e', title: 't', type: 'TRAINING', startDate: '2026-11-11', financeState: 'COLLECTING' },
        summary: { chargedTotal: 0, paidTotal: 0, outstandingTotal: -150, collectionRatePct: 0 },
        participants: [],
        payments: [],
      },
    });
    expect(vm.summaryCards[2].value).toBe('\u2212150\u00A0₽');
  });
});
