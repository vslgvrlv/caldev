import { describe, expect, it } from 'vitest';
import { Role } from '../../types';
import { buildTreasuryViewModel, type TreasuryMember } from '../../lib/treasury-view';

// Решение Василия 10.11.2026, п. 9: игрок видит свой долг и общий список
// должников; баланс команды и историю видит только капитан.
//
// Ответ сервера для игрока меняется: раньше в общей загрузке приходили и
// баланс, и вся история, и долги всех; теперь чужие деньги игроку приходить
// перестанут. Экран обязан работать с обоими ответами: со старым — не выдавать
// лишнего, с новым — не падать и не объявлять «долгов нет» там, где просто не
// пришли данные.

const m = (id: string, name: string, balance?: number | null): TreasuryMember => ({
  id,
  name,
  nickname: name.toLowerCase(),
  balance,
});

// Старый ответ: сервер отдаёт баланс каждого участника.
const oldShape = [
  m('cap', 'Капитан', 0),
  m('anna', 'Анна', -1200),
  m('me', 'Игрок', -500),
  m('bob', 'Боб', 300),
  m('dan', 'Дэн', -50),
];

// Новый ответ (бэкенд, PR 131): чужой баланс — ноль или минус долг, переплаты и
// взносы других не раскрываются, свой баланс приходит целиком. Баланса команды
// и истории нет совсем.
const newShape = [m('cap', 'Капитан', 0), m('anna', 'Анна', -1200), m('me', 'Игрок', -500), m('bob', 'Боб', 0)];

// Ответ вовсе без балансов: так не должно быть, но экран обязан пережить и это
// (устаревший снимок, сбой загрузки).
const noBalances = [m('cap', 'Капитан'), m('anna', 'Анна'), m('me', 'Игрок', -500), m('bob', 'Боб', null)];

describe('казна игрока: старый ответ (баланс есть у всех)', () => {
  const vm = buildTreasuryViewModel({ role: Role.PLAYER, members: oldShape, currentUserId: 'me' });

  it('баланс команды и историю не показывает, хотя данные пришли', () => {
    expect(vm.showBalance).toBe(false);
    expect(vm.showHistory).toBe(false);
    expect(vm.canManage).toBe(false);
  });

  it('называет собственный долг', () => {
    expect(vm.myDebt).toEqual({ kind: 'debt', amount: 500 });
  });

  it('даёт общий список должников с суммами, крупные долги первыми', () => {
    expect(vm.debtors.map((d) => [d.id, d.amount])).toEqual([
      ['anna', 1200],
      ['me', 500],
      ['dan', 50],
    ]);
    expect(vm.totalDebt).toBe(1750);
    expect(vm.debtorsKnown).toBe(true);
  });

  it('переплата и нулевой баланс — не долг', () => {
    const clear = buildTreasuryViewModel({
      role: Role.PLAYER,
      members: [m('me', 'Игрок', 300), m('bob', 'Боб', 0)],
      currentUserId: 'me',
    });
    expect(clear.myDebt).toEqual({ kind: 'clear' });
    expect(clear.debtors).toEqual([]);
    expect(clear.debtorsKnown).toBe(true);

    const zero = buildTreasuryViewModel({ role: Role.PLAYER, members: [m('me', 'Игрок', 0)], currentUserId: 'me' });
    expect(zero.myDebt).toEqual({ kind: 'clear' });
  });
});

describe('казна игрока: новый ответ (чужие деньги скрыты, долги видны)', () => {
  it('свой долг и общий список должников те же, что и раньше', () => {
    const vm = buildTreasuryViewModel({ role: Role.PLAYER, members: newShape, currentUserId: 'me' });
    expect(vm.myDebt).toEqual({ kind: 'debt', amount: 500 });
    expect(vm.debtors.map((d) => [d.id, d.amount])).toEqual([
      ['anna', 1200],
      ['me', 500],
    ]);
    expect(vm.debtorsKnown).toBe(true);
    expect(vm.showBalance).toBe(false);
    expect(vm.showHistory).toBe(false);
  });

  it('ноль у остальных — это «долга нет», а не «нет данных»', () => {
    const vm = buildTreasuryViewModel({
      role: Role.PLAYER,
      members: [m('cap', 'Капитан', 0), m('me', 'Игрок', 0), m('bob', 'Боб', 0)],
      currentUserId: 'me',
    });
    expect(vm.myDebt).toEqual({ kind: 'clear' });
    expect(vm.debtors).toEqual([]);
    expect(vm.debtorsKnown).toBe(true);
  });
});

