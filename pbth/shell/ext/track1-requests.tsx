import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import type { ShellExtContext, ShellExtension } from '../extensions';
import { teamPath } from '../../lib/team-url';
import { onJoinRequestsChanged, track1Api } from '../../api/track1';

// Трек 1: заявки на вступление в меню команды и значок с их числом в шапке.
// Видят капитан и тренер (владелец платформы в чужой команде — как капитан).

const canDecide = (ctx: ShellExtContext) =>
  ctx.role === 'CAPTAIN' || ctx.role === 'TRAINER' || ctx.role === 'ADMIN';

const RequestsBadge: React.FC<ShellExtContext> = (ctx) => {
  const navigate = useNavigate();
  const [count, setCount] = React.useState(0);
  const teamId = ctx.team.id;

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await track1Api.teamJoinRequests();
        if (!cancelled) setCount(res.count);
      } catch {
        // Значок — подсказка, не повод для сообщения об ошибке.
      }
    };
    void load();
    const off = onJoinRequestsChanged(() => void load());
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      off();
      document.removeEventListener('visibilitychange', load);
    };
  }, [teamId]);

  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(teamPath(ctx.teamCode, 'requests'))}
      className="relative p-2 rounded-xl bg-white/10 text-white"
      aria-label={`Заявки в команду: ${count}`}
    >
      <Inbox size={20} />
      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-pb-primary text-pb-background text-[11px] font-bold flex items-center justify-center">
        {count}
      </span>
    </button>
  );
};

const ext: ShellExtension = {
  id: 'track1-requests',
  teamMenu: [
    {
      id: 'requests',
      label: 'Заявки в команду',
      // Обёртка: тип иконки меню уже, чем у lucide (size только числом).
      icon: (props: { size?: number; className?: string }) => <Inbox {...props} />,
      to: (ctx) => teamPath(ctx.teamCode, 'requests'),
      visible: canDecide,
    },
  ],
  headerBadges: [{ id: 'join-requests', Component: RequestsBadge, visible: canDecide }],
};

export default ext;
