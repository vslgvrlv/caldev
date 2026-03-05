import React from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

export const PrivacyView: React.FC = () => {
  return (
    <div className="min-h-screen bg-pb-background text-white">
      <main className="max-w-3xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center text-pb-primary hover:text-pb-secondary transition-colors mb-8">
          На главную
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <Shield size={24} className="text-pb-primary" />
          <h1 className="text-3xl font-black">Политика конфиденциальности</h1>
        </div>

        <div className="space-y-5 text-pb-subtext leading-relaxed">
          <p>Мы храним только данные, необходимые для работы платформы: профиль пользователя, команды, события и RSVP-статусы.</p>
          <p>Авторизация выполняется через Telegram. Логин и базовые данные аккаунта используются только для входа и отображения в интерфейсе команды.</p>
          <p>Данные не передаются третьим лицам, за исключением технических провайдеров хостинга и инфраструктуры, которые обеспечивают работу сервиса.</p>
          <p>По запросу пользователя профиль и связанные данные могут быть деактивированы администратором команды.</p>
        </div>

        <div className="mt-10">
          <Link to="/login" className="inline-block bg-pb-primary text-pb-background px-6 py-3 rounded-xl font-bold hover:bg-pb-secondary transition-colors">
            Войти в приложение
          </Link>
        </div>
      </main>
    </div>
  );
};
