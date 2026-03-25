import React, { useEffect } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CheckCircle2, ChevronDown, Clock3, Receipt, TrendingDown, Wallet } from 'lucide-react';
import { TransactionType } from '../types';
import { getMobileBottomSheetLayout } from '../lib/mobile-bottom-sheet-layout';

type SummaryCard = {
  label: string;
  value: string;
};

type CollectionParticipant = {
  userId: string;
  name: string;
  nickname?: string;
  amountDue: number;
  amountPaid: number;
  amountOutstanding: number;
};

type CollectionExpense = {
  transactionId: string;
  date: string;
  title: string;
  amount: number;
};

type CollectionOperation = {
  transactionId: string;
  date: string;
  title: string;
  amount: number;
  type: TransactionType;
};

interface EventCollectionSheetProps {
  isOpen: boolean;
  title: string;
  subtitle: string;
  statusLabel: string;
  summaryCards: SummaryCard[];
  participants: CollectionParticipant[];
  expenses: CollectionExpense[];
  recentOperations: CollectionOperation[];
  canManage: boolean;
  onClose: () => void;
  onSettleTransfer: (userId?: string) => void;
  onAddExpense: () => void;
  onChargeParticipants: () => void;
  chargeActionLabel: string;
  onRemindDebtors: () => void;
  isRemindingDebtors?: boolean;
}

export const EventCollectionSheet: React.FC<EventCollectionSheetProps> = ({
  isOpen,
  title,
  subtitle,
  statusLabel,
  summaryCards,
  participants,
  expenses,
  recentOperations,
  canManage,
  onClose,
  onSettleTransfer,
  onAddExpense,
  onChargeParticipants,
  chargeActionLabel,
  onRemindDebtors,
  isRemindingDebtors = false,
}) => {
  const layout = getMobileBottomSheetLayout(108);

  useEffect(() => {
    if (!isOpen || !layout.lockBodyScroll || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, layout.lockBodyScroll]);

  if (!isOpen) return null;

  const chargedParticipants = participants
    .filter((item) => Number(item.amountDue || 0) > 0)
    .sort((a, b) => b.amountOutstanding - a.amountOutstanding || a.name.localeCompare(b.name, 'ru'));

  return (
    <div className={layout.viewportClassName}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className={layout.panelClassName}>
        <div
          className="sticky top-0 z-10 border-b border-white/10 bg-pb-background/95 px-5 pb-4 backdrop-blur-md"
          style={{ paddingTop: "calc(var(--pb-safe-top) + 0.75rem)" }}
        >
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/10" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-black text-white">{title}</div>
              <div className="mt-1 text-sm text-pb-subtext">{subtitle}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-pb-subtext"
              aria-label="Закрыть сбор"
            >
              <ChevronDown size={18} />
            </button>
          </div>
          <div className="mt-3 inline-flex rounded-full border border-pb-primary/20 bg-pb-primary/10 px-3 py-1 text-xs font-bold text-pb-primary">
            {statusLabel}
          </div>
        </div>

        <div className={layout.bodyClassName}>
          <section className="grid grid-cols-2 gap-3">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-white/10 bg-pb-surface p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pb-subtext">{card.label}</div>
                <div className="mt-2 text-lg font-black text-white">{card.value}</div>
              </div>
            ))}
          </section>

          {canManage ? (
            <section className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onSettleTransfer()}
                className="rounded-2xl bg-pb-primary px-4 py-3 text-sm font-bold text-pb-background"
              >
                Зачесть перевод
              </button>
              <button
                type="button"
                onClick={onRemindDebtors}
                disabled={isRemindingDebtors}
                className="rounded-2xl border border-pb-primary/40 bg-pb-primary/10 px-4 py-3 text-sm font-bold text-pb-primary disabled:opacity-60"
              >
                {isRemindingDebtors ? 'Отправляем...' : 'Напомнить'}
              </button>
              <button
                type="button"
                onClick={onAddExpense}
                className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-3 text-sm font-bold text-white"
              >
                Добавить расход
              </button>
              <button
                type="button"
                onClick={onChargeParticipants}
                className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-3 text-sm font-bold text-white"
              >
                {chargeActionLabel}
              </button>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <TrendingDown size={16} className="text-pb-danger" />
              Игроки в сборе
            </div>

            {chargedParticipants.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-5 text-sm text-pb-subtext">
                Начислений по событию пока нет. Сначала добавьте расходы и создайте сбор.
              </div>
            ) : (
              <div className="space-y-3">
                {chargedParticipants.map((item) => (
                  <div key={item.userId} className="rounded-2xl border border-white/10 bg-pb-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">{item.name}</div>
                        {item.nickname ? <div className="mt-1 text-xs text-pb-subtext">@{item.nickname}</div> : null}
                      </div>
                      {item.amountOutstanding > 0 ? (
                        <button
                          type="button"
                          onClick={() => onSettleTransfer(item.userId)}
                          className="rounded-xl border border-pb-primary/40 bg-pb-primary/10 px-3 py-2 text-xs font-bold text-pb-primary"
                        >
                          Зачесть
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1 rounded-full bg-pb-primary/15 px-3 py-1 text-[11px] font-bold text-pb-primary">
                          <CheckCircle2 size={13} />
                          Закрыто
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <MetricCard label="Начислено" value={item.amountDue} />
                      <MetricCard label="Оплачено" value={item.amountPaid} tone="success" />
                      <MetricCard label="Осталось" value={item.amountOutstanding} tone={item.amountOutstanding > 0 ? 'danger' : 'neutral'} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Receipt size={16} className="text-pb-warning" />
              Расходы события
            </div>

            {expenses.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-5 text-sm text-pb-subtext">
                По событию пока нет сохраненных расходов.
              </div>
            ) : (
              expenses.map((item) => (
                <div key={item.transactionId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-pb-surface p-4">
                  <div>
                    <div className="text-sm font-bold text-white">{item.title}</div>
                    <div className="mt-1 text-xs text-pb-subtext">
                      {format(new Date(item.date), 'd MMM, HH:mm', { locale: ru })}
                    </div>
                  </div>
                  <div className="text-sm font-black text-pb-danger">-{formatRub(item.amount)}</div>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Clock3 size={16} className="text-pb-subtext" />
              Последние операции
            </div>

            {recentOperations.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-5 text-sm text-pb-subtext">
                История операций по событию пока пустая.
              </div>
            ) : (
              recentOperations.slice(0, 8).map((item) => (
                <div key={item.transactionId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-pb-surface p-4">
                  <div>
                    <div className="text-sm font-bold text-white">{item.title}</div>
                    <div className="mt-1 text-xs text-pb-subtext">
                      {format(new Date(item.date), 'd MMM, HH:mm', { locale: ru })} ·{' '}
                      {item.type === TransactionType.EXPENSE ? 'Расход' : 'Поступление'}
                    </div>
                  </div>
                  <div className={`text-sm font-black ${item.type === TransactionType.EXPENSE ? 'text-pb-danger' : 'text-pb-primary'}`}>
                    {item.type === TransactionType.EXPENSE ? '-' : '+'}
                    {formatRub(item.amount)}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

function MetricCard(props: { label: string; value: number; tone?: 'neutral' | 'success' | 'danger' }) {
  const toneClass =
    props.tone === 'success' ? 'text-pb-primary' : props.tone === 'danger' ? 'text-pb-danger' : 'text-white';

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pb-subtext">{props.label}</div>
      <div className={`mt-2 text-sm font-black ${toneClass}`}>{formatRub(props.value)}</div>
    </div>
  );
}

function formatRub(value: number) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}
