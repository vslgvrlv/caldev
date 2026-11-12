import React from 'react';
import { api } from '../../api';
import { errorText, notify } from '../../lib/notify';
import {
  DEFAULT_DRAFT,
  PAINT_NAMES,
  draftFromLook,
  isDefaultDraft,
  lettersOk,
  lookOfDraft,
  lookPatch,
  shownLook,
  typedLetters,
  type LookDraft,
} from '../../lib/team-look';
import { Button, Sheet, TEAM_PAINTS, TEAM_SHAPES, TeamMark, savedTeamLook, setTeamLook } from '../../ui';
import './team-look.css';

// Оформление команды — шторка капитана: живой знак, краска, фигура и буквы.
// Свой логотип здесь появится, когда у приложения будет хранилище файлов.

export const TeamLookSheet: React.FC<{
  teamId: string;
  teamName: string;
  shortCode?: string;
  onClose: () => void;
  /** Оформление сохранено: перечитать данные команды. */
  onSaved?: () => void;
}> = ({ teamId, teamName, shortCode, onClose, onSaved }) => {
  const [saved, setSaved] = React.useState<LookDraft>(() => draftFromLook(savedTeamLook(teamId)));
  const [draft, setDraft] = React.useState<LookDraft>(saved);
  const [busy, setBusy] = React.useState(false);

  const shown = shownLook(teamId, teamName, shortCode, draft);
  const patch = lookPatch(saved, draft);
  const lettersValid = lettersOk(draft.letters);

  const save = async () => {
    if (!patch || !lettersValid || busy) return;
    setBusy(true);
    try {
      const res = await api.updateTeamLook(teamId, patch);
      setTeamLook(teamId, res.look);
      const next = draftFromLook(res.look);
      setSaved(next);
      setDraft(next);
      notify.success('Оформление сохранено');
      onSaved?.();
      onClose();
    } catch (error) {
      notify.error(errorText(error, 'Не получилось сохранить. Попробуй ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Оформление команды" subtitle={teamName}>
      <div className="pbth-look">
        <div className="pbth-look__mark">
          <TeamMark teamId={teamId} name={teamName} code={shortCode} size={96} look={lookOfDraft(draft)} />
        </div>

        <div className="pbth-look__group" role="group" aria-label="Краска">
          <div className="pbth-look__label">Краска</div>
          <div className="pbth-look__grid">
            {TEAM_PAINTS.map((paint, i) => (
              <button
                key={paint}
                type="button"
                className="ui-btn ui-btn--glass2 pbth-look__opt"
                aria-pressed={shown.paint === paint}
                aria-label={PAINT_NAMES[i]}
                disabled={busy}
                onClick={() => setDraft((d) => ({ ...d, paint }))}
              >
                <span className="pbth-look__dot" style={{ background: paint }} />
              </button>
            ))}
          </div>
        </div>

        <div className="pbth-look__group" role="group" aria-label="Фигура">
          <div className="pbth-look__label">Фигура</div>
          <div className="pbth-look__grid">
            {TEAM_SHAPES.map((shape, i) => (
              <button
                key={shape.name}
                type="button"
                className="ui-btn ui-btn--glass2 pbth-look__opt"
                aria-pressed={shown.shape === i}
                aria-label={`Фигура: ${shape.name}`}
                disabled={busy}
                onClick={() => setDraft((d) => ({ ...d, shape: i }))}
              >
                <TeamMark teamId={teamId} name={teamName} code={shortCode} size={32} look={{ ...lookOfDraft(draft), shape: i }} />
              </button>
            ))}
          </div>
        </div>

        <label className="pbth-look__group">
          <span className="pbth-look__label">Буквы на знаке</span>
          <input
            className="ui-input pbth-look__letters"
            value={draft.letters}
            placeholder={shownLook(teamId, teamName, shortCode, { ...draft, letters: '' }).letters}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!lettersValid}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, letters: typedLetters(e.target.value) }))}
          />
          <span className="pbth-look__hint">
            {lettersValid ? 'Одна или две буквы или цифры. Пусто — буквы из названия.' : 'Только буквы и цифры, без знаков.'}
          </span>
        </label>

        <div className="pbth-look__actions">
          <Button variant="primary" block disabled={!patch || !lettersValid || busy} onClick={() => void save()}>
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </Button>
          <Button variant="ghost" block disabled={isDefaultDraft(draft) || busy} onClick={() => setDraft(DEFAULT_DRAFT)}>
            Вернуть как было у новой команды
          </Button>
        </div>
      </div>
    </Sheet>
  );
};
