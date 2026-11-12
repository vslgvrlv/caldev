import React from 'react';
import { api } from '../../api';
import { errorText, notify } from '../../lib/notify';
import {
  DEFAULT_DRAFT,
  LOGO_ACCEPT,
  LOGO_SEND_AS_IS_BYTES,
  PAINT_NAMES,
  draftFromLook,
  isDefaultDraft,
  fitLogoSize,
  lettersOk,
  logoErrorText,
  logoFileProblem,
  lookOfDraft,
  lookPatch,
  shownLook,
  typedLetters,
  type LookDraft,
} from '../../lib/team-look';
import { Button, Sheet, TEAM_PAINTS, TEAM_SHAPES, TeamMark, savedTeamLook, setTeamLook, validLogo } from '../../ui';
import './team-look.css';

// Оформление команды — шторка капитана: живой знак, краска, фигура, буквы и
// свой логотип. Краска, фигура и буквы сохраняются кнопкой «Сохранить»;
// логотип загружается и убирается сразу.

/**
 * Большую картинку уменьшаем в браузере (большая сторона до 512 px): сервер всё
 * равно сохранит квадрат 256×256, а маленький файл быстрее уходит с телефона.
 * Не получилось уменьшить — отправляем как есть, сервер проверит сам.
 */
async function shrinkLogo(file: File): Promise<Blob> {
  if (file.size <= LOGO_SEND_AS_IS_BYTES || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitLogoSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // PNG хранит прозрачность; если и он велик — JPEG.
    const png = await toBlob('image/png');
    if (png && png.size <= LOGO_SEND_AS_IS_BYTES) return png;
    const jpeg = await toBlob('image/jpeg', 0.9);
    return jpeg && jpeg.size < file.size ? jpeg : file;
  } catch {
    return file;
  }
}

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
  const [logo, setLogo] = React.useState<string | null>(() => validLogo(savedTeamLook(teamId)?.logo));
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // Ответ сервера после загрузки или удаления логотипа: знак меняется сразу на всех экранах.
  const applyLogoAnswer = (look: Parameters<typeof setTeamLook>[1]) => {
    setTeamLook(teamId, look);
    setLogo(validLogo(look?.logo));
    onSaved?.();
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file || busy) return;
    const problem = logoFileProblem(file);
    if (problem) {
      notify.error(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await api.uploadTeamLogo(teamId, await shrinkLogo(file));
      applyLogoAnswer(res.look);
      notify.success('Логотип загружен');
    } catch (error) {
      notify.error(logoErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const removeLogo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.removeTeamLogo(teamId);
      applyLogoAnswer(res.look);
      notify.success('Логотип убран');
    } catch (error) {
      notify.error(errorText(error, 'Не получилось убрать логотип. Попробуй ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

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
          <TeamMark teamId={teamId} name={teamName} code={shortCode} size={96} look={{ ...lookOfDraft(draft), logo }} />
        </div>

        <div className="pbth-look__group" role="group" aria-label="Логотип">
          <input
            ref={fileRef}
            type="file"
            accept={LOGO_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void uploadLogo(file);
            }}
          />
          <div className="pbth-look__logo">
            <Button variant="glass2" icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
              {logo ? 'Заменить логотип' : 'Загрузить логотип'}
            </Button>
            {logo && (
              <Button variant="ghost" icon="trash-2" disabled={busy} onClick={() => void removeLogo()}>
                Убрать
              </Button>
            )}
          </div>
          <span className="pbth-look__hint">
            {logo
              ? 'Логотип стоит на месте фигуры с буквами. Уберёшь — они вернутся.'
              : 'PNG, JPEG или WebP до 2 МБ — встанет на место фигуры.'}
          </span>
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

        {!logo && (
          <>
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
          </>
        )}

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
