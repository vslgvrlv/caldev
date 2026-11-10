// Обработчик кнопки бота (callback_query). Контракт основы ревизии 11.11.2026:
// каждый файл каталога `bot-callbacks/` экспортирует `prefix` и `handle`,
// вебхук выбирает обработчик по части `callback_data` до первого двоеточия.
//
// Префиксы: `pair` (вход по коду, есть), `join` и `team` (трек 1), `rsvp`
// (трек 2), `slot` (трек 4). Новый трек добавляет свой файл и не правит общие.

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: { id?: number | string; [key: string]: unknown };
  message?: { message_id?: number | string; chat?: { id?: number | string }; text?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type BotCallbackContext = {
  /** Всё обновление Telegram целиком. */
  update: Record<string, any>;
  /** Часть `callback_data` после префикса и двоеточия. */
  payload: string;
  correlationId?: string;
};

export type BotCallbackHandler = {
  prefix: string;
  /** true — кнопка обработана; false — обработчик её не узнал. */
  handle: (callback: TelegramCallbackQuery, ctx: BotCallbackContext) => Promise<boolean>;
};

export function callbackPrefix(data: unknown): string | null {
  if (typeof data !== "string" || !data) return null;
  const idx = data.indexOf(":");
  const prefix = idx === -1 ? data : data.slice(0, idx);
  return /^[a-z][a-z0-9_-]{0,31}$/i.test(prefix) ? prefix : null;
}
