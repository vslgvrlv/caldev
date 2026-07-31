import React, { useState } from 'react';
import { buildInsights } from '../lib/summary-insights';
import type { BreakWidth, EventSummary, EventTable, GameCombination, Rate } from '../types';
import {
  Block,
  BreakWidthGrid,
  Donut,
  Empty,
  PHASE_COLOR,
  PHASE_LABEL,
  PHASE_ORDER,
  PointRibbon,
  Waffle,
  ZONE_LABEL,
  ZoneMatrix,
  rateText,
} from './summary-charts';

// Экран разбора (#89), вторая редакция после совета 2026-07-31.
//
// Первая версия была столбиком из ~22 одинаковых полос. Проблема оказалась не в
// вёрстке, а в том, что полоса winrate на выборке из четырёх пойнтов рисует шум
// с той же уверенностью, что и настоящий сигнал, — и вся работа по поиску
// смысла оставалась на человеке.
//
// Что изменилось:
//   — сверху выводы, посчитанные кодом (lib/summary-insights.ts);
//   — форма подбирается под вопрос: кольцо для состава, матрица для «где»,
//     плитка для пары «наша ширина × их ширина», вафля для маленьких выборок,
//     лента для хода игры;
//   — до 10 наблюдений показываем счёт «4 из 7», а не процент.

const COMBINATION_LABEL: Record<GameCombination, string> = {
  ENVELOPE_ATTACK: 'Атака по конвертам',
  SNAKE_ATTACK: 'Атака по змеям',
  ACTIVE_SNAKE: 'Активная змея',
  ACTIVE_ENVELOPE: 'Активные конверты',
};

const LINE_LABEL: Record<string, string> = { snake: 'Змея', center: 'Центр', envelope: 'Конверты' };
const BREAK_WIDTH_LABEL: Record<BreakWidth, string> = { NARROW: 'узко', WIDE: 'широко' };

const deltaLabel = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

const INSIGHT_TONE: Record<string, string> = {
  good: 'border-pb-primary/40 bg-pb-primary/10',
  bad: 'border-pb-danger/40 bg-pb-danger/10',
  neutral: 'border-white/10 bg-white/5',
};

