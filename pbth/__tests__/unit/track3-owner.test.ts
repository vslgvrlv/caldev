import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseTeamCreationRequests } from '../../api/track3';
import { dayLabel, groupByDay, plural, sinceLabel } from '../../components/track3/format';
import ownerExt from '../../shell/ext/track3-journal';
import type { ShellExtContext } from '../../shell/extensions';
import { SectionHeader } from '../../shell/SectionHeader';
import { sectionHeadText } from '../../shell/section-head';
import { Role, type TeamContext } from '../../types';

const now = new Date('2026-11-11T12:00:00');

const ctx = (role: Role, teams: TeamContext[]): ShellExtContext => ({
  user: { id: 'u', name: 'Вася', nickname: 'vasya' } as ShellExtContext['user'],
  team: { id: 't1', name: 'Альфа', shortCode: 'ALFA', role, budget: 0 },
  teamCode: 'alfa',
  role,
  teams,
});

const own: TeamContext = { membershipId: 'm1', teamId: 't1', teamName: 'Альфа', shortCode: 'ALFA', role: Role.CAPTAIN, via: 'membership' };
const foreign: TeamContext = { membershipId: '', teamId: 't2', teamName: 'Бета', shortCode: 'BETA', role: Role.CAPTAIN, via: 'owner' };

describe('меню команды: журнал и консоль', () => {
  const journal = ownerExt.teamMenu!.find((item) => item.id === 'journal')!;
  const consoleItem = ownerExt.teamMenu!.find((item) => item.id === 'console')!;

  it('журнал — капитану (и владельцу в чужой команде), игроку и тренеру — нет', () => {
    expect(journal.visible!(ctx(Role.CAPTAIN, [own]))).toBe(true);
    expect(journal.visible!(ctx(Role.PLAYER, [own]))).toBe(false);
    expect(journal.visible!(ctx(Role.TRAINER, [own]))).toBe(false);
    expect(journal.to(ctx(Role.CAPTAIN, [own]))).toBe('/t/alfa/journal');
  });

  it('консоль — только владельцу: у него в списке есть чужие команды', () => {
    expect(consoleItem.visible!(ctx(Role.CAPTAIN, [own]))).toBe(false);
    expect(consoleItem.visible!(ctx(Role.CAPTAIN, [own, foreign]))).toBe(true);
    expect(consoleItem.to(ctx(Role.CAPTAIN, [own, foreign]))).toBe('/admin');
  });
});

describe('шапка команды владельца', () => {
  it('в чужой команде вместо «Капитан» — «Владелец платформы»', () => {
    const team = { name: 'Бета', role: Role.CAPTAIN, via: 'owner' as const };
    const text = sectionHeadText('/t/beta/roster', { now: now.getTime(), team, membersCount: 5 });
    expect(text.title).toBe('Бета');
    expect(text.subtitle).toBe('5 участников · ты владелец платформы');
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SectionHeader, {
          title: text.title,
          subtitle: text.subtitle,
          note: 'Владелец платформы',
          teams: [own, foreign],
          currentCode: 'beta',
          onPickTeam: () => {},
          onOpenTeams: () => {},
        }),
      ),
    );
    expect(html).toContain('Владелец платформы');
    expect(html).not.toContain('Капитан');
  });
});

describe('заявки на создание команды (контракт трека 1)', () => {
  it('читает список из items, requests или массива', () => {
    const one = { id: 'r1', teamName: 'Дозор', requester: { name: 'Иван', username: 'ivan' }, note: 'Нас 12', createdAt: '2026-11-10T10:00:00Z' };
    for (const body of [{ items: [one] }, { requests: [one] }, [one]]) {
      expect(parseTeamCreationRequests(body)).toEqual([
        { id: 'r1', teamName: 'Дозор', shortCode: null, requesterName: 'Иван', requesterUsername: 'ivan', note: 'Нас 12', createdAt: '2026-11-10T10:00:00Z' },
      ]);
    }
  });

  it('терпит другие имена полей и мусор', () => {
    const parsed = parseTeamCreationRequests({ items: [{ id: 7, name: 'Альфа', short_code: 'ALF', requesterName: 'Пётр' }, null, { foo: 1 }] });
    expect(parsed).toEqual([
      { id: '7', teamName: 'Альфа', shortCode: 'ALF', requesterName: 'Пётр', requesterUsername: null, note: null, createdAt: null },
    ]);
    expect(parseTeamCreationRequests({ detail: 'нет' })).toEqual([]);
  });
});

describe('даты по-русски', () => {
  it('день, давность, склонения', () => {
    expect(dayLabel('2026-11-11T08:00:00', now)).toBe('Сегодня');
    expect(dayLabel('2026-11-10T23:00:00', now)).toBe('Вчера');
    expect(dayLabel('2026-11-12T10:00:00', now)).toBe('Завтра');
    expect(sinceLabel(null, now)).toBe('давно');
    expect(sinceLabel('2026-11-08T10:00:00', now)).toBe('3 дня назад');
    expect(sinceLabel('2026-10-01T10:00:00', now)).toBe('1 месяц назад');
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, 'день', 'дня', 'дней'))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня']);
  });

  it('журнал по дням, порядок сохраняется', () => {
    const groups = groupByDay(
      [
        { at: '2026-11-11T10:00:00' },
        { at: '2026-11-11T09:00:00' },
        { at: '2026-11-10T09:00:00' },
      ],
      now,
    );
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ['Сегодня', 2],
      ['Вчера', 1],
    ]);
  });
});
