// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from 'node:fs';
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinanceView } from '../../views/FinanceView';
import { Role, TransactionType, type Team, type TeamMember, type Transaction } from '../../types';

// Казна глазами людей. Решение Василия 10.11.2026, п. 9: с экранов убрано то,
// что врало («Создать сбор» начислял одному человеку и выглядел как приход),
// оставлены журнал, список должников и запись трат. Игрок видит свой долг и
// общий список должников; баланс и историю — только капитан.

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[  ]/g, ' ').replace(/\s+/g, ' ');

const team = (role: Role, budget = 32000): Team => ({
  id: 't1',
  name: 'Holy Guns',
  shortCode: 'HG',
  role,
  budget,
});

const member = (id: string, name: string, balance?: number | null): TeamMember =>
  ({
    id,
    name,
    nickname: name.toLowerCase(),
    role: Role.PLAYER,
    status: 'ACTIVE',
    balance: balance as number | undefined,
  }) as TeamMember;

const transactions: Transaction[] = [
  { id: 'x1', type: TransactionType.EXPENSE, amount: 6000, title: 'Аренда площадки', date: new Date(2026, 10, 3), status: 'COMPLETED' },
  { id: 'x2', type: TransactionType.DEPOSIT, amount: 1500, title: 'Взнос Анны', date: new Date(2026, 10, 4), userName: 'Анна', status: 'COMPLETED' },
  { id: 'x3', type: TransactionType.FEE, amount: 3500, title: 'Взнос на турнир', date: new Date(2026, 10, 5), userName: 'Анна', status: 'COMPLETED' },
];

// Старый ответ: сервер отдаёт баланс каждого участника, историю и баланс команды.
const oldMembers = [member('cap', 'Капитан', 0), member('anna', 'Анна', -1200), member('me', 'Игрок', -500), member('bob', 'Боб', 300)];
// Новый ответ бэкенда (PR 131): чужой баланс — ноль или минус долг, свой — целиком;
// баланса команды (0) и истории ([]) нет.
const newMembers = [member('cap', 'Капитан', 0), member('anna', 'Анна', -1200), member('me', 'Игрок', -500), member('bob', 'Боб', 0)];
// Ответ вовсе без балансов: не должен случаться, но экран обязан его пережить.
const noBalances = [member('cap', 'Капитан'), member('anna', 'Анна'), member('me', 'Игрок', -500), member('bob', 'Боб', null)];

type Props = React.ComponentProps<typeof FinanceView>;
function render(props: Partial<Props> & Pick<Props, 'currentUserRole'>) {
  const noop = async () => undefined;
  return text(
    renderToStaticMarkup(
      React.createElement(FinanceView, {
        team: team(props.currentUserRole),
        transactions,
        members: oldMembers,
        currentUserId: 'me',
        onAddTransaction: () => undefined,
        onRemindDebtor: noop,
        onRemindAllDebtors: noop,
        ...props,
      } as Props)
    )
  );
}

describe('казна игрока: старый ответ (приходит всё)', () => {
  const html = render({ currentUserRole: Role.PLAYER });

  it('показывает его долг и общий список должников с суммами', () => {
    expect(html).toContain('Твой долг');
    expect(html).toContain('500 ₽');
    expect(html).toContain('Должники');
    expect(html).toContain('Анна');
    expect(html).toContain('1 200 ₽');
  });

  it('не показывает баланс команды и историю, хотя они пришли', () => {
    expect(html).not.toContain('Остаток казны');
    expect(html).not.toContain('32 000');
    expect(html).not.toContain('Операции');
    expect(html).not.toContain('Аренда площадки');
    expect(html).not.toContain('Взнос Анны');
  });

  it('не предлагает действий, которых у игрока нет', () => {
    expect(html).not.toContain('Записать трату');
    expect(html).not.toContain('Создать сбор');
    expect(html).not.toContain('Напомнить');
  });
});

describe('казна игрока: новый ответ (чужие деньги скрыты, долги видны)', () => {
  const html = render({
    currentUserRole: Role.PLAYER,
    members: newMembers,
    transactions: [],
    team: team(Role.PLAYER, 0),
  });

  it('показывает его долг и общий список должников', () => {
    // «Казна» — заголовок шапки раздела (оболочка), на самом экране его нет.
    expect(html).toContain('Твой долг');
    expect(html).toContain('500 ₽');
    expect(html).toContain('Должники · 2');
    expect(html).toContain('1 200 ₽');
  });

  // Этот экран на старой верстке выглядел так: «Общий баланс 0 ₽», «История
  // пуста». Ноль — не баланс команды, а то, что сервер её больше не отдаёт.
  it('не выдаёт пустые заглушки за ответ', () => {
    expect(html).not.toContain('Остаток казны');
    expect(html).not.toContain('Операции');
    expect(html).not.toContain('Долгов нет');
    expect(html).not.toContain('Все молодцы');
    expect(html).not.toMatch(/(^|[^\d])0 ₽/);
  });

  it('если долгов ни у кого нет — говорит это прямо: данные пришли, и они такие', () => {
    const clear = render({
      currentUserRole: Role.PLAYER,
      members: [member('cap', 'Капитан', 0), member('me', 'Игрок', 0), member('bob', 'Боб', 0)],
      transactions: [],
      team: team(Role.PLAYER, 0),
    });
    expect(clear).toContain('У тебя нет долга');
    expect(clear).toContain('Долгов нет');
  });
});

