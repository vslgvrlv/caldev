import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

// Журнал медленных запросов (personal-os#1431, механика 18 «скорость»).
// Одна строка `http.slow_request` на запрос дольше порога. Только метод,
// шаблон пути, код и время: без параметров, IP, id людей и тела запроса —
// по журналу видно, какая ручка тормозит, но не видно, чья.
export const SLOW_REQUEST_THRESHOLD_MS = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_RE = /^\d+$/;
// Токены календаря, приглашений и т. п.: длинные куски из букв, цифр, - и _,
// возможно с расширением (`<токен>.ics`).
const TOKEN_RE = /^[A-Za-z0-9_-]{16,}(\.[A-Za-z0-9]+)?$/;

// Путь без query и без значений: `/api/v1/events/<uuid>?x=1` → `/api/v1/events/:id`.
export function normalizeRequestPath(rawPath: string): string {
  const pathOnly = rawPath.split("?")[0].split("#")[0];
  return pathOnly
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (UUID_RE.test(segment) || NUMBER_RE.test(segment)) return ":id";
      const token = TOKEN_RE.exec(segment);
      if (token) return `:id${token[1] ?? ""}`;
      return segment;
    })
    .join("/");
}

// Шаблон маршрута Express (`/api/v1/events/:eventId`), если запрос дошёл до
// роутера; иначе — нормализованный путь.
export function routeTemplate(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === "string") {
    return normalizeRequestPath(`${req.baseUrl || ""}${routePath}`);
  }
  return normalizeRequestPath(req.originalUrl || req.url || "");
}

export function createSlowRequestLog(options?: { thresholdMs?: number; now?: () => number }) {
  const thresholdMs = options?.thresholdMs ?? SLOW_REQUEST_THRESHOLD_MS;
  const now = options?.now ?? (() => Number(process.hrtime.bigint() / 1_000_000n));

  return function slowRequestLog(req: Request, res: Response, next: NextFunction) {
    const startedAt = now();
    res.on("finish", () => {
      const durationMs = now() - startedAt;
      if (durationMs <= thresholdMs) return;
      logger.warn("http.slow_request", {
        method: req.method,
        route: routeTemplate(req),
        statusCode: res.statusCode,
        durationMs,
      });
    });
    next();
  };
}

export const slowRequestLog = createSlowRequestLog();
