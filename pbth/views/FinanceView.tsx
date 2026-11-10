import React, { useEffect, useState } from 'react';
import { Transaction, TransactionType, Role, TeamMember, Team } from '../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { TrendingUp, TrendingDown, CheckCircle, FileText } from 'lucide-react';
import { api } from '../api';
import { buildTreasuryViewModel, type Debtor, type MyDebt } from '../lib/treasury-view';

// Казна (решение Василия 10.11.2026, п. 9): недоделанное убрано, остались
// журнал, список должников и запись трат. Баланс команды и историю видит только
// капитан (и владелец платформы в его роли); игрок и тренер видят свой долг и
// общий список должников.
//
// Убрано: «Создать сбор». Он начислял сумму одному человеку, в журнале
// выглядел как приход и не создавал долг, а отметить оплату было негде. Полная
// переделка сбора — вторым заходом.

interface FinanceViewProps {
  team: Team;
  transactions: Transaction[];
  members: TeamMember[];
  currentUserRole: Role;
  // Кто смотрит экран: игроку нужно найти в составе свой долг. Не передан —
  // экран узнаёт сам.
  currentUserId?: string;
  onAddTransaction: (t: Omit<Transaction, 'id' | 'date'>) => void | Promise<void>;
  onRemindDebtor: (userId: string, userName: string) => Promise<void>;
  onRemindAllDebtors: () => Promise<void>;
  initialTab?: 'HISTORY' | 'DEBTS';
}

// Неразрывный пробел перед «₽»: иначе на узком экране знак рубля уезжает на
// следующую строку отдельно от суммы.
const formatRub = (value: number) => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;

