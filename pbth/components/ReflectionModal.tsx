import React, { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { api } from '../api';
import { FieldSchema } from './FieldSchema';
import type { FieldPosition, Game, GamePoint, GameReflection, ReflectionKill, ReflectionPhase } from '../types';

// Форма рефлексии игрока по пойнту (#89, спека §7.5). Бюджет — 60–90 сек,
// 4–8 тапов. Клавиатура открывается ровно один раз и только по желанию —
// в последнем поле «что ещё было важного».
//
// Заполняется за пойнт, а не за гейм: в гейме со счётом 4:3 семь разных
// эпизодов, и усреднять их в одну форму — терять ровно то, ради чего рефлексия.

const PHASES: Array<{ value: ReflectionPhase; label: string }> = [
  { value: 'BREAK', label: 'На разбежке' },
  { value: 'COVER', label: 'За укрытием' },
  { value: 'ROTATION', label: 'На перемещении' },
];

// Перестановка флангов — настройка уровня турнира, а не пойнта: спрашивать её
// в каждой форме нельзя, поэтому держим в localStorage.
const SWAP_KEY = 'pbth:field-schema-swapped';

type Props = {
  game: Game;
  point: GamePoint;
  isOpen: boolean;
  onClose: () => void;
};

// 6 — экран подтверждения. Без него игрок не понимал, что форма ушла:
// модалка просто закрывалась, и это читалось как «ничего не произошло».
type Step = 1 | 2 | 3 | 4 | 5 | 6;

// Самооценка (§8.3): оценивается работа, а не исход пойнта — выбитый может
// отработать задачу на пять, доживший — простоять в укрытии.
const SELF_RATINGS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'провалил' },
  { value: 2, label: 'слабо' },
  { value: 3, label: 'норм' },
  { value: 4, label: 'хорошо' },
  { value: 5, label: 'отлично' },
];

const emptyReflection: GameReflection = {
  eliminated: false,
  deathPhase: null,
  deathPositionId: null,
  kills: [],
  selfRating: null,
  note: null,
};

