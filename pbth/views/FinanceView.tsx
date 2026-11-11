import React, { useEffect, useState } from 'react';
import { Transaction, TransactionType, Role, TeamMember, Team } from '../types';
import { api } from '../api';
import { buildTreasuryViewModel, type Debtor, type MyDebt } from '../lib/treasury-view';
import { formatRub, formatRubSigned } from '../lib/format-rub';
import { bigSumSize, groupTransactionsByDay, transactionLine } from '../lib/money-view';
import { Avatar, Button, Glass, Icon, Row, Screen, Sheet, teamPaint } from '../ui';
import './finance-view.css';

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
}

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
}) => {
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
  const days = groupTransactionsByDay(transactions);
  const debtorsHeading = `Должники${vm.debtors.length > 0 ? ` · ${vm.debtors.length}` : ''}`;

  return (
    <Screen paints={[teamPaint(team.id)]}>
      <div className="pbth-money">
        {/* «Казна» и название команды — в шапке раздела (оболочка). */}

        {/* Баланс команды — только капитан */}
        {vm.showBalance && (
          <Glass className="pbth-money__first">
            <div className="pbth-money__label">
              <Icon name="wallet" size={20} /> Остаток казны
            </div>
            <BigSum text={formatRub(team.budget)} />
            {Number(team.budget) < 0 && <div className="pbth-money__note">Казна в минусе</div>}
            {vm.debtorsKnown && vm.totalDebt > 0 && (
              <Glass layer={2} className="pbth-money__sub">
                <span className="pbth-money__sub-label">Долг игроков</span>
                <span className="pbth-money__sub-value">{formatRub(vm.totalDebt)}</span>
              </Glass>
            )}
            {/* Запись траты — только капитан */}
            {vm.canManage && (
              <Button variant="primary" icon="plus" block onClick={() => setIsModalOpen(true)}>
                Записать трату
              </Button>
            )}
          </Glass>
        )}

        {/* Свой долг — игрок и тренер */}
        {!vm.showBalance && <MyDebtCard myDebt={vm.myDebt} />}

        {/* Должники: капитан видит их всегда (если не пришло — честное сообщение), остальные — когда данные есть */}
        {vm.showHistory || vm.debtorsKnown ? (
          <>
            <h2 className="pbth-money__head">{debtorsHeading}</h2>
            <Glass className="pbth-money__panel">
              <DebtorsList
                debtors={vm.debtors}
                notLoaded={debtsNotLoaded}
                canRemind={vm.canManage}
                meId={meId}
                remindingUserIds={remindingUserIds}
                onRemind={handleRemindDebtorClick}
              />
              {vm.canManage && vm.debtors.length > 0 && (
                <div className="pbth-money__all">
                  <Button variant="glass2" block disabled={isRemindingAll} onClick={handleRemindAllClick}>
                    {isRemindingAll ? 'Отправляем...' : 'Напомнить всем должникам'}
                  </Button>
                </div>
              )}
            </Glass>
          </>
        ) : (
          vm.myDebt.kind === 'unknown' && <DebtsNotLoaded />
        )}

        {vm.showHistory && (
          <>
            <h2 className="pbth-money__head">Операции</h2>
            <Glass className="pbth-money__panel">
              {days.length === 0 && <div className="pbth-money__note">Операций пока нет</div>}
              {days.map((day) => (
                <React.Fragment key={day.key}>
                  <div className="pbth-money__day">{day.label}</div>
                  {day.items.map((t) => (
                    <TransactionRow key={t.id} t={t} />
                  ))}
                </React.Fragment>
              ))}
            </Glass>
          </>
        )}
      </div>

      {/* Новая трата */}
      <Sheet open={isModalOpen} onClose={closeModal} title="Новая трата">
        <form onSubmit={handleSubmit} className="pbth-money__form">
          <label className="pbth-money__field">
            Название
            <input
              type="text"
              className="ui-input"
              placeholder="Шары, аренда..."
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
            />
          </label>
          <label className="pbth-money__field">
            Сумма, ₽
            <input
              type="number"
              inputMode="decimal"
              className="ui-input"
              min="1"
              placeholder="0"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              required
            />
          </label>
          {submitError && <div className="pbth-money__error">{submitError}</div>}
          <div className="pbth-money__btns">
            <Button variant="ghost" onClick={closeModal}>
              Отмена
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Записываем...' : 'Списать'}
            </Button>
          </div>
        </form>
      </Sheet>
    </Screen>
  );
};

