import { describe, expect, it } from 'vitest';
import { buildInsights } from '../../lib/summary-insights';
import type { EventSummary, Rate } from '../../types';

// Выводы наверху экрана тренер повторяет команде вслух. Ошибка здесь — это не
// кривой пиксель, а неверное утверждение о том, как команда играла, поэтому
// главное правило вынесено в тесты: не выдавать шум за находку.

const rate = (wins: number, losses: number): Rate => {
  const total = wins + losses;
  return { wins, losses, total, winRate: total ? Math.round((wins / total) * 100) : null };
};

const summary = (over: Partial<EventSummary> = {}): EventSummary => ({
  coverage: { points: 35, marked: 35, withReflections: 33, withCaptainReport: 31, squadSize: 5, withFullSquad: 33 },
  overall: rate(18, 17),
  deltaOtb: [],
  equalSquads: { points: 0, lines: [] },
  combinations: [],
  breakWidth: [],
  deaths: {
    total: 0,
    byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 },
    zones: [
      { zone: 'snake', total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
      { zone: 'center', total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
      { zone: 'envelope', total: 0, byPhase: { BREAK: 0, COVER: 0, ROTATION: 0 } },
    ],
  },
  players: [],
  captainMismatch: { compared: 0, mismatched: 0 },
  ...over,
});

const keys = (result: ReturnType<typeof buildInsights>) => result.map((insight) => insight.key);

describe('buildInsights', () => {
  it('видит недожатое численное преимущество', () => {
    const result = buildInsights(summary({ deltaOtb: [{ delta: 1, ...rate(5, 7) }] }));

    expect(keys(result)).toContain('delta-plus-one');
    expect(result[0]).toMatchObject({ tone: 'bad' });
    expect(result[0].text).toContain('5 из 12');
  });

  it('молчит про дельту, когда наблюдений мало', () => {
    // Три пойнта в плюс одного — это не «не дожимаем», это три пойнта.
    const result = buildInsights(summary({ deltaOtb: [{ delta: 1, ...rate(1, 2) }] }));

    expect(keys(result)).not.toContain('delta-plus-one');
  });

  it('сравнивает комбинацию с winrate турнира, а не с другими комбинациями', () => {
    // Обе комбинации выше «лучшей из списка» ничего не значат, если обе близки
    // к среднему: разрыв должен быть с базовой линией турнира.
    const near = buildInsights(
      summary({
        overall: rate(18, 17),
        combinations: [
          { combination: 'SNAKE_ATTACK', ...rate(6, 6) },
          { combination: 'ENVELOPE_ATTACK', ...rate(5, 5) },
        ],
      })
    );
    expect(keys(near)).not.toContain('combination-strong');

    const apart = buildInsights(
      summary({
        overall: rate(18, 17),
        combinations: [
          { combination: 'SNAKE_ATTACK', ...rate(10, 2) },
          { combination: 'ENVELOPE_ATTACK', ...rate(2, 8) },
        ],
      })
    );
    expect(keys(apart)).toEqual(expect.arrayContaining(['combination-strong', 'combination-weak']));
  });

  it('называет точку, где команда теряет игроков', () => {
    const result = buildInsights(
      summary({
        deaths: {
          total: 40,
          byPhase: { BREAK: 20, COVER: 15, ROTATION: 5 },
          zones: [
            { zone: 'snake', total: 20, byPhase: { BREAK: 18, COVER: 2, ROTATION: 0 } },
            { zone: 'center', total: 15, byPhase: { BREAK: 2, COVER: 10, ROTATION: 3 } },
            { zone: 'envelope', total: 5, byPhase: { BREAK: 0, COVER: 3, ROTATION: 2 } },
          ],
        },
      })
    );

    const hotspot = result.find((insight) => insight.key === 'deaths-hotspot');
    expect(hotspot?.text).toContain('на разбежке в змее');
    expect(hotspot?.text).toContain('18 из 40');
  });

  it('не называет горячую точку, когда потери распределены ровно', () => {
    const even = 5;
    const result = buildInsights(
      summary({
        deaths: {
          total: 45,
          byPhase: { BREAK: 15, COVER: 15, ROTATION: 15 },
          zones: (['snake', 'center', 'envelope'] as const).map((zone) => ({
            zone,
            total: 15,
            byPhase: { BREAK: even, COVER: even, ROTATION: even },
          })),
        },
      })
    );

    expect(keys(result)).not.toContain('deaths-hotspot');
  });

  it('предупреждает, когда формы собраны не со всего состава', () => {
    const result = buildInsights(
      summary({
        coverage: { points: 35, marked: 35, withReflections: 20, withCaptainReport: 30, squadSize: 5, withFullSquad: 12 },
      })
    );

    const coverage = result.find((insight) => insight.key === 'coverage');
    expect(coverage?.text).toContain('12 пойнтах из 35');
  });

  it('на пустом событии не выдумывает выводов', () => {
    expect(buildInsights(summary({ overall: rate(0, 0), coverage: { points: 0, marked: 0, withReflections: 0, withCaptainReport: 0, squadSize: 0, withFullSquad: 0 } }))).toEqual([]);
  });
});
