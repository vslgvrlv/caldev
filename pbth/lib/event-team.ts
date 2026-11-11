import type { Event, Team, TeamContext } from '../types';
import { teamCodeOf } from './team-url';

/**
 * Название команды, которой принадлежит событие.
 *
 * В ленте игрока из нескольких команд лежат события всех его команд. Раньше в
 * карточку события подставлялось название активной команды, и в событии
 * чужой команды стояло не то название. Берём команду самого события: имя
 * приходит в событии из /init, запасной вариант — список команд человека.
 */
export function resolveEventTeamName(
  event: Pick<Event, 'teamId' | 'teamName'>,
  teams: Pick<TeamContext, 'teamId' | 'teamName'>[],
  activeTeam: Pick<Team, 'id' | 'name'> | null,
): string {
  if (event.teamName) return event.teamName;
  const fromTeams = teams.find((team) => team.teamId === event.teamId)?.teamName;
  if (fromTeams) return fromTeams;
  if (activeTeam && activeTeam.id === event.teamId) return activeTeam.name;
  return activeTeam?.name ?? '';
}

/** Код команды события для адреса: из события, запасной вариант — список команд человека, затем `fallback`. */
export function eventTeamCode(
  event: Pick<Event, 'teamId' | 'teamShortCode'>,
  teams: Pick<TeamContext, 'teamId' | 'shortCode'>[],
  fallback = '',
): string {
  if (event.teamShortCode) return teamCodeOf({ teamId: event.teamId, shortCode: event.teamShortCode });
  const fromTeams = teams.find((team) => team.teamId === event.teamId);
  return fromTeams ? teamCodeOf({ teamId: fromTeams.teamId, shortCode: fromTeams.shortCode }) : fallback;
}
