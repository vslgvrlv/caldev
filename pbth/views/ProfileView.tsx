import React from 'react';
import { User, Role } from '../types';
import { Calendar as CalendarIcon, LogOut, Copy, Share2, Download, MessageCircle, Shield, ArrowRight } from 'lucide-react';
import { ProfileIdentities } from '../components/ProfileIdentities';
import { GuideEntrypoint } from '../components/GuideEntrypoint';
import { PushOptIn } from '../components/PushOptIn';

interface ProfileViewProps {
  user: User;
  onLogout: () => void | Promise<void>;
  calendarLink: string;
  onCopyLink: () => void;
  onShareLink: () => void;
  onDownloadICS: () => void;
  role: Role | null | undefined;
  /**
   * True when the current user is allowlisted as a platform owner.
   * Плитка «Консоль владельца» — только владельцу платформы.
   */
  canEnterAdmin?: boolean;
  /** Called when the admin-entry card is tapped. */
  onEnterAdmin?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  onLogout,
  calendarLink,
  onCopyLink,
  onShareLink,
  onDownloadICS,
  role,
  canEnterAdmin = false,
  onEnterAdmin,
}) => {
  return (
    <div
      className="p-4 pb-24 space-y-6 animate-fade-in"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 2rem)' }}
    >
      {/* Редактирования профиля здесь нет: прежняя форма («Редактировать →
          Сохранить», «Новый пароль», кнопка фото) ничего не сохраняла.
          Имя и ник приходят из Telegram при входе. */}
      <div className="text-center">
        <div className="w-28 h-28 mx-auto rounded-full bg-pb-surface p-1 border-2 border-pb-primary mb-3">
            <img
              src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=1E1E2E&color=fff`}
              className="w-full h-full rounded-full object-cover"
              alt={user.name}
            />
        </div>
        <h2 className="text-2xl font-bold text-white">{user.name}</h2>
        <p className="text-pb-primary font-mono text-lg">@{user.nickname}</p>
        <p className="mt-2 text-xs text-pb-subtext">Имя и ник берутся из Telegram.</p>
      </div>

      <div className="bg-[#24A1DE]/10 border border-[#24A1DE]/30 rounded-2xl p-4 flex items-center justify-between">
         <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-[#24A1DE] flex items-center justify-center text-white">
                <MessageCircle size={20} fill="currentColor" />
            </div>
            <div>
                <div className="text-white font-bold text-sm">Telegram подключен</div>
                <div className="text-[#24A1DE] text-xs">@{user.telegramUsername || user.nickname}</div>
            </div>
         </div>
      </div>

      <PushOptIn />

      <ProfileIdentities />

      <GuideEntrypoint role={role} />

      {/* Консоль владельца платформы — только владельцу (трек 3). */}
      {canEnterAdmin && (
        <button
          onClick={() => onEnterAdmin?.()}
          className="w-full bg-pb-surface border border-pb-primary/40 rounded-2xl p-4 flex items-center justify-between hover:bg-pb-primary/5 transition-colors active:scale-[0.99] text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-pb-primary/15 flex items-center justify-center flex-shrink-0">
              <Shield size={22} className="text-pb-primary" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="text-white font-bold text-sm">Консоль владельца</div>
              <div className="text-pb-subtext text-xs truncate">Все команды, заявки на создание, помощь командам</div>
            </div>
          </div>
          <ArrowRight size={18} className="text-pb-primary flex-shrink-0" />
        </button>
      )}

      <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 space-y-4">
          <h3 className="text-white font-bold flex items-center">
              <CalendarIcon size={18} className="mr-2 text-pb-primary" />
              Интеграция календаря
          </h3>
          <p className="text-xs text-pb-subtext">
              Подпишитесь на ваш персональный календарь, чтобы видеть события в Google/Apple Calendar.
          </p>
          
          <div className="bg-black/30 p-3 rounded-lg flex items-center justify-between border border-white/5">
              <code className="text-xs text-pb-subtext truncate max-w-[200px]">
                  {calendarLink}
              </code>
              <button 
                  onClick={onCopyLink}
                  className="text-pb-primary p-2 hover:bg-white/10 rounded active:scale-90 transition-transform"
              >
                  <Copy size={16} />
              </button>
          </div>
          
          <button 
              onClick={onShareLink}
              className="w-full py-3 bg-white/5 rounded-xl text-white font-semibold flex items-center justify-center gap-2 hover:bg-white/10 transition active:scale-[0.98]"
          >
               <Share2 size={18} /> Поделиться ссылкой
          </button>

          <button 
              onClick={onDownloadICS}
              className="w-full py-3 bg-pb-primary/10 border border-pb-primary/20 rounded-xl text-pb-primary font-semibold flex items-center justify-center gap-2 hover:bg-pb-primary/20 transition active:scale-[0.98]"
          >
               <Download size={18} /> Скачать .ics (Файл)
          </button>
      </div>

      <button 
        onClick={() => {
          void onLogout();
        }}
        className="w-full py-3 text-pb-danger font-semibold flex items-center justify-center gap-2 mt-8 hover:bg-pb-danger/10 rounded-xl transition-colors"
      >
           <LogOut size={18} /> Выйти из аккаунта
      </button>
    </div>
  );
};
