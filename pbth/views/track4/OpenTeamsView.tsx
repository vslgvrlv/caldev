import React from 'react';

// Заглушка трека 4 «Открытые слоты»: команды с открытым расписанием, адрес /teams.
export const OpenTeamsView: React.FC = () => (
  <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
    <div className="text-center max-w-sm">
      <div className="text-xl font-bold mb-3">Команды с открытым расписанием</div>
      <p className="text-pb-subtext">Скоро здесь появится список команд, к которым можно записаться на свободный слот.</p>
    </div>
  </div>
);
