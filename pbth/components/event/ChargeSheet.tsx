import React from 'react';
import { Sheet } from '../../ui';
import { notify } from '../../lib/notify';
import { buildEventChargeModalState } from '../../lib/event-charge-modal';
import { formatRub } from '../../lib/event-view';
import { Field, SheetFooter } from './fields';

type Participants = Parameters<typeof buildEventChargeModalState>[0]['participants'];
export type ChargeAudience = 'CONFIRMED_ONLY' | 'CONFIRMED_AND_PENDING';
export type ChargeMode = 'UNDISTRIBUTED_SPLIT' | 'FIXED_PER_PERSON';

/** «Распределить расходы» / «Доначислить участникам» (сбор по событию; открывается, пока сбор включён флагом). */
export const ChargeSheet: React.FC<{
  participants: Participants;
  undistributed: number;
  hasExisting: boolean;
  suggestedAmount?: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { audience: ChargeAudience; mode: ChargeMode; amount: string }) => void;
}> = ({ participants, undistributed, hasExisting, suggestedAmount, busy, onClose, onSubmit }) => {
  const [audience, setAudience] = React.useState<ChargeAudience>('CONFIRMED_ONLY');
  const [mode, setMode] = React.useState<ChargeMode>(() =>
    undistributed > 0 ? 'UNDISTRIBUTED_SPLIT' : hasExisting ? 'FIXED_PER_PERSON' : 'UNDISTRIBUTED_SPLIT',
  );
  const [amount, setAmount] = React.useState(() =>
    undistributed <= 0 && hasExisting && suggestedAmount !== undefined ? String(suggestedAmount) : '',
  );

  const state = buildEventChargeModalState({
    participants,
    audience,
    amountMode: mode,
    undistributedAmount: undistributed,
    fixedAmount: amount,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.canSubmit) {
      notify.error(state.blockingReason || 'Нет подходящих участников для начисления.');
      return;
    }
    onSubmit({ audience, mode, amount });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'UNDISTRIBUTED_SPLIT' ? 'Распределить расходы' : 'Доначислить участникам'}
      subtitle={
        mode === 'UNDISTRIBUTED_SPLIT'
          ? 'Остаток расходов события разойдётся по выбранным участникам.'
          : 'Добавляем фиксированную сумму новым участникам, не переписывая идущий сбор.'
      }
    >
      <form className="pbth-event__form" onSubmit={submit}>
        <Field label="Кого включить в сбор" htmlFor="ch-aud">
          <select id="ch-aud" className="ui-select" value={audience} onChange={(e) => setAudience(e.target.value as ChargeAudience)}>
            <option value="CONFIRMED_ONLY">Только подтвердившие участие</option>
            <option value="CONFIRMED_AND_PENDING">Подтвердившие и думающие</option>
          </select>
        </Field>
        <Field label="Как начислить" htmlFor="ch-mode">
          <select id="ch-mode" className="ui-select" value={mode} onChange={(e) => setMode(e.target.value as ChargeMode)}>
            <option value="UNDISTRIBUTED_SPLIT" disabled={undistributed <= 0}>
              {undistributed > 0 ? 'Распределить нераскиданное' : 'Нераспределённых расходов нет'}
            </option>
            <option value="FIXED_PER_PERSON">Фиксированная сумма на игрока</option>
          </select>
        </Field>
        {hasExisting && mode === 'FIXED_PER_PERSON' ? (
          <div className="pbth-event__muted">
            Сбор уже идёт. Чтобы не сломать начисления, новым участникам можно добавить только фиксированную сумму.
            {suggestedAmount !== undefined ? ` Сейчас ориентир — ${formatRub(suggestedAmount)}.` : ''}
          </div>
        ) : null}
        {mode === 'FIXED_PER_PERSON' ? (
          <Field label="Сумма на игрока, ₽" htmlFor="ch-sum">
            <input id="ch-sum" className="ui-input" type="number" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        ) : (
          <div className="pbth-event__muted">Нераспределённый остаток: {formatRub(undistributed)}</div>
        )}
        <div className="pbth-event__muted">{state.preview}</div>
        {state.blockingReason ? <div className="pbth-event__muted">{state.blockingReason}</div> : null}
        <SheetFooter
          onCancel={onClose}
          submitLabel={busy ? 'Сохраняем…' : mode === 'UNDISTRIBUTED_SPLIT' ? 'Распределить' : 'Доначислить'}
          submit
          busy={busy}
          disabled={!state.canSubmit}
        />
      </form>
    </Sheet>
  );
};
