import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '../types';
import { isTelegramMiniApp, readMiniAppInitData } from '../shell/telegram';
import { api } from '../api';
import {
  extractAuthError,
  normalizeAuthErrorCode,
  resolveAuthErrorMessage,
  resolveTelegramLoginTransport,
  sendAuthTelemetry,
} from '../lib/auth-ux';
import { sanitizeNext } from '../lib/login-next-param';
import { canContinueToAdmin, resolveLoginSession } from '../lib/login-session';
import { isInvitePath } from '../lib/post-login';
import { formatPairingCountdown, pairingStatusMessage } from '../lib/pairing';
import { usePairing } from '../lib/use-pairing';
import { Avatar, Button, Glass, Icon, Screen } from '../ui';
import './login/login.css';

interface LoginViewProps {
  /**
   * Вход состоялся. `target` — куда человек шёл (`?next=`). Куда вести дальше,
   * решает App: для приглашения — на экран приглашения, без загрузки
   * приложения команды, в которой человек ещё не состоит.
   */
  onLogin: (target?: string) => void;
  /** Оболочка закончила запуск: сессию она уже проверила сама (`/auth/me`). */
  bootstrapDone: boolean;
  /** Человек, которого оболочка нашла по сессии при запуске. */
  sessionUser: User | null;
}

const PAINTS = ['#00E676', '#4F7CFF'];
// Зелёное пятно сверху по центру, холодное — слева снизу (тема читает их с корня страницы).
const PAINT_POSITIONS: Record<string, string> = { '--ui-paint-1-at': '50% 240px', '--ui-paint-2-at': '0% 100%' };

const Spinner: React.FC<{ size?: number }> = ({ size = 18 }) => <Icon name="loader-circle" size={size} className="pbth-login__spin" />;

