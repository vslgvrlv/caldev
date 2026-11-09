import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { routeTemplate } from "./slow-request-log.js";

const CORRELATION_HEADER = "x-correlation-id";

export function attachRequestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(CORRELATION_HEADER);
  req.correlationId = incoming?.trim() || randomUUID();
  res.setHeader(CORRELATION_HEADER, req.correlationId);

  // Журнал запросов без персональных данных (personal-os#1436): шаблон пути
  // без query и значений, без IP и id пользователя. По строке видно, какая
  // ручка ответила и как быстро, но не видно, кто ходил.
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("http.request", {
      correlationId: req.correlationId,
      method: req.method,
      route: routeTemplate(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}
