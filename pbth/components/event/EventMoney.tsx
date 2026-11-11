import React from 'react';
import { Button, Glass, Icon, Row } from '../../ui';
import { formatRub } from '../../lib/event-view';

export type CollectionSummary = {
  statusLabel: string;
  cards: { label: string; value: string }[];
  loading: boolean;
  canManage: boolean;
  onAddExpense: () => void;
};

type Props = {
  /** Цена с человека, ₽. Нет или 0 — строки нет. */
  cost?: number | null;
  /** «Сбор по событию»: показывается, только пока он включён флагом (капитан, тренер). */
  collection: CollectionSummary | null;
};

/** Деньги события: сумма с человека и, где разрешено, сводка сбора. */
export const EventMoney: React.FC<Props> = ({ cost, collection }) => {
  const hasCost = Number(cost) > 0;
  if (!hasCost && !collection) return null;
  return (
    <Glass layer={1} className="pbth-event__panel" data-testid="event-money">
      {hasCost ? (
        <Row
          lead={
            <Glass layer={2} className="pbth-event__icon">
              <Icon name="banknote" size={20} />
            </Glass>
          }
          title={`${formatRub(Number(cost))} с человека`}
        />
      ) : null}
      {collection ? (
        <>
          <div className="pbth-event__head">
            <h2 className="pbth-event__h">Сбор по событию</h2>
            <span className="ui-chip">{collection.statusLabel}</span>
          </div>
          {collection.loading ? <div className="pbth-event__muted">Загружаем финансы события…</div> : null}
          {!collection.loading && collection.cards.length > 0 ? (
            <div className="pbth-event__summary">
              {collection.cards.map((card) => (
                <Glass key={card.label} layer={2} className="pbth-event__summary-card">
                  <span className="pbth-event__tile-sub">{card.label}</span>
                  <span className="pbth-event__summary-value">{card.value}</span>
                </Glass>
              ))}
            </div>
          ) : null}
          {!collection.loading && collection.canManage ? (
            <Button variant="glass2" icon="receipt" onClick={collection.onAddExpense}>
              Добавить расход
            </Button>
          ) : null}
        </>
      ) : null}
    </Glass>
  );
};
