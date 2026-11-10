// Адрес, куда сервер отправляет человека после входа (`redirectTo`, `next`).
//
// Принимается только путь внутри этого же сайта. Иначе получается открытый
// переход: злоумышленник даёт ссылку `/auth/yandex/start?redirectTo=//evil.example`,
// человек честно входит, и сайт сам отправляет его на чужой адрес.
//
// Отсекаем:
//   - всё, что не начинается с `/` (`https://…`, `javascript:…`);
//   - `//host` — адрес без схемы, браузер уходит на другой хост;
//   - любой обратный слеш: браузеры читают `/\host` как `//host`;
//   - управляющие символы (подмена заголовков в Location);
//   - слишком длинные строки.
export function sanitizeRelativeRedirect(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.length > 512) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  if (input.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(input)) return null;
  return input;
}

export function sanitizeRedirectTo(input: unknown, fallback = "/app"): string {
  return sanitizeRelativeRedirect(input) ?? fallback;
}
