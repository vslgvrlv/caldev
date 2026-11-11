import { describe, expect, it } from 'vitest';
import {
  TEAM_PAINTS,
  TEAM_SHAPES,
  avatarHtml,
  initialsOf,
  markTextBox,
  teamLetters,
  teamMarkSvg,
  teamPaint,
  teamShapeIndex,
} from '../../ui/team-mark';

describe('знак команды', () => {
  it('по одному id всегда одна и та же фигура и краска', () => {
    expect(teamShapeIndex('team-42')).toBe(teamShapeIndex('team-42'));
    expect(teamPaint('team-42')).toBe(teamPaint('team-42'));
    expect(teamMarkSvg({ teamId: 'team-42', name: 'Holy Guns' })).toBe(teamMarkSvg({ teamId: 'team-42', name: 'Holy Guns' }));
  });

  it('достижимы все девять фигур и все девять красок', () => {
    const shapes = new Set<number>();
    const paints = new Set<string>();
    for (let i = 0; i < 500; i++) {
      shapes.add(teamShapeIndex(i));
      paints.add(teamPaint(i));
    }
    expect(TEAM_SHAPES).toHaveLength(9);
    expect(shapes.size).toBe(9);
    expect(paints.size).toBe(TEAM_PAINTS.length);
    for (const paint of paints) expect(TEAM_PAINTS).toContain(paint);
  });

  it('две буквы: из короткого кода, иначе из названия', () => {
    expect(teamLetters('Holy Guns', 'hg')).toBe('HG');
    expect(teamLetters('Дневной Дозор')).toBe('ДД');
    // Кириллическое название с латинским кодом — буквы из названия; кириллический код берётся как есть.
    expect(teamLetters('Дневной Дозор', 'DD')).toBe('ДД');
    expect(teamLetters('Ураган', 'УР')).toBe('УР');
    expect(teamLetters('Ураган', 'URG')).toBe('УР');
    expect(teamLetters('Tornado')).toBe('TO');
    expect(teamLetters('«Сборная Москвы»')).toBe('СМ');
    expect(teamLetters('', '')).toBe('·');
  });

  it('рисуется в пикселях блока: viewBox равен размеру, без растяжения', () => {
    const svg = teamMarkSvg({ teamId: 7, name: 'Red Legion', size: 56 });
    expect(svg).toContain('width="56" height="56" viewBox="0 0 56 56"');
    expect(svg).not.toContain('preserveAspectRatio');
    expect(svg).toContain('>RL<');
  });

  it('каждая фигура даёт путь внутри квадрата', () => {
    for (const shape of TEAM_SHAPES) {
      const nums = (shape.d(100).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(nums.length).toBeGreaterThanOrEqual(6);
      for (const n of nums) expect(n).toBeLessThanOrEqual(100);
    }
  });

  it('буквы и название экранируются', () => {
    const svg = teamMarkSvg({ teamId: 1, name: '<b>"x"</b>', code: '<>' });
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('aria-label="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
    // Буквы берутся только из букв и цифр, разметке взяться неоткуда.
    expect(teamMarkSvg({ teamId: 1, name: '<>', code: '<>' })).toContain('>·<');
  });
});

describe('аватар', () => {
  it('инициалы: имя и фамилия, одно слово — две буквы', () => {
    expect(initialsOf('Артём Громов')).toBe('АГ');
    expect(initialsOf('василий')).toBe('ВА');
    expect(initialsOf('')).toBe('·');
  });

  it('круг на втором слое стекла нужного размера', () => {
    const html = avatarHtml('Кирилл Мальцев', 44);
    expect(html).toContain('ui-glass2');
    expect(html).toContain('width:44px;height:44px');
    expect(html).toContain('>КМ<');
  });
});

describe('буквы знака по шкале текста', () => {
  it('12 в ряду шапки, 14 в строке, 20 у крупного знака, 28 у огромного', async () => {
    const { markLetterSize, teamMarkSvg } = await import('../../ui/team-mark');
    expect([24, 30, 32, 40, 48, 56, 64, 72, 96].map(markLetterSize)).toEqual([12, 12, 12, 14, 14, 20, 20, 20, 28]);
    expect(teamMarkSvg({ teamId: 't', name: 'Holy Guns', size: 30 })).toContain('font-size="12"');
  });
});

// ───────── буквы одинаковы везде, фигура вмещает любые две буквы ─────────

describe('буквы знака', () => {
  it('слово в скобках не попадает в буквы; одно слово — две первые буквы', () => {
    expect(teamLetters('Гроза (тест)')).toBe('ГР');
    expect(teamLetters('Северный ветер (тест)')).toBe('СВ');
    expect(teamLetters('Holy Guns')).toBe('HG');
    expect(teamLetters('Кобры (тест)', 'КТ')).toBe('КО');
  });

  it('одно слово, один символ, разделитель-точка, цифры', () => {
    expect(teamLetters('Гроза')).toBe('ГР');
    expect(teamLetters('Ы')).toBe('Ы');
    expect(teamLetters('7')).toBe('7');
    expect(teamLetters('Тест · Гроза')).toBe('ТГ');
    expect(teamLetters('Тест. Гроза')).toBe('ТГ');
    expect(teamLetters('Команда 7')).toBe('К7');
    expect(teamLetters('7 Сорок')).toBe('7С');
    expect(teamLetters('Rock-n-Roll')).toBe('RN');
    expect(teamLetters('(тест)')).toBe('ТЕ');
    expect(teamLetters('★ ★', 'ab')).toBe('AB');
    expect(teamLetters('', '')).toBe('·');
  });

  it('команда с кодом на латинице и названием на кириллице везде даёт одни буквы', () => {
    expect(teamLetters('Гроза (тест)', 'tst-groza')).toBe(teamLetters('Гроза (тест)'));
    expect(teamLetters('Holy Guns', 'holy-guns')).toBe('HG');
    expect(teamMarkSvg({ teamId: 1, name: 'Holy Guns', code: 'holy-guns' })).toContain('>HG<');
    expect(initialsOf('Гроза (тест)')).toBe('ГР');
  });
});

/** Контур фигуры точками (кривые и дуги разбиты на отрезки) — для проверки «внутри». */
function outline(d: string): [number, number][] {
  const t = d.match(/[MLHVQAZ]|-?\d*\.?\d+/g) ?? [];
  const out: [number, number][] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd = '';
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/[A-Z]/.test(t[i])) cmd = t[i++];
    if (cmd === 'M' || cmd === 'L') {
      x = num();
      y = num();
      out.push([x, y]);
      cmd = 'L';
    } else if (cmd === 'H') {
      x = num();
      out.push([x, y]);
    } else if (cmd === 'V') {
      y = num();
      out.push([x, y]);
    } else if (cmd === 'Q') {
      const [cx, cy, ex, ey] = [num(), num(), num(), num()];
      for (let k = 1; k <= 24; k++) {
        const u = k / 24;
        out.push([(1 - u) ** 2 * x + 2 * (1 - u) * u * cx + u * u * ex, (1 - u) ** 2 * y + 2 * (1 - u) * u * cy + u * u * ey]);
      }
      x = ex;
      y = ey;
    } else if (cmd === 'A') {
      const r = num();
      num();
      num();
      const large = num();
      const sweep = num();
      const [ex, ey] = [num(), num()];
      const [mx, my, dx, dy] = [(x + ex) / 2, (y + ey) / 2, (ex - x) / 2, (ey - y) / 2];
      const dist = Math.hypot(dx, dy);
      const h = Math.sqrt(Math.max(0, r * r - dist * dist)) * (large === sweep ? -1 : 1);
      const [cx, cy] = [mx + (h * -dy) / dist, my + (h * dx) / dist];
      const a0 = Math.atan2(y - cy, x - cx);
      let da = Math.atan2(ey - cy, ex - cx) - a0;
      if (sweep === 1 && da < 0) da += 2 * Math.PI;
      if (sweep === 0 && da > 0) da -= 2 * Math.PI;
      for (let k = 1; k <= 48; k++) out.push([cx + r * Math.cos(a0 + (da * k) / 48), cy + r * Math.sin(a0 + (da * k) / 48)]);
      x = ex;
      y = ey;
    } else if (cmd === 'Z') {
      i++;
    }
  }
  return out;
}

