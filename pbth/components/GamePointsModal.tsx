import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, ClipboardList, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { ReflectionModal } from './ReflectionModal';
import { CaptainReportModal } from './CaptainReportModal';
import type { Game, GamePoint, GamePointsResponse, PointResult } from '../types';

// Выбор пойнта — вход в рефлексию (#89). Гейм со счётом 4:3 это семь пойнтов,
// и форма заполняется за каждый: без этого экрана игрок отвечал бы за весь матч
// сразу, а семь разных эпизодов схлопывались в один.
//
// Пойнты создаёт сервер из счёта гейма. Из счёта известно только СКОЛЬКО побед,
// но не в каком порядке — порядок размечает капитан тапом по результату.

type Props = {
  game: Game;
  isOpen: boolean;
  onClose: () => void;
};

const RESULT_LABEL: Record<PointResult, string> = { WIN: 'Выиграли', LOSS: 'Проиграли' };

// Тап по результату гоняет по кругу: не размечен → выиграли → проиграли.
const nextResult = (current: PointResult | null): PointResult | null =>
  current === null ? 'WIN' : current === 'WIN' ? 'LOSS' : null;

export const GamePointsModal: React.FC<Props> = ({ game, isOpen, onClose }) => {
  const [data, setData] = useState<GamePointsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflectionPoint, setReflectionPoint] = useState<GamePoint | null>(null);
  const [captainPoint, setCaptainPoint] = useState<GamePoint | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await api.getGamePoints(game.id));
    } catch {
      setError('Не удалось загрузить пойнты');
    } finally {
      setIsLoading(false);
    }
  }, [game.id]);

  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

  const cycleResult = async (point: GamePoint) => {
    if (!data?.canMarkResults) return;
    const result = nextResult(point.result);
    // Оптимистично: разметка семи пойнтов подряд не должна ждать сеть на каждый тап.
    setData((prev) =>
      prev ? { ...prev, points: prev.points.map((p) => (p.id === point.id ? { ...p, result } : p)) } : prev
    );
    try {
      await api.saveGamePointResults(game.id, [{ ordinal: point.ordinal, result }]);
    } catch {
      setError('Не удалось сохранить разметку');
      void load();
    }
  };

  // Сходимость считаем ЛОКАЛЬНО, а не берём resultsMatchScore из ответа: тапы
  // применяются оптимистично, и серверный флаг остаётся тем, каким был на
  // загрузке. Из-за этого предупреждение висело даже после полной разметки.
  const marked =
    data?.expected != null
      ? (() => {
          const wins = data.points.filter((p) => p.result === 'WIN').length;
          const losses = data.points.filter((p) => p.result === 'LOSS').length;
          const unmarked = data.points.filter((p) => p.result === null).length;
          return {
            wins,
            losses,
            unmarked,
            matchesScore: unmarked === 0 && wins === data.expected.wins && losses === data.expected.losses,
          };
        })()
      : null;

  if (!isOpen) return null;

  // Форма закрылась — счётчики заполнения изменились, перечитываем.
  const closeChild = () => {
    setReflectionPoint(null);
    setCaptainPoint(null);
    void load();
  };

  if (reflectionPoint) {
    return <ReflectionModal isOpen game={game} point={reflectionPoint} onClose={closeChild} />;
  }
  if (captainPoint) {
    return <CaptainReportModal isOpen game={game} point={captainPoint} onClose={closeChild} />;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">{game.opponent}</h3>
            <p className="text-pb-subtext text-xs mt-0.5">
              {game.time}
              {game.score ? ` · счёт ${game.score}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-pb-subtext shrink-0 pt-1">
            Закрыть
          </button>
        </div>

        <div className="p-5 space-y-3">
          {isLoading && (
            <div className="flex justify-center py-10 text-pb-subtext">
              <Loader2 className="animate-spin" size={22} />
            </div>
          )}

          {/* Пойнты выводятся из счёта — без него их количество неизвестно. */}
          {!isLoading && data && !data.expected && (
            <p className="text-sm text-pb-subtext">
              Укажи счёт гейма (например 4:3) — из него появятся пойнты, за которые заполняется рефлексия.
            </p>
          )}

          {!isLoading && data?.expected && marked && (
            <>
              <p className="text-xs text-pb-subtext">
                {data.expected.total} пойнтов: {data.expected.wins} выиграли, {data.expected.losses} проиграли.
                {data.canMarkResults && !marked.matchesScore && ' Отметь тапом, какие именно.'}
              </p>

              {data.canMarkResults &&
                (marked.matchesScore ? (
                  <p className="text-xs text-pb-primary">Разметка сходится со счётом.</p>
                ) : (
                  <p className="text-xs text-pb-warning">
                    Отмечено {marked.wins} выигранных и {marked.losses} проигранных
                    {marked.unmarked > 0 ? `, не отмечено ${marked.unmarked}` : ''} — со счётом пока не сходится.
                  </p>
                ))}

              {data.points.map((point) => (
                <div key={point.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setReflectionPoint(point)}
                    className="flex-1 min-w-0 flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3 text-left hover:border-pb-primary/40 transition-colors"
                  >
                    <span className="font-mono font-bold text-pb-primary shrink-0">{point.ordinal}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-white truncate">
                        {point.result ? RESULT_LABEL[point.result] : 'Результат не отмечен'}
                      </span>
                      <span className="block text-[11px] text-pb-subtext mt-0.5">
                        {point.mineFilled ? 'Твоя рефлексия заполнена' : 'Твоя рефлексия не заполнена'}
                        {point.filledCount > 0 ? ` · всего ${point.filledCount}` : ''}
                        {point.captainFilled ? ' · есть разбор' : ''}
                      </span>
                    </span>
                    {point.mineFilled ? (
                      <Check size={16} className="text-pb-primary shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-pb-subtext shrink-0" />
                    )}
                  </button>

                  {data.canMarkResults && (
                    <>
                      <button
                        type="button"
                        onClick={() => void cycleResult(point)}
                        title="Отметить результат пойнта"
                        className={`shrink-0 w-11 h-11 rounded-xl border text-xs font-bold transition-colors ${
                          point.result === 'WIN'
                            ? 'bg-pb-primary text-pb-background border-pb-primary'
                            : point.result === 'LOSS'
                              ? 'bg-pb-danger/20 text-pb-danger border-pb-danger/40'
                              : 'bg-white/5 text-pb-subtext border-white/10'
                        }`}
                      >
                        {point.result === 'WIN' ? 'W' : point.result === 'LOSS' ? 'L' : '—'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptainPoint(point)}
                        title="Разбор капитана"
                        aria-label="Разбор капитана"
                        className={`shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center transition-colors ${
                          point.captainFilled
                            ? 'bg-white/10 text-pb-primary border-pb-primary/40'
                            : 'bg-white/5 text-pb-subtext border-white/10'
                        }`}
                      >
                        <ClipboardList size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {error && <p className="text-xs text-pb-danger text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export default GamePointsModal;
