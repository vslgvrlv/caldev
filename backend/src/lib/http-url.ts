import { z } from "zod";

// Ссылка на место (карты) открывается в браузере участника как <a href>.
// Пускаем только http и https: `javascript:` и `data:` в href выполняются в
// контексте приложения от имени того, кто нажал (ревью безопасности 10.11.2026, №2).

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Значение для ответа: ссылка только если она http(s), иначе null. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed && isHttpUrl(trimmed) ? trimmed : null;
}

const HTTP_URL_MESSAGE = "Ссылка на место должна начинаться с http:// или https://";

/** Поле запроса: пустая строка допустима (ссылки нет), остальное — только http(s). */
export const locationUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => value === "" || isHttpUrl(value), { message: HTTP_URL_MESSAGE });