export const ReflectionModal: React.FC<Props> = ({ game, point, isOpen, onClose }) => {
  const [positions, setPositions] = useState<FieldPosition[]>([]);
  const [draft, setDraft] = useState<GameReflection>(emptyReflection);
  const [step, setStep] = useState<Step>(1);
  const [swapped, setSwapped] = useState(() => localStorage.getItem(SWAP_KEY) === '1');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setStep(1);
    Promise.all([api.getFieldPositions(), api.getMyReflection(point.id)])
      .then(([catalog, saved]) => {
        if (cancelled) return;
        setPositions(catalog);
        setDraft(saved ?? emptyReflection);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить форму');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, point.id]);

  const toggleSwap = () => {
    setSwapped((prev) => {
      localStorage.setItem(SWAP_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  const setKillCount = (count: number) => {
    setDraft((prev) => {
      const kills: ReflectionKill[] = [];
      for (let i = 0; i < count; i += 1) {
        kills.push(prev.kills[i] ?? { phase: 'COVER', positionId: null });
      }
      return { ...prev, kills };
    });
  };

  const patchKill = (index: number, patch: Partial<ReflectionKill>) => {
    setDraft((prev) => ({
      ...prev,
      kills: prev.kills.map((kill, i) => (i === index ? { ...kill, ...patch } : kill)),
    }));
  };

  // Экран 2 для дожившего не существует — назад с киллов он должен вернуться
  // к первому вопросу, а не на пустой экран поражения.
  const goBack = () => {
    if (step === 1) return onClose();
    if (step === 3 && !draft.eliminated) return setStep(1);
    setStep((step - 1) as Step);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.saveMyReflection(point.id, draft);
      setStep(6);
    } catch {
      setError('Не удалось сохранить рефлексию');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const phaseButtons = (value: ReflectionPhase | null, onPick: (phase: ReflectionPhase) => void) => (
    <div className="grid grid-cols-3 gap-2">
      {PHASES.map((phase) => (
        <button
          key={phase.value}
          type="button"
          onClick={() => onPick(phase.value)}
          className={`py-3 px-2 rounded-xl text-xs font-bold border transition-colors ${
            value === phase.value
              ? 'bg-pb-primary text-pb-background border-pb-primary'
              : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
          }`}
        >
          {phase.label}
        </button>
      ))}
    </div>
  );

  // Форма без фазы килла бесполезна: без неё не считается delta_otb (§2.1).
  const killsIncomplete = draft.kills.some((kill) => !kill.phase);

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10">
          <h3 className="text-base font-bold text-white">
            Пойнт {point.ordinal}
            {point.result ? (point.result === 'WIN' ? ' · выиграли' : ' · проиграли') : ''}
          </h3>
          <p className="text-pb-subtext text-xs mt-0.5 truncate">
            {game.opponent} · {game.time}
          </p>
        </div>

        <div className="p-5 space-y-5">
          {isLoading && (
            <div className="flex justify-center py-10 text-pb-subtext">
              <Loader2 className="animate-spin" size={22} />
            </div>
          )}

          {!isLoading && step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-pb-subtext">Чем закончился пойнт для тебя?</p>
              <button
                type="button"
                onClick={() => {
                  setDraft((prev) => ({ ...prev, eliminated: true }));
                  setStep(2);
                }}
                className="w-full p-4 rounded-xl font-bold bg-white/5 text-white border border-white/10 hover:bg-white/10"
              >
                Меня выбили
              </button>
              <button
                type="button"
                onClick={() => {
                  // Дожил — фазы и укрытия поражения не существует, экран 2 пропускаем.
                  setDraft((prev) => ({ ...prev, eliminated: false, deathPhase: null, deathPositionId: null }));
                  setStep(3);
                }}
                className="w-full p-4 rounded-xl font-bold bg-white/5 text-white border border-white/10 hover:bg-white/10"
              >
                Дожил до конца
              </button>
            </div>
          )}

          {!isLoading && step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Где и когда тебя выбили?</p>
              {phaseButtons(draft.deathPhase, (phase) => setDraft((prev) => ({ ...prev, deathPhase: phase })))}
              <FieldSchema
                positions={positions}
                value={draft.deathPositionId}
                onChange={(positionId) => setDraft((prev) => ({ ...prev, deathPositionId: positionId }))}
                swapped={swapped}
                onSwap={toggleSwap}
              />
              <button
                type="button"
                disabled={!draft.deathPhase}
                onClick={() => setStep(3)}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background disabled:opacity-40"
              >
                Дальше
              </button>
            </div>
          )}

          {!isLoading && step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Скольких выбил ты?</p>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setKillCount(count)}
                    className={`py-3 rounded-xl font-bold border transition-colors ${
                      draft.kills.length === count
                        ? 'bg-pb-primary text-pb-background border-pb-primary'
                        : 'bg-white/5 text-white border-white/10'
                    }`}
                  >
                    {count === 3 ? '3+' : count}
                  </button>
                ))}
              </div>
              {draft.kills.length === 3 && (
                <button
                  type="button"
                  onClick={() => setKillCount(draft.kills.length + 1)}
                  className="w-full text-xs text-pb-subtext py-1"
                >
                  Добавить ещё килл
                </button>
              )}

              {draft.kills.map((kill, index) => (
                <div key={index} className="space-y-3 border-t border-white/5 pt-4">
                  <div className="text-xs font-bold text-pb-subtext uppercase tracking-wider">Килл {index + 1}</div>
                  {phaseButtons(kill.phase, (phase) => patchKill(index, { phase }))}
                  <FieldSchema
                    positions={positions}
                    value={kill.positionId}
                    onChange={(positionId) => patchKill(index, { positionId })}
                    swapped={swapped}
                    onSwap={toggleSwap}
                  />
                </div>
              ))}

              <button
                type="button"
                disabled={killsIncomplete}
                onClick={() => setStep(4)}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background disabled:opacity-40"
              >
                Дальше
              </button>
            </div>
          )}

          {!isLoading && step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Как ты отработал этот пойнт?</p>
              <div className="grid grid-cols-5 gap-2">
                {SELF_RATINGS.map((rating) => (
                  <button
                    key={rating.value}
                    type="button"
                    // Повторный тап снимает оценку: пропустить экран — валидный ответ.
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        selfRating: prev.selfRating === rating.value ? null : rating.value,
                      }))
                    }
                    className={`py-3 rounded-xl border transition-colors flex flex-col items-center gap-1 ${
                      draft.selfRating === rating.value
                        ? 'bg-pb-primary text-pb-background border-pb-primary'
                        : 'bg-white/5 text-white border-white/10'
                    }`}
                  >
                    <span className="font-bold">{rating.value}</span>
                    <span className="text-[9px] opacity-70 leading-none">{rating.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background"
              >
                {draft.selfRating ? 'Дальше' : 'Пропустить'}
              </button>
            </div>
          )}

          {!isLoading && step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-pb-subtext">Что ещё было важного? Необязательно.</p>
              <textarea
                value={draft.note ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-pb-subtext"
                placeholder="Например: остался на тридцатке, хотя надо было идти на 3000"
              />
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                Сохранить
              </button>
            </div>
          )}

          {!isLoading && step === 6 && (
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-pb-primary/20 flex items-center justify-center">
                <Check size={28} className="text-pb-primary" />
              </div>
              <p className="text-sm font-bold text-white">Рефлексия за пойнт {point.ordinal} сохранена</p>
              <p className="text-xs text-pb-subtext">Её видят капитан и тренер. Вернуться и поправить можно в любой момент.</p>
              <button
                type="button"
                onClick={onClose}
                className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background"
              >
                К списку пойнтов
              </button>
            </div>
          )}

          {error && <p className="text-xs text-pb-danger text-center">{error}</p>}

          {step < 6 && (
            <div className="flex justify-between text-xs text-pb-subtext pt-2">
              <button type="button" onClick={goBack}>
                {step > 1 ? 'Назад' : 'Отмена'}
              </button>
              <span>Шаг {step} из 5</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReflectionModal;
