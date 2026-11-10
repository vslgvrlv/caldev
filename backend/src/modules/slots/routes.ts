import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { resolveTeamAccess, sendTeamAccessError, type TeamAccess } from "../../lib/team-access.js";
import {
  MAX_PRICE,
  MAX_SLOTS,
  SlotError,
  book,
  cancelBooking,
  closeSlots,
  eventForViewer,
  findTeam,
  follow,
  followerCount,
  listFeed,
  listFollowing,
  listOpenTeams,
  loadEvent,
  managerView,
  openSlots,
  setOpenSchedule,
  setPaid,
  slotSummary,
  teamCardFor,
  unfollow,
  type BookResult,
} from "./service.js";
// Регистрирует «гостя события» в `resolveEventAccess` (трек 3).
import "./guest-access.js";

// Модуль трека 4 «Открытые слоты» (ревизия PBTH, 11.11.2026; решения Василия
// 10.11.2026, п. 23–28). Подключён в `app.ts` основой заранее.
//
//   GET    /slots/teams                          команды с открытым расписанием
//   GET    /slots/teams/:teamId                  страница команды для подписки
//   PUT    /slots/teams/:teamId/open-schedule    включить / выключить (капитан)
//   POST   /slots/teams/:teamId/follow           подписаться
//   DELETE /slots/teams/:teamId/follow           отписаться
//   GET    /slots/feed                           мои подписки, свободные слоты, мои записи
//   GET    /slots/summary                        числа для значка в шапке
//   GET    /slots/events/:eventId                событие глазами гостя или подписчика
//   GET    /slots/events/:eventId/manage         блок слотов (капитан, тренер)
//   PUT    /slots/events/:eventId                открыть N мест с ценой (капитан, тренер)
//   DELETE /slots/events/:eventId                закрыть запись (капитан, тренер)
//   POST   /slots/events/:eventId/book           записаться
//   DELETE /slots/events/:eventId/book           сняться
//   DELETE /slots/events/:eventId/guests/:userId снять гостя (капитан, тренер)
//   PATCH  /slots/events/:eventId/guests/:userId «оплатил» (капитан, тренер)
//
// Команда в ручках капитана берётся из самого события или из адреса
// (`resolveTeamAccess` с параметром), а не из заголовка экрана: подписчик
// приходит с экрана другой команды.

export const slotsRouter = Router();

// Вход проверяется в каждой ручке, а не на весь модуль: незнакомый адрес под
// `/slots` отвечает 404, как у остальных модулей.
const uuid = z.string().uuid();

function sendSlotError(res: Response, error: unknown): boolean {
  if (error instanceof SlotError) {
    res.status(error.status).json({ detail: error.message, code: error.code });
    return true;
  }
  return sendTeamAccessError(res, error);
}

async function teamAccess(req: Request, teamId: string): Promise<TeamAccess> {
  const access = await resolveTeamAccess(req, { param: teamId });
  // С параметром ответ всегда есть: команда или отказ исключением.
  return access as TeamAccess;
}

function isManager(access: TeamAccess): boolean {
  return access.role === "CAPTAIN" || access.role === "TRAINER";
}

/** Событие и права капитана или тренера в его команде. */
async function managedEvent(req: Request, res: Response) {
  const eventId = uuid.safeParse(req.params.eventId);
  if (!eventId.success) {
    res.status(404).json({ detail: "Событие не найдено", code: "SLOTS_EVENT_NOT_FOUND" });
    return null;
  }
  const event = await loadEvent(eventId.data);
  if (!event || event.is_cancelled) {
    res.status(404).json({ detail: "Событие не найдено", code: "SLOTS_EVENT_NOT_FOUND" });
    return null;
  }
  try {
    const access = await teamAccess(req, event.team_id);
    if (!isManager(access)) {
      res.status(403).json({ detail: "Слотами управляют капитан и тренер", code: "SLOTS_FORBIDDEN" });
      return null;
    }
    return { event, access };
  } catch (error) {
    if (sendSlotError(res, error)) return null;
    throw error;
  }
}

