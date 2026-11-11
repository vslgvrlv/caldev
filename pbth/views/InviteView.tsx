import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type TeamInviteInfoResponse } from '../api';
import { normalizeAuthErrorCode, resolveAuthErrorMessage, sendAuthTelemetry } from '../lib/auth-ux';
import { describeInviteProblem } from '../lib/invite-problem';
import { inviteValidUntil, inviterName } from '../lib/invite-copy';
import { roleLabel } from '../lib/labels';
import { Button, Icon, Row } from '../ui';
import { InviteActions, InviteFacts, InviteFrame, InviteHero, InviteNotNow } from '../components/track1/InviteFrame';

// Одноразовое приглашение (капитана) уже сработало — трек 1. Общий разбор
// ошибок приглашения этот код не знает.
function describeTrackInviteProblem(err: unknown): string | null {
  if ((err as { code?: string } | null)?.code === 'INVITE_USED') {
    return 'По этому приглашению уже вступили. Оно одноразовое — попроси новое.';
  }
  return describeInviteProblem(err);
}

const singleUseText = 'Приглашение одноразовое: сработает у одного человека';

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

  // Вход с экрана приглашения идёт через общий /login (?next=/invite/<id>):
  // человек выбирает Яндекс или Telegram там, а не в параллельной ветке.

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
      <InviteFrame>
        <InviteHero title="Открываем приглашение" />
      </InviteFrame>
    );
  }

  // Приглашение не открылось или не работает: тот же каркас, спокойный текст и одно действие.
  if (unusable || !inviteInfo) {
    return (
      <InviteFrame>
        <InviteHero title={unusable ? 'Приглашение не работает' : 'Не открылось'}>{statusText}</InviteHero>
        <InviteActions>
          {unusable ? (
            <Button variant="glass2" block onClick={() => navigate('/')}>
              На главную
            </Button>
          ) : (
            <Button variant="glass2" block onClick={() => window.location.reload()}>
              Обновить
            </Button>
          )}
        </InviteActions>
      </InviteFrame>
    );
  }

  // Поля одноразового приглашения (трек 1) — тип общего клиента их ещё не знает.
  const inviteExtra = inviteInfo as TeamInviteInfoResponse & { singleUse?: boolean; note?: string | null };
  const team = { id: inviteInfo.teamId, name: inviteInfo.teamName };
  const until = inviteValidUntil(inviteInfo.expiresAt);
  const acceptLabel = accepted ? 'Готово' : isSubmitting ? 'Вступаем…' : 'Вступить';

  return (
    <InviteFrame teamId={team.id}>
      <InviteHero team={team} title={`Тебя зовут в ${team.name}`}>
        Тренировки, турниры и спарринги команды будут у тебя в ленте.
      </InviteHero>

      <InviteFacts facts={inviteInfo} invitedRole={inviteInfo.role}>
        {!inviterName(inviteInfo) ? (
          <Row
            lead={<Icon name="shield" size={24} />}
            title={`Роль: ${roleLabel(inviteInfo.role).toLowerCase()}`}
            sub={inviteExtra.singleUse ? singleUseText : undefined}
          />
        ) : inviteExtra.singleUse ? (
          <Row lead={<Icon name="shield" size={24} />} title="Приглашение одноразовое" sub="Сработает у одного человека" />
        ) : null}
        {inviteExtra.note ? <Row lead={<Icon name="message-circle" size={24} />} title={inviteExtra.note} /> : null}
      </InviteFacts>

      <InviteActions>
        {isAuthenticated ? (
          <Button variant="primary" block disabled={isSubmitting || accepted} onClick={handleAccept}>
            {acceptLabel}
          </Button>
        ) : (
          <Button
            variant="primary"
            block
            as={Link}
            to={`/login?next=${encodeURIComponent(`/invite/${inviteId}`)}`}
          >
            Вступить
          </Button>
        )}
        <InviteNotNow onClick={() => navigate('/')} />
      </InviteActions>

      {statusText ? (
        <p className="pbth-invite__note" role="status">
          {statusText}
        </p>
      ) : null}
      {until ? (
        <div className="pbth-invite__until">
          <Icon name="clock" size={16} />
          {until}
        </div>
      ) : null}
    </InviteFrame>
  );
};
