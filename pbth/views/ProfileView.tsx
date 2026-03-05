import React, { useState } from 'react';
import { User, Role } from '../types';
import { Calendar as CalendarIcon, LogOut, Copy, Share2, Download, Edit2, Save, X, Lock, Camera, MessageCircle } from 'lucide-react';

interface ProfileViewProps {
  user: User;
  onUpdateUser: (updatedUser: User) => void;
  onLogout: () => void;
  calendarLink: string;
  onCopyLink: () => void;
  onShareLink: () => void;
  onDownloadICS: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ 
  user, 
  onUpdateUser, 
  onLogout,
  calendarLink,
  onCopyLink,
  onShareLink,
  onDownloadICS
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ ...user, password: '' });

  const handleSave = () => {
    onUpdateUser({
        ...editForm,
        // If simulated password change needed, handle here
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditForm({ ...user, password: '' });
    setIsEditing(false);
  };

  return (
    <div className="p-4 pt-8 pb-24 space-y-6 animate-fade-in">
      <div className="text-center relative">
        <div className="w-28 h-28 mx-auto rounded-full bg-pb-surface p-1 border-2 border-pb-primary mb-3 relative group">
            <img src={user.avatar} className="w-full h-full rounded-full object-cover" alt="profile" />
            {isEditing && (
                <button className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center text-white opacity-100 transition-opacity">
                    <Camera size={24} />
                </button>
            )}
        </div>
        
        {!isEditing ? (
            <>
                <h2 className="text-2xl font-bold text-white">{user.name}</h2>
                <p className="text-pb-primary font-mono text-lg mb-4">@{user.nickname}</p>
                <button 
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center space-x-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full text-sm font-semibold text-white transition-colors border border-white/5"
                >
                    <Edit2 size={14} /> <span>Редактировать</span>
                </button>
            </>
        ) : (
            <div className="bg-pb-surface p-4 rounded-2xl border border-white/10 space-y-4 max-w-sm mx-auto text-left">
                <div>
                    <label className="text-xs text-pb-subtext font-bold uppercase block mb-1">Имя</label>
                    <input 
                        type="text" 
                        value={editForm.name}
                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-xs text-pb-subtext font-bold uppercase block mb-1">Позывной (Ник)</label>
                    <input 
                        type="text" 
                        value={editForm.nickname}
                        onChange={(e) => setEditForm({...editForm, nickname: e.target.value})}
                        className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-xs text-pb-subtext font-bold uppercase block mb-1">Новый Пароль</label>
                    <div className="relative">
                        <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pb-subtext" />
                        <input 
                            type="password" 
                            placeholder="Оставьте пустым, если не меняете"
                            value={editForm.password || ''}
                            onChange={(e) => setEditForm({...editForm, password: e.target.value})}
                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 pl-10 text-white focus:border-pb-primary focus:outline-none"
                        />
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    <button onClick={handleCancel} className="flex-1 py-3 bg-white/5 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2">
                        <X size={16} /> Отмена
                    </button>
                    <button onClick={handleSave} className="flex-1 py-3 bg-pb-primary text-pb-background rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                        <Save size={16} /> Сохранить
                    </button>
                </div>
            </div>
        )}
      </div>

      <div className="bg-[#24A1DE]/10 border border-[#24A1DE]/30 rounded-2xl p-4 flex items-center justify-between">
         <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-[#24A1DE] flex items-center justify-center text-white">
                <MessageCircle size={20} fill="currentColor" />
            </div>
            <div>
                <div className="text-white font-bold text-sm">Telegram подключен</div>
                <div className="text-[#24A1DE] text-xs">@{user.nickname}_tg</div>
            </div>
         </div>
      </div>

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
        onClick={onLogout}
        className="w-full py-3 text-pb-danger font-semibold flex items-center justify-center gap-2 mt-8 hover:bg-pb-danger/10 rounded-xl transition-colors"
      >
           <LogOut size={18} /> Выйти из аккаунта
      </button>
    </div>
  );
};