import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, ClipboardList, ChevronRight, Users } from 'lucide-react';
import { api } from '../api';
import { ReflectionModal } from './ReflectionModal';
import { CaptainReportModal } from './CaptainReportModal';
import { GameScoreLine } from './GameScoreLine';
import { PointRosterModal } from './PointRosterModal';
import type { Game, GamePoint, GamePointsResponse, PointResult } from '../types';

// Выбор пойнта — вход в рефлексию (#89). Гейм со счётом 4:3 это семь пойнтов,
// и форма заполняется за каждый: без этого экрана игрок отвечал бы за весь матч
// сразу, а семь разных эпизодов схлопывались в один.
//
// Пойнты создаёт сервер из счёта гейма. Из счёта известно только СКОЛЬКО побед,
// но не в каком порядке — порядок размечает капитан тапом по результату.

type Props = {
  game: Game;
  /** Имя своей команды — чтобы в шапке было видно, чей счёт слева. */
  teamName: string;
  isOpen: boolean;
  onClose: () => void;
};

const RESULT_LABEL: Record<PointResult, string> = { WIN: 'Выиграли', LOSS: 'Проиграли' };

// Тап по результату гоняет по кругу: не размечен → выиграли → проиграли.
const nextResult = (current: PointResult | null): PointResult | null =>
  current === null ? 'WIN' : current === 'WIN' ? 'LOSS' : null;

export const GamePointsModal: React.FC<Props> = ({ game, teamName, isOpen, onClose }) => {
  const [data, setData] = useState<GamePointsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflectionPoint, setReflectionPoint] = useState<GamePoint | null>(null);
  const [captainPoint, setCaptainPoint] = useState<GamePoint | null>(null);
  const [rosterPoint, setRosterPoint] = useState<GamePoint | null>(null);

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
    setRosterPoint(null);
    void load();
  };

  if (reflectionPoint) {
    return <ReflectionModal isOpen game={game} point={reflectionPoint} onClose={closeChild} />;
  }
  if (captainPoint) {
    return <CaptainReportModal isOpen game={game} point={captainPoint} onClose={closeChild} />;
  }
  if (rosterPoint && data) {
    // Предзаполнение берём с предыдущего пойнта: между пойнтами меняется
    // один-два человека, и заново набирать пятёрку капитан не станет.
    const previous = data.points.find((p) => p.ordinal === rosterPoint.ordinal - 1);
    return (
      <PointRosterModal
        isOpen
        point={rosterPoint}
        previousRoster={previous?.roster ?? []}
        candidates={data.candidates}
        onClose={() => setRosterPoint(null)}
        onSaved={closeChild}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <p className="text-pb-subtext text-xs">{game.time}</p>
            <button type="button" onClick={onClose} className="text-xs text-pb-subtext shrink-0">
              Закрыть
            </button>
          </div>
          <div className="mt-2">
            <GameScoreLine teamName={teamName} opponent={game.opponent} score={game.score} size="md" />
          </div>
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
                <div key={point.id} className="flex items-stretch gap-2">
                  {/* Результат пойнта — первое, что делает капитан, поэтому кнопка
                      стоит слева, а не третьей справа, как было. Игроку показывается
                      тот же бейдж, только не нажимается. */}
                  <button
                    type="button"
                    onClick={() => void cycleResult(point)}
                    disabled={!data.canMarkResults}
                    title={data.canMarkResults ? 'Отметить результат пойнта' : 'Результат отмечает капитан'}
                    className={`shrink-0 w-14 rounded-xl border flex flex-col items-center justify-center leading-none transition-colors disabled:cursor-default ${
                      point.result === 'WIN'
                        ? 'bg-pb-primary text-pb-background border-pb-primary'
                        : point.result === 'LOSS'
                          ? 'bg-pb-danger/20 text-pb-danger border-pb-danger/40'
                          : 'bg-white/5 text-pb-subtext border-white/10'
                    }`}
                  >
                    <span className="font-mono text-[10px] opacity-70">{point.ordinal}</span>
                    <span className="text-sm font-bold mt-0.5">
                      {point.result === 'WIN' ? 'W' : point.result === 'LOSS' ? 'L' : '—'}
                    </span>
                  </button>

                  {/* Не выходил на пойнт — форма не открывается (#102). Пока
                      состава нет, mineInRoster = true, и старые события ведут
                      себя как раньше. */}
                  <button
                    type="button"
                    onClick={() => setReflectionPoint(point)}
                    disabled={!point.mineInRoster}
                    className={`flex-1 min-w-0 flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-3 text-left transition-colors ${
                      point.mineInRoster ? 'hover:border-pb-primary/40' : 'opacity-40 cursor-default'
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-white">
                        Пойнт {point.ordinal}
                        {point.result ? ` · ${RESULT_LABEL[point.result]}` : ''}
                      </span>
                      <span className="block text-[11px] text-pb-subtext mt-0.5">
                        {!point.mineInRoster
                          ? 'Ты не выходил на этот пойнт'
                          : point.mineFilled
                            ? 'Твоя рефлексия заполнена'
                            : 'Твоя рефлексия не заполнена'}
                        {point.filledCount > 0 ? ` · всего ${point.filledCount}` : ''}
                        {point.roster.length > 0 ? ` из ${point.roster.length}` : ''}
                        {point.captainFilled ? ' · есть разбор' : ''}
                      </span>
                    </span>
                    {point.mineFilled ? (
                      <Check size={16} className="text-pb-primary shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-pb-subtext shrink-0" />
                    )}
                  </button>

                  {data.canEditRoster && (
                    <button
                      type="button"
                      onClick={() => setRosterPoint(point)}
                      title="Состав пойнта"
                      aria-label="Состав пойнта"
                      className={`shrink-0 w-11 rounded-xl border flex items-center justify-center transition-colors ${
                        point.roster.length > 0
                          ? 'bg-white/10 text-pb-primary border-pb-primary/40'
                          : 'bg-white/5 text-pb-subtext border-white/10'
                      }`}
                    >
                      <Users size={16} />
                    </button>
                  )}

                  {data.canMarkResults && (
                    <button
                      type="button"
                      onClick={() => setCaptainPoint(point)}
                      title="Разбор капитана"
                      aria-label="Разбор капитана"
                      className={`shrink-0 w-11 rounded-xl border flex items-center justify-center transition-colors ${
                        point.captainFilled
                          ? 'bg-white/10 text-pb-primary border-pb-primary/40'
                          : 'bg-white/5 text-pb-subtext border-white/10'
                      }`}
                    >
                      <ClipboardList size={16} />
                    </button>
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
