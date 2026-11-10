import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { isPlatformOwner } from "../../lib/team-access.js";
import { sendTrackError } from "../join-requests/delivery.js";
import {
  createTeamRequest,
  decideTeamRequest,
  listMyTeamRequests,
  listTeamRequests,
  TeamDecisionError,
  type TeamRequestStatus,
} from "./service.js";

// Заявки на создание команды (трек 1 ревизии PBTH, 11.11.2026).
//
//   POST /team-requests { name }        — человек просит команду;
//   GET  /team-requests/mine            — мои заявки (экран «нет команды»);
//   GET  /team-requests?status=pending  — владелец платформы (консоль трека 3);
//   POST /team-requests/:id/approve     — владелец: создать команду;
//   POST /team-requests/:id/decline     — владелец: отклонить.
//
// Ответ списка: `{ requests: [{ id, name, status, createdAt, decidedAt,
// team: { id, name, shortCode } | null, user: { id, name, nickname, username } }] }`.

export const teamRequestsRouter = Router();

const createSchema = z.object({ name: z.string().trim().min(2).max(60) });
const idSchema = z.string().uuid();
const STATUSES: Record<string, TeamRequestStatus> = {
  pending: "PENDING",
  approved: "APPROVED",
  declined: "DECLINED",
  cancelled: "CANCELLED",
};

function requireOwner(req: Request, res: Response): boolean {
  if (isPlatformOwner(req)) return true;
  sendTrackError(req, res, 403, "FORBIDDEN", "Only the platform owner can review team requests");
  return false;
}

teamRequestsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = createSchema.parse(req.body ?? {});
    const result = await createTeamRequest(req.authUser!.id, payload.name);
    return res.status(result.created ? 201 : 200).json({ created: result.created, request: result.request });
  })
);

teamRequestsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({ requests: await listMyTeamRequests(req.authUser!.id) });
  })
);

teamRequestsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const raw = String(req.query.status ?? "").toLowerCase();
    if (raw && !STATUSES[raw]) {
      return sendTrackError(req, res, 400, "BAD_REQUEST", "Unknown status");
    }
    return res.json({ requests: await listTeamRequests(raw ? STATUSES[raw] : null) });
  })
);

function decideRoute(decision: "approve" | "decline") {
  return asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const id = idSchema.parse(req.params.id);
    try {
      const request = await decideTeamRequest({ requestId: id, decision, actorUserId: req.authUser!.id });
      return res.json({ ok: true, request });
    } catch (error) {
      if (error instanceof TeamDecisionError) {
        return sendTrackError(req, res, error.status, `TEAM_REQUEST_${error.code}`, error.message, error.currentStatus ? { status: error.currentStatus } : undefined);
      }
      throw error;
    }
  });
}

teamRequestsRouter.post("/:id/approve", requireAuth, decideRoute("approve"));
teamRequestsRouter.post("/:id/decline", requireAuth, decideRoute("decline"));
