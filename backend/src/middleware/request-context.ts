import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

const CORRELATION_HEADER = "x-correlation-id";

export function attachRequestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(CORRELATION_HEADER);
  req.correlationId = incoming?.trim() || randomUUID();
  res.setHeader(CORRELATION_HEADER, req.correlationId);

  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("http.request", {
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userId: req.authUser?.id ?? null,
    });
  });

  next();
}