describe('казна игрока: ответ вовсе без балансов', () => {
  it('свой долг виден, чужие данные не выдумываются', () => {
    const vm = buildTreasuryViewModel({ role: Role.PLAYER, members: noBalances, currentUserId: 'me' });
    expect(vm.myDebt).toEqual({ kind: 'debt', amount: 500 });
    expect(vm.debtors.map((d) => d.id)).toEqual(['me']);
    // О чужих долгах ничего не известно — «долгов нет» говорить нельзя.
    expect(vm.debtorsKnown).toBe(false);
    expect(vm.showBalance).toBe(false);
    expect(vm.showHistory).toBe(false);
  });

  it('если нет даже собственного баланса — долг неизвестен, а не нулевой', () => {
    const vm = buildTreasuryViewModel({
      role: Role.PLAYER,
      members: [m('me', 'Игрок'), m('cap', 'Капитан', null)],
      currentUserId: 'me',
    });
    expect(vm.myDebt).toEqual({ kind: 'unknown' });
    expect(vm.debtors).toEqual([]);
    expect(vm.debtorsKnown).toBe(false);
  });

  it('пока неизвестно, кто «я», долг не угадывается', () => {
    const vm = buildTreasuryViewModel({ role: Role.PLAYER, members: oldShape, currentUserId: null });
    expect(vm.myDebt).toEqual({ kind: 'unknown' });
    // Общий список от этого не страдает.
    expect(vm.debtors).toHaveLength(3);
  });

  it('мусор вместо суммы считается отсутствием данных', () => {
    const vm = buildTreasuryViewModel({
      role: Role.PLAYER,
      members: [m('me', 'Игрок', Number.NaN), m('anna', 'Анна', undefined)],
      currentUserId: 'me',
    });
    expect(vm.myDebt).toEqual({ kind: 'unknown' });
    expect(vm.debtorsKnown).toBe(false);
  });

  it('пустой состав не роняет расчёт', () => {
    const vm = buildTreasuryViewModel({ role: Role.PLAYER, members: [], currentUserId: 'me' });
    expect(vm.debtors).toEqual([]);
    expect(vm.totalDebt).toBe(0);
    expect(vm.myDebt).toEqual({ kind: 'unknown' });
  });
});

describe('казна капитана, владельца и тренера', () => {
  it('капитан видит всё и может записывать траты', () => {
    const vm = buildTreasuryViewModel({ role: Role.CAPTAIN, members: oldShape, currentUserId: 'cap' });
    expect(vm.showBalance).toBe(true);
    expect(vm.showHistory).toBe(true);
    expect(vm.canManage).toBe(true);
    expect(vm.debtors).toHaveLength(3);
    expect(vm.totalDebt).toBe(1750);
  });

  it('владелец платформы действует в команде как капитан', () => {
    const vm = buildTreasuryViewModel({ role: Role.ADMIN, members: oldShape, currentUserId: 'owner' });
    expect(vm.canManage).toBe(true);
    expect(vm.showBalance).toBe(true);
  });

  // Бэкенд (PR 131) даёт книгу команды только капитану и владельцу: тренеру,
  // как и игроку, приходят «свой долг и должники», а баланс команды — 0 и история
  // пуста. Экран обязан показывать то же самое, а не «0 ₽» и «История пуста».
  it('тренер видит то же, что игрок: баланс и историю — только капитан', () => {
    const vm = buildTreasuryViewModel({ role: Role.TRAINER, members: newShape, currentUserId: 'coach' });
    expect(vm.showBalance).toBe(false);
    expect(vm.showHistory).toBe(false);
    expect(vm.canManage).toBe(false);
    expect(vm.debtors).toHaveLength(2);
  });

  it('если балансы не загрузились, у капитана тоже нет «долгов нет»', () => {
    const vm = buildTreasuryViewModel({
      role: Role.CAPTAIN,
      members: [m('cap', 'Капитан'), m('anna', 'Анна')],
      currentUserId: 'cap',
    });
    expect(vm.debtorsKnown).toBe(false);
  });
});

describe('список должников', () => {
  it('при равных долгах идёт по алфавиту', () => {
    const vm = buildTreasuryViewModel({
      role: Role.CAPTAIN,
      members: [m('b', 'Яна', -100), m('a', 'Анна', -100), m('c', 'Борис', -100)],
      currentUserId: 'cap',
    });
    expect(vm.debtors.map((d) => d.name)).toEqual(['Анна', 'Борис', 'Яна']);
  });

  it('несёт всё нужное строке: имя, ник, аватар, сумму долга положительным числом', () => {
    const vm = buildTreasuryViewModel({
      role: Role.CAPTAIN,
      members: [{ id: 'a', name: 'Анна', nickname: 'ann', avatar: 'x.png', balance: -75.5 }],
      currentUserId: 'cap',
    });
    expect(vm.debtors[0]).toEqual({ id: 'a', name: 'Анна', nickname: 'ann', avatar: 'x.png', amount: 75.5 });
  });
});