// Дельта — это шкала, а не набор категорий: от «нас на двоих меньше» до «нас на
// двоих больше». Поэтому она рисуется одной горизонтальной осью с нулём
// посередине, а не четырьмя независимыми полосами в столбик.
const DeltaScale: React.FC<{ rows: Array<{ delta: number } & Rate> }> = ({ rows }) => {
  const sorted = [...rows].sort((a, b) => a.delta - b.delta);
  const max = Math.max(...sorted.map((row) => row.total), 1);

  return (
    <div className="flex items-end gap-1">
      {sorted.map((row) => {
        const height = 20 + (row.total / max) * 44;
        const winShare = row.total > 0 ? row.wins / row.total : 0;
        return (
          <div key={row.delta} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold text-white">{rateText(row)}</span>
            {/* Высота столбика — сколько было пойнтов, заливка снизу — доля
                выигранных. Так видно и «часто», и «успешно» одновременно. */}
            <div
              className="w-full rounded-md bg-pb-danger/25 overflow-hidden flex flex-col justify-end"
              style={{ height }}
            >
              <div className="w-full bg-pb-primary" style={{ height: `${winShare * 100}%` }} />
            </div>
            <span className={`text-[11px] ${row.delta === 0 ? 'text-pb-subtext' : 'text-white'}`}>
              {row.delta === 0 ? 'ровно' : deltaLabel(row.delta)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const EventSummarySection: React.FC<{ summary: EventSummary; games?: EventTable['games'] }> = ({
  summary,
  games,
}) => {
  const [showInitiative, setShowInitiative] = useState(false);
  const { coverage, deaths, overall } = summary;
  const insights = buildInsights(summary);
  const zoneMax = Math.max(0, ...deaths.zones.flatMap((zone) => PHASE_ORDER.map((phase) => zone.byPhase[phase] ?? 0)));
  const phaseSlices = PHASE_ORDER.map((phase) => ({
    key: phase,
    value: deaths.byPhase[phase] ?? 0,
    color: PHASE_COLOR[phase],
  }));
  const maxPlayerDeaths = Math.max(1, ...summary.players.map((player) => player.eliminated));

  return (
    <div className="space-y-3">
      {/* Якорь: без winrate турнира любые проценты ниже не с чем сравнивать. */}
      <div className="bg-white/5 rounded-2xl border border-white/5 p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold text-white leading-none">
            {overall.wins}
            <span className="text-pb-subtext">:</span>
            {overall.losses}
          </div>
          <p className="text-[11px] text-pb-subtext mt-1">
            {coverage.points} пойнтов · размечено {coverage.marked}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white leading-none">
            {overall.winRate === null ? '—' : `${overall.winRate}%`}
          </div>
          <p className="text-[11px] text-pb-subtext mt-1">winrate турнира</p>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((insight) => (
            <p
              key={insight.key}
              className={`text-xs text-white leading-snug rounded-xl border px-3 py-2 ${INSIGHT_TONE[insight.tone]}`}
            >
              {insight.text}
            </p>
          ))}
        </div>
      )}

      {/* Ход турнира: серии, которые не видно ни в одном среднем. */}
      {games && games.length > 0 && (
        <Block
          title="Как шли пойнты"
          hint="Квадрат — пойнт, зелёный выигран. Полоска сверху — дельта разбежки: зелёная значит вышли в плюс."
        >
          <PointRibbon games={games} />
        </Block>
      )}

      {/* §2.1 — реализуем ли численное преимущество. Важна величина дельты:
          +1 и +2 это разные задачи, а не «в большинстве». */}
      <Block
        title="Реализация численного преимущества"
        hint={`Высота — сколько было таких пойнтов, зелёная часть — сколько выиграли. Посчитано по ${coverage.withFullSquad} пойнтам с полным составом форм.`}
      >
        {summary.deltaOtb.length === 0 ? (
          <Empty>
            Нет пойнтов, где формы заполнил весь состав — дельту не из чего считать. Обычный состав:{' '}
            {coverage.squadSize || '—'} форм на пойнт.
          </Empty>
        ) : (
          <DeltaScale rows={summary.deltaOtb} />
        )}
      </Block>

      {/* §1.1 — где выбивают. Матрица «зона × фаза» вместо 51 фигуры:
          на 75 выбиваниях по фигурам получается 1-2 наблюдения на фигуру. */}
      <Block title="Где нас выбивают" hint="Зона поля против фазы пойнта. Размер квадрата — число выбиваний.">
        {deaths.total === 0 ? (
          <Empty>Выбиваний пока не отмечено.</Empty>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Donut
                slices={phaseSlices}
                size={92}
                center={
                  <>
                    <span className="text-lg font-bold text-white leading-none">{deaths.total}</span>
                    <span className="text-[9px] text-pb-subtext mt-0.5">выбиваний</span>
                  </>
                }
              />
              <div className="flex-1 min-w-0 space-y-1">
                {PHASE_ORDER.map((phase) => {
                  const value = deaths.byPhase[phase] ?? 0;
                  return (
                    <div key={phase} className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-white truncate flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ backgroundColor: PHASE_COLOR[phase] }}
                        />
                        {PHASE_LABEL[phase]}
                      </span>
                      <span className="text-[11px] text-pb-subtext shrink-0">
                        {value}
                        {deaths.total > 0 && ` · ${Math.round((value / deaths.total) * 100)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <ZoneMatrix zones={deaths.zones} max={zoneMax} />
          </div>
        )}
      </Block>

      {/* §3.3 — узкая разбежка должна давать преимущество, особенно против
          широкой у соперника. Пара осей вместо четырёх полос в столбик. */}
      <Block title="Разбежка" hint="Наша ширина против ширины соперника. Заливка — отклонение от winrate турнира.">
        {summary.breakWidth.length === 0 ? (
          <Empty>Капитан ширину разбежки не отмечал.</Empty>
        ) : (
          <BreakWidthGrid cells={summary.breakWidth} baseline={overall.winRate} />
        )}
      </Block>

      {/* §3.2 — что разыгрывали втроём. Один квадрат = один пойнт: на выборке
          из четырёх наблюдений нельзя нарисовать убедительную длину. */}
      <Block title="Комбинации" hint="Квадрат — пойнт. Зелёный выигран, красный проигран.">
        {summary.combinations.length === 0 ? (
          <Empty>Капитан комбинации не отмечал.</Empty>
        ) : (
          <div className="space-y-3">
            {summary.combinations.map((row) => (
              <Waffle
                key={row.combination}
                label={COMBINATION_LABEL[row.combination] ?? row.combination}
                rate={row}
              />
            ))}
          </div>
        )}
      </Block>

      {/* §1.1 на уровне игрока: кольца в ряд сравниваются и по составу потерь,
          и по объёму — площадь кольца пропорциональна числу выбиваний. */}
      <Block title="Игроки" hint="Кольцо — из чего складываются потери игрока. Размер — как часто его выбивают.">
        {summary.players.length === 0 ? (
          <Empty>Форм пока никто не заполнил.</Empty>
        ) : (
          <div className="space-y-3">
            {summary.players.map((player) => (
              <div key={player.userId} className="flex items-center gap-3">
                <Donut
                  size={48}
                  scale={player.eliminated / maxPlayerDeaths}
                  slices={PHASE_ORDER.map((phase) => ({
                    key: phase,
                    value: player.deathPhases[phase] ?? 0,
                    color: PHASE_COLOR[phase],
                  }))}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-white truncate">{player.nickname || player.name}</span>
                    <span className="text-[11px] text-pb-subtext shrink-0">{player.points} пойнтов</span>
                  </div>
                  <div className="text-[11px] text-pb-subtext">
                    Выбит {player.eliminated} · киллов {player.kills}
                  </div>
                  <div className="text-[11px] text-pb-subtext">
                    {PHASE_ORDER.filter((phase) => (player.deathPhases[phase] ?? 0) > 0)
                      .map((phase) => `${PHASE_LABEL[phase].toLowerCase()} ${player.deathPhases[phase]}`)
                      .join(' · ') || 'ни разу не выбит'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Block>

      {/* §2.2 — инициатива. Девять ячеек на ~10 пойнтов с равными составами:
          сигнала там почти нет, поэтому блок свёрнут и открывается по запросу. */}
      <div className="bg-white/5 rounded-2xl border border-white/5 p-4">
        <button
          type="button"
          onClick={() => setShowInitiative((value) => !value)}
          className="w-full text-left"
          aria-expanded={showInitiative}
        >
          <h4 className="text-sm font-bold text-white">
            Инициатива в равных составах
            <span className="text-pb-subtext font-normal"> · {summary.equalSquads.points} пойнтов</span>
          </h4>
          <p className="text-[11px] text-pb-subtext mt-0.5 leading-snug">
            {showInitiative ? 'Свернуть' : 'Развернуть'} — девять ячеек на такой выборке дают наблюдения, а не выводы.
          </p>
        </button>
        {showInitiative && (
          <div className="mt-3 space-y-3">
            {summary.equalSquads.points === 0 ? (
              <Empty>Пойнтов с равными составами не было.</Empty>
            ) : (
              summary.equalSquads.lines.map((line) => (
                <div key={line.line} className="flex items-center gap-2">
                  <span className="text-[11px] text-white w-16 shrink-0">{LINE_LABEL[line.line]}</span>
                  <div className="flex-1 grid grid-cols-3 gap-1">
                    {(
                      [
                        ['забрали мы', line.ours],
                        ['поровну', line.even],
                        ['у них', line.theirs],
                      ] as const
                    ).map(([label, rate]) => (
                      <div key={label} className="rounded-lg bg-white/[0.03] px-1 py-2 text-center">
                        <div className="text-xs font-bold text-white">{rateText(rate)}</div>
                        <div className="text-[9px] text-pb-subtext truncate">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Полнота данных внизу: это не вывод о турнире, а честность о том,
          на чём посчитаны выводы выше. */}
      <p className="text-[11px] text-pb-subtext leading-snug">
        Формы игроков на {coverage.withReflections} пойнтах из {coverage.points}
        {coverage.squadSize > 0 && `, полный состав (${coverage.squadSize}) — на ${coverage.withFullSquad}`} · разбор
        капитана на {coverage.withCaptainReport}
        {summary.captainMismatch.compared > 0 &&
          ` · дельта капитана разошлась с расчётом на ${summary.captainMismatch.mismatched} из ${summary.captainMismatch.compared}`}
      </p>

      {/* Самооценка убрана из общего списка: сравнение игроков между собой на
          такой выборке ничего не значит, а публичный рейтинг «кто честнее себя
          оценивает» — способ отучить команду заполнять формы. */}
      {summary.players.some((player) => player.avgSelfRating !== null) && (
        <details className="bg-white/5 rounded-2xl border border-white/5 p-4">
          <summary className="text-sm font-bold text-white cursor-pointer">Самооценка</summary>
          <p className="text-[11px] text-pb-subtext mt-1 leading-snug">
            Смысл в разнице между общей самооценкой и самооценкой в проигранных пойнтах: она показывает, кто не
            связывает свою игру с результатом команды. Сравнивать игроков между собой по этим числам нельзя.
          </p>
          <div className="mt-3 space-y-1">
            {summary.players
              .filter((player) => player.avgSelfRating !== null)
              .map((player) => (
                <div key={player.userId} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-white truncate">{player.nickname || player.name}</span>
                  <span className="text-[11px] text-pb-subtext shrink-0">
                    {player.avgSelfRating}
                    {player.avgSelfRatingInLosses !== null && ` · в проигранных ${player.avgSelfRatingInLosses}`}
                  </span>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default EventSummarySection;
