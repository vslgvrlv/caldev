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
