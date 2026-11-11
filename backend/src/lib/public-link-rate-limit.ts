import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";

// Ограничитель чтения для открытых ручек ссылок приглашения:
//   GET /teams/invites/:token, GET /join-requests/link/:code.
// Они отвечают без входа, а код ссылки команды — 6 символов, поэтому перебор
// упирается в предел: 30 запросов в минуту на IP (RATE_PUBLIC_LINK_MAX,
// RATE_PUBLIC_LINK_WINDOW_MS). Считаются все ответы, и 404 тоже — иначе
// перебор несуществующих кодов шёл бы бесплатно.
//
// Ключ — `req.ip`, как у остальных ограничителей: приложение стоит за одним
// прокси (`trust proxy` = 1), адрес берётся из X-Forwarded-For.
// У каждой ручки свой счётчик: функция возвращает новый ограничитель на вызов.
// Отказ — 429 в общем формате `{ code, detail, correlationId }`.

export function publicLinkReadLimiter(): RequestHandler {
  return rateLimit({
    windowMs: env.rateLimit.publicLinkWindowMs,
    limit: env.rateLimit.publicLinkMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ code: "RATE_LIMITED", detail: "Too many requests, try again later", correlationId: req.correlationId });
    },
  });
}
