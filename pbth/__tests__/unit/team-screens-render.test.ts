import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlayerStatus, Role, type TeamMember } from '../../types';
import { TeamView } from '../../views/TeamView';
import { PlayerProfileView } from '../../views/PlayerProfileView';
import { ProfileView } from '../../views/ProfileView';

vi.mock('../../components/ProfileIdentities', () => ({ ProfileIdentities: () => null }));
vi.mock('../../shell/context', () => ({ useShell: () => ({ team: null, user: null, canEnterAdmin: false }) }));

const people: TeamMember[] = [
  { id: 'c', name: 'Артём Громов', nickname: 'cap', role: Role.CAPTAIN, status: PlayerStatus.ACTIVE, phone: '+79990000000' },
  { id: 'p', name: 'Кирилл Мальцев', nickname: 'kir', role: Role.PLAYER, status: PlayerStatus.INJURED },
];

const roster = (role: Role, onOpenRequests?: () => void) =>
  renderToStaticMarkup(
    React.createElement(TeamView, {
      team: { id: 't1', name: 'Holy Guns', shortCode: 'HG', role, budget: 0 },
      members: people,
      currentUserRole: role,
      currentUserId: 'p',
      onOpenRequests,
      onMemberClick: () => {},
      onUpdateMemberStatus: () => {},
      onRemoveMember: () => {},
    }),
  );

describe('состав: что видит каждая роль', () => {
  it('капитан: заявки, ссылка, управление участником; роли по-русски, без ников', () => {
    const html = roster(Role.CAPTAIN, () => {});
    expect(html).toContain('Заявки');
    expect(html).toContain('Пригласить');
    expect(html).toContain('Управление участником Артём Громов');
    expect(html).toContain('Капитан');
    expect(html).toContain('Руководство');
    expect(html).toContain('Резерв');
    // Число участников и роль — в подписи шапки раздела (оболочка), на экране их нет.
    expect(html).not.toContain('2 участника · ты капитан');
    expect(html).toContain('placeholder="Поиск игрока"');
    expect(html).toContain('Игрок · Травма');
    expect(html).toContain('· ты');
    expect(html).not.toMatch(/CAPTAIN|PLAYER|@cap|ui-avatars/);
  });

  it('тренер: заявки и ссылка есть, управления участником нет', () => {
    const html = roster(Role.TRAINER, () => {});
    expect(html).toContain('Пригласить');
    expect(html).not.toContain('Управление участником');
  });

  it('игрок: ни заявок, ни ссылки, ни управления', () => {
    const html = roster(Role.PLAYER, () => {});
    expect(html).not.toContain('Пригласить');
    expect(html).not.toContain('Заявки');
    expect(html).not.toContain('Управление участником');
    expect(html).toContain('Артём Громов');
  });
});

describe('карточка игрока', () => {
  const card = (canManage: boolean) =>
    renderToStaticMarkup(
      React.createElement(PlayerProfileView, {
        member: { ...people[1], balance: -1500, stats: { attendanceRate: 50, eventsAttended: 1, totalEvents: 2, mvpCount: 0, matchesPlayed: 0 } },
        teamName: 'Holy Guns',
        onBack: () => {},
        canManage,
      }),
    );

  it('сумма с минусом и неразрывным пробелом; служебной строки нет', () => {
    const html = card(false);
    expect(html).toContain('−1 500 ₽');
    expect(html).not.toContain('Источник данных');
    expect(html).not.toContain('Управление игроком');
  });

  it('действия капитана — только при canManage', () => {
    const html = card(true);
    expect(html).toContain('Управление игроком');
    expect(html).toContain('Исключить из команды');
  });
});

describe('профиль', () => {
  it('«Мои команды» с ролью по-русски, без команд владельца; выход есть', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProfileView, {
        user: { id: 'u', name: 'Василий Гаврилов', nickname: 'vasily_g' },
        onLogout: () => {},
        calendarLink: 'https://example.test/c.ics',
        onCopyLink: () => {},
        onShareLink: () => {},
        onDownloadICS: () => {},
        role: Role.PLAYER,
        teams: [
          { membershipId: 'm1', teamId: 't1', teamName: 'Holy Guns', shortCode: 'HG', role: Role.PLAYER },
          { membershipId: 'm2', teamId: 't2', teamName: 'Чужая', shortCode: 'XX', role: Role.ADMIN, via: 'owner' },
        ],
      }),
    );
    expect(html).toContain('Мои команды');
    expect(html).toContain('Holy Guns');
    expect(html).not.toContain('Чужая');
    expect(html).toContain('Выйти');
    expect(html).not.toContain('Консоль владельца');
    expect(html).not.toContain('ui-avatars');
  });
});
