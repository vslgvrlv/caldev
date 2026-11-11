import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import type { ShellExtContext, ShellExtension } from '../extensions';
import { teamPath } from '../../lib/team-url';
import { Button } from '../../ui';
import { onJoinRequestsChanged, track1Api } from '../../api/track1';

// Трек 1: заявки на вступление в меню команды и значок с их числом в шапке разделов команды.
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
    <span className="pbth-sectionhead__badge">
      <Button
        variant="ghost"
        icon="inbox"
        aria-label={`Заявки в команду: ${count}`}
        onClick={() => navigate(teamPath(ctx.teamCode, 'requests'))}
      />
      <span className="ui-sidenav__badge" aria-hidden="true">
        {count}
      </span>
    </span>
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
  // Значок — про текущую команду: на «Моё» вместо него строки заявок по всем командам в ленте.
  headerBadges: [{ id: 'join-requests', Component: RequestsBadge, visible: canDecide, teamScoped: true }],
};

export default ext;
