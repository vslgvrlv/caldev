import React from 'react';
import { slotsApi, type PublicSlotGuest, type SlotGuest, type SlotManageView } from '../../api/track4';
import { confirmAction, errorText, notify } from '../../lib/notify';

// Свежий вид слотов события для капитана и тренера: его читают блок «Свободные слоты»
// (места, цена, запись) и блок состава (гости сразу после основного состава).

const views = new Map<string, SlotManageView>();
const subscribers = new Set<() => void>();

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

export function publishSlotsView(eventId: string, view: SlotManageView | null): void {
  if (view) views.set(eventId, view);
  else views.delete(eventId);
  subscribers.forEach((fn) => fn());
}

export function useSlotsView(eventId: string): SlotManageView | null {
  return React.useSyncExternalStore(subscribe, () => views.get(eventId) ?? null);
}

/** Гости события: пусто, пока вид слотов не загружен или у человека нет прав на него. */
export function useSlotGuests(eventId: string): SlotGuest[] {
  return useSlotsView(eventId)?.guests ?? [];
}

/**
 * Гости события для экрана: капитан и тренер берут их из вида слотов (с оплатой),
 * остальные участники команды и сам гость — из ответа события (только имя и аватар).
 */
export function useEventGuests(eventId: string, canManage: boolean): Array<PublicSlotGuest & { paid?: boolean }> {
  const managed = useSlotGuests(eventId);
  const [shared, setShared] = React.useState<PublicSlotGuest[]>([]);
  React.useEffect(() => {
    if (canManage) return;
    let live = true;
    setShared([]);
    slotsApi
      .event(eventId)
      .then((view) => {
        if (live) setShared(view.guests ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [eventId, canManage]);
  return canManage ? managed : shared;
}

/** «Снять» и «оплатил» для гостя в блоке состава. */
export function useGuestActions(eventId: string) {
  const [busy, setBusy] = React.useState(false);

  const run = async (action: () => Promise<SlotManageView>, success?: string) => {
    setBusy(true);
    try {
      publishSlotsView(eventId, await action());
      if (success) notify.success(success);
    } catch (error) {
      notify.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (guest: Pick<SlotGuest, 'userId' | 'name'>) => {
    const ok = await confirmAction(`Снять ${guest.name} со слота? Место снова станет свободным.`, {
      confirmLabel: 'Снять',
      danger: true,
    });
    if (ok) await run(() => slotsApi.removeGuest(eventId, guest.userId), `${guest.name} снят`);
  };

  const setPaid = (guest: Pick<SlotGuest, 'userId'>, paid: boolean) => run(() => slotsApi.setPaid(eventId, guest.userId, paid));

  return { busy, remove, setPaid };
}
