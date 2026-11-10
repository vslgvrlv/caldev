import React from 'react';
import { useParams } from 'react-router-dom';

// Заглушка трека 1 «Вход и заявки»: вступление по ссылке команды, адрес /join/:code.
// Адрес открыт и без входа: трек сам решает, когда отправлять на /login?next=…
export const JoinByCodeView: React.FC = () => {
  const { code } = useParams();
  return (
    <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
      <div className="text-center max-w-sm">
        <div className="text-xl font-bold mb-3">Вступление в команду</div>
        <p className="text-pb-subtext">Код команды: {String(code || '').toUpperCase()}. Скоро здесь можно будет подать заявку.</p>
      </div>
    </div>
  );
};
