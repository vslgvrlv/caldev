import { describe, expect, it } from 'vitest';
import { buildFieldLayout } from '../../lib/field-schema-layout';
import type { FieldPosition } from '../../types';

// Каталог собираем так же, как его отдаёт миграция 028: 51 позиция.
function catalog(): FieldPosition[] {
  const items: FieldPosition[] = [];
  const push = (
    group: FieldPosition['group'],
    index: string,
    side: FieldPosition['side'],
    code: string,
    depth: number
  ) =>
    items.push({
      id: `${group}.${index}.${side.toLowerCase()}`,
      group,
      index,
      side,
      code,
      // В каталоге код несёт суффикс половины (1Б/1Д), на кнопке он лишний —
      // здесь коды без суффикса, поэтому shortCode совпадает с code.
      shortCode: code,
      depth,
      label: code,
      active: true,
    });

  const grid = [
    [1, ['1', '2', '3', '4', '5']],
    [10, ['10', '20', '30', '40', '50']],
    [100, ['100', '200', '300', '400', '500']],
  ] as const;
  for (const [depth, numbers] of grid) {
    for (const n of numbers) {
      push('grid', n, 'NEAR', n, depth);
      push('grid', n, 'FAR', n, depth);
    }
  }
  for (const n of ['1000', '2000', '3000', '4000', '5000']) {
    push('grid', n, 'CENTER', n, 1000);
  }
  for (const [i, depth] of [1, 10, 100, 1000].entries()) {
    push('snake', String(i + 1), 'NEAR', `Z${i + 1}Б`, depth);
    push('snake', String(i + 1), 'FAR', `Z${i + 1}Д`, depth);
    push('envelope', String(i + 1), 'NEAR', `K${i + 1}Б`, depth);
    push('envelope', String(i + 1), 'FAR', `K${i + 1}Д`, depth);
  }
  return items;
}

describe('buildFieldLayout', () => {
  // Главная правка Василия по прототипу: тумблер Б/Д рисовал чужую половину как
  // свою. Глубина растёт от своей базы — значит половина Д зеркальна.
  it('половина противника идёт от их базы вглубь, наша — наоборот', () => {
    const { far, near } = buildFieldLayout(catalog(), false);
    expect(far.map((r) => r.grid.map((p) => p.code))).toEqual([
      ['1', '2', '3', '4', '5'],
      ['10', '20', '30', '40', '50'],
      ['100', '200', '300', '400', '500'],
      [],
    ]);
    expect(near.map((r) => r.grid.map((p) => p.code))).toEqual([
      [],
      ['100', '200', '300', '400', '500'],
      ['10', '20', '30', '40', '50'],
      ['1', '2', '3', '4', '5'],
    ]);
  });

  // «Нашей 3000» и «их 3000» не существует: тысячный ряд один на всё поле.
  it('тысячный числовой ряд один, на центре, без флангов', () => {
    const { center, far, near } = buildFieldLayout(catalog(), false);
    expect(center.map((p) => p.code)).toEqual(['1000', '2000', '3000', '4000', '5000']);
    expect(far.concat(near).flatMap((r) => r.grid).some((p) => p.depth === 1000)).toBe(false);
  });

  // Z4/K4 при этом сторонние: на глубинной линии половины стоят только фланги.
  it('в дальнем ряду половины остаются только Z4 и K4', () => {
    const { far, near } = buildFieldLayout(catalog(), false);
    expect([far[3].left?.code, far[3].right?.code]).toEqual(['Z4Д', 'K4Д']);
    expect([near[0].left?.code, near[0].right?.code]).toEqual(['Z4Б', 'K4Б']);
  });

  it('змея слева, конверты справа; тап по ⇄ меняет их местами и только их', () => {
    const straight = buildFieldLayout(catalog(), false);
    const swapped = buildFieldLayout(catalog(), true);

    expect([straight.near[3].left?.code, straight.near[3].right?.code]).toEqual(['Z1Б', 'K1Б']);
    expect([swapped.near[3].left?.code, swapped.near[3].right?.code]).toEqual(['K1Б', 'Z1Б']);
    // Числовой ряд перестановка не трогает — она про фланги.
    expect(swapped.near[3].grid.map((p) => p.code)).toEqual(straight.near[3].grid.map((p) => p.code));
    // id фигуры визуальная перестановка не меняет: Z1 остаётся Z1.
    expect(swapped.near[3].right?.id).toBe(straight.near[3].left?.id);
  });

  it('вся схема — 51 клетка', () => {
    const { far, center, near } = buildFieldLayout(catalog(), false);
    const cells = [...far, ...near].reduce(
      (sum, row) => sum + row.grid.length + (row.left ? 1 : 0) + (row.right ? 1 : 0),
      center.length
    );
    expect(cells).toBe(51);
  });
});
