import React from 'react';
import type { Game } from '../../types';
import { Sheet } from '../../ui';
import { errorText, notify } from '../../lib/notify';
import {
  buildEditDraft,
  normalizeTimeForInput,
  validateEditDraft,
  type EditDraft,
  type EditPatch,
} from '../../lib/event-view';
import { LocationAutocompleteInput } from '../LocationAutocompleteInput';
import { Field, SheetFooter } from './fields';

type GameInput = Omit<Game, 'id'>;

// ───────── Изменить событие ─────────

export const EditEventSheet: React.FC<{
  event: Parameters<typeof buildEditDraft>[0];
  isSeries: boolean;
  onClose: () => void;
  onSave: (patch: EditPatch) => Promise<void>;
}> = ({ event, isSeries, onClose, onSave }) => {
  const [draft, setDraft] = React.useState<EditDraft>(() => buildEditDraft(event));
  const [busy, setBusy] = React.useState(false);
  const set = (key: keyof EditDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async () => {
    const result = validateEditDraft(draft);
    if (!result.ok) {
      notify.error(result.error);
      return;
    }
    setBusy(true);
    try {
      await onSave(result.patch);
      onClose();
    } catch (error) {
      console.error('Failed to update event', error);
      notify.error(errorText(error, 'Не удалось сохранить событие.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Изменить событие" subtitle={isSeries ? 'Изменится только это занятие серии.' : 'Изменения увидит вся команда.'}>
      <div className="pbth-event__form">
        <Field label="Название" htmlFor="ev-title">
          <input id="ev-title" className="ui-input" type="text" value={draft.title} onChange={set('title')} placeholder="Название события" />
        </Field>
        <LocationAutocompleteInput
          name={draft.location}
          address={draft.locationAddress}
          url={draft.locationUrl}
          onChange={({ name, address, url }) => setDraft((prev) => ({ ...prev, location: name, locationAddress: address, locationUrl: url }))}
        />
        <Field label="Дата" htmlFor="ev-date">
          <input id="ev-date" className="ui-input" type="date" value={draft.date} onChange={set('date')} />
        </Field>
        <div className="pbth-event__two">
          <Field label="Начало" htmlFor="ev-start">
            <input id="ev-start" className="ui-input" type="time" value={draft.startTime} onChange={set('startTime')} />
          </Field>
          <Field label="Окончание" htmlFor="ev-end">
            <input id="ev-end" className="ui-input" type="time" value={draft.endTime} onChange={set('endTime')} />
          </Field>
        </div>
        <Field label="Стоимость, ₽" htmlFor="ev-cost">
          <input id="ev-cost" className="ui-input" type="number" inputMode="numeric" value={draft.cost} onChange={set('cost')} placeholder="0" />
        </Field>
        <Field label="Описание" htmlFor="ev-desc">
          <textarea id="ev-desc" className="ui-input pbth-event__area" rows={3} value={draft.description} onChange={set('description')} placeholder="План, снаряжение, заметки…" />
        </Field>
        <SheetFooter onCancel={onClose} submitLabel={busy ? 'Сохраняем…' : 'Сохранить'} onSubmit={() => void save()} busy={busy} />
      </div>
    </Sheet>
  );
};

// ───────── Игры ─────────

const PitZoneSelect: React.FC<{ id: string; value: 'NEAR' | 'FAR'; disabled?: boolean; onChange: (v: 'NEAR' | 'FAR') => void }> = ({ id, value, disabled, onChange }) => (
  <select id={id} className="ui-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as 'NEAR' | 'FAR')}>
    <option value="NEAR">Ближняя пит-зона</option>
    <option value="FAR">Дальняя пит-зона</option>
  </select>
);

const PairSelect: React.FC<{ id: string; value: 'FIRST' | 'SECOND'; disabled?: boolean; onChange: (v: 'FIRST' | 'SECOND') => void }> = ({ id, value, disabled, onChange }) => (
  <select id={id} className="ui-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as 'FIRST' | 'SECOND')}>
    <option value="FIRST">Первая пара</option>
    <option value="SECOND">Вторая пара</option>
  </select>
);

export const AddGameSheet: React.FC<{ onClose: () => void; onAdd: (game: GameInput) => void }> = ({ onClose, onAdd }) => {
  const [time, setTime] = React.useState('');
  const [opponent, setOpponent] = React.useState('');
  const [pitZone, setPitZone] = React.useState<'NEAR' | 'FAR'>('NEAR');
  const [pair, setPair] = React.useState<'FIRST' | 'SECOND'>('FIRST');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!time || !opponent.trim()) {
      notify.error('Укажи время и соперника.');
      return;
    }
    onAdd({ time, opponent: opponent.trim(), pitZone, gamePair: pair });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Добавить игру">
      <form className="pbth-event__form" onSubmit={submit}>
        <Field label="Время начала" htmlFor="g-time">
          <input id="g-time" className="ui-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field label="Соперник" htmlFor="g-opp">
          <input id="g-opp" className="ui-input" type="text" placeholder="Название команды" value={opponent} onChange={(e) => setOpponent(e.target.value)} required />
        </Field>
        <Field label="Пит-зона" htmlFor="g-pit">
          <PitZoneSelect id="g-pit" value={pitZone} onChange={setPitZone} />
        </Field>
        <Field label="Пара" htmlFor="g-pair">
          <PairSelect id="g-pair" value={pair} onChange={setPair} />
        </Field>
        <SheetFooter onCancel={onClose} submitLabel="Сохранить" submit />
      </form>
    </Sheet>
  );
};

export const GameCardSheet: React.FC<{
  game: Game;
  canEdit: boolean;
  onClose: () => void;
  onSave: (game: GameInput) => Promise<void> | void;
}> = ({ game, canEdit, onClose, onSave }) => {
  const [time, setTime] = React.useState(normalizeTimeForInput(game.time));
  const [opponent, setOpponent] = React.useState(game.opponent);
  const [score, setScore] = React.useState(game.score || '');
  const [pitZone, setPitZone] = React.useState<'NEAR' | 'FAR'>(game.pitZone || 'NEAR');
  const [pair, setPair] = React.useState<'FIRST' | 'SECOND'>(game.gamePair || 'FIRST');
  const [busy, setBusy] = React.useState(false);
  const locked = !canEdit || busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!time || !opponent.trim()) return;
    setBusy(true);
    try {
      await onSave({ time, opponent: opponent.trim(), score: score.trim() || undefined, pitZone, gamePair: pair });
      onClose();
    } catch (error) {
      notify.error(errorText(error, 'Не удалось сохранить игру.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Карточка игры" subtitle={`Соперник: ${game.opponent}`}>
      <form className="pbth-event__form" onSubmit={(e) => void submit(e)}>
        <Field label="Время игры" htmlFor="gc-time">
          <input id="gc-time" className="ui-input" type="time" value={time} disabled={locked} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field label="Соперник" htmlFor="gc-opp">
          <input id="gc-opp" className="ui-input" type="text" value={opponent} disabled={locked} onChange={(e) => setOpponent(e.target.value)} required />
        </Field>
        <Field label="Пит-зона" htmlFor="gc-pit">
          <PitZoneSelect id="gc-pit" value={pitZone} disabled={locked} onChange={setPitZone} />
        </Field>
        <Field label="Пара" htmlFor="gc-pair">
          <PairSelect id="gc-pair" value={pair} disabled={locked} onChange={setPair} />
        </Field>
        <Field label="Счёт (необязательно)" htmlFor="gc-score">
          <input id="gc-score" className="ui-input" type="text" placeholder="например 4:2" value={score} disabled={locked} onChange={(e) => setScore(e.target.value)} />
        </Field>
        <SheetFooter
          cancelLabel="Закрыть"
          onCancel={onClose}
          submitLabel={canEdit ? (busy ? 'Сохраняем…' : 'Сохранить') : undefined}
          submit
          busy={busy}
        />
      </form>
    </Sheet>
  );
};
