import type { TeamContext } from '../types';
import { findTeamByCode, matchesTeamCode } from '../lib/team-url';

// Совместимость со старым сервером (спека ревизии, «Команда в запросе»).
//
// Новый сервер на `/init?team=<код>` отдаёт команду из адреса. Старый параметр
// не знает и отдаёт команду, запомненную в сессии. Тогда переключаем сессию
// прежней ручкой `/auth/context` (membershipId есть в списке `teams`) и
// перечитываем данные. Фронтенд обязан работать с обоими серверами.

export type InitTeamDecision =
  | { kind: 'match' }
  | { kind: 'switch'; membershipId: string }
  | { kind: 'forbidden' };

export function decideInitTeam(
  requested: string | null | undefined,
  data: { team?: { id: string; shortCode?: string | null } | null; teams?: TeamContext[] | null },
): InitTeamDecision {
  if (!requested) return { kind: 'match' };
  if (data.team && matchesTeamCode(requested, { teamId: String(data.team.id), shortCode: data.team.shortCode })) {
    return { kind: 'match' };
  }
  const target = findTeamByCode(requested, data.teams || []);
  if (target?.membershipId) return { kind: 'switch', membershipId: String(target.membershipId) };
  return { kind: 'forbidden' };
}

/**
 * Новый сервер на `/init?team=<код>` чужой или несуществующей команды отвечает
 * 403 (TEAM_ACCESS_DENIED) или 404 (TEAM_NOT_FOUND). Это не сбой входа: человек
 * вошёл, просто команда в адресе не его.
 */
export function isTeamDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /^INIT_FAILED:(403|404):/.test(message);
}
