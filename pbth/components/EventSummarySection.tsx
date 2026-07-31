import React from 'react';
import type { BreakWidth, EventSummary, GameCombination, Rate } from '../types';

// Экран разбора (#89). Не графики, а ответы на вопросы спеки: турнир даёт ~50
// пойнтов на четыре комбинации и три состояния дельты, и любой график на таких
// числах покажет шум, который выглядит как вывод.
//
// Поэтому каждая цифра идёт с размером выборки, а выборка меньше MIN_SAMPLE
// помечается явно: «85% из трёх пойнтов» — это не знание.

const MIN_SAMPLE = 5;

const COMBINATION_LABEL: Record<GameCombination, string> = {
  ENVELOPE_ATTACK: 'Атака по конвертам',
  SNAKE_ATTACK: 'Атака по змеям',
  ACTIVE_SNAKE: 'Активная змея',
  ACTIVE_ENVELOPE: 'Активные конверты',
};

const BREAK_WIDTH_LABEL: Record<BreakWidth, string> = { NARROW: 'узко', WIDE: 'широко' };

const LINE_LABEL: Record<string, string> = { snake: 'Змея', center: 'Центр', envelope: 'Конверты' };

const deltaLabel = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

// Полоса winrate: глазами сравнивать проценты в столбик тяжело, а ширина
// читается мгновенно. Полупрозрачная, когда наблюдений мало.
const RateBar: React.FC<{ rate: Rate; label: string }> = ({ rate, label }) => {
  const thin = rate.total < MIN_SAMPLE;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-white truncate">{label}</span>
        <span className={`text-xs font-bold shrink-0 ${thin ? 'text-pb-subtext' : 'text-white'}`}>
          {rate.winRate === null ? '—' : `${rate.winRate}%`}
          <span className="text-pb-subtext font-normal"> · {rate.total}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full ${thin ? 'bg-pb-primary/30' : 'bg-pb-primary'}`}
          style={{ width: `${rate.winRate ?? 0}%` }}
        />
      </div>
    </div>
  );
};

const Block: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="bg-white/5 rounded-2xl border border-white/5 p-4 space-y-3">
    <div>
      <h4 className="text-sm font-bold text-white">{title}</h4>
      {hint && <p className="text-[11px] text-pb-subtext mt-0.5 leading-snug">{hint}</p>}
    </div>
    {children}
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-pb-subtext italic">{children}</p>
);

export const EventSummarySection: React.FC<{ summary: EventSummary }> = ({ summary }) => {
  const { coverage } = summary;
  const hasThinSample = [
    ...summary.deltaOtb,
    ...summary.combinations,
    ...summary.breakWidth,
  ].some((rate) => rate.total > 0 && rate.total < MIN_SAMPLE);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-pb-subtext leading-snug">
        {coverage.points} пойнтов · размечено {coverage.marked} · с формами игроков {coverage.withReflections} · с
        разбором капитана {coverage.withCaptainReport}
      </p>

      {hasThinSample && (
        <p className="text-[11px] text-pb-warning leading-snug">
          Часть цифр посчитана меньше чем на {MIN_SAMPLE} пойнтах — читать как наблюдение, а не как вывод. Они
          выделены бледным.
        </p>
      )}

      {/* §2.1 — главный вопрос: реализуем ли преимущество. Важна величина
          дельты, а не факт «в большинстве»: +1 и +3 это разные задачи. */}
      <Block
        title="Реализация численного преимущества"
        hint="Winrate по величине дельты разбежки. +2 — нас на двоих больше после разбежки."
      >
        {summary.deltaOtb.length === 0 ? (
          <Empty>Нет пойнтов с заполненными формами — дельту не из чего считать.</Empty>
        ) : (
          summary.deltaOtb.map((row) => (
            <RateBar
              key={row.delta}
              rate={row}
              label={row.delta === 0 ? 'Равные составы' : `Дельта ${deltaLabel(row.delta)}`}
            />
          ))
        )}
      </Block>

      {/* §2.2 — инициатива различает пойнты только там, где численность равна. */}
      <Block
        title="Инициатива в равных составах"
        hint={`Кто первым занял ключевые укрытия по линии. Пойнтов с равной дельтой: ${summary.equalSquads.points}.`}
      >
        {summary.equalSquads.points === 0 ? (
          <Empty>Пойнтов с равными составами не было.</Empty>
        ) : (
          summary.equalSquads.lines.map((line) => (
            <div key={line.line} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-pb-subtext">{LINE_LABEL[line.line]}</div>
              <RateBar rate={line.ours} label="Забрали мы" />
              <RateBar rate={line.theirs} label="Забрал соперник" />
              <RateBar rate={line.even} label="Поровну" />
            </div>
          ))
        )}
      </Block>

      {/* §3.2 — куда эффективнее играть втроём. */}
      <Block title="Комбинации" hint="Что разыгрывали и чем это заканчивалось.">
        {summary.combinations.length === 0 ? (
          <Empty>Капитан комбинации не отмечал.</Empty>
        ) : (
          summary.combinations.map((row) => (
            <RateBar key={row.combination} rate={row} label={COMBINATION_LABEL[row.combination] ?? row.combination} />
          ))
        )}
      </Block>

      {/* §3.3 — узкая разбежка должна давать численное преимущество,
          особенно против широкой у соперника. */}
      <Block title="Разбежка" hint="Наша ширина против ширины соперника.">
        {summary.breakWidth.length === 0 ? (
          <Empty>Капитан ширину разбежки не отмечал.</Empty>
        ) : (
          summary.breakWidth.map((row) => (
            <RateBar
              key={`${row.ours}-${row.theirs}`}
              rate={row}
              label={`Мы ${BREAK_WIDTH_LABEL[row.ours]} · они ${BREAK_WIDTH_LABEL[row.theirs]}`}
            />
          ))
        )}
      </Block>

      {/* §1.1 — где игрока выбивают. Плюс самооценка: расхождение общей и
          «в проигранных» показывает, кто не связывает свою игру с результатом. */}
      <Block title="Игроки" hint="Где выбивают, сколько отстреливают, как себя оценивают.">
        {summary.players.length === 0 ? (
          <Empty>Форм пока никто не заполнил.</Empty>
        ) : (
          summary.players.map((player) => (
            <div key={player.userId} className="border-t border-white/5 first:border-t-0 pt-3 first:pt-0 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-white truncate">{player.nickname || player.name}</span>
                <span className="text-[11px] text-pb-subtext shrink-0">{player.points} пойнтов</span>
              </div>
              <div className="text-[11px] text-pb-subtext">
                Выбит {player.eliminated} — на разбежке {player.deathPhases.BREAK ?? 0}, за укрытием{' '}
                {player.deathPhases.COVER ?? 0}, на перемещении {player.deathPhases.ROTATION ?? 0}
              </div>
              <div className="text-[11px] text-pb-subtext">
                Киллов {player.kills}
                {player.avgSelfRating !== null && ` · самооценка ${player.avgSelfRating}`}
                {player.avgSelfRatingInLosses !== null && ` · в проигранных ${player.avgSelfRatingInLosses}`}
              </div>
            </div>
          ))
        )}
      </Block>

      {/* Капитан оценивает дельту сам, а расчёт идёт из форм игроков.
          Расхождение — это либо кто-то не заполнил, либо разное понимание пойнта. */}
      {summary.captainMismatch.compared > 0 && (
        <Block title="Капитан против расчёта" hint="Дельта из форм игроков против дельты, которую поставил капитан.">
          <p className="text-xs text-white">
            Разошлось {summary.captainMismatch.mismatched} из {summary.captainMismatch.compared} пойнтов
            {summary.captainMismatch.mismatched > 0 && (
              <span className="text-pb-subtext">
                {' '}
                — либо кто-то не заполнил форму, либо пойнт помнят по-разному.
              </span>
            )}
          </p>
        </Block>
      )}
    </div>
  );
};

export default EventSummarySection;
