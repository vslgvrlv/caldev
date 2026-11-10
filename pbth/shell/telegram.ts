// Mini App определяется по данным запуска, а не по наличию скрипта Telegram.
//
// Скрипт `telegram-web-app.js` грузится на каждой странице, в том числе в
// обычном браузере, и там тоже создаёт `Telegram.WebApp` — только с пустым
// `initData`. Раньше приложение считало такой браузер Mini App: вошедшего
// человека уводило с `/support`, `/privacy`, `/terms` в приложение, а перед
// кодом входа стояла пауза больше секунды в ожидании данных, которых не будет.
//
// Данные запуска Telegram кладёт в адрес (`#tgWebAppData=…`), а скрипт после
// загрузки — в `Telegram.WebApp.initData` и в sessionStorage. Скрипт грузится
// асинхронно, поэтому читаем все три места: так ответ верный и до него.

function fromHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.includes('tgWebAppData=')) return '';
  try {
    return new URLSearchParams(raw).get('tgWebAppData') || '';
  } catch {
    return '';
  }
}

function fromSessionStorage(): string {
  try {
    const stored = window.sessionStorage.getItem('__telegram__initParams');
    if (!stored) return '';
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return typeof parsed?.tgWebAppData === 'string' ? parsed.tgWebAppData : '';
  } catch {
    return '';
  }
}

/** Данные запуска Mini App или пустая строка вне Telegram. */
export function readMiniAppInitData(): string {
  if (typeof window === 'undefined') return '';
  const fromSdk = String((window as any).Telegram?.WebApp?.initData || '').trim();
  if (fromSdk) return fromSdk;
  return (fromHash(window.location.hash || '') || fromSessionStorage()).trim();
}

export function isTelegramMiniApp(): boolean {
  return readMiniAppInitData() !== '';
}
