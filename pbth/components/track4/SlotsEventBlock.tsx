import React from 'react';
import { Minus, Plus, Ticket } from 'lucide-react';
import { slotsApi, type SlotManageView } from '../../api/track4';
import { confirmAction, errorText, notify } from '../../lib/notify';
import type { EventBlockProps } from '../../shell/extensions';
import { Role } from '../../types';
import { followersLabel, openedLabel, parsePriceInput, slotPriceLabel } from './slot-format';

// Блок «Свободные слоты» на экране события у капитана и тренера (трек 4).
// Открыть N мест с ценой — подписчикам команды сразу уходит уведомление;
// список гостей с галочкой «оплатил» и кнопкой «Снять».

const card = 'bg-pb-surface rounded-2xl p-4 border border-white/5';
const primaryBtn =
  'w-full py-2.5 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60';
const secondaryBtn =
  'px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-60';

function isPast(event: EventBlockProps['event']): boolean {
  const start = event.startDate instanceof Date ? event.startDate : new Date(event.startAt || '');
  return Number.isFinite(start.getTime()) && start.getTime() <= Date.now();
}

export const SlotsEventBlock: React.FC<EventBlockProps> = ({ event, viewerRole }) => {
  const [view, setView] = React.useState<SlotManageView | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [capacity, setCapacity] = React.useState(2);
  const [priceText, setPriceText] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const next = await slotsApi.manage(event.id);
      setView(next);
      setLoadError(false);
      if (next.slot) {
        setCapacity(next.slot.capacity);
        setPriceText(next.slot.price > 0 ? String(next.slot.price) : '');
      }
    } catch {
      setLoadError(true);
    }
  }, [event.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<SlotManageView | void>, success?: string) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) setView(next);
      if (success) notify.success(success);
      return true;
    } catch (error) {
      notify.error(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const past = isPast(event);
  const slot = view?.slot ?? null;
  const guests = view?.guests ?? [];

  // Прошедшее событие без слотов — блоку нечего показать.
  if (past && !slot) return null;
  if (!view) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 text-white font-bold">
          <Ticket size={18} className="text-pb-primary" /> Свободные слоты
        </div>
        <div className="text-sm text-pb-subtext mt-2">{loadError ? 'Не удалось загрузить слоты.' : 'Загрузка…'}</div>
      </div>
    );
  }

  const enableSchedule = () =>
    run(async () => {
      await slotsApi.setOpenSchedule(event.teamId, true);
      return slotsApi.manage(event.id);
    }, 'Открытое расписание включено');

  const submitOpen = async () => {
    const price = parsePriceInput(priceText);
    if (price === null) {
      notify.error('Цена — число в рублях, например 3000');
      return;
    }
    const reopening = !slot || !slot.open;
    const ok = await run(
      () => slotsApi.open(event.id, capacity, price),
      reopening ? 'Слоты открыты, подписчикам ушло уведомление' : 'Слоты обновлены',
    );
    if (ok) setEditing(false);
  };

  const closeSlots = async () => {
    const ok = await confirmAction('Закрыть запись? Записанные гости останутся, новые записаться не смогут.', {
      confirmLabel: 'Закрыть',
    });
    if (ok) await run(() => slotsApi.close(event.id), 'Запись закрыта');
  };

  const removeGuest = async (userId: string, name: string) => {
    const ok = await confirmAction(`Снять ${name} со слота? Место снова станет свободным.`, {
      confirmLabel: 'Снять',
      danger: true,
    });
    if (ok) await run(() => slotsApi.removeGuest(event.id, userId), `${name} снят`);
  };

  const showForm = !past && view.openSchedule && (!slot || !slot.open || editing);
  const isCaptain = viewerRole === Role.CAPTAIN;

  return (
    <div className={`${card} space-y-3`} data-testid="slots-block">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white font-bold">
          <Ticket size={18} className="text-pb-primary" /> Свободные слоты
        </div>
        {slot?.open && (
          <span className="text-xs text-pb-subtext">
            занято {slot.booked} из {slot.capacity}
          </span>
        )}
      </div>

      {!view.openSchedule && !past && (
        <div className="space-y-2">
          <p className="text-sm text-pb-subtext">
            Открой расписание команды — и подписчики смогут записываться на свободные места в событиях.
          </p>
          {isCaptain ? (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void enableSchedule()}>
              Включить открытое расписание
            </button>
          ) : (
            <p className="text-sm text-pb-subtext">Включает капитан в меню команды: «Открытое расписание».</p>
          )}
        </div>
      )}

      {slot?.open && !editing && (
        <div className="text-sm text-white">
          {openedLabel(slot.capacity, slot.price, slot.free)}
        </div>
      )}
      {slot && !slot.open && <div className="text-sm text-pb-subtext">Запись закрыта.</div>}

      {showForm && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-pb-subtext">Сколько мест</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Меньше мест"
                className={secondaryBtn}
                disabled={busy || capacity <= Math.max(1, slot?.booked ?? 0)}
                onClick={() => setCapacity((n) => Math.max(1, n - 1))}
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center text-white font-bold text-lg" aria-live="polite">
                {capacity}
              </span>
              <button
                type="button"
                aria-label="Больше мест"
                className={secondaryBtn}
                disabled={busy || capacity >= 50}
                onClick={() => setCapacity((n) => Math.min(50, n + 1))}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-pb-subtext">Цена за место, ₽</span>
            <input
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="0 — бесплатно"
              className="w-36 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-right text-white placeholder:text-pb-subtext/60 focus:outline-none focus:border-pb-primary"
            />
          </label>
          {(!slot || !slot.open) && (
            <p className="text-xs text-pb-subtext">Уведомление получат: {followersLabel(view.followers)}.</p>
          )}
          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void submitOpen()}>
              {slot?.open ? 'Сохранить' : 'Открыть слоты'}
            </button>
            {editing && (
              <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setEditing(false)}>
                Отмена
              </button>
            )}
          </div>
        </div>
      )}

      {slot?.open && !editing && !past && (
        <div className="flex gap-2">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void closeSlots()}>
            Закрыть запись
          </button>
        </div>
      )}

      {guests.length > 0 && (
        <div className="border-t border-white/5 pt-3 space-y-2">
          <div className="text-xs text-pb-subtext uppercase tracking-wide">Гости</div>
          {guests.map((guest) => (
            <div
              key={guest.userId}
              className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 px-2.5 py-2"
            >
              <img
                src={
                  guest.avatar ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(guest.name)}&background=0F0F0F&color=fff`
                }
                alt=""
                loading="lazy"
                className="w-7 h-7 rounded-full object-cover shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{guest.name}</div>
                <div className="text-[11px] text-pb-subtext">{slotPriceLabel(guest.price)}</div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-pb-subtext shrink-0">
                <input
                  type="checkbox"
                  checked={guest.paid}
                  disabled={busy}
                  onChange={(e) => void run(() => slotsApi.setPaid(event.id, guest.userId, e.target.checked))}
                  className="w-4 h-4 accent-emerald-500"
                />
                оплатил
              </label>
              <button
                type="button"
                className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 text-pb-subtext border border-white/10 hover:text-white"
                disabled={busy}
                onClick={() => void removeGuest(guest.userId, guest.name)}
              >
                Снять
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
