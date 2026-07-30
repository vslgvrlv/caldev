import type { FieldPosition } from '../types';

// Раскладка схемы поля (спека §7.4.1). Геометрия правилась несколько раз, поэтому
// живёт отдельно от рендера и покрыта тестом.
//
// Три правила:
//  1. Глубина растёт от СВОЕЙ базы → половина противника зеркальна по вертикали.
//  2. Тысячный числовой ряд рисуется один раз, на центре: он общий.
//  3. Ряды Z4/K4 пустые в середине — это не дырка, а геометрия: глубже 500 на
//     своей половине стоят только фланговые фигуры.

export const FIELD_DEPTHS = [1, 10, 100, 1000] as const;

export type FieldRow = {
  key: string;
  left?: FieldPosition;
  right?: FieldPosition;
  grid: FieldPosition[];
};

export type FieldLayout = {
  far: FieldRow[];
  center: FieldPosition[];
  near: FieldRow[];
};

function buildRow(positions: FieldPosition[], side: 'NEAR' | 'FAR', depth: number, swapped: boolean): FieldRow {
  const flank = (group: 'snake' | 'envelope') =>
    positions.find((p) => p.group === group && p.side === side && p.depth === depth);
  return {
    key: `${side}-${depth}`,
    // Перестановка чисто визуальная: id фигуры от неё не меняется, Z1 остаётся Z1.
    left: swapped ? flank('envelope') : flank('snake'),
    right: swapped ? flank('snake') : flank('envelope'),
    grid: positions.filter((p) => p.group === 'grid' && p.side === side && p.depth === depth),
  };
}

export function buildFieldLayout(positions: FieldPosition[], swapped: boolean): FieldLayout {
  return {
    // Сверху база противника: у них глубина растёт вниз, к центру.
    far: FIELD_DEPTHS.map((depth) => buildRow(positions, 'FAR', depth, swapped)),
    center: positions.filter((p) => p.side === 'CENTER'),
    // Снизу наша база: у нас глубина растёт вверх, поэтому порядок обратный.
    near: [...FIELD_DEPTHS].reverse().map((depth) => buildRow(positions, 'NEAR', depth, swapped)),
  };
}
