import React from 'react';
import { slotsApi, type SlotManageView } from '../../api/track4';
import { confirmAction, errorText, notify } from '../../lib/notify';
import type { EventBlockProps } from '../../shell/extensions';
import { Role } from '../../types';
import { Avatar, Button, Glass, Row, Switch } from '../../ui';
import '../event/event.css';
import { followersLabel, openedLabel, parsePriceInput, slotPriceLabel } from './slot-format';

// Блок «Свободные слоты» на экране события у капитана и тренера (трек 4).
// Открыть N мест с ценой — подписчикам команды сразу уходит уведомление;
// список гостей с галочкой «оплатил» и кнопкой «Снять».

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
      <Glass layer={1} className="pbth-event__panel">
        <div className="pbth-event__head">
          <h2 className="pbth-event__h">Свободные слоты</h2>
        </div>
        <div className="pbth-event__muted">{loadError ? 'Не удалось загрузить слоты.' : 'Загружаем…'}</div>
      </Glass>
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
    <Glass layer={1} className="pbth-event__panel" data-testid="slots-block">
      <div className="pbth-event__head">
        <h2 className="pbth-event__h">Свободные слоты</h2>
        {slot?.open ? (
          <span className="pbth-event__muted">
            занято {slot.booked} из {slot.capacity}
          </span>
        ) : null}
      </div>

      {!view.openSchedule && !past && (
        <>
          <div className="pbth-event__muted">
            Открой расписание команды — и подписчики смогут записываться на свободные места в событиях.
          </div>
          {isCaptain ? (
            <Button variant="glass2" disabled={busy} onClick={() => void enableSchedule()}>
              Включить открытое расписание
            </Button>
          ) : (
            <div className="pbth-event__muted">Включает капитан в меню команды: «Открытое расписание».</div>
          )}
        </>
      )}

      {slot?.open && !editing && <div>{openedLabel(slot.capacity, slot.price, slot.free)}</div>}
      {slot && !slot.open && <div className="pbth-event__muted">Запись закрыта.</div>}

      {showForm && (
        <div className="pbth-event__form">
          <div className="pbth-event__blockhead">
            <span className="pbth-event__muted">Сколько мест</span>
            <span className="pbth-event__inline">
              <Button
                variant="glass2"
                icon="minus"
                aria-label="Меньше мест"
                disabled={busy || capacity <= Math.max(1, slot?.booked ?? 0)}
                onClick={() => setCapacity((n) => Math.max(1, n - 1))}
              />
              <span className="pbth-event__h" aria-live="polite">
                {capacity}
              </span>
              <Button
                variant="glass2"
                icon="plus"
                aria-label="Больше мест"
                disabled={busy || capacity >= 50}
                onClick={() => setCapacity((n) => Math.min(50, n + 1))}
              />
            </span>
          </div>
          <div className="pbth-event__field">
            <label className="ui-label" htmlFor="slot-price">
              Цена за место, ₽
            </label>
            <input
              id="slot-price"
              className="ui-input"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="0 — бесплатно"
            />
          </div>
          {(!slot || !slot.open) && (
            <div className="pbth-event__muted">Уведомление получат: {followersLabel(view.followers)}.</div>
          )}
          <div className="pbth-event__footer">
            {editing && (
              <Button variant="glass2" disabled={busy} onClick={() => setEditing(false)}>
                Отмена
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void submitOpen()}>
              {slot?.open ? 'Сохранить' : 'Открыть слоты'}
            </Button>
          </div>
        </div>
      )}

      {slot?.open && !editing && !past && (
        <div className="pbth-event__footer">
          <Button variant="glass2" disabled={busy} onClick={() => setEditing(true)}>
            Изменить
          </Button>
          <Button variant="glass2" disabled={busy} onClick={() => void closeSlots()}>
            Закрыть запись
          </Button>
        </div>
      )}

      {guests.length > 0 && (
        <div>
          <div className="pbth-event__group">Гости</div>
          {guests.map((guest) => (
            <Row
              key={guest.userId}
              lead={<Avatar name={guest.name} size={40} />}
              title={guest.name}
              sub={`${slotPriceLabel(guest.price)} · ${guest.paid ? 'оплатил' : 'не оплатил'}`}
              trailing={
                <span className="pbth-event__inline">
                  <Switch
                    checked={guest.paid}
                    disabled={busy}
                    label={`${guest.name}: оплатил`}
                    onChange={(paid) => void run(() => slotsApi.setPaid(event.id, guest.userId, paid))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    aria-label={`Снять ${guest.name}`}
                    disabled={busy}
                    onClick={() => void removeGuest(guest.userId, guest.name)}
                  />
                </span>
              }
            />
          ))}
        </div>
      )}
    </Glass>
  );
};
