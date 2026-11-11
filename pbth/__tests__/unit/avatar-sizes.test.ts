import { describe, expect, it } from 'vitest';
import { avatarHtml } from '../../ui/team-mark';

// Аватары входа, главной, события и казны (до 72px) не должны измениться от крупного размера в профиле.
describe('avatarHtml: размер букв', () => {
  const fontOf = (size: number) => /font-size:(\d+)px/.exec(avatarHtml('Иван Петров', size))![1];
  it('до 80px размеры прежние', () => {
    expect([24, 32, 40, 48, 56, 72].map(fontOf)).toEqual(['12', '12', '14', '14', '20', '20']);
  });
  it('крупный аватар — буквы 28px, верхняя ступень шкалы текста', () => {
    expect(fontOf(96)).toBe('28');
  });
});
