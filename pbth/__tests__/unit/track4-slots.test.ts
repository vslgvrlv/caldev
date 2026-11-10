import { describe, expect, it } from 'vitest';
import { shellExtensions } from '../../shell/extensions';
import { slotsPath } from '../../api/track4';
import {
  bookButtonLabel,
  followersLabel,
  freeSlotsLabel,
  openedLabel,
  parsePriceInput,
  slotPriceLabel,
  slotWhenLabel,
} from '../../components/track4/slot-format';
import { Role } from '../../types';

describe('трек 4: подписи открытых слотов', () => {
  it('цена и кнопка записи', () => {
    expect(slotPriceLabel(3000)).toBe('3000 ₽');
    expect(slotPriceLabel(0)).toBe('бесплатно');
    expect(bookButtonLabel(3000)).toBe('Записаться за 3000 ₽');
    expect(bookButtonLabel(0)).toBe('Записаться бесплатно');
  });

  it('места и подписчики по-русски', () => {
    expect(freeSlotsLabel(1, 2)).toBe('свободно 1 из 2');
    expect(freeSlotsLabel(0, 2)).toBe('мест нет');
    expect(openedLabel(2, 3000, 1)).toBe('Открыто 2 места по 3000 ₽, свободно 1.');
    expect(openedLabel(5, 0, 0)).toBe('Открыто 5 мест бесплатно, все заняты.');
    expect(followersLabel(0)).toBe('подписчиков пока нет');
    expect(followersLabel(3)).toBe('3 подписчика');
    expect(followersLabel(11)).toBe('11 подписчиков');
  });

  it('цена из поля ввода', () => {
    expect(parsePriceInput('3 000')).toBe(3000);
    expect(parsePriceInput('1500,50')).toBe(1500.5);
    expect(parsePriceInput('')).toBe(0);
    expect(parsePriceInput('три тысячи')).toBeNull();
    expect(parsePriceInput('-5')).toBeNull();
  });

  it('время в часовом поясе команды', () => {
    expect(slotWhenLabel('2026-11-17T17:30:00Z', 'Europe/Moscow')).toBe('вторник, 17 ноября, 20:30');
    expect(slotWhenLabel('2026-11-17T17:30:00Z', 'Asia/Yekaterinburg')).toBe('вторник, 17 ноября, 22:30');
  });

  it('адреса экрана /teams — без кода команды', () => {
    expect(slotsPath.list()).toBe('/teams');
    expect(slotsPath.team('a-b')).toBe('/teams?team=a-b');
    expect(slotsPath.event('e1')).toBe('/teams?event=e1');
  });
});

describe('трек 4 в оболочке', () => {
  const ctx = (role: Role) => ({
    user: { id: 'u', name: 'U', nickname: 'u' },
    team: { id: 't1', name: 'HG', shortCode: 'hg', role, budget: 0 },
    teamCode: 'hg',
    role,
    teams: [],
  });

  it('пункт меню «Открытое расписание» — капитану и тренеру, ведёт на страницу команды', () => {
    const item = shellExtensions.teamMenu.find((i) => i.id === 'open-schedule');
    expect(item?.label).toBe('Открытое расписание');
    expect(item?.to(ctx(Role.CAPTAIN))).toBe('/teams?team=t1');
    expect(item?.visible?.(ctx(Role.CAPTAIN))).toBe(true);
    expect(item?.visible?.(ctx(Role.TRAINER))).toBe(true);
    expect(item?.visible?.(ctx(Role.PLAYER))).toBe(false);
  });

  it('блок «Свободные слоты» в событии — только капитану и тренеру', () => {
    const block = shellExtensions.eventBlocks.find((b) => b.id === 'free-slots');
    expect(block).toBeTruthy();
    const props = (viewerRole: Role) => ({ ...ctx(viewerRole), event: {} as any, viewerRole, reload: async () => {} });
    expect(block?.visible?.(props(Role.CAPTAIN))).toBe(true);
    expect(block?.visible?.(props(Role.TRAINER))).toBe(true);
    expect(block?.visible?.(props(Role.PLAYER))).toBe(false);
  });
});
