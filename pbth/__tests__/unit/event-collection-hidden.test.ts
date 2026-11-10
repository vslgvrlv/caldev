// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from 'node:fs';
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Role } from '../../types';
import { EVENT_COLLECTION_ENABLED, canShowEventCollection } from '../../lib/event-collection-access';

// Решение Василия 10.11.2026, п. 9: недоделанное с денежных экранов убрать.
// Расход, внесённый в событии, списывался из казны, но в самом событии не
// появлялся, а кнопка сбора была заблокирована навсегда. Блок прячется у всех,
// пока сбор не переделан; код и данные остаются — второй заход начнётся с них.

describe('«Сбор по событию» спрятан у всех', () => {
  it('выключен для каждой роли', () => {
    expect(EVENT_COLLECTION_ENABLED).toBe(false);
    for (const role of [Role.ADMIN, Role.CAPTAIN, Role.TRAINER, Role.PLAYER]) {
      expect(canShowEventCollection(role)).toBe(false);
    }
  });

  it('когда его включат обратно, игроку он по-прежнему не показывается', () => {
    expect(canShowEventCollection(Role.PLAYER, true)).toBe(false);
    expect(canShowEventCollection(Role.CAPTAIN, true)).toBe(true);
    expect(canShowEventCollection(Role.TRAINER, true)).toBe(true);
  });
});

describe('экран события следует этому правилу', () => {
  const source = readFileSync(fileURLToPath(new URL('../../views/EventDetailView.tsx', import.meta.url)), 'utf8');

  it('право на сбор берётся только из общей функции', () => {
    expect(source).toContain('canShowEventCollection(currentUserRole)');
    // Прежнее правило «все, кроме игрока» вернуло бы блок мимо выключателя.
    expect(source).not.toContain('const canReadEventFinance = currentUserRole !== Role.PLAYER');
  });

  it('без права финансы события даже не запрашиваются', () => {
    // Загрузка стоит за тем же условием: незачем ходить за данными для экрана,
    // которого нет.
    expect(source).toMatch(/if \(!canReadEventFinance\) \{\s*setFinanceDetail\(null\);\s*return;\s*\}/);
  });

  it('код сбора не удалён: листы и ручки на месте для второго захода', () => {
    expect(source).toContain('api.getFinanceEventDetail(event.id)');
    expect(source).toContain('<EventExpensesSheet');
    expect(source).toContain('<EventCollectionSheet');
    expect(source).toContain('<TransferConfirmationModal');
  });
});
