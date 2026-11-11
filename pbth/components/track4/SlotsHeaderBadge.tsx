import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { slotsPath } from '../../api/track4';
import type { ShellExtContext } from '../../shell/extensions';

// Значок в шапке команды: вход на экран открытых слотов (`/teams`) — мои
// записи гостем, свободные слоты подписок, команды с открытым расписанием.
// Без запроса к серверу: шапка рисуется на каждом экране, лишний запрос на
// каждый переход не нужен.

export const SlotsHeaderBadge: React.FC<ShellExtContext> = () => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(slotsPath.list())}
      aria-label="Свободные слоты"
      title="Свободные слоты"
      className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-pb-subtext hover:text-white transition-colors"
    >
      <Ticket size={18} />
    </button>
  );
};