const BOOK_ERRORS: Record<Exclude<BookResult, { ok: true }>["outcome"], { status: number; detail: string }> = {
  FULL: { status: 409, detail: "Мест уже нет" },
  CLOSED: { status: 409, detail: "Запись закрыта" },
  STARTED: { status: 409, detail: "Событие уже началось, запись закрыта" },
  MEMBER: { status: 409, detail: "Ты в этой команде — слот тебе не нужен" },
  NOT_FOLLOWER: { status: 403, detail: "Сначала подпишись на команду" },
  NOT_FOUND: { status: 404, detail: "Событие не найдено" },
};

// --- Команды и подписки -----------------------------------------------------

slotsRouter.get(
  "/teams",
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({ teams: await listOpenTeams(req.authUser!.id) });
  })
);

slotsRouter.get(
  "/teams/:teamId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const team = await findTeam(String(req.params.teamId));
    if (!team) return res.status(404).json({ detail: "Команда не найдена", code: "SLOTS_TEAM_NOT_FOUND" });
    const userId = req.authUser!.id;
    const card = await teamCardFor(userId, team.id);
    let role: string | null = null;
    try {
      role = (await resolveTeamAccess(req, { param: team.id }))?.role ?? null;
    } catch {
      role = null;
    }
    const manager = role === "CAPTAIN" || role === "TRAINER";
    const feed = card?.following || manager ? (await listFeed(userId)).slots.filter((s) => s.teamId === team.id) : [];
    return res.json({
      team: card,
      member: Boolean(role),
      role,
      canManage: role === "CAPTAIN",
      followers: manager ? await followerCount(team.id) : undefined,
      slots: feed,
    });
  })
);

slotsRouter.put(
  "/teams/:teamId/open-schedule",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = uuid.parse(req.params.teamId);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
    try {
      const access = await teamAccess(req, teamId);
      // Решение 23: открытое расписание включает капитан.
      if (access.role !== "CAPTAIN") {
        return res.status(403).json({ detail: "Открытое расписание включает капитан", code: "SLOTS_FORBIDDEN" });
      }
    } catch (error) {
      if (sendSlotError(res, error)) return;
      throw error;
    }
    await setOpenSchedule(teamId, enabled, req.authUser!.id);
    await writeAudit(req.authUser!.id, "slots.open_schedule", { teamId, enabled });
    return res.json({ openSchedule: enabled, followers: await followerCount(teamId) });
  })
);

slotsRouter.post(
  "/teams/:teamId/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const team = await findTeam(String(req.params.teamId));
    if (!team) return res.status(404).json({ detail: "Команда не найдена", code: "SLOTS_TEAM_NOT_FOUND" });
    try {
      await follow(req.authUser!.id, team.id);
    } catch (error) {
      if (sendSlotError(res, error)) return;
      throw error;
    }
    return res.json({ following: true });
  })
);

slotsRouter.delete(
  "/teams/:teamId/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = uuid.parse(req.params.teamId);
    await unfollow(req.authUser!.id, teamId);
    return res.json({ following: false });
  })
);

slotsRouter.get(
  "/feed",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const [following, feed] = await Promise.all([listFollowing(userId), listFeed(userId)]);
    return res.json({ following, slots: feed.slots, bookings: feed.bookings });
  })
);

slotsRouter.get(
  "/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json(await slotSummary(req.authUser!.id));
  })
);

// --- Событие ----------------------------------------------------------------

slotsRouter.get(
  "/events/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = uuid.safeParse(req.params.eventId);
    const view = eventId.success ? await eventForViewer(req.authUser!.id, eventId.data, null) : null;
    if (!view) return res.status(404).json({ detail: "Событие не найдено", code: "SLOTS_EVENT_NOT_FOUND" });
    return res.json(view);
  })
);

slotsRouter.get(
  "/events/:eventId/manage",
  requireAuth,
  asyncHandler(async (req, res) => {
    const managed = await managedEvent(req, res);
    if (!managed) return;
    return res.json(await managerView(managed.event.id, managed.event.team_id));
  })
);

