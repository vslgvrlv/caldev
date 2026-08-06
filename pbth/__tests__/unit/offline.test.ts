import { describe, expect, it } from 'vitest';
import { OFFLINE_ERROR_CODE, formatSnapshotAge, isOfflineError, toOfflineError } from '../../lib/offline';

// Корень бага «на турнире приложение не открывается» — неразличимость двух
// совершенно разных событий. 401 требует логина, отсутствие сети требует
// снимка; до этой функции оба лечились одинаково и оба вели на экран входа,
// который без сети тем более не работает.
describe('распознавание офлайна', () => {
  it('ошибка со статусом пришла от сервера, значит сеть жива', () => {
    const serverError = Object.assign(new Error('Unauthorized'), { status: 401 });
    expect(isOfflineError(serverError)).toBe(false);
  });

  it('TypeError без статуса — fetch не дошёл до сервера', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('наша офлайн-ошибка узнаётся по коду, а не по типу', () => {
    const error = toOfflineError(new TypeError('Failed to fetch'));
    expect(error.code).toBe(OFFLINE_ERROR_CODE);
    expect(isOfflineError(error)).toBe(true);
  });

  // 500 — тоже TypeError не порождает, но проверка на всякий случай: сервер,
  // ответивший ошибкой, не должен уводить приложение в офлайн-режим со старым
  // снимком, иначе человек будет смотреть на вчерашние данные вместо аварии.
  it('пятисотка — не офлайн', () => {
    const serverError = Object.assign(new Error('Internal'), { status: 500 });
    expect(isOfflineError(serverError)).toBe(false);
  });

  it('мусор вместо ошибки офлайном не считается', () => {
    expect(isOfflineError(null)).toBe(false);
    expect(isOfflineError('Failed to fetch')).toBe(false);
  });
});

// Возраст снимка — не украшение: состав и расписание на турнире меняются по
// ходу дня, и экран недельной давности выглядит ровно как сегодняшний.
describe('возраст снимка', () => {
  const base = Date.UTC(2026, 7, 6, 12, 0, 0);

  it('свежий снимок не пугает точностью до секунд', () => {
    expect(formatSnapshotAge(base, base + 30_000)).toBe('только что');
  });

  it('минуты, часы и дни называются своими словами', () => {
    expect(formatSnapshotAge(base, base + 12 * 60_000)).toBe('12 мин назад');
    expect(formatSnapshotAge(base, base + 3 * 3600_000)).toBe('3 ч назад');
    expect(formatSnapshotAge(base, base + 26 * 3600_000)).toBe('вчера');
    expect(formatSnapshotAge(base, base + 5 * 24 * 3600_000)).toBe('5 дн назад');
  });

  // Граница суток — место, где обычно вылезает «0 дн назад».
  it('на границе суток не появляется нулевых значений', () => {
    expect(formatSnapshotAge(base, base + 23 * 3600_000)).toBe('23 ч назад');
    expect(formatSnapshotAge(base, base + 24 * 3600_000)).toBe('вчера');
  });
});