function MyDebtCard({ myDebt }: { myDebt: MyDebt }) {
  if (myDebt.kind === 'unknown') return null;
  // Действия оплаты у игрока в приложении сейчас нет (долг закрывает капитан),
  // поэтому только состояние и сумма.
  if (myDebt.kind === 'clear') {
    return (
      <Glass className="pbth-money__first">
        <div className="pbth-money__label">
          <Icon name="circle-check" size={20} /> Мой долг
        </div>
        <div className="pbth-money__big pbth-money__big--text">У тебя нет долга</div>
      </Glass>
    );
  }
  return (
    <Glass className="pbth-money__first">
      <div className="pbth-money__label">
        <Icon name="coins" size={20} /> Твой долг
      </div>
      <BigSum text={formatRub(myDebt.amount)} />
    </Glass>
  );
}

function BigSum({ text }: { text: string }) {
  return <div className={`pbth-money__big pbth-money__big--${bigSumSize(text)}`}>{text}</div>;
}

function DebtsNotLoaded() {
  return <div className="pbth-money__note">Данные о долгах не загрузились. Закрой и снова открой приложение.</div>;
}

function DebtorsList({
  debtors,
  notLoaded,
  canRemind,
  meId,
  remindingUserIds,
  onRemind,
}: {
  debtors: Debtor[];
  notLoaded: boolean;
  canRemind: boolean;
  meId: string | null;
  remindingUserIds: Set<string>;
  onRemind: (userId: string, userName: string) => void;
}) {
  if (notLoaded) return <div className="pbth-money__note">Данные о долгах не загрузились. Закрой и снова открой приложение.</div>;
  if (debtors.length === 0) return <div className="pbth-money__note">Долгов нет</div>;
  return (
    <>
      {debtors.map((d) => (
        <Row
          key={d.id}
          lead={<PersonAvatar name={d.name} src={d.avatar} />}
          title={d.id === meId ? `${d.name} (ты)` : d.name}
          trailing={
            <>
              <span className="pbth-money__sum">{formatRub(d.amount)}</span>
              {canRemind && (
                <Button size="sm" variant="glass2" className="pbth-money__rem" disabled={remindingUserIds.has(d.id)} onClick={() => onRemind(d.id, d.name)}>
                  {remindingUserIds.has(d.id) ? 'Отправляем...' : 'Напомнить'}
                </Button>
              )}
            </>
          }
        />
      ))}
    </>
  );
}

// Фото из данных участника или инициалы; ui/Avatar фото пока не держит.
function PersonAvatar({ name, src }: { name: string; src?: string }) {
  if (!src) return <Avatar name={name} />;
  return <img className="pbth-money__photo" src={src} width={40} height={40} alt={name} loading="lazy" decoding="async" />;
}

function TransactionRow({ t }: { t: Transaction }) {
  const line = transactionLine(t);
  const sum =
    line.sign === 'plus' ? formatRubSigned(t.amount) : line.sign === 'minus' ? formatRub(-Math.abs(Number(t.amount))) : formatRub(t.amount);
  const lead =
    line.kind === 'person' ? (
      <Avatar name={line.title} />
    ) : (
      <span className="pbth-money__ico ui-glass2">
        <Icon name={line.kind === 'expense' ? 'wallet' : 'coins'} size={20} />
      </span>
    );
  return (
    <Row
      lead={lead}
      title={line.title}
      sub={line.sub}
      trailing={
        <span className={`pbth-money__sum${line.sign === 'plus' ? '' : ' pbth-money__sum--out'}`}>
          {sum}
        </span>
      }
    />
  );
}