const openSchema = z.object({
  capacity: z.coerce.number().int().min(1).max(MAX_SLOTS),
  price: z.coerce.number().min(0).max(MAX_PRICE),
});

slotsRouter.put(
  "/events/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const managed = await managedEvent(req, res);
    if (!managed) return;
    const payload = openSchema.parse(req.body ?? {});
    try {
      const result = await openSlots({
        eventId: managed.event.id,
        teamId: managed.event.team_id,
        actorId: req.authUser!.id,
        capacity: payload.capacity,
        price: Math.round(payload.price * 100) / 100,
      });
      await writeAudit(req.authUser!.id, "slots.open", {
        teamId: managed.event.team_id,
        eventId: managed.event.id,
        capacity: payload.capacity,
        price: payload.price,
        notify: result.notify,
      });
    } catch (error) {
      if (sendSlotError(res, error)) return;
      throw error;
    }
    return res.json(await managerView(managed.event.id, managed.event.team_id));
  })
);

slotsRouter.delete(
  "/events/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const managed = await managedEvent(req, res);
    if (!managed) return;
    await closeSlots(managed.event.id);
    await writeAudit(req.authUser!.id, "slots.close", { teamId: managed.event.team_id, eventId: managed.event.id });
    return res.json(await managerView(managed.event.id, managed.event.team_id));
  })
);

slotsRouter.post(
  "/events/:eventId/book",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = uuid.safeParse(req.params.eventId);
    if (!eventId.success) return res.status(404).json({ detail: "Событие не найдено", code: "SLOTS_EVENT_NOT_FOUND" });
    const result = await book(req.authUser!.id, eventId.data);
    if (!result.ok) {
      const error = BOOK_ERRORS[result.outcome];
      return res.status(error.status).json({ detail: error.detail, code: `SLOTS_${result.outcome}` });
    }
    await writeAudit(req.authUser!.id, "slots.book", { eventId: eventId.data, outcome: result.outcome, via: "app" });
    return res.json(await eventForViewer(req.authUser!.id, eventId.data, null));
  })
);

slotsRouter.delete(
  "/events/:eventId/book",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = uuid.safeParse(req.params.eventId);
    if (!eventId.success) return res.status(404).json({ detail: "Событие не найдено", code: "SLOTS_EVENT_NOT_FOUND" });
    const outcome = await cancelBooking({
      eventId: eventId.data,
      guestUserId: req.authUser!.id,
      actorId: req.authUser!.id,
      status: "LEFT",
    });
    if (outcome === "CANCELLED") {
      await writeAudit(req.authUser!.id, "slots.leave", { eventId: eventId.data });
    }
    return res.json({ cancelled: outcome === "CANCELLED" });
  })
);

slotsRouter.delete(
  "/events/:eventId/guests/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const managed = await managedEvent(req, res);
    if (!managed) return;
    const guestUserId = uuid.parse(req.params.userId);
    const outcome = await cancelBooking({
      eventId: managed.event.id,
      guestUserId,
      actorId: req.authUser!.id,
      status: "REMOVED",
    });
    if (outcome === "CANCELLED") {
      await writeAudit(req.authUser!.id, "slots.remove_guest", {
        teamId: managed.event.team_id,
        eventId: managed.event.id,
        guestUserId,
        via: "app",
      });
    }
    return res.json(await managerView(managed.event.id, managed.event.team_id));
  })
);

slotsRouter.patch(
  "/events/:eventId/guests/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const managed = await managedEvent(req, res);
    if (!managed) return;
    const guestUserId = uuid.parse(req.params.userId);
    const { paid } = z.object({ paid: z.boolean() }).parse(req.body ?? {});
    const changed = await setPaid({ eventId: managed.event.id, guestUserId, paid, actorId: req.authUser!.id });
    if (!changed) return res.status(404).json({ detail: "Гость не найден", code: "SLOTS_GUEST_NOT_FOUND" });
    await writeAudit(req.authUser!.id, "slots.paid", {
      teamId: managed.event.team_id,
      eventId: managed.event.id,
      guestUserId,
      paid,
    });
    return res.json(await managerView(managed.event.id, managed.event.team_id));
  })
);
