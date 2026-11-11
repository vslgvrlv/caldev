import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui';
import { slotsPath } from '../../api/track4';
import type { ShellExtContext } from '../../shell/extensions';

// Значок в шапке команды: вход на экран открытых слотов (`/teams`) — мои
// записи гостем, свободные слоты подписок, команды с открытым расписанием.
// Без запроса к серверу: шапка рисуется на каждом экране, лишний запрос на
// каждый переход не нужен.

export const SlotsHeaderBadge: React.FC<ShellExtContext> = () => {
  const navigate = useNavigate();
  return <Button variant="ghost" icon="tag" aria-label="Свободные слоты" title="Свободные слоты" onClick={() => navigate(slotsPath.list())} />;
};
