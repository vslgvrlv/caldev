import React from 'react';
import type { Rate } from '../types';

// Формы для экрана разбора (#89). Словарь подобран под вопрос, а не под моду:
// для части-от-целого — кольцо, для «где именно» — матрица, для маленьких
// выборок — плитка «один квадрат = один пойнт», для хода игры — лента.
//
// Почему не библиотека графиков: chart-библиотеки заточены под ряды из сотен
// точек и дают оси, тултипы и легенды, которых здесь нечего показывать. Турнир
// это 35 пойнтов и 75 выбиваний — всё рисуется div'ами и парой <circle>.

// Ниже этого числа наблюдений процент не показываем вовсе: «85% из трёх
// пойнтов» выглядит как знание, но это гадание.
export const MIN_SAMPLE = 5;

export const PHASE_ORDER = ['BREAK', 'COVER', 'ROTATION'] as const;
export const PHASE_LABEL: Record<string, string> = {
  BREAK: 'На разбежке',
  COVER: 'За укрытием',
  ROTATION: 'На перемещении',
};
export const PHASE_COLOR: Record<string, string> = {
  BREAK: '#FF1744',
  COVER: '#FF6D00',
  ROTATION: '#FFEA00',
};
export const ZONE_LABEL: Record<string, string> = { snake: 'Змея', center: 'Центр', envelope: 'Конверты' };

// Счёт «4 из 7» вместо «57%», пока выборка мала: доля из семи наблюдений
// меняется на 14 пунктов от одного пойнта, и процент это скрывает.
export const rateText = (rate: Rate): string =>
  rate.total === 0
    ? '—'
    : rate.total < 10
      ? `${rate.wins} из ${rate.total}`
      : `${rate.winRate}% · ${rate.total}`;

export const Block: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children,
}) => (
  <div className="bg-white/5 rounded-2xl border border-white/5 p-4 space-y-3">
    <div>
      <h4 className="text-sm font-bold text-white">{title}</h4>
      {hint && <p className="text-[11px] text-pb-subtext mt-0.5 leading-snug">{hint}</p>}
    </div>
    {children}
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-pb-subtext italic">{children}</p>
);

/**
 * Кольцо для части-от-целого. Радиус растёт от объёма (sqrt, чтобы сравнивалась
 * площадь, а не радиус), поэтому пять колец игроков рядом читаются и по составу,
 * и по тому, кого вообще чаще выбивают.
 */
export const Donut: React.FC<{
  slices: Array<{ key: string; value: number; color: string }>;
  size: number;
  scale?: number;
  center?: React.ReactNode;
}> = ({ slices, size, scale = 1, center }) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const stroke = Math.max(4, size * 0.18);
  // Внешний размер фиксирован, а сам круг ужимается по объёму: так кольца
  // в ряду остаются выровненными по сетке.
  const radius = ((size - stroke) / 2) * Math.max(0.35, Math.sqrt(scale));
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        {total > 0 &&
          slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return element;
          })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
          {center}
        </div>
      )}
    </div>
  );
};

/**
 * Матрица «зона × фаза». Кодируется размером квадрата, а не цветом: размер
 * человек сравнивает точнее оттенка, а клеток всего девять.
 */
export const ZoneMatrix: React.FC<{
  zones: Array<{ zone: string; total: number; byPhase: Record<string, number> }>;
  max: number;
}> = ({ zones, max }) => (
  <div className="space-y-2">
    <div className="grid grid-cols-[52px_repeat(3,1fr)] gap-1 items-end">
      <span />
      {PHASE_ORDER.map((phase) => (
        <span key={phase} className="text-[9px] uppercase tracking-wide text-pb-subtext text-center leading-tight">
          {phase === 'BREAK' ? 'разбежка' : phase === 'COVER' ? 'укрытие' : 'перемещ.'}
        </span>
      ))}
    </div>
    {zones.map((zone) => (
      <div key={zone.zone} className="grid grid-cols-[52px_repeat(3,1fr)] gap-1 items-center">
        <span className="text-[11px] text-white truncate">{ZONE_LABEL[zone.zone] ?? zone.zone}</span>
        {PHASE_ORDER.map((phase) => {
          const value = zone.byPhase[phase] ?? 0;
          // Пустая клетка — тоже ответ: «здесь нас не выбивают».
          const side = max > 0 && value > 0 ? 32 + Math.sqrt(value / max) * 20 : 0;
          return (
            <div
              key={phase}
              className="h-[52px] rounded-lg bg-white/[0.03] flex items-center justify-center"
              title={`${ZONE_LABEL[zone.zone] ?? zone.zone} · ${PHASE_LABEL[phase]}: ${value}`}
            >
              {value > 0 ? (
                <div
                  className="rounded-md flex items-center justify-center text-[11px] font-bold text-black"
                  style={{ width: side, height: side, backgroundColor: PHASE_COLOR[phase] }}
                >
                  {value}
                </div>
              ) : (
                <span className="text-[11px] text-white/15">·</span>
              )}
            </div>
          );
        })}
      </div>
    ))}
  </div>
);

/**
 * Плитка 2×2 для разбежки. Диагональ «мы узко / они широко» против «мы широко /
 * они узко» видно мгновенно, а в столбике из четырёх полос она терялась.
 */