const PairingSteps: React.FC<{ scope: 'USER' | 'ADMIN'; redirectTo: string; onAuthenticated: (to: string) => void }> = ({
  scope,
  redirectTo,
  onAuthenticated,
}) => {
  const { state, code, botUrl, botUsername, secondsLeft, copied, handleCopy, requestCode } = usePairing({
    scope,
    redirectTo,
    onAuthenticated,
  });

  if (state === 'starting' || state === 'idle') {
    return (
      <div className="pbth-login__loading">
        <Spinner size={22} />
      </div>
    );
  }

  const isDead = state === 'expired' || state === 'denied' || state === 'error';

  if (isDead) {
    return (
      <>
        <p className="pbth-login__note">{pairingStatusMessage(state)}</p>
        <Button variant="primary" block icon="refresh-cw" className="pbth-login__main" onClick={() => void requestCode()}>
          Получить новый код
        </Button>
      </>
    );
  }

  return (
    <>
      <Glass layer={2} className="pbth-login__code-card">
        <span className="pbth-login__code-label">Код для входа</span>
        <p className="pbth-login__code">{code}</p>
        <span className="pbth-login__code-ttl">Действует {formatPairingCountdown(secondsLeft)}</span>
        <Button variant="ghost" size="sm" icon={copied ? 'check' : 'copy'} onClick={handleCopy}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      </Glass>

      <Button as="a" variant="primary" block icon="send" className="pbth-login__main" href={botUrl} target="_blank" rel="noopener noreferrer">
        Открыть Telegram
      </Button>

      {/* Инструкция на случай, когда кнопка выше не сработала: именно этот
          случай — тупик «START BOT» — и был инцидентом. */}
      <p className="pbth-login__small">
        Кнопка не сработала? Найди в Telegram @{botUsername} и отправь ему код {code}. Потом нажми «Это я, войти» — прямо в
        чате.
      </p>

      <div className="pbth-login__status">
        <Spinner size={16} />
        {pairingStatusMessage(state)}
      </div>

      <Button variant="ghost" size="sm" block icon="refresh-cw" onClick={() => void requestCode()}>
        Получить новый код
      </Button>
    </>
  );
};

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, bootstrapDone, sessionUser }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const nextParam = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams]);
  const targetRedirect = nextParam ?? '/app';
  const wantsAdmin = (nextParam ?? '').startsWith('/admin');
  // Пришёл по ссылке-приглашению или по ссылке команды.
  const wantsTeam = isInvitePath(nextParam) || /^\/join\/[^/?#]+/.test(nextParam ?? '');

  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string>('');
  const [switchedAccount, setSwitchedAccount] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [pairing, setPairing] = useState(false);
  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

  // Пятна фона: положение задаём на корне страницы рядом с красками `Backdrop`.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(PAINT_POSITIONS).forEach(([k, v]) => root.style.setProperty(k, v));
    return () => Object.keys(PAINT_POSITIONS).forEach((k) => root.style.removeProperty(k));
  }, []);

  // Surface URL-borne auth errors (?auth_error=...&detail=...) once.
  useEffect(() => {
    const params = new URLSearchParams(authQuery);
    const code = normalizeAuthErrorCode(params.get('auth_error') || params.get('code'));
    const detail = params.get('detail');
    if (!code && !detail) return;

    const message = resolveAuthErrorMessage({ code, detail, scope: wantsAdmin ? 'ADMIN' : 'USER' });
    setAuthError(message);
    sendAuthTelemetry({
      scope: wantsAdmin ? 'ADMIN' : 'USER',
      flow: isTelegramMiniApp() ? 'MINIAPP' : 'BOT_HANDOFF',
      event: 'error_page',
      code,
      detail,
    });
  }, [authQuery, wantsAdmin]);

  // Сессия, найденная при запуске: вместо кнопок входа — «Продолжить как X».
  // Оболочка уже спросила `/auth/me`, второй запрос с экрана входа не нужен.
  const session = resolveLoginSession({ bootstrapDone, user: switchedAccount ? null : sessionUser });

  const checkAuthenticated = async (): Promise<boolean> => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!res.ok) return false;
    const payload = await res.json();
    return Boolean(payload?.authenticated);
  };

  // Данные запуска Mini App читаются сразу (из адреса или SDK): ждать их в
  // обычном браузере бессмысленно — там их не будет, а пауза стояла перед
  // кодом входа больше секунды.
  const readMiniAppLaunch = (): string => {
    const initData = readMiniAppInitData();
    if (!initData) return '';
    const tg = (window as any).Telegram?.WebApp;
    try {
      tg?.ready?.();
      tg?.expand?.();
    } catch {
      // ignore telegram webapp readiness errors
    }
    return initData;
  };

  const handleContinueExisting = async () => {
    if (session.kind !== 'session') return;
    sessionStorage.setItem('pbth:post-auth-app', wantsAdmin ? '0' : '1');

    // Smart routing: if /admin requested AND scope is admin-eligible, go to
    // /admin. Critically, we DO NOT call onLogin() (=handleLogin in App.tsx)
    // for the admin path. handleLogin → tryEnterUserApp → selectRole('USER')
    // would demote the just-elevated ADMIN session back to USER and bounce to
    // /app. AdminConsoleView's own bootstrap owns the admin entry flow.
    if (wantsAdmin) {
      let me = null;
      try {
        me = await api.getAuthMe();
      } catch {
        // нет ответа — идём как обычный пользователь
      }
      if (canContinueToAdmin(me)) {
        navigate('/admin', { replace: true });
        return;
      }
    }

    onLogin(targetRedirect.startsWith('/admin') ? '/app' : targetRedirect);
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } catch {
      // ignore
    } finally {
      setSwitchedAccount(true);
      setSwitchingAccount(false);
      setAuthError('');
    }
  };

  const handleYandexLogin = () => {
    // redirectTo carries post-auth landing path. Server uses it to:
    //   - decide entryRoleOverride='ADMIN' if path starts with /admin (PR #71),
    //   - drive the final 302 after callback.
    const url = `/api/v1/auth/yandex/start?redirectTo=${encodeURIComponent(targetRedirect)}`;
    window.location.assign(url);
  };

  const handleTelegramLogin = async () => {
    setIsLoading(true);
    setAuthError('');
    try {
      sessionStorage.setItem('pbth:post-auth-app', wantsAdmin ? '0' : '1');
      sessionStorage.removeItem('pbth:skip-auto-auth-after-logout');
      sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
      localStorage.removeItem('pbth:skip-auto-auth-after-logout');
      const initData = readMiniAppLaunch();
      const hasTelegramWebApp = Boolean(initData);
      const telemetryScope = wantsAdmin ? 'ADMIN' : 'USER';
      sendAuthTelemetry({
        scope: telemetryScope,
        flow: hasTelegramWebApp ? 'MINIAPP' : 'BOT_HANDOFF',
        event: 'login_start',
      });
      const transport = resolveTelegramLoginTransport({
        hasTelegramWebApp,
        initData,
      });
      if (transport === 'OIDC') {
        if (hasTelegramWebApp && !String(initData || '').trim()) {
          sendAuthTelemetry({
            scope: telemetryScope,
            flow: 'PAIRING',
            event: 'webapp_initdata_missing_fallback_pairing',
            code: 'INITDATA_MISSING',
          });
        }
        // Вне Mini App вход идёт кодом сопряжения (#109). Никакой навигации:
        // редирект в PWA на домашнем экране iOS отдаёт куку чужому браузеру.
        setPairing(true);
        return;
      }
      try {
        await api.authTelegramWebApp(initData, true);
        const authenticated = await checkAuthenticated();
        if (authenticated) {
          sendAuthTelemetry({
            scope: telemetryScope,
            flow: 'MINIAPP',
            event: 'login_success',
          });
          onLogin(targetRedirect);
          return;
        }
        setAuthError('Вход не завершился. Попробуй ещё раз из Telegram Mini App.');
        sendAuthTelemetry({
          scope: telemetryScope,
          flow: 'MINIAPP',
          event: 'login_error',
          code: 'SESSION_ANONYMOUS',
        });
        return;
      } catch (err) {
        const authErr = extractAuthError(err);
        setAuthError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: telemetryScope }));
        sendAuthTelemetry({
          scope: telemetryScope,
          flow: 'MINIAPP',
          event: 'login_error',
          code: authErr.code || 'WEBAPP_AUTH_FAILED',
          detail: authErr.detail,
        });
        return;
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Сюда приходим, когда опрос уже получил сессионную куку. Никаких переходов
  // по внешним ссылкам не было — приложение просто перерисовывается.
  const handlePaired = (target: string) => {
    sendAuthTelemetry({
      scope: wantsAdmin ? 'ADMIN' : 'USER',
      flow: 'PAIRING',
      event: 'login_success',
    });
    if (target.startsWith('/admin')) {
      navigate('/admin', { replace: true });
      return;
    }
    onLogin(target);
  };

  const handleLocalDevLogin = (telegramId: string) => {
    sessionStorage.setItem('pbth:post-auth-app', '1');
    window.location.assign(
      `/api/v1/auth/dev/login?telegramId=${encodeURIComponent(telegramId)}&redirectTo=${encodeURIComponent(targetRedirect)}`,
    );
  };

  const yandexEnabled = (import.meta as any).env?.VITE_AUTH_YANDEX_ENABLED === '1';
  const showProviders = session.kind === 'anonymous' && !pairing;
  const sessionName = session.kind === 'session' ? session.user.name || session.user.nickname || 'Игрок' : '';

  return (
    <Screen paints={PAINTS} className="pbth-login">
      <div className="pbth-login__hero">
        <Link to="/" className="ui-glass pbth-login__mark" aria-label="На главную">
          <Icon name="hexagon" size={48} />
        </Link>
        <h1 className="pbth-login__title">Paintball TeamHub</h1>
        <p className="pbth-login__tagline">
          {wantsAdmin ? 'Вход владельца платформы' : 'Все твои игры и тренировки в одном месте'}
        </p>
      </div>

      <Glass layer={1} className="pbth-login__panel">
        {authError && (
          <Glass layer={2} className="pbth-login__alert" role="alert">
            <Icon name="circle-alert" size={18} />
            <span>{authError}</span>
          </Glass>
        )}

        {session.kind === 'checking' && (
          <div className="pbth-login__loading">
            <Spinner size={22} />
          </div>
        )}

        {/* Сессия уже есть: одно «Продолжить как X» и тихая «Сменить аккаунт». */}
        {session.kind === 'session' && (
          <>
            <div className="pbth-login__who">
              {session.user.avatar ? (
                <img className="pbth-login__photo" src={session.user.avatar} alt="" loading="eager" decoding="async" />
              ) : (
                <Avatar name={sessionName} size={40} />
              )}
              <div className="pbth-login__who-text">
                <span className="pbth-login__who-label">Продолжить как</span>
                <span className="pbth-login__who-name">{sessionName}</span>
              </div>
            </div>
            <Button variant="primary" block className="pbth-login__main" onClick={handleContinueExisting}>
              Войти
            </Button>
            <Button variant="ghost" size="sm" block icon="log-out" onClick={handleSwitchAccount} disabled={switchingAccount}>
              {switchingAccount ? 'Выходим...' : 'Сменить аккаунт'}
            </Button>
          </>
        )}

        {pairing && (
          <PairingSteps scope={wantsAdmin ? 'ADMIN' : 'USER'} redirectTo={targetRedirect} onAuthenticated={handlePaired} />
        )}

        {showProviders && (
          <>
            {wantsTeam && <p className="pbth-login__note">Войди через Telegram — после входа заявка уйдёт капитану.</p>}
            <Button
              variant="primary"
              block
              icon={isLoading ? 'loader-circle' : 'send'}
              className="pbth-login__main"
              onClick={handleTelegramLogin}
              disabled={isLoading}
            >
              {isLoading ? 'Входим...' : 'Войти через Telegram'}
            </Button>
            {/* Вход (решение Василия 10.11.2026, п. 6): у нового человека путь один —
                Telegram. Яндекс — тихая ссылка для тех, кто уже привязал его в
                профиле. Адрес возврата (`?next=`) едет в `redirectTo` (caldev#128). */}
            {yandexEnabled && (
              <>
                <Button variant="ghost" block className="pbth-login__quiet" onClick={handleYandexLogin} disabled={isLoading}>
                  Войти через Яндекс
                </Button>
                <p className="pbth-login__small">Работает, если ты уже привязал Яндекс в профиле. Первый вход — через Telegram.</p>
              </>
            )}
          </>
        )}
      </Glass>

      <div className="pbth-login__foot">
        <p className="pbth-login__small">Входя, ты принимаешь правила и политику конфиденциальности</p>
        <nav className="pbth-login__links" aria-label="Документы">
          <Link to="/terms">Правила</Link>
          <Link to="/privacy">Конфиденциальность</Link>
          <Link to="/support">Поддержка</Link>
        </nav>
        {isLocalDev && showProviders && (
          <div className="pbth-login__dev">
            <Button variant="ghost" size="sm" onClick={() => handleLocalDevLogin('9000000101')}>
              Dev капитан
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleLocalDevLogin('9000000103')}>
              Dev игрок
            </Button>
          </div>
        )}
      </div>
    </Screen>
  );
};