// Свой id игроку нужен, чтобы выделить из состава собственный долг. Узнаём его
// у сервера (при отсутствии сети — из снимка), а не угадываем по составу.
function useCurrentUserId(explicit: string | undefined, needed: boolean): string | null {
  const [fetched, setFetched] = useState<string | null>(null);

  useEffect(() => {
    if (explicit || !needed) return;
    let cancelled = false;
    api
      .getAuthMe()
      .then((me) => {
        if (!cancelled && me.authenticated) setFetched(me.user.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [explicit, needed]);

  return explicit || fetched;
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  team,
  transactions,
  members,
  currentUserRole,
  currentUserId,
  onAddTransaction,
  onRemindDebtor,
  onRemindAllDebtors,
  initialTab = 'HISTORY',
}) => {
  const [activeTab, setActiveTab] = useState<'HISTORY' | 'DEBTS'>(initialTab);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRemindingAll, setIsRemindingAll] = useState(false);
  const [remindingUserIds, setRemindingUserIds] = useState<Set<string>>(new Set());

  // Форма траты
  const [formAmount, setFormAmount] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Кто книгу команды не видит (игрок, тренер), находит в составе свой долг.
  const seesLedger = currentUserRole === Role.CAPTAIN || currentUserRole === Role.ADMIN;
  const meId = useCurrentUserId(currentUserId, !seesLedger);
  const vm = buildTreasuryViewModel({ role: currentUserRole, members, currentUserId: meId });

  const handleRemindDebtorClick = async (userId: string, userName: string) => {
    setRemindingUserIds((prev) => new Set(prev).add(userId));
    try {
      await onRemindDebtor(userId, userName);
    } finally {
      setRemindingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleRemindAllClick = async () => {
    setIsRemindingAll(true);
    try {
      await onRemindAllDebtors();
    } finally {
      setIsRemindingAll(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Повторное нажатие, пока трата уходит на сервер, записало бы её дважды.
    if (isSubmitting) return;
    const amount = Number(formAmount);
    const title = formTitle.trim();
    if (!title || !(amount > 0)) return;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      await onAddTransaction({
        type: TransactionType.EXPENSE,
        amount,
        title,
        status: 'COMPLETED',
      });
      setIsModalOpen(false);
      setFormAmount('');
      setFormTitle('');
    } catch {
      setSubmitError('Не удалось записать трату. Проверь связь и попробуй ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Игрок, о чьих долгах ничего не пришло, не должен читать «Долгов нет».
  const debtsNotLoaded = !vm.debtorsKnown;

  return (
    <div
      className="pb-24 px-4 h-full flex flex-col animate-fade-in relative"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 1rem)' }}
    >
      <h1 className="text-2xl font-bold text-white mb-6">Казна</h1>

      {/* Баланс команды — только капитан */}
      {vm.showBalance && (
        <div className="bg-gradient-to-br from-pb-surface to-[#1a1a2e] rounded-3xl p-6 border border-white/5 relative overflow-hidden mb-6 shadow-lg shadow-black/50">
          <div className="absolute top-0 right-0 w-32 h-32 bg-pb-primary/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
          <div className="relative z-10">
            <span className="text-pb-subtext text-xs font-bold uppercase tracking-wider block mb-2">Общий баланс</span>
            <div className="text-4xl font-black text-white mb-2 flex items-baseline">
              {Number(team.budget || 0).toLocaleString('ru-RU')} <span className="text-xl ml-2 text-pb-primary">₽</span>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center text-xs text-pb-subtext">
                <div className="w-2 h-2 rounded-full bg-pb-primary mr-2"></div> Доступно
              </div>
              {vm.debtorsKnown && vm.totalDebt > 0 && (
                <div className="flex items-center text-xs text-pb-danger font-bold">
                  <div className="w-2 h-2 rounded-full bg-pb-danger mr-2"></div>
                  Долг игроков: {formatRub(vm.totalDebt)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Свой долг — игрок и тренер */}
      {!vm.showBalance && <MyDebtCard myDebt={vm.myDebt} />}

      {/* Запись траты — только капитан */}
      {vm.canManage && (
        <button
          onClick={() => setIsModalOpen(true)}
          className="w-full mb-6 bg-pb-surface hover:bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-center text-sm font-bold text-white transition-all active:scale-[0.98]"
        >
          <TrendingDown size={16} className="mr-2 text-pb-danger" /> Записать трату
        </button>
      )}

      {vm.showHistory ? (
        <>
          {/* Tabs */}
          <div className="flex bg-pb-surface rounded-xl p-1 border border-white/5 mb-4">
            <button
              onClick={() => setActiveTab('HISTORY')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'HISTORY' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
            >
              История
            </button>
            <button
              onClick={() => setActiveTab('DEBTS')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'DEBTS' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
            >
              Должники {vm.debtors.length > 0 && `(${vm.debtors.length})`}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {activeTab === 'HISTORY' ? (
              <div className="space-y-3">
                {transactions.length === 0 && <div className="text-center text-pb-subtext py-8 text-sm">История пуста</div>}
                {transactions.map((t) => (
                  <TransactionRow key={t.id} t={t} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {vm.canManage && vm.debtors.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRemindAllClick}
                    disabled={isRemindingAll}
                    className="w-full bg-pb-surface border border-pb-primary/30 p-3 rounded-xl text-pb-primary font-bold text-sm hover:bg-pb-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isRemindingAll ? 'Отправляем...' : 'Напомнить всем должникам'}
                  </button>
                )}
                <DebtorsList
                  debtors={vm.debtors}
                  notLoaded={debtsNotLoaded}
                  canRemind={vm.canManage}
                  remindingUserIds={remindingUserIds}
                  onRemind={handleRemindDebtorClick}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {vm.debtorsKnown ? (
            <>
              <div className="text-pb-subtext text-xs font-bold uppercase tracking-wider mb-3">
                Должники {vm.debtors.length > 0 && `(${vm.debtors.length})`}
              </div>
              <div className="space-y-3">
                <DebtorsList
                  debtors={vm.debtors}
                  notLoaded={false}
                  canRemind={false}
                  remindingUserIds={remindingUserIds}
                  onRemind={handleRemindDebtorClick}
                />
              </div>
            </>
          ) : (
            vm.myDebt.kind === 'unknown' && <DebtsNotLoaded />
          )}
        </div>
      )}

      {/* Новая трата */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={closeModal}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-4">Новая трата</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Название</label>
                <input
                  type="text"
                  placeholder="Шары, аренда..."
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Сумма (₽)</label>
                <input
                  type="number"
                  min="1"
                  placeholder="0"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                  required
                />
              </div>

              {submitError && <div className="text-xs text-pb-danger">{submitError}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl font-bold transition-colors text-white bg-pb-danger disabled:opacity-60"
                >
                  {isSubmitting ? 'Записываем...' : 'Списать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

function MyDebtCard({ myDebt }: { myDebt: MyDebt }) {
  if (myDebt.kind === 'unknown') return null;
  if (myDebt.kind === 'clear') {
    return (
      <div className="bg-pb-surface rounded-3xl p-5 border border-white/5 mb-6 flex items-center">
        <CheckCircle size={28} className="text-pb-primary mr-3 shrink-0" />
        <div className="text-white font-bold">У тебя нет долга</div>
      </div>
    );
  }
  return (
    <div className="bg-pb-surface rounded-3xl p-6 border border-pb-danger/30 mb-6">
      <span className="text-pb-subtext text-xs font-bold uppercase tracking-wider block mb-2">Твой долг</span>
      <div className="text-4xl font-black text-pb-danger">{formatRub(myDebt.amount)}</div>
    </div>
  );
}

function DebtsNotLoaded() {
  return (
    <div className="text-center text-pb-subtext py-8 text-sm">
      Данные о долгах не загрузились. Закрой и снова открой приложение.
    </div>
  );
}

function DebtorsList({
  debtors,
  notLoaded,
  canRemind,
  remindingUserIds,
  onRemind,
}: {
  debtors: Debtor[];
  notLoaded: boolean;
  canRemind: boolean;
  remindingUserIds: Set<string>;
  onRemind: (userId: string, userName: string) => void;
}) {
  if (notLoaded) return <DebtsNotLoaded />;
  if (debtors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-pb-subtext">
        <CheckCircle size={48} className="text-pb-primary mb-4 opacity-50" />
        <p>Долгов нет. Все молодцы!</p>
      </div>
    );
  }
  return (
    <>
      {debtors.map((d) => (
        <div key={d.id} className="bg-pb-surface border border-pb-danger/30 p-4 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar name={d.name} src={d.avatar} />
            <div>
              <div className="font-bold text-white text-sm">{d.name}</div>
              {d.nickname && <div className="text-xs text-pb-subtext">@{d.nickname}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono font-bold text-pb-danger">Должен {formatRub(d.amount)}</div>
            {canRemind && (
              <button
                type="button"
                onClick={() => onRemind(d.id, d.name)}
                disabled={remindingUserIds.has(d.id)}
                className="text-[10px] text-pb-primary underline mt-1 disabled:opacity-50 disabled:no-underline"
              >
                {remindingUserIds.has(d.id) ? 'Отправляем...' : 'Напомнить'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// Без фото — инициал в кружке. Ходить за картинкой на чужой сервис с именем
// игрока не нужно, а битая картинка в списке выглядит как поломка.
function Avatar({ name, src }: { name: string; src?: string }) {
  if (src) return <img src={src} className="w-10 h-10 rounded-full bg-white/10 object-cover" alt={name} />;
  return (
    <div
      className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white"
      aria-label={name}
    >
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}

function TransactionRow({ t }: { t: Transaction }) {
  const isExpense = t.type === TransactionType.EXPENSE;
  const isDeposit = t.type === TransactionType.DEPOSIT;
  // Начисление игроку — это долг игрока, а не деньги в казне: плюс и цвет прихода
  // ему не положены.
  const isCharge = t.type === TransactionType.FEE;

  return (
    <div className="bg-pb-surface border border-white/5 p-4 rounded-2xl flex items-center justify-between">
      <div className="flex items-center space-x-3 min-w-0">
        <div
          className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${
            isExpense ? 'bg-pb-danger/10 text-pb-danger' : isDeposit ? 'bg-pb-primary/10 text-pb-primary' : 'bg-pb-warning/10 text-pb-warning'
          }`}
        >
          {isExpense ? <TrendingDown size={18} /> : isDeposit ? <TrendingUp size={18} /> : <FileText size={18} />}
        </div>
        <div>
          <div className="font-bold text-white text-sm">{t.title}</div>
          <div className="text-xs text-pb-subtext">
            {format(t.date, 'd MMM', { locale: ru })} •{' '}
            {isCharge ? `Начисление${t.userName ? ` · ${t.userName}` : ''}` : t.userName || 'Команда'}
          </div>
        </div>
      </div>
      <div className={`ml-3 shrink-0 whitespace-nowrap font-mono font-bold ${isExpense ? 'text-pb-danger' : isCharge ? 'text-pb-warning' : 'text-pb-primary'}`}>
        {isExpense ? '-' : isCharge ? '' : '+'}
        {formatRub(t.amount)}
      </div>
    </div>
  );
}
