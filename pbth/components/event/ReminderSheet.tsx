import React from 'react';
import type { Game } from '../../types';
import { Sheet } from '../../ui';
import { notify } from '../../lib/notify';
import {
  REMINDER_AUDIENCES,
  REMINDER_TEMPLATES,
  gameOptionLabel,
  isGameReminderTemplate,
  type ReminderAudience,
  type ReminderTemplate,
} from '../../lib/event-view';
import { Field, SheetFooter } from './fields';

/** Напоминание по выбору: кому, какое, и для игры — по какой. Для «молчунам» есть быстрая кнопка в составе. */
export const ReminderSheet: React.FC<{
  games: Game[];
  busy: boolean;
  onClose: () => void;
  onSend: (payload: { audience: ReminderAudience; template: ReminderTemplate; gameId?: string }) => Promise<boolean>;
}> = ({ games, busy, onClose, onSend }) => {
  const [audience, setAudience] = React.useState<ReminderAudience>('UNANSWERED');
  const [template, setTemplate] = React.useState<ReminderTemplate>('EVENT_REMINDER');
  const [gameId, setGameId] = React.useState('');
  const forGame = isGameReminderTemplate(template);

  React.useEffect(() => {
    if (!forGame) return;
    if (games.length === 0) setGameId('');
    else if (!gameId || !games.some((g) => g.id === gameId)) setGameId(games[0].id);
  }, [forGame, games, gameId]);

  const send = async () => {
    if (forGame && !gameId) {
      notify.error('Для напоминания об игре выбери игру из расписания.');
      return;
    }
    const ok = await onSend({ audience, template, gameId: forGame ? gameId : undefined });
    if (ok) onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Напоминание">
      <div className="pbth-event__form">
        <Field label="Кому" htmlFor="rm-aud">
          <select id="rm-aud" className="ui-select" value={audience} onChange={(e) => setAudience(e.target.value as ReminderAudience)}>
            {REMINDER_AUDIENCES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Что отправить" htmlFor="rm-tpl">
          <select id="rm-tpl" className="ui-select" value={template} onChange={(e) => setTemplate(e.target.value as ReminderTemplate)}>
            {REMINDER_TEMPLATES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {forGame ? (
          <Field label="Игра" htmlFor="rm-game">
            <select id="rm-game" className="ui-select" value={gameId} disabled={games.length === 0} onChange={(e) => setGameId(e.target.value)}>
              {games.length === 0 ? <option value="">Нет игр в расписании</option> : null}
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameOptionLabel(g)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <SheetFooter
          onCancel={onClose}
          submitLabel={busy ? 'Отправляем…' : 'Отправить'}
          onSubmit={() => void send()}
          busy={busy}
          disabled={forGame && games.length === 0}
        />
      </div>
    </Sheet>
  );
};
