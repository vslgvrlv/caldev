import React, { useEffect, useMemo, useState } from 'react';
import { UserRoleOption, Role } from '../types';
import { Shield, User as UserIcon, LogOut, Loader2 } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AuthMeResponse } from '../api';
import {
  extractAuthError,
  normalizeAuthErrorCode,
  resolveAuthErrorMessage,
  resolveTelegramLoginTransport,
  sendAuthTelemetry,
} from '../lib/auth-ux';
import { sanitizeNext } from '../lib/login-next-param';
import { PairingPanel } from '../components/PairingPanel';

type AuthenticatedMe = Extract<AuthMeResponse, { authenticated: true }>;

interface LoginViewProps {
  onLogin: () => void;
  onSelectRole: (roleOption: UserRoleOption) => void;
  availableRoles: UserRoleOption[];
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onSelectRole, availableRoles }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const nextParam = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams]);
  const targetRedirect = nextParam ?? '/app';
  const wantsAdmin = (nextParam ?? '').startsWith('/admin');

  const [step, setStep] = useState<'LOGIN' | 'SELECT'>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string>('');
  const [continuity, setContinuity] = useState<AuthenticatedMe | null>(null);
  const [continuityChecked, setContinuityChecked] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [pairing, setPairing] = useState(false);
  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
  const safeAreaFrameStyle = {
    paddingTop: 'calc(var(--pb-safe-top) + 1.5rem)',
    paddingRight: 'calc(var(--pb-safe-right) + 1.5rem)',
    paddingBottom: 'calc(var(--pb-safe-bottom) + 1.5rem)',
    paddingLeft: 'calc(var(--pb-safe-left) + 1.5rem)',
  } as const;

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
      flow: Boolean((window as any)?.Telegram?.WebApp) ? 'MINIAPP' : 'BOT_HANDOFF',
      event: 'error_page',
      code,
      detail,
    });
  }, [authQuery, wantsAdmin]);

  // Continuity check: if there's already a session, render "Continue as X"
  // instead of provider buttons. Owner gets here after Yandex/TG login when
  // they revisit /login while still signed in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.getAuthMe();
        if (cancelled) return;
        if (me.authenticated) {
          setContinuity(me);
        }
      } catch {
        // ignore — fall back to provider buttons
      } finally {
        if (!cancelled) setContinuityChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkAuthenticated = async (): Promise<boolean> => {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!res.ok) return false;
    const payload = await res.json();
    return Boolean(payload?.authenticated);
  };

  const waitMiniAppInitData = async (timeoutMs = 1200): Promise<string> => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return '';
    try {
      tg.ready?.();
      tg.expand?.();
    } catch {
      // ignore telegram webapp readiness errors
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const initData = String(tg.initData || '').trim();
      if (initData) return initData;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return String(tg.initData || '').trim();
  };

  const handleContinueExisting = () => {
    if (!continuity) return;
    sessionStorage.setItem('pbth:post-auth-app', wantsAdmin ? '0' : '1');

    // Smart routing: if /admin requested AND scope is admin-eligible, go to
    // /admin. Critically, we DO NOT call onLogin() (=handleLogin in App.tsx)
    // for the admin path. handleLogin → tryEnterUserApp → selectRole('USER')
    // would demote the just-elevated ADMIN session back to USER and bounce to
    // /app. AdminConsoleView's own bootstrap owns the admin entry flow.
    if (wantsAdmin && continuity.adminScope && continuity.adminScope !== 'NONE') {
      navigate('/admin', { replace: true });
      return;
    }

    onLogin();
    navigate(targetRedirect.startsWith('/admin') ? '/app' : targetRedirect, { replace: true });
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
      setContinuity(null);
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
      const hasTelegramWebApp = Boolean((window as any).Telegram?.WebApp);
      const telemetryScope = wantsAdmin ? 'ADMIN' : 'USER';
      sendAuthTelemetry({
        scope: telemetryScope,
        flow: hasTelegramWebApp ? 'MINIAPP' : 'BOT_HANDOFF',
        event: 'login_start',
      });
      const initData = hasTelegramWebApp ? await waitMiniAppInitData() : '';
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
          onLogin();
          return;
        }
        setAuthError('Вход не завершился. Повторите попытку из Telegram Mini App.');
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
    onLogin();
    navigate(target, { replace: true });
  };

  const handleLocalDevLogin = (telegramId: string) => {
    sessionStorage.setItem('pbth:post-auth-app', '1');
    window.location.assign(
      `/api/v1/auth/dev/login?telegramId=${encodeURIComponent(telegramId)}&redirectTo=${encodeURIComponent(targetRedirect)}`,
    );
  };

  if (step === 'SELECT') {
    return (
      <div
        className="min-h-screen bg-pb-background flex flex-col items-center justify-center animate-fade-in"
        style={safeAreaFrameStyle}
      >
        <h2 className="text-2xl font-bold text-white mb-2">Выберите профиль</h2>
        <p className="text-pb-subtext text-center mb-8">
          К вашему Telegram аккаунту привязано несколько ролей.
        </p>

        <div className="w-full max-w-sm space-y-3">
          {availableRoles.map((option, idx) => (
            <button
              key={idx}
              onClick={() => onSelectRole(option)}
              className="w-full bg-pb-surface border border-white/10 p-4 rounded-2xl flex items-center justify-between hover:bg-white/5 transition-colors active:scale-[0.99]"
            >
              <div className="flex items-center space-x-4">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center ${
                    option.role === Role.ADMIN || option.role === Role.CAPTAIN
                      ? 'bg-pb-primary/20 text-pb-primary'
                      : 'bg-white/10 text-pb-subtext'
                  }`}
                >
                  {option.role === Role.ADMIN || option.role === Role.CAPTAIN ? (
                    <Shield size={22} />
                  ) : (
                    <UserIcon size={22} />
                  )}
                </div>
                <div className="text-left">
                  <div className="font-bold text-white">{option.teamName}</div>
                  <div className="text-xs text-pb-subtext uppercase tracking-wider font-bold">{option.role}</div>
                </div>
              </div>
              <div className="w-2 h-2 rounded-full bg-pb-primary"></div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-pb-background flex flex-col items-center justify-center animate-fade-in"
      style={safeAreaFrameStyle}
    >
      <Link
        to="/"
        className="absolute text-pb-subtext hover:text-white flex items-center gap-2 px-4 py-3 transition-colors text-sm"
        style={{ top: 'calc(var(--pb-safe-top) + 0.5rem)', left: 'calc(var(--pb-safe-left) + 0.5rem)' }}
      >
        На главную
      </Link>

      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-pb-primary/15 flex items-center justify-center">
          <Shield size={32} className="text-pb-primary" strokeWidth={2.5} />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">PaintBall Team Hub</h1>
        <p className="text-pb-subtext mt-2 text-sm">
          {wantsAdmin ? 'Вход в админ-режим' : 'Управляй командой, тренировками и победами.'}
        </p>
      </div>

      <div className="w-full max-w-sm">
        {authError && (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {authError}
          </div>
        )}

        {/* Continuity: pre-existing session detected. Single big "Continue as X"
            CTA + small "Switch account" link. Hides provider buttons. */}
        {continuity && (
          <div className="space-y-3">
            <button
              onClick={handleContinueExisting}
              className="w-full bg-pb-surface hover:bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 transition-colors active:scale-[0.99]"
            >
              <div className="w-10 h-10 rounded-full bg-pb-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                {continuity.user?.avatar ? (
                  <img
                    src={continuity.user.avatar}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon size={20} className="text-pb-primary" />
                )}
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="text-pb-subtext text-xs">Продолжить как</div>
                <div className="text-white font-semibold truncate">
                  {continuity.user?.name || continuity.user?.nickname || 'Игрок'}
                </div>
              </div>
              <span className="text-pb-primary text-sm font-semibold">Войти →</span>
            </button>
            <button
              onClick={handleSwitchAccount}
              disabled={switchingAccount}
              className="w-full text-pb-subtext hover:text-white text-sm py-2 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <LogOut size={14} />
              {switchingAccount ? 'Выходим...' : 'Сменить аккаунт'}
            </button>
          </div>
        )}

        {pairing && (
          <PairingPanel
            scope={wantsAdmin ? 'ADMIN' : 'USER'}
            redirectTo={targetRedirect}
            onAuthenticated={handlePaired}
          />
        )}

        {/* Provider buttons. Neutral surface, brand-coloured logo only.
            Hierarchy = size + order, not colour. Yandex primary (RU market),
            Telegram secondary. Hidden when there is a known session. */}
        {continuityChecked && !continuity && !pairing && (
          <div className="space-y-2">
            {(import.meta as any).env?.VITE_AUTH_YANDEX_ENABLED === '1' && (
              <button
                onClick={handleYandexLogin}
                disabled={isLoading}
                className="w-full bg-pb-surface hover:bg-white/5 border border-white/10 text-white font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors active:scale-[0.99] disabled:opacity-60"
              >
                <span className="w-6 h-6 rounded bg-[#FFCC00] text-black font-black flex items-center justify-center flex-shrink-0">Я</span>
                <span>Продолжить с Яндексом</span>
              </button>
            )}
            <button
              onClick={handleTelegramLogin}
              disabled={isLoading}
              className="w-full bg-pb-surface hover:bg-white/5 border border-white/10 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition-colors active:scale-[0.99] disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin text-pb-subtext" />
              ) : (
                <>
                  <span className="w-6 h-6 rounded bg-[#24A1DE] text-white font-black flex items-center justify-center flex-shrink-0 text-[10px] tracking-tight">tg</span>
                  <span className="text-pb-subtext">Продолжить с Telegram</span>
                </>
              )}
            </button>
          </div>
        )}

        {!continuityChecked && (
          <div className="flex justify-center py-6">
            <Loader2 size={22} className="animate-spin text-pb-subtext" />
          </div>
        )}

        {isLocalDev && continuityChecked && !continuity && !pairing && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => handleLocalDevLogin('9000000101')}
              className="bg-pb-surface border border-pb-primary/40 text-pb-primary text-sm font-semibold py-2.5 rounded-xl hover:bg-pb-primary/10 transition-colors"
            >
              Dev капитан
            </button>
            <button
              onClick={() => handleLocalDevLogin('9000000103')}
              className="bg-pb-surface border border-white/20 text-pb-subtext text-sm font-semibold py-2.5 rounded-xl hover:bg-white/10 transition-colors"
            >
              Dev игрок
            </button>
          </div>
        )}

        <p className="text-xs text-center text-pb-subtext/70 mt-6 leading-relaxed">
          Войдя, ты принимаешь <Link to="/terms" className="underline hover:text-pb-subtext">условия</Link> и{' '}
          <Link to="/privacy" className="underline hover:text-pb-subtext">политику конфиденциальности</Link>.
        </p>
      </div>
    </div>
  );
};
