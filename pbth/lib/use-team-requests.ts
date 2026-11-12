import React from 'react';
import { onJoinRequestsChanged, track1Api } from '../api/track1';
import type { TeamContext } from '../types';
import { requestTeams } from './team-filter';

/**
 * Число ждущих заявок по каждой своей команде, где я капитан или тренер.
 * Один запрос `GET /join-requests` на такую команду (команда — заголовком
 * `X-PBTH-Team`), как раньше делал значок в шапке для одной текущей: при
 * открытии экрана, когда заявку решили и когда приложение снова на экране.
 * Команды без права решать заявки не спрашиваем.
 */
export function useTeamRequestCounts(teams: TeamContext[], enabled = true): Record<string, number> {
  const ids = React.useMemo(() => requestTeams(teams).map((t) => t.teamId), [teams]);
  const key = ids.join('|');
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    if (!enabled || ids.length === 0) {
      setCounts({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const results = await Promise.allSettled(ids.map((id) => track1Api.teamJoinRequestsOf(id)));
      if (cancelled) return;
      setCounts((prev) => {
        const next: Record<string, number> = {};
        results.forEach((res, i) => {
          // Не ответил сервер — оставляем прежнее число: строка — подсказка, не повод для ошибки.
          next[ids[i]] = res.status === 'fulfilled' ? Number(res.value?.count) || 0 : prev[ids[i]] ?? 0;
        });
        return next;
      });
    };
    void load();
    const off = onJoinRequestsChanged(() => void load());
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      off();
      document.removeEventListener('visibilitychange', load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return counts;
}
