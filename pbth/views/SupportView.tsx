import React from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';

export const SupportView: React.FC = () => {
  return (
    <div className="min-h-screen bg-pb-background text-white">
      <main className="max-w-3xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center text-pb-primary hover:text-pb-secondary transition-colors mb-8">
          На главную
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <LifeBuoy size={24} className="text-pb-primary" />
          <h1 className="text-3xl font-black">Поддержка</h1>
        </div>

        <div className="space-y-5 text-pb-subtext leading-relaxed">
          <p>Если у вас вопрос по входу, уведомлениям или работе команды, напишите нам любым удобным способом.</p>
          <p>
            Telegram бот:
            {' '}
            <a className="text-pb-primary hover:text-pb-secondary" href="https://t.me/pbthub_bot" target="_blank" rel="noreferrer">
              @pbthub_bot
            </a>
          </p>
          <p>
            Email:
            {' '}
            <a className="text-pb-primary hover:text-pb-secondary" href="mailto:support@pbthub.ru">
              support@pbthub.ru
            </a>
          </p>
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
