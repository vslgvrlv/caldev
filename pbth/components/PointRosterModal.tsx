import React, { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { api } from '../api';
import type { GamePoint, RosterCandidate } from '../types';

// Состав пойнта (#102). Живёт отдельным экраном, потому что жест другой:
// разметку результатов делают по всему игре сразу, а состав — по одному
// пойнту, глядя на поле.
//
// Ключевая механика — предзаполнение. Капитан не будет тапать пять имён
// пятнадцать раз за игра; в пейнтболе между пойнтами меняется один-два
// человека. Поэтому экран открывается с составом ПРЕДЫДУЩЕГО пойнта, и
// капитану остаётся отметить только замены. Первый пойнт предзаполняется
// явкой на событие.

type Props = {
  point: GamePoint;
  /** Состав предыдущего пойнта — источник предзаполнения. */
  previousRoster: string[];
  candidates: RosterCandidate[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const OPPONENT_SIZES = [3, 4, 5];

export const PointRosterModal: React.FC<Props> = ({
  point,
  previousRoster,
  candidates,
  isOpen,
  onClose,
  onSaved,
}) => {
  const [selected, setSelected] = useState<string[]>(() => {
    if (point.roster.length) return point.roster;
    if (previousRoster.length) return previousRoster;
    // Явку отмечали — берём приехавших. Не отмечали — пусто, гадать не надо.
    return candidates.filter((c) => c.present === true).map((c) => c.userId);
  });
  const [opponentSize, setOpponentSize] = useState<number | null>(point.opponentRosterSize);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggle = (userId: string) =>
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.saveGamePointRoster(point.id, selected, opponentSize);
      onSaved();
    } catch {
      setError('Не удалось сохранить состав');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">Состав пойнта {point.ordinal}</h3>
            <p className="text-pb-subtext text-xs mt-0.5">Выбрано {selected.length}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-pb-subtext shrink-0">
            Закрыть
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-2">
            {candidates.map((candidate) => {
              const active = selected.includes(candidate.userId);
              return (
                <button
                  key={candidate.userId}
                  type="button"
                  onClick={() => toggle(candidate.userId)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                    active
                      ? 'bg-pb-primary text-pb-background border-pb-primary'
                      : 'bg-white/5 text-white border-white/10'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold truncate">
                      {candidate.nickname || candidate.name}
                    </span>
                    {candidate.present === false && (
                      <span className="block text-[10px] opacity-70">не приехал на событие</span>
                    )}
                  </span>
                  {active && <Check size={16} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Размер состава соперника: 5-на-4 после штрафа — другой пойнт, и
              складывать его с равным составом в статистике нельзя. */}
          <div className="space-y-2 border-t border-white/5 pt-4">
            <p className="text-sm text-pb-subtext">Сколько было у соперника?</p>
            <div className="grid grid-cols-3 gap-2">
              {OPPONENT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setOpponentSize((prev) => (prev === size ? null : size))}
                  className={`py-3 rounded-xl font-bold border transition-colors ${
                    opponentSize === size
                      ? 'bg-pb-primary text-pb-background border-pb-primary'
                      : 'bg-white/5 text-white border-white/10'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void save()}
            className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
            Сохранить состав
          </button>

          {error && <p className="text-xs text-pb-danger text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export default PointRosterModal;
