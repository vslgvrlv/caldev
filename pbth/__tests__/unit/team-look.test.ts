import { beforeEach, describe, expect, it } from 'vitest';
import {
  TEAM_PAINTS,
  defaultTeamPaint,
  defaultTeamShapeIndex,
  harvestTeamLooks,
  resetTeamLooks,
  savedTeamLook,
  setTeamLook,
  subscribeTeamLooks,
  teamLooksVersion,
  teamMarkSvg,
  teamPaint,
  teamShapeIndex,
  TEAM_SHAPES,
} from '../../ui/team-mark';
import { spotColor } from '../../ui/paint-spot';
import {
  DEFAULT_DRAFT,
  PAINT_NAMES,
  draftFromLook,
  isDefaultDraft,
  lettersOk,
  lookOfDraft,
  lookPatch,
  shownLook,
  typedLetters,
} from '../../lib/team-look';

const ID = 'team-42';
const otherPaint = TEAM_PAINTS.find((p) => p !== defaultTeamPaint(ID))!;
const otherShape = (defaultTeamShapeIndex(ID) + 1) % TEAM_SHAPES.length;

beforeEach(() => resetTeamLooks());

describe('сохранённое оформление в знаке', () => {
  it('без оформления всё как раньше: краска и фигура по id, буквы из названия', () => {
    const before = teamMarkSvg({ teamId: ID, name: 'Holy Guns' });
    expect(teamPaint(ID)).toBe(defaultTeamPaint(ID));
    expect(teamShapeIndex(ID)).toBe(defaultTeamShapeIndex(ID));
    setTeamLook(ID, null);
    setTeamLook(ID, { paint: null, shape: null, letters: null });
    expect(teamMarkSvg({ teamId: ID, name: 'Holy Guns' })).toBe(before);
    expect(savedTeamLook(ID)).toBeNull();
  });

  it('краска, фигура и буквы капитана заменяют расчёт', () => {
    setTeamLook(ID, { paint: otherPaint.toLowerCase(), shape: otherShape, letters: 'щ7' });
    expect(teamPaint(ID)).toBe(otherPaint);
    expect(teamShapeIndex(ID)).toBe(otherShape);
    const svg = teamMarkSvg({ teamId: ID, name: 'Holy Guns', size: 40 });
    expect(svg).toContain(`fill="${otherPaint}"`);
    expect(svg).toContain(`d="${TEAM_SHAPES[otherShape].d(40)}"`);
    expect(svg).toContain('>Щ7</text>');
  });

  it('заполнено одно поле — остальные считаются по умолчанию', () => {
    setTeamLook(ID, { shape: otherShape });
    expect(teamPaint(ID)).toBe(defaultTeamPaint(ID));
    expect(teamMarkSvg({ teamId: ID, name: 'Holy Guns' })).toContain('>HG</text>');
  });

  it('чужая краска, фигура вне ряда и разметка в буквах в знак не попадают', () => {
    setTeamLook(ID, { paint: '#000000', shape: 12, letters: '<b' });
    expect(savedTeamLook(ID)).toBeNull();
    setTeamLook(ID, { paint: 'url(x)', shape: 1.5, letters: 'ABC' });
    expect(teamPaint(ID)).toBe(defaultTeamPaint(ID));
    const svg = teamMarkSvg({ teamId: ID, name: 'Holy Guns', look: { letters: '"/><script>' } });
    expect(svg).not.toContain('script');
  });

  it('пятно краски за стеклом идёт за краской команды', () => {
    setTeamLook(ID, { paint: otherPaint });
    expect(spotColor(teamPaint(ID))).toBe(spotColor(otherPaint));
  });

  it('оформление из пропса важнее сохранённого (живой знак в настройке)', () => {
    setTeamLook(ID, { paint: otherPaint });
    const svg = teamMarkSvg({ teamId: ID, name: 'Holy Guns', look: null });
    expect(svg).toContain(`fill="${defaultTeamPaint(ID)}"`);
  });

  it('подписчики узнают о смене, повтор того же значения их не будит', () => {
    let calls = 0;
    const off = subscribeTeamLooks(() => (calls += 1));
    const v = teamLooksVersion();
    setTeamLook(ID, { shape: otherShape });
    setTeamLook(ID, { shape: otherShape });
    expect(calls).toBe(1);
    expect(teamLooksVersion()).toBe(v + 1);
    setTeamLook(ID, null);
    expect(calls).toBe(2);
    off();
  });
});

