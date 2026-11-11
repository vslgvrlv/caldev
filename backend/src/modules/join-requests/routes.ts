import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler.js";
import { attachAuthUser, requireAuth } from "../../middleware/auth.js";
import { sendTrackError as sendError } from "./delivery.js";
import { resolveTeamAccess, sendTeamAccessError, TeamAccessError } from "../../lib/team-access.js";
import { findActiveJoinLink } from "../teams/join-link.js";
import { loadInviteFacts } from "../teams/invite-facts.js";
import { publicLinkReadLimiter } from "../../lib/public-link-rate-limit.js";
import {
  canDecideJoinRequests,
  createJoinRequest,
  decideJoinRequest,
  findMembership,
  getJoinRequest,
  JoinDecisionError,
  listMyJoinRequests,
  listPendingTeamRequests,
} from "./service.js";

// Заявки на вступление (трек 1 ревизии PBTH, 11.11.2026).
//
//   GET  /join-requests/link/:code   — экран ссылки: команда, и для вошедшего —
//                                      состоит ли он в ней и его заявка;
//   POST /join-requests { code }      — подать заявку (повтор отдаёт ту же);
//   GET  /join-requests/mine          — мои заявки (экран «нет команды»);
//   GET  /join-requests/:id           — моя заявка (экран ожидания опрашивает);
//   GET  /join-requests               — ждущие заявки команды запроса
//                                      (`X-PBTH-Team`), капитан и тренер;
//   POST /join-requests/:id/approve   — принять;
//   POST /join-requests/:id/decline   — отклонить.

export const joinRequestsRouter = Router();

const idSchema = z.string().uuid();
const createSchema = z.object({ code: z.string().min(1).max(32) });

function sendDecisionError(req: Request, res: Response, error: unknown): boolean {
  if (error instanceof JoinDecisionError) {
    sendError(req, res, error.status, `JOIN_REQUEST_${error.code}`, error.message, error.currentStatus ? { status: error.currentStatus } : undefined);
    return true;
  }
  return false;
}

joinRequestsRouter.get(
  "/link/:code",
  publicLinkReadLimiter(),
  asyncHandler(async (req, res) => {
    const link = await findActiveJoinLink(req.params.code);
    if (!link) return sendError(req, res, 404, "JOIN_LINK_NOT_FOUND", "Join link not found or revoked");
    const team = { id: link.teamId, name: link.teamName, shortCode: link.teamShortCode };
    const facts = (await loadInviteFacts(link.teamId)) ?? {};
    const user = await attachAuthUser(req);
    if (!user) return res.json({ team, authenticated: false, member: false, request: null, ...facts });
    const membership = await findMembership(link.teamId, user.id);
    let request = null;
    if (!membership) {
      const mine = await listMyJoinRequests(user.id);
      request = mine.find((item) => item.team.id === link.teamId) ?? null;
    }
    return res.json({ team, authenticated: true, member: Boolean(membership), request, ...facts });
  })
);

joinRequestsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = createSchema.parse(req.body ?? {});
    const result = await createJoinRequest(req.authUser!.id, payload.code);
    if (result.kind === "invalid_link") {
      return sendError(req, res, 404, "JOIN_LINK_NOT_FOUND", "Join link not found or revoked");
    }
    if (result.kind === "member") {
      return res.json({ member: true, team: result.team, request: null });
    }
    return res.status(result.created ? 201 : 200).json({ member: false, team: result.request.team, request: result.request });
  })
);

joinRequestsRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({ requests: await listMyJoinRequests(req.authUser!.id) });
  })
);

joinRequestsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    let access;
    try {
      access = await resolveTeamAccess(req);
    } catch (error) {
      if (sendTeamAccessError(res, error)) return;
      throw error;
    }
    if (!access) return sendError(req, res, 400, "TEAM_CONTEXT_REQUIRED", "Team is required");
    if (!canDecideJoinRequests(access.role)) {
      return sendError(req, res, 403, "JOIN_REQUEST_FORBIDDEN", "Only the team captain or trainer can see join requests");
    }
    const requests = await listPendingTeamRequests(access.teamId);
    return res.json({ teamId: access.teamId, count: requests.length, requests });
  })
);

joinRequestsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const request = await getJoinRequest(id);
    if (!request || request.userId !== req.authUser!.id) {
      return sendError(req, res, 404, "JOIN_REQUEST_NOT_FOUND", "Join request not found");
    }
    const { userId: _userId, ...view } = request;
    return res.json({ request: view });
  })
);

function decideRoute(decision: "approve" | "decline") {
  return asyncHandler(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const request = await getJoinRequest(id);
    if (!request) return sendError(req, res, 404, "JOIN_REQUEST_NOT_FOUND", "Join request not found");
    // Права — в команде заявки: участник по составу, владелец платформы как
    // капитан (с пометкой в журнале).
    let role: "CAPTAIN" | "TRAINER" | "PLAYER" | null = null;
    let via: "membership" | "owner" = "membership";
    try {
      const access = await resolveTeamAccess(req, { param: request.team.id });
      role = access?.role ?? null;
      via = access?.via ?? "membership";
    } catch (error) {
      if (!(error instanceof TeamAccessError)) throw error;
    }
    try {
      const result = await decideJoinRequest({ requestId: id, decision, actor: { userId: req.authUser!.id, role, via } });
      return res.json({ ok: true, status: result.status, membershipId: result.membershipId });
    } catch (error) {
      if (sendDecisionError(req, res, error)) return;
      throw error;
    }
  });
}

joinRequestsRouter.post("/:id/approve", requireAuth, decideRoute("approve"));
joinRequestsRouter.post("/:id/decline", requireAuth, decideRoute("decline"));
