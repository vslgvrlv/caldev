import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hasSectionHead, markTarget, sectionHeadText, sectionPaints, shouldCompact, teamScreenRows } from '../../shell/section-head';
import { contrastRatio, glassOverSpot, MIN_CONTRAST, MUTED_TEXT, paintStrength, parseHex, spotColor, SPOT_PEAK } from '../../ui/paint-spot';
import { TEAM_PAINTS, teamPaint } from '../../ui/team-mark';
import { treasuryRowSub } from '../../lib/treasury-view';
import { formatRub } from '../../lib/format-rub';
import { TeamView } from '../../views/TeamView';
import { paintVars } from '../../shell/TeamShell';
import { Role, type Event, type TeamContext } from '../../types';

const now = new Date('2026-11-11T12:00:00').getTime();
const team = { id: 't1', name: 'Holy Guns', role: Role.PLAYER };

describe('шапка раздела: где есть и что написано', () => {
  it('разделы с шапкой: Моё, Календарь, Команда, Казна, журнал, Профиль; запись и заявки — без неё', () => {
    for (const path of ['/t/hg', '/t/hg/calendar', '/t/hg/roster', '/t/hg/money', '/t/hg/journal', '/me']) {
      expect(hasSectionHead(path)).toBe(true);
    }
    for (const path of ['/t/hg/event/e1', '/t/hg/new', '/t/hg/roster/u1', '/t/hg/requests', '/teams']) {
      expect(hasSectionHead(path)).toBe(false);
    }
  });

  it('«Моё» вместо «Главной»: название и дата; календарь — месяц; команда — её название и состав', () => {
    expect(sectionHeadText('/t/hg', { now })).toEqual({ title: 'Моё', subtitle: 'ср, 11 ноября' });
    expect(sectionHeadText('/t/hg/calendar', { now })).toEqual({ title: 'Календарь', subtitle: 'ноябрь 2026' });
    expect(sectionHeadText('/t/hg/roster', { now, team, membersCount: 12 })).toEqual({
      title: 'Holy Guns',
      subtitle: '12 участников · ты игрок',
    });
    expect(sectionHeadText('/t/hg/money', { now, team })).toEqual({ title: 'Казна', subtitle: 'Holy Guns' });
    expect(sectionHeadText('/me', { now })).toEqual({ title: 'Профиль' });
  });

  it('знак команды ведёт в тот же раздел другой команды, из профиля — на «Моё» команды', () => {
    expect(markTarget('/t/hg/calendar', 'dd')).toBe('/t/dd/calendar');
    expect(markTarget('/t/hg/roster', 'dd')).toBe('/t/dd/roster');
    expect(markTarget('/t/hg', 'dd')).toBe('/t/dd');
    expect(markTarget('/me', 'dd')).toBe('/t/dd');
  });

  it('строка шапки не ломается: не помещается — «Команды» без подписи, место появилось — подпись возвращается', () => {
    // 390 px: панель 358, внутри 326. «Команды» с подписью ~124 px, без подписи 44 px, значки по 44 px.
    expect(shouldCompact({ rowWidth: 326, titleWidth: 74, toolsWidth: 124, labelWidth: 80, compact: false })).toBe(false);
    expect(shouldCompact({ rowWidth: 326, titleWidth: 74, toolsWidth: 124 + 132, labelWidth: 80, compact: false })).toBe(true);
    expect(shouldCompact({ rowWidth: 326, titleWidth: 200, toolsWidth: 124, labelWidth: 80, compact: false })).toBe(true);
    // Уже без подписи: решение считается по полной ширине, поэтому не мигает.
    expect(shouldCompact({ rowWidth: 326, titleWidth: 74, toolsWidth: 44 + 132, labelWidth: 80, compact: true })).toBe(true);
    expect(shouldCompact({ rowWidth: 326, titleWidth: 74, toolsWidth: 44, labelWidth: 80, compact: true })).toBe(false);
  });

  it('пункты меню команды — строками на экране команды, без повторов «Заявок» и «Консоли»', () => {
    const rows = teamScreenRows([
      { id: 'requests', label: 'Заявки в команду', to: '/t/hg/requests' },
      { id: 'journal', label: 'Журнал команды', to: '/t/hg/journal' },
      { id: 'open-schedule', label: 'Открытое расписание', to: '/teams/t1' },
      { id: 'console', label: 'Консоль владельца', to: '/admin' },
    ]);
    expect(rows).toEqual([
      { id: 'journal', label: 'Журнал команды', to: '/t/hg/journal', icon: 'history' },
      { id: 'open-schedule', label: 'Открытое расписание', to: '/teams/t1', icon: 'calendar-days' },
    ]);
  });
});

