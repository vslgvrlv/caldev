import React, { useEffect, useState } from 'react';
import { TeamMember, Transaction, TransactionType } from '../types';

type EventOption = {
  eventId: string;
  title: string;
  startDate?: string;
};

interface FinanceTransactionModalProps {
  isOpen: boolean;
  type: TransactionType.EXPENSE | TransactionType.FEE;
  members: TeamMember[];
  eventOptions?: EventOption[];
  initialEventId?: string;
  initialTransaction?: Partial<Transaction> & { id?: string };
  lockEventId?: boolean;
  onClose: () => void;
  onSubmit: (payload: Omit<Transaction, 'id' | 'date'>) => Promise<void> | void;
}

export const FinanceTransactionModal: React.FC<FinanceTransactionModalProps> = ({
  isOpen,
  type,
  members,
  eventOptions = [],
  initialEventId,
  initialTransaction,
  lockEventId = false,
  onClose,
  onSubmit,
}) => {
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [userId, setUserId] = useState(members[0]?.id || '');
  const [eventId, setEventId] = useState(initialTransaction?.eventId || initialEventId || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = Boolean(initialTransaction?.id);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(initialTransaction?.amount !== undefined ? String(initialTransaction.amount) : '');
    setTitle(initialTransaction?.title || '');
    setUserId(initialTransaction?.userId || members[0]?.id || '');
    setEventId(initialTransaction?.eventId || initialEventId || '');
  }, [initialEventId, initialTransaction, isOpen, members, type]);

  if (!isOpen) return null;

  const selectedEvent = eventOptions.find((item) => item.eventId === eventId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        type,
        amount: Number(amount),
        title: title.trim(),
        userId: type === TransactionType.FEE ? userId : undefined,
        userName: type === TransactionType.FEE ? members.find((member) => member.id === userId)?.name : undefined,
        eventId: type === TransactionType.EXPENSE && eventId ? eventId : undefined,
        status: 'COMPLETED',
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-pb-surface p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">
          {type === TransactionType.EXPENSE ? (isEditing ? 'Редактировать трату' : 'Новая трата') : 'Начисление игроку'}
        </h3>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {type === TransactionType.FEE ? (
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Игрок</span>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {type === TransactionType.EXPENSE ? (
            lockEventId && selectedEvent ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Событие</div>
                <div className="mt-2 text-sm font-bold text-white">{selectedEvent.title}</div>
              </div>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Привязка к событию</span>
                <select
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
                >
                  <option value="">Без привязки к событию</option>
                  {eventOptions.map((item) => (
                    <option key={item.eventId} value={item.eventId}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Название</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              placeholder={type === TransactionType.EXPENSE ? 'Шары, аренда, дорога...' : 'Взнос, форма, сбор...'}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Сумма</span>
            <input
              type="number"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              placeholder="0"
            />
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl bg-white/5 px-4 py-3 text-sm font-bold text-pb-subtext"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 rounded-2xl px-4 py-3 text-sm font-bold ${
                type === TransactionType.EXPENSE ? 'bg-pb-danger text-white' : 'bg-pb-primary text-pb-background'
              } disabled:opacity-60`}
            >
              {isSubmitting ? 'Сохраняем...' : type === TransactionType.EXPENSE ? (isEditing ? 'Сохранить' : 'Списать') : 'Начислить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
