import { Role } from '../types';

// Что показывает казна и кому (решение Василия 10.11.2026, п. 9): баланс
// команды и историю видит только капитан (и владелец платформы в его роли), все
// остальные — игрок, тренер — видят свой долг и общий список должников.
// Считается из одного списка участников с балансами, потому что именно он
// приходит в любом варианте ответа сервера.
//
// Ответ сервера для не-капитана меняется (бэкенд, PR 131): раньше с общей
// загрузкой приходили баланс команды, вся история и баланс каждого, теперь
// баланс команды — 0, история пуста, чужой баланс — ноль или минус долг. Экран
// от роли решает сам, а не по тому, что пришло: «0 ₽» и «История пуста» там,
// где сервер просто ничего не отдаёт, были бы враньём. И «нет данных» от
// «долга нет» он отличает: пустое поле не превращается в ноль, иначе экран
// объявит «Долгов нет. Все молодцы!» там, где просто ничего не пришло.

export type TreasuryMember = {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  // Положительный — переплата, отрицательный — долг. Нет поля, null или не
  // число — сервер этих данных не прислал.
  balance?: number | null;
};

export type Debtor = {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  // Сумма долга положительным числом.
  amount: number;
};

export type MyDebt = { kind: 'debt'; amount: number } | { kind: 'clear' } | { kind: 'unknown' };

export type TreasuryViewModel = {
  // Записывать траты может капитан (и владелец платформы в его роли).
  canManage: boolean;
  showBalance: boolean;
  showHistory: boolean;
  debtors: Debtor[];
  totalDebt: number;
  // Известны ли долги вообще. Ложь — пустой список значит «не прислали», а не
  // «никто не должен».
  debtorsKnown: boolean;
  myDebt: MyDebt;
};

function isKnownBalance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildTreasuryViewModel(input: {
  role: Role;
  members: TreasuryMember[];
  currentUserId?: string | null;
}): TreasuryViewModel {
  const { role, members, currentUserId } = input;
  // Как на бэкенде: книгу команды видят CAPTAIN и ADMIN, остальные — только долги.
  const sawLedger = role === Role.CAPTAIN || role === Role.ADMIN;

  const debtors: Debtor[] = members
    .filter((member) => isKnownBalance(member.balance) && member.balance < 0)
    .map((member) => ({
      id: member.id,
      name: member.name,
      nickname: member.nickname,
      avatar: member.avatar,
      amount: Math.abs(member.balance as number),
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ru'));

  // Собственный баланс ничего не говорит о чужих долгах, поэтому тому, кто
  // книги не видит, «долги известны» считаем по остальным участникам.
  const debtorsKnown = members.some(
    (member) => isKnownBalance(member.balance) && (sawLedger || member.id !== currentUserId)
  );

  const me = currentUserId ? members.find((member) => member.id === currentUserId) : undefined;
  let myDebt: MyDebt = { kind: 'unknown' };
  if (me && isKnownBalance(me.balance)) {
    myDebt = me.balance < 0 ? { kind: 'debt', amount: Math.abs(me.balance) } : { kind: 'clear' };
  }

  return {
    canManage: sawLedger,
    showBalance: sawLedger,
    showHistory: sawLedger,
    debtors,
    totalDebt: debtors.reduce((sum, debtor) => sum + debtor.amount, 0),
    debtorsKnown,
    myDebt,
  };
}

/**
 * Подпись строки «Казна» на экране команды: капитану — остаток казны, игроку и
 * тренеру — свой долг. Нет данных — подписи нет: «долгов нет» там, где ничего
 * не пришло, было бы враньём.
 */
export function treasuryRowSub(input: {
  role: Role;
  budget?: number | null;
  members: TreasuryMember[];
  currentUserId?: string | null;
  formatRub: (value: unknown) => string;
}): string | undefined {
  const vm = buildTreasuryViewModel({ role: input.role, members: input.members, currentUserId: input.currentUserId });
  if (vm.showBalance) {
    if (!isKnownBalance(input.budget)) return undefined;
    return `остаток ${input.formatRub(input.budget)}`;
  }
  if (vm.myDebt.kind === 'debt') return `твой долг ${input.formatRub(vm.myDebt.amount)}`;
  if (vm.myDebt.kind === 'clear') return 'долгов нет';
  return undefined;
}