export const BreakWidthGrid: React.FC<{
  cells: Array<{ ours: string; theirs: string } & Rate>;
  baseline: number | null;
}> = ({ cells, baseline }) => {
  const at = (ours: string, theirs: string) => cells.find((c) => c.ours === ours && c.theirs === theirs);
  const order: Array<[string, string]> = [
    ['NARROW', 'NARROW'],
    ['NARROW', 'WIDE'],
    ['WIDE', 'NARROW'],
    ['WIDE', 'WIDE'],
  ];

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[48px_1fr_1fr] gap-1">
        <span />
        <span className="text-[9px] uppercase tracking-wide text-pb-subtext text-center">они узко</span>
        <span className="text-[9px] uppercase tracking-wide text-pb-subtext text-center">они широко</span>
      </div>
      {(['NARROW', 'WIDE'] as const).map((ours) => (
        <div key={ours} className="grid grid-cols-[48px_1fr_1fr] gap-1 items-stretch">
          <span className="text-[11px] text-white self-center">мы {ours === 'NARROW' ? 'узко' : 'широко'}</span>
          {order
            .filter(([o]) => o === ours)
            .map(([o, theirs]) => {
              const cell = at(o, theirs);
              // Заливка — отклонение от winrate турнира: сама по себе доля
              // ничего не говорит, пока не с чем сравнить.
              const diff = cell && cell.winRate !== null && baseline !== null ? cell.winRate - baseline : null;
              const tone =
                diff === null
                  ? 'rgba(255,255,255,0.03)'
                  : diff >= 0
                    ? `rgba(0,230,118,${Math.min(0.45, 0.08 + Math.abs(diff) / 120)})`
                    : `rgba(255,23,68,${Math.min(0.45, 0.08 + Math.abs(diff) / 120)})`;

              return (
                <div
                  key={theirs}
                  className="rounded-lg px-2 py-3 text-center border border-white/5"
                  style={{ backgroundColor: tone }}
                >
                  <div className="text-sm font-bold text-white">{cell ? rateText(cell) : '—'}</div>
                  <div className="text-[10px] text-pb-subtext">
                    {!cell ? 'не было' : cell.total < 10 ? 'пойнтов' : ''}
                  </div>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
};

/**
 * Вафля: один квадрат — один пойнт. На четырёх наблюдениях нельзя нарисовать
 * убедительную длину, поэтому предупреждение «мало данных» не нужно словами —
 * оно нарисовано.
 */
export const Waffle: React.FC<{ label: string; rate: Rate }> = ({ label, rate }) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-white truncate">{label}</span>
      <span className="text-xs font-bold text-white shrink-0">{rateText(rate)}</span>
    </div>
    <div className="flex flex-wrap gap-[3px]">
      {Array.from({ length: rate.total }, (_, index) => (
        <span
          key={index}
          className={`w-3 h-3 rounded-[3px] ${index < rate.wins ? 'bg-pb-primary' : 'bg-pb-danger/70'}`}
        />
      ))}
      {rate.total === 0 && <span className="text-[11px] text-pb-subtext italic">не размечено</span>}
    </div>
  </div>
);

/**
 * Лента пойнтов по игрым. Ни один агрегат не показывает серий: winrate 51%
 * одинаков и для «ровно чередовались», и для «три подряд слили и вернулись».
 */
export const PointRibbon: React.FC<{
  games: Array<{
    gameId: string;
    opponent: string;
    score: string | null;
    points: Array<{ pointId: string; ordinal: number; result: string | null; deltaOtb: number; submitted: number }>;
  }>;
}> = ({ games }) => (
  <div className="space-y-2">
    {games.map((game) => (
      <div key={game.gameId} className="flex items-center gap-2">
        <span className="text-[11px] text-white w-24 truncate shrink-0">{game.opponent}</span>
        <div className="flex gap-1 flex-1 min-w-0">
          {game.points.map((point) => (
            <div
              key={point.pointId}
              className="flex-1 min-w-0 flex flex-col items-center gap-[2px]"
              title={`Пойнт ${point.ordinal} · ${
                point.result === 'WIN' ? 'выигран' : point.result === 'LOSS' ? 'проигран' : 'не размечен'
              } · дельта ${point.deltaOtb > 0 ? `+${point.deltaOtb}` : point.deltaOtb}`}
            >
              {/* Засечка сверху — дельта разбежки: видно, выигран ли пойнт
                  «по игре» или его отдали ещё до начала. */}
              <span
                className={`h-[3px] w-full rounded-full ${
                  point.submitted === 0
                    ? 'bg-white/10'
                    : point.deltaOtb > 0
                      ? 'bg-pb-primary/60'
                      : point.deltaOtb < 0
                        ? 'bg-pb-danger/60'
                        : 'bg-white/25'
                }`}
              />
              <span
                className={`h-5 w-full rounded ${
                  point.result === 'WIN'
                    ? 'bg-pb-primary'
                    : point.result === 'LOSS'
                      ? 'bg-pb-danger/70'
                      : 'bg-white/10'
                }`}
              />
            </div>
          ))}
        </div>
        <span className="text-[11px] text-pb-subtext w-8 text-right shrink-0">{game.score ?? '—'}</span>
      </div>
    ))}
  </div>
);
