import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { slotsApi, slotsPath } from '../../api/track4';
import type { ShellExtContext } from '../../shell/extensions';

// Значок в шапке команды: вход на экран открытых слотов (`/teams`). Число —
// свободные слоты в командах, на которые я подписан, и мои записи гостем.
// Счёт помним минуту: шапка перерисовывается на каждом экране.

let cached: { at: number; count: number } | null = null;
const TTL_MS = 60_000;

export const SlotsHeaderBadge: React.FC<ShellExtContext> = () => {
  const navigate = useNavigate();
  const [count, setCount] = React.useState(cached?.count ?? 0);

  React.useEffect(() => {
    if (cached && Date.now() - cached.at < TTL_MS) return;
    let alive = true;
    slotsApi
      .summary()
      .then((summary) => {
        const next = summary.free + summary.bookings;
        cached = { at: Date.now(), count: next };
        if (alive) setCount(next);
      })
      .catch(() => {
        // Нет сети или старый сервер — значок просто без числа.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => navigate(slotsPath.list())}
      aria-label={count > 0 ? `Свободные слоты: ${count}` : 'Свободные слоты'}
      className="relative w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-pb-subtext hover:text-white transition-colors"
    >
      <Ticket size={18} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-pb-primary text-pb-background text-[11px] font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </button>
  );
};
