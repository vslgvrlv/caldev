import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FinanceMemberDetailResponse } from '../api';
import { buildTransferAllocationPreview } from '../lib/finance-transfer-preview';
import { TeamMember } from '../types';

type TransferConfirmationModalMode = 'CAPTAIN_SETTLE' | 'PLAYER_SUBMIT';

interface TransferConfirmationModalProps {
  isOpen: boolean;
  mode: TransferConfirmationModalMode;
  members: TeamMember[];
  defaultUserId?: string;
  preferredEventId?: string;
  loadMemberFinance?: (userId: string) => Promise<FinanceMemberDetailResponse>;
  onClose: () => void;
  onSubmit: (payload: {
    userId?: string;
    amount: number;
    screenshotDataUrl: string;
    note?: string;
    autoApprove?: boolean;
    preferredEventId?: string;
  }) => Promise<void> | void;
}

export const TransferConfirmationModal: React.FC<TransferConfirmationModalProps> = ({
  isOpen,
  mode,
  members,
  defaultUserId,
  preferredEventId,
  loadMemberFinance,
  onClose,
  onSubmit,
}) => {
  const isCaptainSettle = mode === 'CAPTAIN_SETTLE';
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(defaultUserId || members[0]?.id || '');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const [screenshotName, setScreenshotName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMemberFinance, setIsLoadingMemberFinance] = useState(false);
  const [memberFinanceDetail, setMemberFinanceDetail] = useState<FinanceMemberDetailResponse | null>(null);
  const [memberFinanceError, setMemberFinanceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAmount('');
    setNote('');
    setScreenshotDataUrl('');
    setScreenshotName('');
    setSelectedUserId(defaultUserId || members[0]?.id || '');
    setMemberFinanceDetail(null);
    setMemberFinanceError(null);
  }, [defaultUserId, isOpen, members]);

  useEffect(() => {
    if (!isOpen || !isCaptainSettle || !selectedUserId || !loadMemberFinance) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingMemberFinance(true);
      setMemberFinanceError(null);
      try {
        const detail = await loadMemberFinance(selectedUserId);
        if (!cancelled) setMemberFinanceDetail(detail);
      } catch (error) {
        if (!cancelled) {
          setMemberFinanceDetail(null);
          setMemberFinanceError(error instanceof Error ? error.message : 'Не удалось загрузить долги игрока');
        }
      } finally {
        if (!cancelled) setIsLoadingMemberFinance(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isCaptainSettle, isOpen, loadMemberFinance, selectedUserId]);

  const openDebts = useMemo(
    () =>
      (memberFinanceDetail?.eventDebts || [])
        .filter((item) => Number(item.outstanding || 0) > 0)
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [memberFinanceDetail]
  );

  const totalOutstanding = useMemo(
    () => Number(memberFinanceDetail?.summary?.outstanding || openDebts.reduce((sum, item) => sum + Number(item.outstanding || 0), 0)),
    [memberFinanceDetail, openDebts]
  );

  const allocationPreview = useMemo(
    () =>
      isCaptainSettle
        ? buildTransferAllocationPreview({
            amount: Number(amount || 0),
            preferredEventId,
            debts: openDebts.map((item) => ({
              eventId: item.eventId,
              title: item.title,
              date: item.date,
              outstanding: Number(item.outstanding || 0),
            })),
          })
        : null,
    [amount, isCaptainSettle, openDebts, preferredEventId]
  );
  const numericAmount = Number(amount || 0);
  const canSubmit =
    numericAmount > 0 &&
    !!screenshotDataUrl &&
    (!isCaptainSettle || (!!selectedUserId && !isLoadingMemberFinance));

  if (!isOpen) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setScreenshotDataUrl(dataUrl);
    setScreenshotName(file.name);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      alert('Введите сумму перевода.');
      return;
    }
    if (isCaptainSettle && !selectedUserId) {
      alert('Выберите игрока.');
      return;
    }
    if (!screenshotDataUrl) {
      alert('Приложите скриншот перевода.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        userId: isCaptainSettle ? selectedUserId : undefined,
        amount: numericAmount,
        screenshotDataUrl,
        note: note.trim() || undefined,
        autoApprove: isCaptainSettle,
        preferredEventId,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-pb-surface p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">{isCaptainSettle ? 'Зачесть перевод' : 'Подтверждение перевода'}</h3>
        <p className="mt-2 text-sm text-pb-subtext">
          {isCaptainSettle
            ? 'Перевод будет зачтен игроку с авторазносом по его открытым долгам.'
            : 'Долг уменьшится только после подтверждения капитаном.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {isCaptainSettle ? (
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Игрок</span>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={members.length === 0}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              >
                {members.length === 0 ? (
                  <option value="">Нет игроков с долгами</option>
                ) : (
                  members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Сумма</span>
            <input
              type="number"
              min="1"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              placeholder="0"
            />
          </label>

          {isCaptainSettle ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Долги игрока</div>
              {isLoadingMemberFinance ? <div className="mt-3 text-sm text-pb-subtext">Загружаем долги...</div> : null}
              {!isLoadingMemberFinance && memberFinanceError ? <div className="mt-3 text-sm text-pb-danger">{memberFinanceError}</div> : null}
              {!isLoadingMemberFinance && !memberFinanceError ? (
                <>
                  <div className="mt-3 text-sm text-white">
                    Общий долг: <span className="font-black">{totalOutstanding.toLocaleString('ru-RU')} ₽</span>
                  </div>
                  {openDebts.length === 0 ? (
                    <div className="mt-2 text-xs text-pb-subtext">
                      У игрока нет открытых долгов. После подтверждения сумма останется на его балансе.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {openDebts.map((item) => (
                        <div key={item.eventId} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                            <div className="text-[11px] text-pb-subtext">{new Date(item.date).toLocaleDateString('ru-RU')}</div>
                          </div>
                          <div className="text-sm font-black text-pb-danger">{Number(item.outstanding || 0).toLocaleString('ru-RU')} ₽</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          {isCaptainSettle && allocationPreview ? (
            <div className="rounded-2xl border border-pb-primary/20 bg-pb-primary/5 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Авторазнос</div>
              <div className="mt-3 text-sm text-white">
                Будет зачтено: <span className="font-black">{allocationPreview.allocatedTotal.toLocaleString('ru-RU')} ₽</span>
              </div>
              {allocationPreview.leftoverAmount > 0 ? (
                <div className="mt-1 text-xs text-pb-warning">
                  Остаток после зачета: {allocationPreview.leftoverAmount.toLocaleString('ru-RU')} ₽
                </div>
              ) : null}
              {allocationPreview.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {allocationPreview.items.map((item) => (
                    <div key={item.eventId} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                        <div className="text-[11px] text-pb-subtext">
                          Было {item.outstanding.toLocaleString('ru-RU')} ₽
                          {item.remainingAfterAllocation > 0
                            ? ` · останется ${item.remainingAfterAllocation.toLocaleString('ru-RU')} ₽`
                            : ' · будет закрыт'}
                        </div>
                      </div>
                      <div className="text-sm font-black text-pb-primary">{item.allocated.toLocaleString('ru-RU')} ₽</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-pb-subtext">Разнос появится после ввода суммы.</div>
              )}
            </div>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-pb-subtext">Комментарий</span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-pb-primary"
              placeholder={isCaptainSettle ? 'Например: перевод за несколько долгов сразу' : 'Например: перевод за мартовский взнос'}
            />
          </label>

          <div className="rounded-2xl border border-dashed border-white/15 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Скриншот перевода</div>
                <div className="mt-1 text-xs text-pb-subtext">Только PNG, JPEG или WEBP.</div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border border-pb-primary/40 bg-pb-primary/10 px-3 py-2 text-xs font-bold text-pb-primary"
              >
                Выбрать
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => void handleFileChange(event)}
            />
            {screenshotName ? <div className="mt-3 text-xs text-pb-subtext">{screenshotName}</div> : null}
            {screenshotDataUrl ? (
              <img src={screenshotDataUrl} alt="Превью скриншота" className="mt-3 h-40 w-full rounded-2xl object-cover" />
            ) : null}
          </div>

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
              disabled={isSubmitting || !canSubmit}
              className="flex-1 rounded-2xl bg-pb-primary px-4 py-3 text-sm font-bold text-pb-background disabled:opacity-60"
            >
              {isSubmitting ? 'Сохраняем...' : isCaptainSettle ? 'Зачесть' : 'Отправить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
