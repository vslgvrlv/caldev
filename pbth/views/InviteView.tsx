import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react';
import { api, type TeamInviteInfoResponse } from '../api';
import { normalizeAuthErrorCode, resolveAuthErrorMessage, sendAuthTelemetry } from '../lib/auth-ux';

type InviteMode = 'TOKEN' | 'TEAM_FALLBACK';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

function isInviteNotFound(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return message.includes('invite not found') || message.includes('invite_not_found');
}

function isAuthRequired(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return message.includes('authentication required') || message.includes('401');
}

export const InviteView: React.FC = () => {
  const navigate = useNavigate();
  const { inviteId } = useParams<{ inviteId: string }>();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mode, setMode] = useState<InviteMode>('TOKEN');
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
        setStatusText('Некорректная ссылка инвайта.');
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
        setMode('TOKEN');
        setInviteInfo(info);
      } catch (err) {
        if (cancelled) return;
        if (isInviteNotFound(err)) {
          // Backward compatibility for old links where /invite/<teamId> was copied.
          setMode('TEAM_FALLBACK');
          setStatusText('Обнаружена ссылка старого формата. Можно вступить напрямую в команду.');
        } else {
          setStatusText(`Инвайт недоступен: ${errorMessage(err)}`);
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

  const handleLogin = () => {
    if (!inviteId) return;
    const redirectTo = `/invite/${inviteId}`;
    const run = async () => {
      sendAuthTelemetry({
        scope: 'INVITE',
        flow: 'BOT_HANDOFF',
        event: 'login_start',
        path: redirectTo,
      });
      const handoff = await api.startTelegramHandoff('USER', redirectTo);
      window.location.assign(handoff.botUrl);
    };
    void run();
  };

  const handleAccept = async () => {
    if (!inviteId) return;
    setIsSubmitting(true);
    setStatusText('');
    try {
      if (mode === 'TOKEN') {
        try {
          await api.acceptTeamInvite(inviteId);
        } catch (err) {
          if (!isInviteNotFound(err)) throw err;
          // Backward compatibility fallback.
          await api.joinTeam(inviteId);
        }
      } else {
        await api.joinTeam(inviteId);
      }
      setAccepted(true);
      setStatusText('Вы успешно вступили в команду. Перенаправляем в приложение...');
      setTimeout(() => navigate('/app', { replace: true }), 700);
    } catch (err) {
      if (isAuthRequired(err)) {
        setStatusText('Сначала нужно войти через Telegram.');
      } else {
        setStatusText(`Не удалось принять инвайт: ${errorMessage(err)}`);
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

  const title = inviteInfo?.teamName ? `Инвайт в команду ${inviteInfo.teamName}` : 'Приглашение в команду';
  const roleHint = inviteInfo?.role ? `Роль по инвайту: ${inviteInfo.role}` : 'Роль по умолчанию: PLAYER';
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
        <p className="text-pb-subtext text-sm mb-2">{roleHint}</p>
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

        {!isAuthenticated ? (
          <button
            onClick={handleLogin}
            className="w-full bg-[#24A1DE] hover:bg-[#208bbf] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            Войти через Telegram
          </button>
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
