import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';

export const TermsView: React.FC = () => {
  return (
    <div className="min-h-screen bg-pb-background text-white">
      <main className="max-w-3xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center text-pb-primary hover:text-pb-secondary transition-colors mb-8">
          На главную
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <FileText size={24} className="text-pb-primary" />
          <h1 className="text-3xl font-black">Условия использования</h1>
        </div>

        <div className="space-y-5 text-pb-subtext leading-relaxed">
          <p>PaintBall Team Hub предоставляет инструменты для управления командами, событиями и коммуникацией участников.</p>
          <p>Пользователь обязуется указывать корректные данные и не использовать сервис для спама, мошенничества и действий, нарушающих законодательство.</p>
          <p>Администраторы команд отвечают за корректность расписания, рассылок и состава участников внутри своей команды.</p>
          <p>Сервис может обновляться и изменять функциональность без предварительного уведомления, если это необходимо для стабильности и безопасности.</p>
        </div>

        <div className="mt-10">
          <Link to="/login" className="inline-block bg-pb-primary text-pb-background px-6 py-3 rounded-xl font-bold hover:bg-pb-secondary transition-colors">
            Перейти ко входу
          </Link>
        </div>
      </main>
    </div>
  );
};
