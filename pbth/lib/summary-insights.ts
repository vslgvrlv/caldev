import type { EventSummary, Rate } from '../types';

// Выводы, которые считает код, а не глаз тренера (#89).
//
// Совет по визуализации (2026-07-31) сошёлся на том, что экран из двух десятков
// одинаковых полос перекладывает работу на человека: он должен сам найти
// выделяющееся число и сам понять, значимо ли оно. Поэтому главные наблюдения
// формулируются здесь и выносятся наверх экрана, а картинки ниже нужны, чтобы
// вывод можно было проверить.
//
// Правило одно: не выдавать за вывод то, что укладывается в случайность.
// Турнир — это ~35 пойнтов на четыре комбинации, и любая доля из трёх
// наблюдений выглядит убедительно, не будучи знанием.

export type Insight = {
  key: string;
  tone: 'good' | 'bad' | 'neutral';
  text: string;
};

// Минимум наблюдений, при котором доля вообще рассматривается как сигнал.
const MIN_TOTAL = 6;
// Отрыв от базового winrate турнира, ниже которого это шум, а не находка.
const MIN_GAP = 15;

const COMBINATION_LABEL: Record<string, string> = {
  ENVELOPE_ATTACK: 'атака по конвертам',
  SNAKE_ATTACK: 'атака по змеям',
  ACTIVE_SNAKE: 'активная змея',
  ACTIVE_ENVELOPE: 'активные конверты',
};

const WIDTH_LABEL: Record<string, string> = { NARROW: 'узко', WIDE: 'широко' };

const ZONE_LABEL: Record<string, string> = { snake: 'в змее', center: 'в центре', envelope: 'в конвертах' };

const PHASE_LABEL: Record<string, string> = {
  BREAK: 'на разбежке',
  COVER: 'за укрытием',
  ROTATION: 'на перемещении',
};

const countText = (rate: Rate): string => `${rate.wins} из ${rate.total}`;

export function buildInsights(summary: EventSummary): Insight[] {
  const insights: Insight[] = [];
  const baseline = summary.overall.winRate;

  // 1. Реализация численного преимущества. Смотрим ровно на «плюс один»:
  // «в плюс два выигрываем» — это норма, а не вывод, а вот не дожатый +1
  // и есть то, что разбирают на тренировке.
  const plusOne = summary.deltaOtb.find((row) => row.delta === 1);
  if (plusOne && plusOne.total >= MIN_TOTAL && plusOne.winRate !== null) {
    if (plusOne.winRate < 60) {
      insights.push({
        key: 'delta-plus-one',
        tone: 'bad',
        text: `Численное преимущество не дожимаем: в плюс одного выиграно ${countText(plusOne)} пойнтов.`,
      });
    } else if (plusOne.winRate >= 75) {
      insights.push({
        key: 'delta-plus-one',
        tone: 'good',
        text: `Преимущество реализуем: в плюс одного выиграно ${countText(plusOne)} пойнтов.`,
      });
    }
  }

  // 2. Разбежка. Самая ценная пара — наша узкая против их широкой (§3.3).
  const widthPairs = [...summary.breakWidth].filter((row) => row.total >= MIN_TOTAL && row.winRate !== null);
  if (widthPairs.length >= 2 && baseline !== null) {
    const best = widthPairs.reduce((a, b) => ((a.winRate ?? 0) >= (b.winRate ?? 0) ? a : b));
    const worst = widthPairs.reduce((a, b) => ((a.winRate ?? 0) <= (b.winRate ?? 0) ? a : b));
    if ((best.winRate ?? 0) - (worst.winRate ?? 0) >= MIN_GAP * 2) {
      insights.push({
        key: 'break-width',
        tone: 'neutral',
        text:
          `Разбежка решает: мы ${WIDTH_LABEL[best.ours]} против их ${WIDTH_LABEL[best.theirs]} — ` +
          `${countText(best)}, мы ${WIDTH_LABEL[worst.ours]} против их ${WIDTH_LABEL[worst.theirs]} — ${countText(worst)}.`,
      });
    }
  }

  // 3. Комбинации. Сравниваем с базовым winrate турнира, а не друг с другом:
  // «лучшая из четырёх» на таких выборках почти всегда просто самая везучая.
  if (baseline !== null) {
    const scored = summary.combinations.filter((row) => row.total >= MIN_TOTAL && row.winRate !== null);
    const strong = scored.find((row) => (row.winRate ?? 0) - baseline >= MIN_GAP);
    const weak = scored.find((row) => baseline - (row.winRate ?? 0) >= MIN_GAP);
    if (strong) {
      insights.push({
        key: 'combination-strong',
        tone: 'good',
        text: `Работает ${COMBINATION_LABEL[strong.combination] ?? strong.combination}: ${countText(strong)} при среднем по турниру ${baseline}%.`,
      });
    }
    if (weak) {
      insights.push({
        key: 'combination-weak',
        tone: 'bad',
        text: `Не идёт ${COMBINATION_LABEL[weak.combination] ?? weak.combination}: ${countText(weak)} при среднем по турниру ${baseline}%.`,
      });
    }
  }

  // 4. Где выбивают. Ищем клетку матрицы, на которую приходится непропорционально
  // много потерь: из неё прямо следует упражнение, а не «поработать над игрой».
  if (summary.deaths.total >= 10) {
    let top: { zone: string; phase: string; value: number } | null = null;
    for (const zone of summary.deaths.zones) {
      for (const [phase, value] of Object.entries(zone.byPhase)) {
        if (!top || value > top.value) top = { zone: zone.zone, phase, value };
      }
    }
    // Девять клеток: ровное распределение дало бы 11% на клетку. Порог в 25%
    // отсекает случай, когда «самая большая» клетка просто чуть больше прочих.
    if (top && top.value / summary.deaths.total >= 0.25) {
      insights.push({
        key: 'deaths-hotspot',
        tone: 'bad',
        text: `Четверть потерь в одной точке: ${top.value} из ${summary.deaths.total} выбиваний — ${PHASE_LABEL[top.phase] ?? top.phase} ${ZONE_LABEL[top.zone] ?? top.zone}.`,
      });
    }
  }

  // 5. Покрытие. Идёт последним, но по важности первым: если форм мало, все
  // выводы выше посчитаны на обрезанных данных, и об этом надо сказать явно.
  const { points, withFullSquad, squadSize } = summary.coverage;
  if (points > 0 && squadSize > 0 && withFullSquad < points * 0.7) {
    insights.push({
      key: 'coverage',
      tone: 'neutral',
      text: `Полный состав форм собран на ${withFullSquad} пойнтах из ${points} — остальные в расчёт дельты не вошли.`,
    });
  }

  return insights;
}