function inside(poly: [number, number][], px: number, py: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('буквы внутри фигуры', () => {
  // Размеры знака в приложении: ряд в шапке 30, шапки экранов 32, подписки 36, строки 40, шапка состава 48, блок события 64, приглашение 96.
  const SIZES = [30, 32, 36, 40, 48, 64, 96];

  it('в наборе девять различимых фигур', () => {
    expect(TEAM_SHAPES).toHaveLength(9);
    expect(new Set(TEAM_SHAPES.map((s) => s.d(100))).size).toBe(9);
    expect(new Set(TEAM_SHAPES.map((s) => s.name)).size).toBe(9);
  });

  for (const [index, shape] of TEAM_SHAPES.entries()) {
    for (const size of SIZES) {
      for (const count of [1, 2]) {
        it(`${shape.name}, ${size}px, ${count} букв: рамка текста целиком внутри контура`, () => {
          const poly = outline(shape.d(size));
          const box = markTextBox(index, size, count);
          for (let ux = 0; ux <= 12; ux++) {
            for (let uy = 0; uy <= 12; uy++) {
              const px = box.left + ((box.right - box.left) * ux) / 12;
              const py = box.top + ((box.bottom - box.top) * uy) / 12;
              expect(inside(poly, px, py), `точка ${px.toFixed(1)}:${py.toFixed(1)} вне контура`).toBe(true);
            }
          }
        });
      }
    }
  }
});
