import React from 'react';

// Заглушка трека 1 «Вход и заявки»: заявки на вступление, адрес /t/:team/requests.
// Экран рисуется внутри оболочки команды: шапка и навигация уже есть,
// данные — через useShell() из pbth/shell/context.ts.
export const JoinRequestsView: React.FC = () => (
  <div className="px-4 pb-24 pt-4 text-white">
    <h1 className="text-2xl font-bold mb-2">Заявки</h1>
    <p className="text-pb-subtext">Здесь будут заявки на вступление в команду.</p>
  </div>
);
