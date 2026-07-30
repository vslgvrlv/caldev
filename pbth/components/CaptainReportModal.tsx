import React, { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { api } from '../api';
import type { BreakWidth, CaptainReport, Game, GameCombination } from '../types';

// Капитанский отчёт по гейму (#89, спека §2.2, §3.1–3.3). Отдельная форма от
// игроцкой: она верхнеуровневая — взгляд одного человека на весь пойнт.
// Смысл двух форм — расхождение между ними, поэтому капитан отвечает своими
// словами, а не смотрит на агрегат игроков (иначе меряли бы эхо).
//
// Читать отчёт может вся команда, писать — капитан и тренер: право приходит с
// сервера в canEdit, роль на клиенте не выводим.

const COMBINATIONS: Array<{ value: GameCombination; label: string; hint: string }> = [
  { value: 'ENVELOPE_ATTACK', label: 'Атака по конвертам', hint: 'сразу далеко на вторую линию' },
  { value: 'SNAKE_ATTACK', label: 'Атака по змеям', hint: 'сразу бежим на змею' },
  { value: 'ACTIVE_SNAKE', label: 'Активная змея', hint: 'играем втроём по змее' },
  { value: 'ACTIVE_ENVELOPE', label: 'Активные конверты', hint: 'играем втроём по конвертам' },
];

const BREAK_WIDTHS: Array<{ value: BreakWidth; label: string }> = [
  { value: 'NARROW', label: 'Узкая' },
  { value: 'WIDE', label: 'Широкая' },
];

// Линии инициативы — те же три, что и в §2.2.
const INITIATIVE_LINES: Array<{ key: keyof CaptainReport['initiative']; label: string }> = [
  { key: 'snake', label: 'Змея' },
  { key: 'center', label: 'Центр' },
  { key: 'envelope', label: 'Конверты' },
];

// +1 = ключевое укрытие по линии первыми заняли мы.
const INITIATIVE_VALUES: Array<{ value: number; label: string }> = [
  { value: -1, label: 'они' },
  { value: 0, label: 'поровну' },
  { value: 1, label: 'мы' },
];

// Дельта хранится величиной, а не знаком: реализация +1 и +3 — разные задачи (§2.1).
const DELTA_VALUES = [-3, -2, -1, 0, 1, 2, 3];

type Props = {
  game: Game;
  isOpen: boolean;
  onClose: () => void;
};

type Step = 1 | 2 | 3;

const emptyReport: CaptainReport = {
  combination: null,
  breakWidth: null,
  opponentBreakWidth: null,
  initiative: { snake: null, center: null, envelope: null },
  deltaOtb: null,
  result: null,
  note: null,
};

export const CaptainReportModal: React.FC<Props> = ({ game, isOpen, onClose }) => {
  const [draft, setDraft] = useState<CaptainReport>(emptyReport);
  const [canEdit, setCanEdit] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setStep(1);
    api
      .getCaptainReport(game.id)
      .then(({ report, canEdit: editable }) => {
        if (cancelled) return;
        setDraft(report ?? emptyReport);
        setCanEdit(editable);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить отчёт');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, game.id]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.saveCaptainReport(game.id, draft);
      onClose();
    } catch {
      setError('Не удалось сохранить отчёт');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Любой выбор снимается повторным тапом: капитан заполняет между пойнтами и
  // должен уметь отменить промах пальцем, не закрывая форму.
  const pick = <T,>(current: T | null, value: T): T | null => (current === value ? null : value);

  const chip = (active: boolean, label: string, onClick: () => void, hint?: string) => (
    <button
      key={label}
      type="button"
      disabled={!canEdit}
      onClick={onClick}
      className={`py-3 px-2 rounded-xl border transition-colors text-xs font-bold disabled:opacity-60 ${
        active ? 'bg-pb-primary text-pb-background border-pb-primary' : 'bg-white/5 text-white border-white/10'
      }`}
    >
      <span className="block">{label}</span>
      {hint && <span className="block text-[9px] font-normal opacity-70 mt-0.5">{hint}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10">
          <h3 className="text-base font-bold text-white">Разбор капитана · {game.time}</h3>
          <p className="text-pb-subtext text-xs mt-0.5 truncate">{game.opponent}</p>
        </div>

        <div className="p-5 space-y-5">
          {isLoading && (
            <div className="flex justify-center py-10 text-pb-subtext">
              <Loader2 className="animate-spin" size={22} />
            </div>
          )}

          {!isLoading && !canEdit && (
            <p className="text-xs text-pb-warning">Разбор ведёт капитан или тренер — здесь он только для чтения.</p>
          )}

          {!isLoading && step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Чем закончился пойнт?</p>
              <div className="grid grid-cols-2 gap-2">
                {chip(draft.result === 'WIN', 'Выиграли', () =>
                  setDraft((prev) => ({ ...prev, result: pick(prev.result, 'WIN') }))
                )}
                {chip(draft.result === 'LOSS', 'Проиграли', () =>
                  setDraft((prev) => ({ ...prev, result: pick(prev.result, 'LOSS') }))
                )}
              </div>

              <p className="text-sm text-pb-subtext pt-2">Какую комбинацию разыгрывали?</p>
              <div className="grid grid-cols-2 gap-2">
                {COMBINATIONS.map((combination) =>
                  chip(
                    draft.combination === combination.value,
                    combination.label,
                    () => setDraft((prev) => ({ ...prev, combination: pick(prev.combination, combination.value) })),
                    combination.hint
                  )
                )}
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background"
              >
                Дальше
              </button>
            </div>
          )}

          {!isLoading && step === 2 && (
            <div className="space-y-4">
              {/* Ширина обеих разбежек нужна вместе: «мы узко, они широко» — это
                  отдельная гипотеза о том, почему пойнт сложился так (§3.3). */}
              <p className="text-sm text-pb-subtext">Наша разбежка</p>
              <div className="grid grid-cols-2 gap-2">
                {BREAK_WIDTHS.map((width) =>
                  chip(draft.breakWidth === width.value, width.label, () =>
                    setDraft((prev) => ({ ...prev, breakWidth: pick(prev.breakWidth, width.value) }))
                  )
                )}
              </div>

              <p className="text-sm text-pb-subtext pt-2">Разбежка соперника</p>
              <div className="grid grid-cols-2 gap-2">
                {BREAK_WIDTHS.map((width) =>
                  chip(draft.opponentBreakWidth === width.value, width.label, () =>
                    setDraft((prev) => ({ ...prev, opponentBreakWidth: pick(prev.opponentBreakWidth, width.value) }))
                  )
                )}
              </div>

              <p className="text-sm text-pb-subtext pt-2">Составы после разбежки</p>
              <p className="text-[11px] text-pb-subtext/70 -mt-2">
                Минус — играли в меньшинстве, плюс — в большинстве. Это твоя оценка; расчёт по формам игроков идёт
                отдельно.
              </p>
              <div className="grid grid-cols-7 gap-1">
                {DELTA_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setDraft((prev) => ({ ...prev, deltaOtb: pick(prev.deltaOtb, value) }))}
                    className={`py-3 rounded-lg text-xs font-bold border transition-colors disabled:opacity-60 ${
                      draft.deltaOtb === value
                        ? 'bg-pb-primary text-pb-background border-pb-primary'
                        : 'bg-white/5 text-white border-white/10'
                    }`}
                  >
                    {value > 0 ? `+${value}` : value}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background"
              >
                Дальше
              </button>
            </div>
          )}

          {!isLoading && step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Кто первым занял ключевые укрытия?</p>
              {INITIATIVE_LINES.map((line) => (
                <div key={line.key} className="space-y-2">
                  <div className="text-xs font-bold text-pb-subtext uppercase tracking-wider">{line.label}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {INITIATIVE_VALUES.map((option) =>
                      chip(draft.initiative[line.key] === option.value, option.label, () =>
                        setDraft((prev) => ({
                          ...prev,
                          initiative: { ...prev.initiative, [line.key]: pick(prev.initiative[line.key], option.value) },
                        }))
                      )
                    )}
                  </div>
                </div>
              ))}

              <textarea
                value={draft.note ?? ''}
                disabled={!canEdit}
                onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-pb-subtext"
                placeholder="Что ещё было важного? Необязательно."
              />

              {canEdit && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSave}
                  className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                  Сохранить
                </button>
              )}
            </div>
          )}

          {error && <p className="text-xs text-pb-danger text-center">{error}</p>}

          <div className="flex justify-between text-xs text-pb-subtext pt-2">
            <button type="button" onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))}>
              {step > 1 ? 'Назад' : 'Закрыть'}
            </button>
            <span>Шаг {step} из 3</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaptainReportModal;
