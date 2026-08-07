import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_ERROR_CODE, formatSnapshotAge, isOfflineError, toOfflineError } from '../../lib/offline';
import { api, markNetworkAlive } from '../../api';

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

// Ровно этот случай оставлял приложение на вечном загрузочном спиннере: iPhone
// в самолётном режиме не отбивает запрос ошибкой, а держит его открытым. Весь
// офлайн-слой ждал отказа fetch, отказ не приходил никогда, и до чтения снимка
// дело не доходило. Поэтому «сети нет» теперь наступает по сроку, а не только
// по отвергнутому промису.
describe('зависшая сеть считается офлайном', () => {
  beforeEach(() => {
    markNetworkAlive();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const hangingFetch = () =>
    vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      }),
    );

  it('запрос, который никогда не отвечает, обрывается по сроку', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = api.getInitData();
    const assertion = expect(pending).rejects.toMatchObject({ code: OFFLINE_ERROR_CODE });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('то же и для проверки сессии — иначе вход зависает до перезапуска', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = api.getAuthMe();
    const assertion = expect(pending).rejects.toMatchObject({ code: OFFLINE_ERROR_CODE });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  // Старт делает несколько запросов подряд. Если каждый заново выжидает свой
  // срок, открытие приложения без сети стоит не шесть секунд, а все двадцать —
  // человек столько перед спиннером не сидит.
  it('после первого просроченного запроса следующие чтения не ждут заново', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const first = api.getAuthMe();
    const firstAssertion = expect(first).rejects.toMatchObject({ code: OFFLINE_ERROR_CODE });
    await vi.advanceTimersByTimeAsync(10_000);
    await firstAssertion;

    await expect(api.getInitData()).rejects.toMatchObject({ code: OFFLINE_ERROR_CODE });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Браузер уже знает, что сети нет. Ждать восьми секунд, чтобы узнать то же
  // самое, — значит держать человека перед спиннером на ровном месте.
  it('при выключенной сети запрос не уходит вовсе', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: false });

    await expect(api.getInitData()).rejects.toMatchObject({ code: OFFLINE_ERROR_CODE });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
