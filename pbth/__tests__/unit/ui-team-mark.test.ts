import { describe, expect, it } from 'vitest';
import {
  TEAM_PAINTS,
  TEAM_SHAPES,
  avatarHtml,
  initialsOf,
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
    expect(svg).toContain('&lt;&gt;');
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
