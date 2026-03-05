import React, { useState } from 'react';
import { UserRoleOption, Role } from '../types';
import { Send, Shield, User as UserIcon, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface LoginViewProps {
  onLogin: () => void;
  onSelectRole: (roleOption: UserRoleOption) => void;
  availableRoles: UserRoleOption[];
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin: _onLogin, onSelectRole, availableRoles }) => {
  const [step, setStep] = useState<'LOGIN' | 'SELECT'>('LOGIN');
  const [isLoading, setIsLoading] = useState(false);
  const isLocalDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');

  const handleTelegramLogin = async () => {
    setIsLoading(true);
    sessionStorage.setItem('pbth:post-auth-app', '1');
    const initData = String((window as any).Telegram?.WebApp?.initData || '').trim();
    if (initData) {
      try {
        await api.authTelegramWebApp(initData);
        window.location.assign('/app');
        return;
      } catch (err) {
        console.warn('Telegram WebApp auth from login screen failed, fallback to OAuth redirect', err);
      }
    }
    window.location.assign('/api/v1/auth/telegram/direct');
  };

  const handleLocalDevLogin = (telegramId: string) => {
    sessionStorage.setItem('pbth:post-auth-app', '1');
    window.location.assign(`/api/v1/auth/dev/login?telegramId=${encodeURIComponent(telegramId)}&redirectTo=%2Fapp`);
  };

  if (step === 'SELECT') {
    return (
      <div className="min-h-screen bg-pb-background flex flex-col items-center justify-center p-6 animate-fade-in relative overflow-hidden">
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
    <div className="min-h-screen bg-pb-background flex flex-col items-center justify-center p-6 relative overflow-hidden animate-fade-in">
       {/* Back Link */}
       <Link to="/" className="absolute top-8 left-8 text-pb-subtext hover:text-white flex items-center space-x-2 transition-colors z-20">
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
