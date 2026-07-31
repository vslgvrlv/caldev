import React, { useEffect, useState } from 'react';
import { Loader2, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api';
import type { BreakWidth, EventTable, EventTablePoint, GameCombination, ReflectionPhase } from '../types';

// Таблица разбора по событию (#89) — то место, где тренер читает результат и
// забирает его в работу. Экран телефона узкий, поэтому «таблица» здесь —
// список пойнтов с раскрытием; настоящая таблица уезжает в CSV.

const COMBINATION_LABEL: Record<GameCombination, string> = {
  ENVELOPE_ATTACK: 'Атака по конвертам',
  SNAKE_ATTACK: 'Атака по змеям',
  ACTIVE_SNAKE: 'Активная змея',
  ACTIVE_ENVELOPE: 'Активные конверты',
};

const BREAK_WIDTH_LABEL: Record<BreakWidth, string> = { NARROW: 'узкая', WIDE: 'широкая' };

const PHASE_LABEL: Record<ReflectionPhase, string> = {
  BREAK: 'на разбежке',
  COVER: 'за укрытием',
  ROTATION: 'на перемещении',
};

const INITIATIVE_LABEL = (value: number | null): string =>
  value === null ? '—' : value > 0 ? 'мы' : value < 0 ? 'они' : 'поровну';

type Props = {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
};

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

const PointRow: React.FC<{ point: EventTablePoint; positions: Record<string, string> }> = ({ point, positions }) => {
  const [open, setOpen] = useState(false);
  const report = point.captainReport;
  const position = (id: string | null) => (id ? (positions[id] ?? '?') : '—');

  return (
    <div className="border-t border-white/5 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-3 py-3 text-left"
      >
        <span className="font-mono font-bold text-pb-primary w-5 shrink-0">{point.ordinal}</span>
        <span
          className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${
            point.result === 'WIN'
              ? 'bg-pb-primary/20 text-pb-primary'
              : point.result === 'LOSS'
                ? 'bg-pb-danger/20 text-pb-danger'
                : 'bg-white/5 text-pb-subtext'
          }`}
        >
          {point.result === 'WIN' ? 'W' : point.result === 'LOSS' ? 'L' : '—'}
        </span>
        <span className="flex-1 min-w-0 text-xs text-pb-subtext">
          {/* Дельта по формам игроков — это факт, дельта капитана — его оценка.
              Показываем обе: расхождение и есть предмет разбора. */}
          ОТБ {signed(point.deltaOtb)} · сдали {point.submitted}
          {point.deltaOtbMismatch && <span className="text-pb-warning"> · капитан {signed(report?.deltaOtb ?? 0)}</span>}
        </span>
        {open ? (
          <ChevronDown size={14} className="text-pb-subtext shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-pb-subtext shrink-0" />
        )}
      </button>

      {open && (
        <div className="pb-4 pl-8 space-y-3 text-xs">
          <div className="text-pb-subtext">
            Мы потеряли на разбежке {point.ourOtbLosses}, соперник {point.opponentOtbLosses}.
          </div>

          {report ? (
            <div className="bg-white/5 rounded-xl p-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-pb-subtext">Разбор капитана</div>
              <div className="text-white">
                {report.combination ? COMBINATION_LABEL[report.combination] : 'Комбинация не указана'}
              </div>
              <div className="text-pb-subtext">
                Разбежка: мы {report.breakWidth ? BREAK_WIDTH_LABEL[report.breakWidth] : '—'}, они{' '}
                {report.opponentBreakWidth ? BREAK_WIDTH_LABEL[report.opponentBreakWidth] : '—'}
              </div>
              <div className="text-pb-subtext">
                Инициатива: змея {INITIATIVE_LABEL(report.initiative.snake)}, центр{' '}
                {INITIATIVE_LABEL(report.initiative.center)}, конверты {INITIATIVE_LABEL(report.initiative.envelope)}
              </div>
              {report.note && <div className="text-white/80 pt-1">{report.note}</div>}
            </div>
          ) : (
            <div className="text-pb-subtext italic">Капитан пойнт ещё не разобрал</div>
          )}

          {point.reflections.length === 0 ? (
            <div className="text-pb-subtext italic">Рефлексий по пойнту нет</div>
          ) : (
            point.reflections.map((reflection) => (
              <div key={reflection.userId} className="bg-white/5 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white truncate">{reflection.nickname || reflection.name}</span>
                  {reflection.selfRating !== null && (
                    <span className="text-[10px] font-bold text-pb-primary shrink-0">
                      самооценка {reflection.selfRating}
                    </span>
                  )}
                </div>
                <div className="text-pb-subtext">
                  {reflection.eliminated
                    ? `Выбит ${reflection.deathPhase ? PHASE_LABEL[reflection.deathPhase] : ''} · ${position(reflection.deathPositionId)}`
                    : 'Дожил до конца'}
                </div>
                <div className="text-pb-subtext">
                  {reflection.kills.length === 0
                    ? 'Киллов нет'
                    : `Киллы: ${reflection.kills
                        .map((kill) => `${PHASE_LABEL[kill.phase]} · ${position(kill.positionId)}`)
                        .join('; ')}`}
                </div>
                {reflection.note && <div className="text-white/80">{reflection.note}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export const EventTableModal: React.FC<Props> = ({ eventId, isOpen, onClose }) => {
  const [table, setTable] = useState<EventTable | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Внутри Telegram файл уходит в чат: скачивание там открывает файл окном
  // поверх приложения, из которого нет пути назад (Василий, 2026-07-31).
  const inTelegram = Boolean((window as any).Telegram?.WebApp?.initData);

  const exportCsv = async () => {
    setIsExporting(true);
    setError(null);
    setExportNote(null);
    try {
      if (inTelegram) {
        await api.sendEventTableCsv(eventId);
        setExportNote('Файл отправлен в чат с ботом.');
      } else {
        await api.downloadEventTableCsv(eventId, `Разбор — ${table?.eventTitle ?? 'событие'}.csv`);
      }
    } catch {
      setError('Не удалось выгрузить CSV');
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api
      .getEventTable(eventId)
      .then((data) => {
        if (!cancelled) setTable(data);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить таблицу');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, eventId]);

  if (!isOpen) return null;

  const hasPoints = table?.games.some((game) => game.points.length > 0) ?? false;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-lg bg-pb-surface rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-pb-surface border-b border-white/5 px-5 py-4 z-10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white truncate">Таблица разбора</h3>
            <p className="text-pb-subtext text-xs mt-0.5 truncate">{table?.eventTitle ?? ''}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-pb-subtext shrink-0 pt-1">
            Закрыть
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && (
            <div className="flex justify-center py-10 text-pb-subtext">
              <Loader2 className="animate-spin" size={22} />
            </div>
          )}

          {!isLoading && table && !hasPoints && (
            <p className="text-sm text-pb-subtext">
              Пойнтов пока нет. Они появятся, когда у геймов будет проставлен счёт.
            </p>
          )}

          {!isLoading &&
            table?.games.map((game) => (
              <div key={game.gameId} className="bg-white/5 rounded-2xl border border-white/5 px-4 py-2">
                <div className="flex items-baseline justify-between gap-2 py-2">
                  <span className="font-bold text-white text-sm truncate">{game.opponent}</span>
                  <span className="text-xs text-pb-subtext shrink-0">
                    {game.time}
                    {game.score ? ` · ${game.score}` : ''}
                  </span>
                </div>
                {game.points.length === 0 ? (
                  <p className="text-xs text-pb-subtext italic pb-3">Счёт не проставлен — пойнтов нет</p>
                ) : (
                  game.points.map((point) => (
                    <PointRow key={point.pointId} point={point} positions={table.positions} />
                  ))
                )}
              </div>
            ))}

          {error && <p className="text-xs text-pb-danger text-center">{error}</p>}

          {/* Выгрузка — то, ради чего таблица и нужна: дальше с ней работают вне приложения. */}
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={isExporting}
            className="w-full p-4 rounded-xl font-bold bg-pb-primary text-pb-background flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            {inTelegram ? 'Прислать CSV в чат' : 'Скачать CSV'}
          </button>
          {exportNote && <p className="text-xs text-pb-primary text-center">{exportNote}</p>}
        </div>
      </div>
    </div>
  );
};

export default EventTableModal;
