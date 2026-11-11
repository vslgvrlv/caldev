import React from 'react';
import { onJoinRequestsChanged, track1Api } from '../api/track1';

/** Число ждущих заявок в команду; обновляется, когда заявку решили. Без права решать — не спрашивает. */
export function usePendingRequests(enabled: boolean, teamId: string | undefined): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await track1Api.teamJoinRequests();
        if (!cancelled) setCount(res.count);
      } catch {
        // Число — подсказка на строке, не повод для сообщения об ошибке.
      }
    };
    void load();
    const off = onJoinRequestsChanged(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [enabled, teamId]);
  return count;
}