describe('оформление из ответов сервера', () => {
  it('команда, список команд, события, приглашение и слот', () => {
    harvestTeamLooks({
      team: { id: 'a', name: 'A', look: { paint: TEAM_PAINTS[1], shape: 2, letters: null } },
      teams: [
        { teamId: 'a', look: { paint: TEAM_PAINTS[1], shape: 2, letters: null } },
        { teamId: 'b', look: null },
      ],
      events: [{ id: 'e1', teamId: 'c', teamLook: { paint: null, shape: 4, letters: 'CC' } }],
    });
    harvestTeamLooks({ teamId: 'd', teamName: 'D', teamLook: { paint: TEAM_PAINTS[3], shape: null, letters: null } });
    expect(teamPaint('a')).toBe(TEAM_PAINTS[1]);
    expect(teamShapeIndex('a')).toBe(2);
    expect(savedTeamLook('b')).toBeNull();
    expect(teamShapeIndex('c')).toBe(4);
    expect(savedTeamLook('e1')).toBeNull();
    expect(teamPaint('d')).toBe(TEAM_PAINTS[3]);
  });

  it('look: null снимает прежнее оформление, ответ без поля его не трогает', () => {
    setTeamLook('a', { shape: 3 });
    harvestTeamLooks({ teams: [{ teamId: 'a', teamName: 'A' }] });
    expect(teamShapeIndex('a')).toBe(3);
    harvestTeamLooks({ teams: [{ teamId: 'a', look: null }] });
    expect(savedTeamLook('a')).toBeNull();
  });

  it('старый ответ и мусор не ломают разбор', () => {
    expect(() => harvestTeamLooks(null)).not.toThrow();
    expect(() => harvestTeamLooks({ team: { id: 'a', look: 'red' }, teams: 'x', n: 1 })).not.toThrow();
    expect(savedTeamLook('a')).toBeNull();
  });
});

describe('шторка оформления', () => {
  it('черновик из сохранённого и показ с расчётом по умолчанию', () => {
    expect(draftFromLook(null)).toEqual(DEFAULT_DRAFT);
    const shown = shownLook(ID, 'Holy Guns', 'hg', DEFAULT_DRAFT);
    expect(shown).toEqual({ paint: defaultTeamPaint(ID), shape: defaultTeamShapeIndex(ID), letters: 'HG' });
    expect(shownLook(ID, 'Holy Guns', 'hg', { paint: otherPaint, shape: otherShape, letters: 'Я' })).toEqual({
      paint: otherPaint,
      shape: otherShape,
      letters: 'Я',
    });
  });

  it('буквы в поле: заглавные, не больше двух, пробелы убираются', () => {
    expect(typedLetters('hg')).toBe('HG');
    expect(typedLetters(' а б в ')).toBe('АБ');
    expect(lettersOk('')).toBe(true);
    expect(lettersOk('Щ7')).toBe(true);
    expect(lettersOk('A!')).toBe(false);
    expect(lookOfDraft({ paint: null, shape: null, letters: 'A!' }).letters).toBeNull();
  });

  it('на сервер уходят только изменённые поля; пустые буквы — сброс', () => {
    const saved = draftFromLook({ paint: otherPaint, shape: 2, letters: 'HG' });
    expect(lookPatch(saved, saved)).toBeNull();
    expect(lookPatch(saved, { ...saved, shape: 5 })).toEqual({ shape: 5 });
    expect(lookPatch(saved, { ...saved, letters: '' })).toEqual({ letters: null });
    expect(lookPatch(saved, DEFAULT_DRAFT)).toEqual({ paint: null, shape: null, letters: null });
    expect(isDefaultDraft(DEFAULT_DRAFT)).toBe(true);
    expect(isDefaultDraft(saved)).toBe(false);
  });

  it('у каждой краски есть название для подписи', () => {
    expect(PAINT_NAMES).toHaveLength(TEAM_PAINTS.length);
  });
});
