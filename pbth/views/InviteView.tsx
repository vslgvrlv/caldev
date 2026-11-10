import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react';
import { api, type TeamInviteInfoResponse } from '../api';
import { normalizeAuthErrorCode, resolveAuthErrorMessage, sendAuthTelemetry } from '../lib/auth-ux';
import { describeInviteProblem } from '../lib/invite-problem';
import { roleLabel } from '../lib/labels';

// Одноразовое приглашение (капитана) уже сработало — трек 1. Общий разбор
// ошибок приглашения этот код не знает.
function describeTrackInviteProblem(err: unknown): string | null {
  if ((err as { code?: string } | null)?.code === 'INVITE_USED') {
    return 'По этому приглашению уже вступили. Оно одноразовое — попроси новое.';
  }
  return describeInviteProblem(err);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

function isAuthRequired(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return message.includes('authentication required') || message.includes('401');
}

function isAlreadyMember(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ALREADY_MEMBER';
}

interface InviteViewProps {
  /**
   * Человек вступил в команду (или уже в ней состоял). App загружает
   * приложение — сервер уже сделал эту команду активной — и открывает главную.
   */
  onJoined?: () => void | Promise<void>;
}

export const InviteView: React.FC<InviteViewProps> = ({ onJoined }) => {
  const navigate = useNavigate();
  const { inviteId } = useParams<{ inviteId: string }>();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Приглашением воспользоваться нельзя (устарело, истекло, отозвано) —
  // кнопок нет, только текст, что делать дальше.
  const [unusable, setUnusable] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<TeamInviteInfoResponse | null>(null);
  const [statusText, setStatusText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(authQuery);
    const code = normalizeAuthErrorCode(params.get('auth_error') || params.get('code'));
    const detail = params.get('detail');
    if (!code && !detail) return;

    const message = resolveAuthErrorMessage({ code, detail, scope: 'INVITE' });
    setStatusText(message);
    sendAuthTelemetry({
      scope: 'INVITE',
      flow: 'OIDC',
      event: 'error_page',
      code,
      detail,
      path: window.location.pathname,
    });
  }, [authQuery]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!inviteId) {
        setStatusText('Ссылка приглашения неполная. Попроси капитана прислать её ещё раз.');
        setIsLoading(false);
        return;
      }

      try {
        const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          const me = await meRes.json();
          if (!cancelled) setIsAuthenticated(Boolean(me?.authenticated));
        }
      } catch {
        // Keep fallback: unauthenticated.
      }

      try {
        const info = await api.getTeamInvite(inviteId);
        if (cancelled) return;
        setInviteInfo(info);
      } catch (err) {
        if (cancelled) return;
        // В том числе старые ссылки /invite/<ID команды>: вступить по ID
        // команды больше нельзя, только по действующему приглашению.
        const problem = describeTrackInviteProblem(err);
        if (problem) {
          setUnusable(true);
          setStatusText(problem);
        } else {
          setStatusText('Приглашение сейчас не открывается. Проверь связь и обнови страницу.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  // Note: login from invite is now routed through the unified /login screen
  // (with ?next=/invite/<id>) so the user can pick Yandex or Telegram, see
  // continuity if already signed in, etc. The old inline Telegram-only
  // handoff was a parallel auth path — removed in favour of one source of
  // truth for provider choice.

  const handleAccept = async () => {
    if (!inviteId) return;
    setIsSubmitting(true);
    setStatusText('');
    try {
      try {
        await api.acceptTeamInvite(inviteId);
      } catch (err) {
        // Повторно открытая ссылка: человек уже в команде — это не ошибка,
        // просто открываем приложение.
        if (isAlreadyMember(err)) {
          setAccepted(true);
          setStatusText('Ты уже в этой команде. Открываем приложение…');
          if (onJoined) await onJoined();
          else navigate('/app', { replace: true });
          return;
        }
        const problem = describeTrackInviteProblem(err);
        if (problem) {
          setUnusable(true);
          setStatusText(problem);
          return;
        }
        throw err;
      }
      setAccepted(true);
      setStatusText('Ты в команде. Открываем приложение…');
      if (onJoined) await onJoined();
      else navigate('/app', { replace: true });
    } catch (err) {
      if (isAuthRequired(err)) {
        setStatusText('Сначала нужно войти через Telegram.');
      } else {
        setStatusText('Приглашение не принялось. Попробуй ещё раз.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-pb-primary" size={46} />
      </div>
    );
  }

  const title = inviteInfo?.teamName ? `Приглашение в команду «${inviteInfo.teamName}»` : 'Приглашение в команду';
  // Поля одноразового приглашения (трек 1) — тип общего клиента их ещё не знает.
  const inviteExtra = inviteInfo as (TeamInviteInfoResponse & { singleUse?: boolean; note?: string | null }) | null;
  const roleHint = `Роль в команде: ${roleLabel(inviteInfo?.role || 'PLAYER').toLowerCase()}`;
  const safeAreaCardViewportStyle = {
    paddingTop: 'calc(var(--pb-safe-top) + 1.5rem)',
    paddingRight: 'calc(var(--pb-safe-right) + 1.5rem)',
    paddingBottom: 'calc(var(--pb-safe-bottom) + 1.5rem)',
    paddingLeft: 'calc(var(--pb-safe-left) + 1.5rem)',
  } as const;

  return (
    <div
      className="min-h-screen bg-pb-background flex items-center justify-center text-white"
      style={safeAreaCardViewportStyle}
    >
      <div className="w-full max-w-sm bg-pb-surface border border-white/10 rounded-2xl p-5">
        <h1 className="text-xl font-bold mb-2">{title}</h1>
        {!unusable && <p className="text-pb-subtext text-sm mb-2">{roleHint}</p>}
        {!unusable && inviteExtra?.note && <p className="text-white text-sm mb-2">{inviteExtra.note}</p>}
        {!unusable && inviteExtra?.singleUse && (
          <p className="text-pb-subtext text-xs mb-2">Приглашение одноразовое: сработает только у одного человека.</p>
        )}
        {inviteInfo?.expiresAt && (
          <p className="text-pb-subtext text-xs mb-4">
            Действует до: {new Date(inviteInfo.expiresAt).toLocaleString('ru-RU')}
          </p>
        )}

        {statusText && (
          <div className="mb-4 text-sm text-pb-subtext bg-black/30 rounded-xl px-3 py-2">
            {statusText}
          </div>
        )}

        {unusable ? null : !isAuthenticated ? (
          <Link
            to={`/login?next=${encodeURIComponent(`/invite/${inviteId}`)}`}
            className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-pb-primary/90 transition-colors"
          >
            <LogIn size={18} />
            Войти и принять приглашение
          </Link>
        ) : (
          <button
            onClick={handleAccept}
            disabled={isSubmitting || accepted}
            className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : accepted ? <CheckCircle2 size={18} /> : <UserPlus size={18} />}
            {accepted ? 'Готово' : 'Принять приглашение'}
          </button>
        )}
      </div>
    </div>
  );
};
