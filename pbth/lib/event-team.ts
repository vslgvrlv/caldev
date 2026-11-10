import type { Event, Team, TeamContext } from '../types';

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
