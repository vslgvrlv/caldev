import React, { useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CreditCard,
  ImagePlus,
  RefreshCw,
  TrendingDown,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { FinanceEventsResponse, FinanceMemberDetailResponse, FinanceOverviewResponse } from '../api';
import { api as financeApi } from '../api';
import { TeamContextSwitcher } from '../components/TeamContextSwitcher';
import { FinanceTransactionModal } from '../components/FinanceTransactionModal';
import { TransferConfirmationModal } from '../components/TransferConfirmationModal';
import { ALL_TEAMS_FINANCE_FILTER, buildFinanceViewModel } from '../lib/finance-view-model';
import {
  Role,
  TeamContext,
  TeamMember,
  Transaction,
  TransactionType,
  TransferConfirmation,
  User,
} from '../types';

interface FinanceViewProps {
  selectedTeamId: string;
  selectedTeamName: string;
  allowAllTeamsFilter: boolean;
  currentUser: User;
  availableTeams: TeamContext[];
  members: TeamMember[];
  transactions: Transaction[];
  currentUserRole: Role;
  financeOverview: FinanceOverviewResponse | null;
  financeEvents: FinanceEventsResponse['items'];
  financeConfirmations: TransferConfirmation[];
  playerFinanceDetail: FinanceMemberDetailResponse | null;
  isSwitchingTeam: boolean;
  onSwitchTeam: (teamId: string) => Promise<void> | void;
  onAddTransaction: (t: Omit<Transaction, 'id' | 'date'>) => Promise<void> | void;
  onRemindDebtor: (userId: string, userName: string) => Promise<void>;
  onRemindAllDebtors: () => Promise<void>;
  onCreateTransferConfirmation: (payload: {
    userId?: string;
    amount: number;
    screenshotDataUrl: string;
    note?: string;
    autoApprove?: boolean;
    preferredEventId?: string;
  }) => Promise<void>;
  onReviewTransferConfirmation: (
    confirmationId: string,
    decision: 'APPROVE' | 'REJECT',
    reviewNote?: string
  ) => Promise<void>;
}

type TransactionModalType = TransactionType.EXPENSE | TransactionType.FEE;

export const FinanceView: React.FC<FinanceViewProps> = ({
  selectedTeamId,
  selectedTeamName,
  allowAllTeamsFilter,
  currentUser,
  availableTeams,
  members,
  transactions,
  currentUserRole,
  financeOverview,
  financeEvents,
  financeConfirmations,
  playerFinanceDetail,
  isSwitchingTeam,
  onSwitchTeam,
  onAddTransaction,
  onRemindDebtor,
  onRemindAllDebtors,
  onCreateTransferConfirmation,
  onReviewTransferConfirmation,
}) => {
  const isCaptain = currentUserRole === Role.CAPTAIN || currentUserRole === Role.ADMIN;
  const debtors =
    financeOverview?.topDebtors ||
    members
      .filter((member) => (member.balance || 0) < 0)
      .map((member) => ({
        userId: member.id,
        name: member.name,
        nickname: member.nickname,
        avatar: member.avatar,
        debt: Math.abs(member.balance || 0),
      }));

  const summary = isCaptain
    ? {
        balance: financeOverview?.summary?.balance,
        totalOutstanding: financeOverview?.summary?.totalOutstanding || 0,
        overdueCount: financeOverview?.summary?.overdueCount || 0,
        pendingConfirmations:
          financeOverview?.summary?.pendingConfirmations ||
          financeConfirmations.filter((item) => item.status === 'PENDING_REVIEW').length,
      }
    : {
        totalOutstanding:
          playerFinanceDetail?.summary?.outstanding || financeOverview?.summary?.totalOutstanding || 0,
        overdueCount:
          playerFinanceDetail?.summary?.eventsWithDebt || financeOverview?.summary?.overdueCount || 0,
        pendingConfirmations:
          financeOverview?.summary?.pendingConfirmations ||
          financeConfirmations.filter((item) => item.status === 'PENDING_REVIEW').length,
      };

  const viewModel = buildFinanceViewModel({
    currentUserRole,
    activeTeamName: selectedTeamName,
    summary,
    debtors,
    confirmations: financeConfirmations.map((item) => ({
      id: item.id,
      status: item.status,
      amount: item.amount,
      userName: item.userName,
    })),
  });

  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [transactionType, setTransactionType] = useState<TransactionModalType>(TransactionType.EXPENSE);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<'CAPTAIN_SETTLE' | 'PLAYER_SUBMIT'>('PLAYER_SUBMIT');
  const [transferDefaultUserId, setTransferDefaultUserId] = useState<string | undefined>(undefined);
  const [reviewingConfirmationId, setReviewingConfirmationId] = useState<string | null>(null);
  const [remindingUserIds, setRemindingUserIds] = useState<Set<string>>(new Set());
  const [isRemindingAll, setIsRemindingAll] = useState(false);

  const openTransactionModal = (type: TransactionModalType) => {
    setTransactionType(type);
    setIsTransactionModalOpen(true);
  };

  const openTransferConfirmationModal = (mode: 'CAPTAIN_SETTLE' | 'PLAYER_SUBMIT', userId?: string) => {
    setTransferMode(mode);
    setTransferDefaultUserId(userId);
    setIsTransferModalOpen(true);
  };

  const handleReview = async (confirmationId: string, decision: 'APPROVE' | 'REJECT') => {
    setReviewingConfirmationId(confirmationId);
    try {
      await onReviewTransferConfirmation(confirmationId, decision);
    } catch (error) {
      console.error('Failed to review transfer confirmation', error);
      alert(`Не удалось обработать подтверждение перевода: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setReviewingConfirmationId(null);
    }
  };

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

  const pendingConfirmations = financeConfirmations.filter((item) => item.status === 'PENDING_REVIEW');
  const playerEventDebts = (playerFinanceDetail?.eventDebts || []).filter((item) => item.outstanding > 0);
  const openFinanceEvents = (financeEvents || []).filter((item) => item.outstandingTotal > 0);
  const isAllTeamsView = selectedTeamId === ALL_TEAMS_FINANCE_FILTER;
  const captainTransferMembers = members.filter((member) => member.role !== Role.CAPTAIN || Number(member.balance || 0) < 0);

  return (
    <div className="pb-24 pt-4 px-4 space-y-6 animate-fade-in">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white">Казна</h1>
            <p className="mt-1 text-sm text-pb-subtext">
              {isCaptain
                ? 'Сборы, должники и подтверждения перевода под контролем.'
                : 'Ваши долги и отправленные подтверждения перевода в одном месте.'}
            </p>
          </div>
          {isSwitchingTeam ? (
            <div className="rounded-full border border-white/10 bg-pb-surface px-3 py-2 text-xs font-semibold text-pb-subtext">
              Переключаем...
            </div>
          ) : null}
        </div>

        <TeamContextSwitcher
          teams={availableTeams}
          selectedTeamId={selectedTeamId}
          currentUserRole={allowAllTeamsFilter ? Role.PLAYER : currentUserRole}
          disabled={isSwitchingTeam}
          onChange={onSwitchTeam}
        />

        <div className="grid grid-cols-3 gap-3">
          {viewModel.heroCards.map((card) => (
            <div key={card.label} className="rounded-3xl border border-white/10 bg-gradient-to-br from-pb-surface to-[#171c2b] p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-pb-subtext">{card.label}</div>
              <div className="mt-3 text-xl font-black text-white">{card.value}</div>
            </div>
          ))}
        </div>

        {isCaptain ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => openTransactionModal(TransactionType.FEE)}
              className="rounded-2xl bg-pb-primary px-4 py-3 text-sm font-bold text-pb-background"
            >
              Начислить игроку
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal(TransactionType.EXPENSE)}
              className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-3 text-sm font-bold text-white"
            >
              Новая трата
            </button>
            <button
              type="button"
              onClick={() => openTransferConfirmationModal('CAPTAIN_SETTLE')}
              className="rounded-2xl border border-pb-primary/40 bg-pb-primary/10 px-4 py-3 text-sm font-bold text-pb-primary"
            >
              Зачесть перевод
            </button>
            <button
              type="button"
              onClick={handleRemindAllClick}
              disabled={isRemindingAll}
              className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {isRemindingAll ? 'Отправляем...' : 'Напомнить всем'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openTransferConfirmationModal('PLAYER_SUBMIT')}
              disabled={isAllTeamsView}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-pb-primary px-4 py-3 text-sm font-bold text-pb-background disabled:opacity-60"
            >
              <Wallet size={16} />
              Отправить подтверждение перевода
            </button>
            {isAllTeamsView ? (
              <div className="text-xs text-pb-subtext">
                Чтобы отправить подтверждение перевода, сначала выберите конкретную команду в фильтре.
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <AlertCircle size={16} className="text-pb-warning" />
          Требует внимания
        </div>
        <div className="space-y-2">
          {viewModel.attentionItems.map((item) => (
            <div key={item} className="rounded-2xl border border-white/5 bg-black/20 px-4 py-3 text-sm text-pb-subtext">
              {item}
            </div>
          ))}
        </div>
      </section>

      {isCaptain ? (
        <>
          <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <Clock3 size={16} className="text-pb-primary" />
              Очередь подтверждений перевода
            </div>
            <div className="space-y-3">
              {pendingConfirmations.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={42} className="text-pb-primary/70" />}
                  text="Новых подтверждений на проверке нет."
                />
              ) : (
                pendingConfirmations.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">{item.userName}</div>
                        <div className="mt-1 text-xs text-pb-subtext">
                          {format(new Date(item.submittedAt), 'd MMM, HH:mm', { locale: ru })} · {item.amount.toLocaleString('ru-RU')} ₽
                        </div>
                        {item.note ? <div className="mt-2 text-xs text-pb-subtext">{item.note}</div> : null}
                      </div>
                      <StatusChip status={item.status} />
                    </div>
                    <img
                      src={item.screenshotDataUrl}
                      alt="Скриншот перевода"
                      className="mt-3 h-40 w-full rounded-2xl object-cover"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleReview(item.id, 'APPROVE')}
                        disabled={reviewingConfirmationId === item.id}
                        className="flex-1 rounded-xl bg-pb-primary px-4 py-3 text-sm font-bold text-pb-background disabled:opacity-60"
                      >
                        Подтвердить
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReview(item.id, 'REJECT')}
                        disabled={reviewingConfirmationId === item.id}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <RefreshCw size={16} className="text-pb-primary" />
              Открытые сборы по событиям
            </div>
            <div className="space-y-3">
              {openFinanceEvents.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={42} className="text-pb-primary/70" />}
                  text="По событиям нет открытых сборов."
                />
              ) : (
                openFinanceEvents.slice(0, 5).map((item) => (
                  <div key={item.eventId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-pb-subtext">
                          {format(new Date(item.startDate), 'd MMM', { locale: ru })} · Собрано {item.paidTotal.toLocaleString('ru-RU')} ₽ из {item.chargedTotal.toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                      <div className="rounded-full bg-pb-warning/15 px-3 py-1 text-xs font-bold text-pb-warning">
                        Осталось {item.outstandingTotal.toLocaleString('ru-RU')} ₽
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <TrendingDown size={16} className="text-pb-danger" />
              Основные должники
            </div>
            <div className="space-y-3">
              {debtors.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={42} className="text-pb-primary/70" />}
                  text="Сейчас по команде нет открытых долгов."
                />
              ) : (
                debtors.map((item) => (
                  <div key={item.userId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-white/10">
                        {item.avatar ? <img src={item.avatar} alt={item.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{item.name}</div>
                        <div className="text-xs text-pb-subtext">@{item.nickname || 'без ника'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-pb-danger">{item.debt.toLocaleString('ru-RU')} ₽</div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openTransferConfirmationModal('CAPTAIN_SETTLE', item.userId)}
                          className="rounded-lg border border-pb-primary/40 bg-pb-primary/10 px-2.5 py-1.5 text-[11px] font-bold text-pb-primary"
                        >
                          Зачесть
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemindDebtorClick(item.userId, item.name)}
                          disabled={remindingUserIds.has(item.userId)}
                          className="text-[11px] font-bold text-pb-primary disabled:opacity-60"
                        >
                          {remindingUserIds.has(item.userId) ? 'Отправляем...' : 'Напомнить'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <CreditCard size={16} className="text-pb-primary" />
              Мои долги по событиям
            </div>
            <div className="space-y-3">
              {playerEventDebts.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={42} className="text-pb-primary/70" />}
                  text="Открытых долгов по событиям нет."
                />
              ) : (
                playerEventDebts.map((item) => (
                  <div key={item.eventId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {item.teamName ? (
                          <div className="mb-2 inline-flex rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-pb-subtext">
                            {item.teamName}
                          </div>
                        ) : null}
                        <div className="text-sm font-bold text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-pb-subtext">
                          {format(new Date(item.date), 'd MMM', { locale: ru })} · Осталось {item.outstanding.toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                      <div className="rounded-full bg-pb-warning/15 px-3 py-1 text-[11px] font-bold text-pb-warning">
                        {item.chargeStatus === 'PARTIAL' ? 'Частично оплачен' : 'Открыт'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
              <ImagePlus size={16} className="text-pb-primary" />
              Мои подтверждения перевода
            </div>
            <div className="space-y-3">
              {financeConfirmations.length === 0 ? (
                <EmptyState
                  icon={<Clock3 size={42} className="text-pb-subtext/70" />}
                  text="Вы еще не отправляли подтверждения перевода."
                />
              ) : (
                financeConfirmations.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {item.teamName ? (
                          <div className="mb-2 inline-flex rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-pb-subtext">
                            {item.teamName}
                          </div>
                        ) : null}
                        <div className="text-sm font-bold text-white">{item.amount.toLocaleString('ru-RU')} ₽</div>
                        <div className="mt-1 text-xs text-pb-subtext">
                          {format(new Date(item.submittedAt), 'd MMM, HH:mm', { locale: ru })}
                        </div>
                        {item.status === 'PENDING_REVIEW' ? (
                          <div className="mt-2 text-xs text-pb-warning">
                            Долг не изменится, пока капитан не подтвердит перевод.
                          </div>
                        ) : null}
                      </div>
                      <StatusChip status={item.status} />
                    </div>
                    <img
                      src={item.screenshotDataUrl}
                      alt="Скриншот перевода"
                      className="mt-3 h-40 w-full rounded-2xl object-cover"
                    />
                    {item.reviewNote ? <div className="mt-3 text-xs text-pb-subtext">{item.reviewNote}</div> : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <section className="rounded-3xl border border-white/10 bg-pb-surface p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
          <Wallet size={16} className="text-pb-primary" />
          История операций
        </div>
        <div className="space-y-3">
          {transactions.length === 0 || isAllTeamsView ? (
            <EmptyState icon={<Clock3 size={42} className="text-pb-subtext/70" />} text="Операции пока отсутствуют." />
          ) : (
            transactions.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4">
                <div>
                  <div className="text-sm font-bold text-white">{item.title}</div>
                  <div className="mt-1 text-xs text-pb-subtext">
                    {format(item.date, 'd MMM, HH:mm', { locale: ru })} · {item.userName || 'Команда'}
                  </div>
                </div>
                <div className={`text-sm font-black ${item.type === TransactionType.EXPENSE ? 'text-pb-danger' : 'text-pb-primary'}`}>
                  {item.type === TransactionType.EXPENSE ? '-' : '+'}
                  {item.amount.toLocaleString('ru-RU')} ₽
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <FinanceTransactionModal
        isOpen={isTransactionModalOpen}
        type={transactionType}
        members={members}
        eventOptions={(financeEvents || []).map((item) => ({
          eventId: item.eventId,
          title: item.title,
          startDate: item.startDate,
        }))}
        onClose={() => setIsTransactionModalOpen(false)}
        onSubmit={onAddTransaction}
      />

      <TransferConfirmationModal
        isOpen={isTransferModalOpen}
        mode={transferMode}
        members={transferMode === 'CAPTAIN_SETTLE' ? captainTransferMembers : members}
        defaultUserId={transferDefaultUserId}
        loadMemberFinance={
          transferMode === 'CAPTAIN_SETTLE' && !isAllTeamsView
            ? (userId) => financeApi.getFinanceMember(selectedTeamId, userId)
            : undefined
        }
        onClose={() => setIsTransferModalOpen(false)}
        onSubmit={async (payload) => {
          try {
            await onCreateTransferConfirmation(payload);
            setIsTransferModalOpen(false);
          } catch (error) {
            console.error('Failed to create transfer confirmation', error);
            alert(`Не удалось сохранить подтверждение перевода: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }}
      />
    </div>
  );
};

function StatusChip(props: { status: TransferConfirmation['status'] }) {
  const config =
    props.status === 'APPROVED'
      ? { label: 'Подтверждено', className: 'bg-pb-primary/15 text-pb-primary', icon: <CheckCircle2 size={14} /> }
      : props.status === 'REJECTED'
        ? { label: 'Отклонено', className: 'bg-pb-danger/15 text-pb-danger', icon: <XCircle size={14} /> }
        : { label: 'На проверке', className: 'bg-pb-warning/15 text-pb-warning', icon: <Clock3 size={14} /> };

  return (
    <div className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold ${config.className}`}>
      {config.icon}
      {config.label}
    </div>
  );
}

function EmptyState(props: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-black/20 px-6 py-10 text-center">
      {props.icon}
      <div className="mt-3 text-sm text-pb-subtext">{props.text}</div>
    </div>
  );
}
