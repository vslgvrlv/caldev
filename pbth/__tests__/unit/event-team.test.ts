import { describe, expect, it } from 'vitest';
import { resolveEventTeamName } from '../../lib/event-team';

const active = { id: 'team-a', name: 'Alpha' };
const teams = [
  { teamId: 'team-a', teamName: 'Alpha' },
  { teamId: 'team-b', teamName: 'Beta' },
];

describe('resolveEventTeamName', () => {
  it('событие другой команды — её название, а не активной', () => {
    expect(resolveEventTeamName({ teamId: 'team-b', teamName: 'Beta' }, teams, active)).toBe('Beta');
  });

  it('без имени в событии — ищем по списку команд человека', () => {
    expect(resolveEventTeamName({ teamId: 'team-b' }, teams, active)).toBe('Beta');
  });

  it('событие активной команды', () => {
    expect(resolveEventTeamName({ teamId: 'team-a' }, [], active)).toBe('Alpha');
  });
});