describe('краски за стеклом', () => {
  it('палитра знаков — девять ярких красок макета, teamPaint выдаёт только их и все', () => {
    expect([...TEAM_PAINTS]).toEqual(['#FF8A1F', '#4FC3F7', '#FF6B57', '#A58BFF', '#FFD23F', '#FF6FB0', '#F2F3F5', '#D9B98A', '#4F7CFF']);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) seen.add(teamPaint(`team-${i}`));
    expect([...seen].sort()).toEqual([...TEAM_PAINTS].sort());
  });

  it('пятно каждой краски заметное и приглушённый текст на стекле над ним держит 4,5', () => {
    for (const paint of TEAM_PAINTS) {
      const strength = paintStrength(paint);
      // Светлые краски (белая, жёлтая) упираются в контраст раньше: 0,21 и 0,25; остальные — 0,29…0,32.
      expect(strength, paint).toBeGreaterThanOrEqual(['#F2F3F5', '#FFD23F'].includes(paint) ? 0.2 : 0.29);
      expect(strength, paint).toBeLessThanOrEqual(SPOT_PEAK);
      expect(contrastRatio(parseHex(MUTED_TEXT)!, glassOverSpot(paint, strength)), paint).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    // Тёмные краски берут полную силу, белая — слабее.
    expect(paintStrength('#4F7CFF')).toBe(SPOT_PEAK);
    expect(paintStrength('#F2F3F5')).toBeLessThan(SPOT_PEAK);
  });

  it('переменная краски — цвет с альфой ослабления; мусор не превращается в цвет', () => {
    expect(spotColor('#4F7CFF')).toBe('rgb(79 124 255 / 1)');
    expect(spotColor('#F2F3F5')).toMatch(/^rgb\(242 243 245 \/ 0\.\d+\)$/);
    expect(spotColor('red')).toBe('red');
  });

  it('обёртка раздела задаёт все три пятна, недостающие — прозрачные', () => {
    expect(paintVars(['#4F7CFF'])).toEqual({
      '--ui-paint-1': 'rgb(79 124 255 / 1)',
      '--ui-paint-2': 'transparent',
      '--ui-paint-3': 'transparent',
    });
  });

  it('«Моё» — краска команды ближайшего события; разделы команды — её краска и второе пятно ниже; профиль — свои команды', () => {
    const ev = (id: string, teamId: string, start: string) =>
      ({ id, teamId, title: id, type: 'TRAINING', startDate: new Date(start), location: '', attendees: [] }) as unknown as Event;
    const paintOf = (id: string) => ({ a: '#FF8A1F', b: '#4FC3F7', c: '#FF6B57' })[id] ?? '#F2F3F5';
    const events = [ev('2', 'b', '2026-11-13T19:00:00'), ev('1', 'a', '2026-11-11T20:30:00')];
    const teams: TeamContext[] = [
      { membershipId: 'm1', teamId: 'c', teamName: 'C', shortCode: 'C', role: Role.PLAYER },
      { membershipId: 'm2', teamId: 'a', teamName: 'A', shortCode: 'A', role: Role.PLAYER },
      { membershipId: '', teamId: 'x', teamName: 'X', shortCode: 'X', role: Role.CAPTAIN, via: 'owner' },
    ];
    expect(sectionPaints('/t/c', { now, events, team: { id: 'c' }, teams, paintOf })).toEqual(['#FF8A1F', '#4FC3F7']);
    expect(sectionPaints('/t/c', { now, events: [], team: { id: 'c' }, teams, paintOf })).toEqual(['#FF6B57', '#FF6B57']);
    expect(sectionPaints('/t/c/roster', { now, events, team: { id: 'c' }, teams, paintOf })).toEqual(['#FF6B57', '#FF6B57']);
    expect(sectionPaints('/t/c/calendar', { now, events, team: { id: 'c' }, teams, paintOf })).toEqual(['#FF6B57', '#FF6B57']);
    expect(sectionPaints('/me', { now, events, team: { id: 'c' }, teams, paintOf })).toEqual(['#FF6B57', '#FF8A1F']);
  });
});

describe('строка «Казна» на экране команды', () => {
  const members = [
    { id: 'me', name: 'Я', balance: -1500 },
    { id: 'p2', name: 'Он', balance: 0 },
  ];
  it('капитану — остаток казны, игроку — свой долг или «долгов нет», без данных — без подписи', () => {
    expect(treasuryRowSub({ role: Role.CAPTAIN, budget: 32000, members, currentUserId: 'me', formatRub })).toBe('остаток 32 000 ₽');
    expect(treasuryRowSub({ role: Role.PLAYER, budget: 0, members, currentUserId: 'me', formatRub })).toBe('твой долг 1 500 ₽');
    expect(treasuryRowSub({ role: Role.PLAYER, budget: 0, members, currentUserId: 'p2', formatRub })).toBe('долгов нет');
    expect(treasuryRowSub({ role: Role.TRAINER, budget: 0, members: [{ id: 'me', name: 'Я' }], currentUserId: 'me', formatRub })).toBeUndefined();
  });

  it('экран команды: «Казна» над составом и пункты меню строками', () => {
    const html = renderToStaticMarkup(
      React.createElement(TeamView, {
        team: { id: 't1', name: 'Holy Guns', shortCode: 'HG', role: Role.CAPTAIN, budget: 32000 },
        members: [],
        currentUserRole: Role.CAPTAIN,
        onMemberClick: () => {},
        onUpdateMemberStatus: () => {},
        onRemoveMember: () => {},
        treasury: { sub: 'остаток 32 000 ₽', onOpen: () => {} },
        menuRows: [{ id: 'journal', label: 'Журнал команды', icon: 'history', onOpen: () => {} }],
      }),
    );
    expect(html).toContain('Казна');
    expect(html).toContain('остаток 32 000 ₽');
    expect(html).toContain('Журнал команды');
    expect(html.indexOf('Казна')).toBeLessThan(html.indexOf('Журнал команды'));
    // Название команды — в шапке раздела, на самом экране не повторяется.
    expect(html).not.toContain('Holy Guns');
  });
});
