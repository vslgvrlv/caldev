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
import { Field, TextInput, DateInput, TimeInput, MoneyInput } from '../form';
import { SheetFooter } from './fields';

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
  const set = (key: keyof EditDraft) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

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
          <TextInput id="ev-title" value={draft.title} onChange={set('title')} placeholder="Название события" />
        </Field>
        <LocationAutocompleteInput
          name={draft.location}
          address={draft.locationAddress}
          url={draft.locationUrl}
          onChange={({ name, address, url }) => setDraft((prev) => ({ ...prev, location: name, locationAddress: address, locationUrl: url }))}
        />
        <Field label="Дата" htmlFor="ev-date">
          <DateInput id="ev-date" value={draft.date} onChange={set('date')} />
        </Field>
        <div className="pbth-event__two">
          <Field label="Начало" htmlFor="ev-start">
            <TimeInput id="ev-start" value={draft.startTime} onChange={set('startTime')} />
          </Field>
          <Field label="Окончание" htmlFor="ev-end">
            <TimeInput id="ev-end" value={draft.endTime} onChange={set('endTime')} />
          </Field>
        </div>
        <Field label="Стоимость" htmlFor="ev-cost">
          <MoneyInput id="ev-cost" value={draft.cost} onChange={set('cost')} placeholder="0" />
        </Field>
        <Field label="Описание" htmlFor="ev-desc">
          <TextInput id="ev-desc" multiline rows={3} value={draft.description} onChange={set('description')} placeholder="План, снаряжение, заметки…" />
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
          <TimeInput id="g-time" value={time} onChange={setTime} required />
        </Field>
        <Field label="Соперник" htmlFor="g-opp">
          <TextInput id="g-opp" placeholder="Название команды" value={opponent} onChange={setOpponent} required />
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
          <TimeInput id="gc-time" value={time} disabled={locked} onChange={setTime} required />
        </Field>
        <Field label="Соперник" htmlFor="gc-opp">
          <TextInput id="gc-opp" value={opponent} disabled={locked} onChange={setOpponent} required />
        </Field>
        <Field label="Пит-зона" htmlFor="gc-pit">
          <PitZoneSelect id="gc-pit" value={pitZone} disabled={locked} onChange={setPitZone} />
        </Field>
        <Field label="Пара" htmlFor="gc-pair">
          <PairSelect id="gc-pair" value={pair} disabled={locked} onChange={setPair} />
        </Field>
        <Field label="Счёт (необязательно)" htmlFor="gc-score">
          <TextInput id="gc-score" placeholder="например 4:2" value={score} disabled={locked} onChange={setScore} />
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
