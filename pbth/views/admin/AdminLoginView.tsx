import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, Send } from 'lucide-react';
import { api, type AuthMeResponse } from '../../api';
import {
  extractAuthError,
  normalizeAuthErrorCode,
  resolveAuthErrorMessage,
  resolveTelegramLoginTransport,
  sendAuthTelemetry,
} from '../../lib/auth-ux';

type AuthenticatedMe = Extract<AuthMeResponse, { authenticated: true }>;

export const AdminLoginView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const [checking, setChecking] = useState(true);
  const [authMe, setAuthMe] = useState<AuthenticatedMe | null>(null);
  const [error, setError] = useState<string>('');
  const [switchingRole, setSwitchingRole] = useState(false);
  const [startingLogin, setStartingLogin] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(authQuery);
    const code = normalizeAuthErrorCode(params.get('auth_error') || params.get('code'));
    const detail = params.get('detail');
    if (!code && !detail) return;

    const message = resolveAuthErrorMessage({ code, detail, scope: 'ADMIN' });
    setError(message);
    sendAuthTelemetry({
      scope: 'ADMIN',
      flow: Boolean((window as any)?.Telegram?.WebApp) ? 'MINIAPP' : 'BOT_HANDOFF',
      event: 'error_page',
      code,
      detail,
      path: '/admin/login',
    });
  }, [authQuery]);

  const bootstrap = async (cancelled = false) => {
    try {
      const me = await api.getAuthMe();
      if (cancelled) return;
      if (me.authenticated) {
        setAuthMe(me);
        if (me.adminScope !== 'NONE') {
          navigate('/admin', { replace: true });
          return;
        }
      } else {
        setAuthMe(null);
      }
      setError('');
    } catch (err) {
      if (!cancelled) {
        const authErr = extractAuthError(err);
        setError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: 'ADMIN' }));
      }
    } finally {
      if (!cancelled) setChecking(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void bootstrap().catch((err) => {
      if (!cancelled) {
        const authErr = extractAuthError(err);
        setError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: 'ADMIN' }));
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSwitchToAdmin = async () => {
    setSwitchingRole(true);
    setError('');
    try {
      await api.selectAccountRole('ADMIN');
      await bootstrap();
    } catch (err) {
      const authErr = extractAuthError(err);
      setError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: 'ADMIN' }));
    } finally {
      setSwitchingRole(false);
    }
  };

  const handleTelegramLogin = () => {
    const run = async () => {
      setStartingLogin(true);
      setError('');
      try {
        const tg = (window as any).Telegram?.WebApp;
        const hasTelegramWebApp = Boolean(tg);
        sendAuthTelemetry({
          scope: 'ADMIN',
          flow: hasTelegramWebApp ? 'MINIAPP' : 'BOT_HANDOFF',
          event: 'login_start',
          path: '/admin/login',
        });
        let initData = '';
        if (hasTelegramWebApp) {
          try {
            tg?.ready?.();
            tg?.expand?.();
          } catch {
            // ignore telegram webapp readiness errors
          }

          const started = Date.now();
          while (Date.now() - started < 1200) {
            initData = String((window as any).Telegram?.WebApp?.initData || '').trim();
            if (initData) break;
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }

        const transport = resolveTelegramLoginTransport({
          hasTelegramWebApp,
          initData,
        });

        if (transport === 'WEBAPP') {
          await api.authTelegramWebApp(initData, true);
          const me = await api.getAuthMe();
          if (me.authenticated) {
            if (me.canChooseAdminRole && me.accountRole !== 'ADMIN') {
              await api.selectAccountRole('ADMIN');
            }
            const refreshed = await api.getAuthMe();
            if (refreshed.authenticated && refreshed.adminScope !== 'NONE') {
              sendAuthTelemetry({
                scope: 'ADMIN',
                flow: 'MINIAPP',
                event: 'login_success',
                path: '/admin/login',
              });
              navigate('/admin', { replace: true });
              return;
            }
            setError(resolveAuthErrorMessage({ code: 'ADMIN_SCOPE_NONE', scope: 'ADMIN' }));
            sendAuthTelemetry({
              scope: 'ADMIN',
              flow: 'MINIAPP',
              event: 'login_error',
              code: 'ADMIN_SCOPE_NONE',
              path: '/admin/login',
            });
            return;
          }

          setError('Не удалось завершить вход. Повторите попытку.');
          sendAuthTelemetry({
            scope: 'ADMIN',
            flow: 'MINIAPP',
            event: 'login_error',
            code: 'SESSION_ANONYMOUS',
            path: '/admin/login',
          });
          return;
        }

        if (hasTelegramWebApp && !String(initData || '').trim()) {
          sendAuthTelemetry({
            scope: 'ADMIN',
            flow: 'BOT_HANDOFF',
            event: 'webapp_initdata_missing_fallback_handoff',
            code: 'INITDATA_MISSING',
            path: '/admin/login',
          });
        }

        const handoff = await api.startTelegramHandoff('ADMIN', '/admin');
        window.location.assign(handoff.botUrl);
      } catch (err) {
        const authErr = extractAuthError(err);
        setError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: 'ADMIN' }));
        sendAuthTelemetry({
          scope: 'ADMIN',
          flow: Boolean((window as any)?.Telegram?.WebApp) ? 'MINIAPP' : 'BOT_HANDOFF',
          event: 'login_error',
          code: authErr.code || 'ADMIN_LOGIN_START_FAILED',
          detail: authErr.detail,
          path: '/admin/login',
        });
      } finally {
        setStartingLogin(false);
      }
    };

    void run();
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-pb-primary" size={42} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pb-background flex items-center justify-center text-white p-6">
      <div className="w-full max-w-md bg-pb-surface border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-pb-primary/20 flex items-center justify-center">
            <ShieldCheck className="text-pb-primary" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold">PBTH Admin Console</h1>
            <p className="text-pb-subtext text-sm">Вход через Telegram Mini App или через бота из браузера</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm bg-red-500/10 text-red-300 border border-red-500/30 rounded-xl p-3">
            Ошибка проверки сессии: {error}
          </div>
        )}

        {authMe?.authenticated && authMe.canChooseAdminRole && authMe.accountRole !== 'ADMIN' && (
          <button
            onClick={() => {
              void handleSwitchToAdmin();
            }}
            disabled={switchingRole}
            className="w-full mb-3 bg-pb-primary text-pb-background font-bold py-3 rounded-xl disabled:opacity-60"
          >
            {switchingRole ? 'Переключаем роль...' : 'Переключить роль на ADMIN'}
          </button>
        )}

        <button
          onClick={handleTelegramLogin}
          disabled={startingLogin}
          className="w-full bg-[#24A1DE] hover:bg-[#208bbf] text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
        >
          <Send size={18} />
          {startingLogin ? 'Переходим в Telegram...' : 'Войти в Admin через Telegram-бот'}
        </button>
        <button
          onClick={() => navigate('/login', { replace: true })}
          className="w-full mt-3 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl"
        >
          Войти в команду
        </button>
      </div>
    </div>
  );
};
