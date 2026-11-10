import { describe, expect, it } from 'vitest';
import { decideInitTeam } from '../../shell/team-switch';
import { Role, type TeamContext } from '../../types';

// Совместимость со старым сервером: он не знает `/init?team=` и отдаёт
// команду из сессии. Тогда переключаем сессию прежней ручкой /auth/context.
const teams: TeamContext[] = [
  { membershipId: 'm-a', teamId: 't-a', teamName: 'Alpha', shortCode: 'DTA', role: Role.PLAYER },
  { membershipId: 'm-b', teamId: 't-b', teamName: 'Beta', shortCode: 'DTB', role: Role.PLAYER },
];

describe('decideInitTeam', () => {
  it('новый сервер отдал команду из адреса — ничего не делаем', () => {
    expect(decideInitTeam('dtb', { team: { id: 't-b', shortCode: 'DTB' }, teams })).toEqual({ kind: 'match' });
  });

  it('команда не запрошена — подходит любая', () => {
    expect(decideInitTeam('', { team: { id: 't-a', shortCode: 'DTA' }, teams })).toEqual({ kind: 'match' });
  });

  it('старый сервер отдал другую команду — переключаем сессию на нужную', () => {
    expect(decideInitTeam('dtb', { team: { id: 't-a', shortCode: 'DTA' }, teams })).toEqual({
      kind: 'switch',
      membershipId: 'm-b',
    });
  });

  it('команда в адресе по id тоже находится', () => {
    expect(decideInitTeam('t-b', { team: { id: 't-a', shortCode: 'DTA' }, teams })).toEqual({
      kind: 'switch',
      membershipId: 'm-b',
    });
  });

  it('человек не в этой команде — нет доступа', () => {
    expect(decideInitTeam('zzz', { team: { id: 't-a', shortCode: 'DTA' }, teams })).toEqual({ kind: 'forbidden' });
  });

  it('команда владельца без членства (новый сервер) — переключать нечем', () => {
    const ownerTeams = [...teams, { membershipId: null as unknown as string, teamId: 't-c', teamName: 'C', shortCode: 'C', role: Role.CAPTAIN }];
    expect(decideInitTeam('c', { team: { id: 't-a', shortCode: 'DTA' }, teams: ownerTeams })).toEqual({ kind: 'forbidden' });
  });
});
