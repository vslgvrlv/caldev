import type { Request, Response } from "express";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR"
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "ALREADY_MEMBER"
  | "ROLE_REQUIRED"
  | "EVENT_NOT_FOUND"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_STATE_EXPIRED"
  | "OAUTH_NO_ACCOUNT"
  | "OAUTH_LINK_TAKEN"
  | "OAUTH_LAST_IDENTITY"
  | "OAUTH_PROVIDER_DISABLED"
  | "OAUTH_PENDING_LINK_EXPIRED";

export function httpStatusToCode(status: number): ApiErrorCode {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  return "INTERNAL_SERVER_ERROR";
}

export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: ApiErrorCode,
  detail: string,
  extra?: Record<string, unknown>
) {
  return res.status(status).json({
    code,
    detail,
    correlationId: req.correlationId,
    ...(extra || {}),
  });
}

export function withErrorMetadata(req: Request, body: unknown, statusCode: number): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const mutable = body as Record<string, unknown>;
  if (!("detail" in mutable)) return body;
  if (!("code" in mutable)) {
    mutable.code = httpStatusToCode(statusCode);
  }
  if (!("correlationId" in mutable)) {
    mutable.correlationId = req.correlationId;
  }
  return mutable;
}
