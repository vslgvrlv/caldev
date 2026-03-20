import React, { useEffect } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronDown, Receipt, Wallet } from 'lucide-react';
import { getMobileBottomSheetLayout } from '../lib/mobile-bottom-sheet-layout';

type EventExpenseItem = {
  transactionId: string;
  date: string;
  title: string;
  amount: number;
};

interface EventExpensesSheetProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  statusLabel: string;
  totalSpentLabel: string;
  expenseCountLabel: string;
  deltaHint?: string | null;
  expenses: EventExpenseItem[];
  canManage: boolean;
  canOpenCollection: boolean;
  collectionActionLabel: string;
  onClose: () => void;
  onAddExpense: () => void;
  onOpenCollection: () => void;
  onEditExpense?: (transactionId: string) => void;
}

export const EventExpensesSheet: React.FC<EventExpensesSheetProps> = ({
  isOpen,
  title,
  subtitle,
  statusLabel,
  totalSpentLabel,
  expenseCountLabel,
  deltaHint,
  expenses,
  canManage,
  canOpenCollection,
  collectionActionLabel,
  onClose,
  onAddExpense,
  onOpenCollection,
  onEditExpense,
}) => {
  const layout = getMobileBottomSheetLayout(107);

  useEffect(() => {
    if (!isOpen || !layout.lockBodyScroll || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, layout.lockBodyScroll]);

  if (!isOpen) return null;

  return (
    <div className={layout.viewportClassName}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className={layout.panelClassName}>
        <div className="sticky top-0 z-10 border-b border-white/10 bg-pb-background/95 px-5 pb-4 pt-3 backdrop-blur-md">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/10" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-black text-white">{title}</div>
              {subtitle ? <div className="mt-1 text-sm text-pb-subtext">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-pb-subtext"
              aria-label="Закрыть расходы события"
            >
              <ChevronDown size={18} />
            </button>
          </div>
          <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-pb-subtext">
            {statusLabel}
          </div>
        </div>

        <div className={layout.bodyClassName}>
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-pb-surface p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pb-subtext">Потрачено</div>
              <div className="mt-2 text-lg font-black text-white">{totalSpentLabel}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-pb-surface p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pb-subtext">Расходов</div>
              <div className="mt-2 text-lg font-black text-white">{expenseCountLabel}</div>
            </div>
          </section>

          {deltaHint ? (
            <div className="rounded-2xl border border-pb-warning/30 bg-pb-warning/10 px-4 py-3 text-sm text-pb-subtext">
              {deltaHint}
            </div>
          ) : null}

          {canManage ? (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onAddExpense}
                className="rounded-2xl bg-pb-danger px-4 py-3 text-sm font-bold text-white"
              >
                Добавить расход
              </button>
              <button
                type="button"
                onClick={onOpenCollection}
                disabled={!canOpenCollection}
                className="rounded-2xl border border-pb-primary/40 bg-pb-primary/10 px-4 py-3 text-sm font-bold text-pb-primary disabled:opacity-50"
              >
                {collectionActionLabel}
              </button>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Receipt size={16} className="text-pb-danger" />
              Расходы события
            </div>

            {expenses.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-pb-surface px-4 py-5 text-sm text-pb-subtext">
                По событию пока нет сохраненных расходов.
              </div>
            ) : (
              expenses.map((item) => (
                <div key={item.transactionId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-pb-surface p-4">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">{item.title}</div>
                    <div className="mt-1 text-xs text-pb-subtext">
                      {format(new Date(item.date), 'd MMM, HH:mm', { locale: ru })}
                    </div>
                  </div>
                  <div className="ml-4 flex items-center gap-3">
                    {canManage && onEditExpense ? (
                      <button
                        type="button"
                        onClick={() => onEditExpense(item.transactionId)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white"
                      >
                        Изменить
                      </button>
                    ) : null}
                    <div className="text-sm font-black text-pb-danger">-{formatRub(item.amount)}</div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-pb-surface p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Wallet size={16} className="text-pb-primary" />
              Что дальше
            </div>
            <div className="mt-2 text-sm text-pb-subtext">
              Сначала заносим все фактические траты события. Потом жмите «{collectionActionLabel}»: внутри этого экрана
              доступно распределение, доначисление и работа с долгами.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

function formatRub(value: number): string {
  return `${Number(value || 0).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₽`;
}
