import React, { useEffect, useState } from 'react';
import { UserRoleOption, Role } from '../types';
import { Send, Shield, User as UserIcon, ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import {
  extractAuthError,
  normalizeAuthErrorCode,
  resolveAuthErrorMessage,
  resolveTelegramLoginTransport,
  sendAuthTelemetry,
} from '../lib/auth-ux';

interface LoginViewProps {
  onLogin: () => void;
  onSelectRole: (roleOption: UserRoleOption) => void;
  availableRoles: UserRoleOption[];
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onSelectRole, availableRoles }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authQuery = searchParams.toString();
  const [step, setStep] = useState<'LOGIN' | 'SELECT'>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string>('');
  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
  const safeAreaFrameStyle = {
    paddingTop: 'calc(var(--pb-safe-top) + 1.5rem)',
    paddingRight: 'calc(var(--pb-safe-right) + 1.5rem)',
    paddingBottom: 'calc(var(--pb-safe-bottom) + 1.5rem)',
    paddingLeft: 'calc(var(--pb-safe-left) + 1.5rem)',
  } as const;

  useEffect(() => {
    const params = new URLSearchParams(authQuery);
    const code = normalizeAuthErrorCode(params.get('auth_error') || params.get('code'));
    const detail = params.get('detail');
    if (!code && !detail) return;

    const message = resolveAuthErrorMessage({ code, detail, scope: 'USER' });
    setAuthError(message);
    sendAuthTelemetry({
      scope: 'USER',
      flow: Boolean((window as any)?.Telegram?.WebApp) ? 'MINIAPP' : 'BOT_HANDOFF',
      event: 'error_page',
      code,
      detail,
    });
  }, [authQuery]);

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

  const handleTelegramLogin = async () => {
    setIsLoading(true);
    setAuthError('');
    try {
      sessionStorage.setItem('pbth:post-auth-app', '1');
      sessionStorage.removeItem('pbth:skip-auto-auth-after-logout');
      sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
      localStorage.removeItem('pbth:skip-auto-auth-after-logout');
      const hasTelegramWebApp = Boolean((window as any).Telegram?.WebApp);
      sendAuthTelemetry({
        scope: 'USER',
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
            scope: 'USER',
            flow: 'BOT_HANDOFF',
            event: 'webapp_initdata_missing_fallback_handoff',
            code: 'INITDATA_MISSING',
          });
        }
        const handoff = await api.startTelegramHandoff('USER', '/app');
        window.location.assign(handoff.botUrl);
        return;
      }
      try {
        await api.authTelegramWebApp(initData, true);
        const authenticated = await checkAuthenticated();
        if (authenticated) {
          sendAuthTelemetry({
            scope: 'USER',
            flow: 'MINIAPP',
            event: 'login_success',
          });
          onLogin();
          return;
        }
        console.warn('Telegram WebApp auth returned 200 but session is still anonymous');
        setAuthError('Вход не завершился. Повторите попытку из Telegram Mini App.');
        sendAuthTelemetry({
          scope: 'USER',
          flow: 'MINIAPP',
          event: 'login_error',
          code: 'SESSION_ANONYMOUS',
        });
        return;
      } catch (err) {
        console.warn('Telegram WebApp auth from login screen failed', err);
        const authErr = extractAuthError(err);
        setAuthError(resolveAuthErrorMessage({ code: authErr.code, detail: authErr.detail, scope: 'USER' }));
        sendAuthTelemetry({
          scope: 'USER',
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

  const handleLocalDevLogin = (telegramId: string) => {
    sessionStorage.setItem('pbth:post-auth-app', '1');
    window.location.assign(`/api/v1/auth/dev/login?telegramId=${encodeURIComponent(telegramId)}&redirectTo=%2Fapp`);
  };

  if (step === 'SELECT') {
    return (
      <div
        className="min-h-screen bg-pb-background flex flex-col items-center justify-center animate-fade-in relative overflow-hidden"
        style={safeAreaFrameStyle}
      >
        {/* Decorative BG */}
        <div className="absolute top-0 left-0 w-full h-full bg-splatter opacity-20 pointer-events-none"></div>
        
        <h2 className="text-2xl font-bold text-white mb-2 z-10">Выберите профиль</h2>
        <p className="text-pb-subtext text-center mb-8 z-10">
          К вашему Telegram аккаунту привязано несколько ролей.
        </p>

        <div className="w-full max-w-sm space-y-4 z-10">
          {availableRoles.map((option, idx) => (
            <button
              key={idx}
              onClick={() => onSelectRole(option)}
              className="w-full bg-pb-surface border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:bg-white/5 transition-colors active:scale-[0.98]"
            >
              <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${option.role === Role.ADMIN || option.role === Role.CAPTAIN ? 'bg-pb-primary/20 text-pb-primary' : 'bg-blue-500/20 text-blue-500'}`}>
                   {option.role === Role.ADMIN || option.role === Role.CAPTAIN ? <Shield size={24} /> : <UserIcon size={24} />}
                </div>
                <div className="text-left">
                  <div className="font-bold text-white text-lg">{option.teamName}</div>
                  <div className="text-xs text-pb-subtext uppercase tracking-wider font-bold">{option.role}</div>
                </div>
              </div>
              <div className="w-2 h-2 rounded-full bg-pb-primary shadow-[0_0_10px_rgba(0,230,118,0.5)]"></div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-pb-background flex flex-col items-center justify-center relative overflow-hidden animate-fade-in"
      style={safeAreaFrameStyle}
    >
       {/* Back Link */}
       <Link to="/" className="absolute top-0 left-0 text-pb-subtext hover:text-white flex items-center space-x-2 transition-colors z-20">
         <ArrowLeft size={20} />
         <span className="font-medium">На главную</span>
       </Link>

       {/* Background Effects */}
       <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-pb-primary/20 rounded-full blur-3xl animate-pulse"></div>
       <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
       
       <div className="z-10 text-center mb-12">
          <div className="w-24 h-24 mx-auto bg-gradient-to-tr from-pb-primary to-blue-500 rounded-3xl rotate-12 flex items-center justify-center mb-6 shadow-2xl shadow-pb-primary/20">
             <Shield size={48} className="text-white -rotate-12" strokeWidth={2.5} />
          </div>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight">PaintBall <br/> <span className="text-pb-primary">Team Hub</span></h1>
          <p className="text-pb-subtext">Управляй командой, тренировками<br/> и победами в одном месте.</p>
       </div>

      <div className="w-full max-w-sm z-10">
          {authError && (
            <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {authError}
            </div>
          )}
          <button 
            onClick={handleTelegramLogin}
            disabled={isLoading}
            className="w-full bg-[#24A1DE] hover:bg-[#208bbf] text-white font-bold py-4 rounded-xl flex items-center justify-center space-x-3 transition-all active:scale-95 shadow-lg shadow-[#24A1DE]/30"
          >
            {isLoading ? (
               <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
               <>
                 <Send size={24} />
                 <span>Войти через Telegram</span>
               </>
            )}
          </button>
          <button
            onClick={() => navigate('/admin/login')}
            className="w-full mt-3 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl flex items-center justify-center space-x-2 transition-all active:scale-95"
          >
            <Shield size={18} />
            <span>Режим админки</span>
          </button>
          {isLocalDev && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => handleLocalDevLogin('9000000101')}
                className="bg-pb-surface border border-pb-primary/40 text-pb-primary font-bold py-3 rounded-xl hover:bg-pb-primary/10 transition-colors"
              >
                Dev капитан
              </button>
              <button
                onClick={() => handleLocalDevLogin('9000000103')}
                className="bg-pb-surface border border-white/20 text-pb-subtext font-bold py-3 rounded-xl hover:bg-white/10 transition-colors"
              >
                Dev игрок
              </button>
            </div>
          )}
          <p className="text-xs text-center text-pb-subtext mt-6 opacity-60">
            Нажимая войти, вы принимаете условия использования и политику конфиденциальности.
          </p>
       </div>
    </div>
  );
};