describe('казна игрока: ответ вовсе без балансов', () => {
  it('показывает известное и не рисует «долгов нет» по неизвестному', () => {
    const html = render({ currentUserRole: Role.PLAYER, members: noBalances, transactions: [], team: team(Role.PLAYER, 0) });
    expect(html).toContain('Твой долг');
    expect(html).not.toContain('Долгов нет');
    expect(html).not.toContain('Все молодцы');
  });

  it('если вообще ничего не пришло — говорит об этом прямо', () => {
    const nothing = render({
      currentUserRole: Role.PLAYER,
      members: [member('me', 'Игрок'), member('cap', 'Капитан', null)],
      transactions: [],
      team: team(Role.PLAYER, 0),
    });
    expect(nothing).toContain('Данные о долгах не загрузились');
    expect(nothing).not.toContain('Долгов нет');
    expect(nothing).not.toContain('Твой долг');
  });
});

describe('казна игрока: долга нет', () => {
  it('говорит об этом, только когда знает', () => {
    const html = render({ currentUserRole: Role.PLAYER, members: [member('me', 'Игрок', 300), member('anna', 'Анна', 0)] });
    expect(html).toContain('У тебя нет долга');
    expect(html).toContain('Долгов нет');
  });
});

describe('казна капитана', () => {
  const html = render({ currentUserRole: Role.CAPTAIN, currentUserId: 'cap' });

  it('держит баланс, журнал и запись трат', () => {
    expect(html).toContain('Остаток казны');
    expect(html).toContain('32 000 ₽');
    expect(html).toContain('Долг игроков');
    expect(html).toContain('1 700 ₽');
    expect(html).toContain('Записать трату');
    expect(html).toContain('Операции');
    expect(html).toContain('Аренда площадки');
    expect(html).toContain('Должники · 2');
  });

  it('«Создать сбор» убран: он не создавал долг и выглядел как приход', () => {
    expect(html).not.toContain('Создать сбор');
    expect(html).not.toContain('Новый сбор');
  });

  it('прежнее начисление в журнале не выглядит приходом', () => {
    expect(html).toContain('Взнос на турнир');
    expect(html).toContain('Начисление');
    expect(html).not.toContain('+3500');
    expect(html).not.toContain('+3 500');
    expect(html).toContain('3 500 ₽');
    // А настоящие приход и расход остаются со знаками; минус — настоящий (U+2212).
    expect(html).toContain('+1 500 ₽');
    expect(html).toContain('\u22126 000 ₽');
    expect(html).not.toContain('-6 000');
  });

  it('должники: сумма и «Напомнить» каждому и всем', () => {
    const debts = render({ currentUserRole: Role.CAPTAIN, currentUserId: 'cap' });
    expect(debts).toContain('Напомнить всем должникам');
    expect(debts).toContain('1 200 ₽');
    // Кнопка «Напомнить» у каждого из двух должников (общая — «…всем должникам»).
    expect(debts.match(/Напомнить(?! всем)/g)).toHaveLength(2);
  });

  it('если балансы не загрузились — не объявляет «Все молодцы»', () => {
    const debts = render({
      currentUserRole: Role.CAPTAIN,
      currentUserId: 'cap',
      members: [member('cap', 'Капитан'), member('anna', 'Анна')],
    });
    expect(debts).toContain('Данные о долгах не загрузились');
    expect(debts).not.toContain('Все молодцы');
  });
});

describe('казна капитана: отрицательный остаток', () => {
  it('не теряет знак и подписывает «Казна в минусе»', () => {
    const html = render({ currentUserRole: Role.CAPTAIN, currentUserId: 'cap', team: team(Role.CAPTAIN, -500) });
    expect(html).toContain('\u2212500 ₽');
    expect(html).toContain('Казна в минусе');
    expect(render({ currentUserRole: Role.CAPTAIN, currentUserId: 'cap' })).not.toContain('Казна в минусе');
  });
});

describe('казна тренера', () => {
  // Бэкенд (PR 131) отдаёт книгу команды только капитану и владельцу. Тренеру —
  // как игроку: долги, а не баланс и история.
  it('видит то же, что игрок, и ничего не меняет', () => {
    const html = render({ currentUserRole: Role.TRAINER, currentUserId: 'coach', members: newMembers, transactions: [], team: team(Role.TRAINER, 0) });
    expect(html).toContain('Должники · 2');
    expect(html).toContain('1 200 ₽');
    expect(html).not.toContain('Остаток казны');
    expect(html).not.toContain('Операции');
    expect(html).not.toContain('Записать трату');
    expect(html).not.toContain('Напомнить');
  });
});

describe('исходник экрана казны', () => {
  const source = readFileSync(fileURLToPath(new URL('../../views/FinanceView.tsx', import.meta.url)), 'utf8');

  it('не содержит опечатки и недостижимой формы начисления', () => {
    expect(source).not.toContain('касатеся');
    // Форма начисления игроку (поле «Кого касается») ушла вместе с кнопкой.
    expect(source).not.toContain('formUser');
    expect(source).not.toContain('TransactionType.FEE ?');
  });

  it('не ходит за аватарами на чужой сервис', () => {
    expect(source).not.toContain('ui-avatars.com');
  });

  it('рубли без значка доллара', () => {
    expect(source).not.toContain('DollarSign');
  });
});
