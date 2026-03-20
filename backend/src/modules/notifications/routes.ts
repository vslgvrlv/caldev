import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { getActiveContext } from "../teams/context.js";
import { sendTelegramBotMessage } from "../../lib/telegram-bot.js";
import { enqueueTelegramNotification, isNotificationsQueueEnabled } from "../../lib/notification-queue.js";
import { formatNotificationDateTime } from "../../lib/notification-timezone.js";

type ActorRole = "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER";
type EventKind = "TRAINING" | "TOURNAMENT" | "CHAMPIONSHIP" | "FRIENDLY_MATCH" | "MEETING" | "MAINTENANCE" | "OTHER";
type EventReminderAudience = "ALL" | "RESPONDED" | "UNANSWERED" | "CONFIRMED" | "PENDING" | "DECLINED";
type EventReminderTemplate =
  | "EVENT_REMINDER"
  | "WARMUP_REMINDER"
  | "ROLE_REMINDER"
  | "GAME_GATHERING"
  | "GAME_WARMUP";

const eventReminderSchema = z.object({
  audience: z.enum(["ALL", "RESPONDED", "UNANSWERED", "CONFIRMED", "PENDING", "DECLINED"]).default("UNANSWERED"),
  template: z.enum(["EVENT_REMINDER", "WARMUP_REMINDER", "ROLE_REMINDER", "GAME_GATHERING", "GAME_WARMUP"]).default("EVENT_REMINDER"),
  gameId: z.string().uuid().optional(),
  customText: z.string().trim().max(2000).optional(),
});

const debtReminderSchema = z.object({
  teamId: z.string().uuid().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  customText: z.string().trim().max(2000).optional(),
});

const teamDebtReminderSchema = z.object({
  teamId: z.string().uuid().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  customText: z.string().trim().max(2000).optional(),
});

type NotificationsAccess = {
  userId: string;
  actorRole: ActorRole;
};

async function resolveNotificationsAccess(req: Parameters<typeof requireAuth>[0]): Promise<NotificationsAccess> {
  const effectiveRole = getEffectiveEntryRole(req as any, (req as any).authUser);
  if (effectiveRole === "ADMIN") {
    return { userId: (req as any).authUser.id, actorRole: "ADMIN" };
  }
  const ctx = await getActiveContext(req as any);
  if (!ctx) {
    const err = new Error("Active team context required");
    (err as any).status = 403;
    throw err;
  }
  return { userId: ctx.userId, actorRole: ctx.role as ActorRole };
}

async function resolveActorRoleForTeam(access: NotificationsAccess, teamId: string): Promise<ActorRole | null> {
  if (access.actorRole === "ADMIN") return "ADMIN";
  const membership = await query<{ role: "CAPTAIN" | "TRAINER" | "PLAYER" }>(
    `SELECT role::text AS role
     FROM team_memberships
     WHERE user_id = $1 AND team_id = $2
     LIMIT 1`,
    [access.userId, teamId]
  );
  return membership.rows[0]?.role ?? null;
}

function assertCanSendEventReminder(actorRole: ActorRole, eventType: EventKind) {
  if (actorRole === "ADMIN" || actorRole === "CAPTAIN") return;
  if (actorRole === "TRAINER" && (eventType === "TRAINING" || eventType === "MEETING")) return;
  const err = new Error("Only captain/admin or trainer (training/meeting) can send event reminders");
  (err as any).status = 403;
  throw err;
}

function assertCanSendDebtReminder(actorRole: ActorRole) {
  if (actorRole === "ADMIN" || actorRole === "CAPTAIN") return;
  const err = new Error("Only captain or root admin can send debt reminders");
  (err as any).status = 403;
  throw err;
}

function classifyTelegramSendError(reason: string): "CHAT_NOT_FOUND" | "BOT_BLOCKED" | "USER_DEACTIVATED" | "SEND_FAILED" {
  const text = reason.toLowerCase();
  if (text.includes("chat not found")) return "CHAT_NOT_FOUND";
  if (text.includes("blocked by the user")) return "BOT_BLOCKED";
  if (text.includes("user is deactivated")) return "USER_DEACTIVATED";
  return "SEND_FAILED";
}

function buildEventReminderText(params: {
  template: EventReminderTemplate;
  event: { title: string; start_at: string; location: string | null; team_name: string; team_timezone?: string | null };
  game?: {
    id: string;
    time_label: string;
    opponent: string;
    pit_zone: "NEAR" | "FAR" | null;
    game_pair: "FIRST" | "SECOND" | null;
  } | null;
  customText?: string;
}) {
  if (params.customText) return params.customText;
  const whenWhere = formatNotificationDateTime(params.event.start_at, params.event.team_timezone, params.event.location);
  const game = params.game;
  const gamePairLabel = game?.game_pair === "FIRST" ? "Первая пара" : game?.game_pair === "SECOND" ? "Вторая пара" : "Пара не указана";
  const pitLabel = game?.pit_zone === "NEAR" ? "Ближняя пит-зона" : game?.pit_zone === "FAR" ? "Дальняя пит-зона" : "Пит-зона не указана";
  if (params.template === "GAME_GATHERING" || params.template === "GAME_WARMUP") {
    const header = params.template === "GAME_GATHERING" ? "Сбор перед игрой" : "Начало разминки перед игрой";
    return [
      header,
      `${params.event.title}`,
      `${params.event.team_name}`,
      whenWhere,
      "",
      `Соперник: ${game?.opponent || "не указан"}`,
      `Время игры: ${game?.time_label || "не указано"}`,
      `База/пит: ${pitLabel}`,
      `Пара: ${gamePairLabel}`,
    ].join("\n");
  }
  if (params.template === "WARMUP_REMINDER") {
    return [
      `Разминка перед событием`,
      `${params.event.title}`,
      `${params.event.team_name}`,
      whenWhere,
      ``,
      `Проверь экипировку и выезжай заранее.`,
    ].join("\n");
  }
  if (params.template === "ROLE_REMINDER") {
    return [
      `Напоминание по роли/задаче на событии`,
      `${params.event.title}`,
      `${params.event.team_name}`,
      whenWhere,
      ``,
      `Проверь свою роль/задачу в событии и подготовься заранее.`,
    ].join("\n");
  }
  return [
    `Напоминание о командном событии`,
    `${params.event.title}`,
    `${params.event.team_name}`,
    whenWhere,
    ``,
    `Пожалуйста, проверь RSVP и время.`,
  ].join("\n");
}

function isGameReminderTemplate(template: EventReminderTemplate): boolean {
  return template === "GAME_GATHERING" || template === "GAME_WARMUP";
}

function buildDebtReminderText(params: {
  event: { title: string; start_at: string; location: string | null; team_name: string; team_timezone?: string | null };
  amountOutstanding: number;
  customText?: string;
}) {
  if (params.customText) return params.customText;
  const whenWhere = formatNotificationDateTime(params.event.start_at, params.event.team_timezone, params.event.location);
  return [
    `Напоминание по оплате события`,
    `${params.event.title}`,
    `${params.event.team_name}`,
    whenWhere,
    ``,
    `Осталось сдать: ${Math.round(params.amountOutstanding * 100) / 100} ₽`,
  ].join("\n");
}

function buildTeamDebtReminderText(params: {
  teamName: string;
  amountOutstanding: number;
  customText?: string;
}) {
  if (params.customText) return params.customText;
  return [
    `Напоминание по оплате задолженности`,
    `${params.teamName}`,
    ``,
    `Осталось сдать: ${Math.round(params.amountOutstanding * 100) / 100} ₽`,
    `Подробности в приложении`,
  ].join("\n");
}

type NotificationDeliveryType = "EVENT_REMINDER" | "EVENT_DEBT_REMINDER" | "TEAM_DEBT_REMINDER" | "MEMBER_DEBT_REMINDER";

type DispatchMessageParams = {
  chatId: string;
  text: string;
  type: NotificationDeliveryType;
  actorUserId: string;
  recipientUserId?: string;
  teamId?: string;
  eventId?: string;
  correlationId?: string;
};

async function dispatchNotificationMessage(params: DispatchMessageParams): Promise<{ mode: "SYNC" | "QUEUE" }> {
  if (!isNotificationsQueueEnabled()) {
    await sendTelegramBotMessage(params.chatId, params.text);
    return { mode: "SYNC" };
  }

  await enqueueTelegramNotification({
    chatId: params.chatId,
    text: params.text,
    context: {
      type: params.type,
      actorUserId: params.actorUserId,
      recipientUserId: params.recipientUserId,
      teamId: params.teamId,
      eventId: params.eventId,
      correlationId: params.correlationId,
    },
  });
  return { mode: "QUEUE" };
}

export const notificationsRouter = Router();

async function getTeamDebtorsSummary(teamId: string) {
  return query<{
    user_id: string;
    telegram_id: string | null;
    amount_outstanding: string;
  }>(
    `WITH charge_paid AS (
       SELECT c.id,
              c.user_id,
              c.amount_due,
              COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
       FROM event_member_charges c
       LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
       WHERE c.team_id = $1
       GROUP BY c.id, c.user_id, c.amount_due
     )
     SELECT u.id AS user_id,
            u.telegram_id::text AS telegram_id,
            COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::text AS amount_outstanding
     FROM charge_paid cp
     JOIN users u ON u.id = cp.user_id AND u.is_active = TRUE
     GROUP BY u.id, u.telegram_id
     HAVING COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0) > 0`,
    [teamId]
  );
}

notificationsRouter.post(
  "/finance/remind-debtors",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = teamDebtReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);

    const ctx = await getActiveContext(req as any);
    const teamId = payload.teamId ?? ctx?.teamId;
    if (!teamId) return res.status(403).json({ detail: "Active team context required" });
    const actorRole = await resolveActorRoleForTeam(access, teamId);
    if (!actorRole) return res.status(403).json({ detail: "No access to this team" });
    assertCanSendDebtReminder(actorRole);

    const teamResult = await query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = $1`, [teamId]);
    const team = teamResult.rows[0];
    if (!team) return res.status(404).json({ detail: "Team not found" });

    const selectedIds = new Set(payload.userIds || []);
    const debtors = await getTeamDebtorsSummary(teamId);
    const filtered = debtors.rows.filter((row) => selectedIds.size === 0 || selectedIds.has(row.user_id));

    let sent = 0;
    let queued = 0;
    let skippedNoTelegram = 0;
    const failed: Array<{ userId: string; reason: string }> = [];
    for (const row of filtered) {
      if (!row.telegram_id) {
        skippedNoTelegram += 1;
        continue;
      }
      try {
        const dispatched = await dispatchNotificationMessage({
          chatId: row.telegram_id,
          text: buildTeamDebtReminderText({
            teamName: team.name,
            amountOutstanding: Number(row.amount_outstanding),
            customText: payload.customText,
          }),
          type: "TEAM_DEBT_REMINDER",
          actorUserId: access.userId,
          recipientUserId: row.user_id,
          teamId,
          correlationId: req.correlationId,
        });
        if (dispatched.mode === "QUEUE") queued += 1;
        else sent += 1;
      } catch (error) {
        failed.push({ userId: row.user_id, reason: error instanceof Error ? error.message : "Send failed" });
      }
    }

    await writeAudit(access.userId, "notifications.team_debt_reminder.send", {
      teamId,
      actorRole,
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      failed: failed.length,
    });

    return res.json({
      success: true,
      deliveryMode: isNotificationsQueueEnabled() ? "QUEUE" : "SYNC",
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      failed,
    });
  })
);

notificationsRouter.post(
  "/events/:eventId/remind",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = eventReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);

    const eventResult = await query<{
      id: string;
      team_id: string;
      title: string;
      start_at: string;
      location: string | null;
      type: EventKind;
      team_name: string;
      team_timezone: string | null;
    }>(
      `SELECT e.id,
              e.team_id,
              e.title,
              e.start_at::text,
              e.location,
              e.type,
              t.name AS team_name,
              t.timezone AS team_timezone
       FROM events e
       JOIN teams t ON t.id = e.team_id
       WHERE e.id = $1 AND e.is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ detail: "Event not found" });

    const actorRole = await resolveActorRoleForTeam(access, event.team_id);
    if (!actorRole) return res.status(403).json({ detail: "No access to this team event" });
    assertCanSendEventReminder(actorRole, event.type);

    const recipients = await query<{
      user_id: string;
      name: string;
      nickname: string;
      username: string | null;
      telegram_id: string | null;
      rsvp_status: "CONFIRMED" | "PENDING" | "DECLINED" | null;
    }>(
      `SELECT tm.user_id,
              u.name,
              u.nickname,
              u.username,
              u.telegram_id::text AS telegram_id,
              r.status AS rsvp_status
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
       LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
       WHERE tm.team_id = $2`,
      [eventId, event.team_id]
    );

    const filtered = recipients.rows.filter((row) => {
      if (payload.audience === "ALL") return true;
      if (payload.audience === "RESPONDED") return row.rsvp_status !== null;
      if (payload.audience === "UNANSWERED") return row.rsvp_status === null;
      if (payload.audience === "CONFIRMED") return row.rsvp_status === "CONFIRMED";
      if (payload.audience === "PENDING") return row.rsvp_status === "PENDING";
      if (payload.audience === "DECLINED") return row.rsvp_status === "DECLINED";
      return false;
    });

    let gameContext: {
      id: string;
      time_label: string;
      opponent: string;
      pit_zone: "NEAR" | "FAR" | null;
      game_pair: "FIRST" | "SECOND" | null;
    } | null = null;
    if (payload.gameId || isGameReminderTemplate(payload.template as EventReminderTemplate)) {
      const games = await query<{
        id: string;
        time_label: string;
        opponent: string;
        pit_zone: "NEAR" | "FAR" | null;
        game_pair: "FIRST" | "SECOND" | null;
      }>(
        `SELECT id, time_label, opponent, pit_zone::text, game_pair::text
         FROM event_games
         WHERE event_id = $1
         ORDER BY time_label ASC`,
        [eventId]
      );
      if (!games.rowCount) {
        return res.status(400).json({ detail: "No games found for this event. Add event schedule first." });
      }
      if (payload.gameId) {
        gameContext = games.rows.find((row) => row.id === payload.gameId) || null;
        if (!gameContext) {
          return res.status(400).json({ detail: "Selected game not found in this event schedule" });
        }
      } else {
        gameContext = games.rows[0];
      }
    }

    const text = buildEventReminderText({
      template: payload.template as EventReminderTemplate,
      event,
      game: gameContext,
      customText: payload.customText,
    });

    let sent = 0;
    let queued = 0;
    let skippedNoTelegram = 0;
    const failed: Array<{
      userId: string;
      name: string;
      nickname: string;
      username: string | null;
      reason: string;
      code: "CHAT_NOT_FOUND" | "BOT_BLOCKED" | "USER_DEACTIVATED" | "SEND_FAILED";
    }> = [];
    const skippedNoTelegramUsers: Array<{
      userId: string;
      name: string;
      nickname: string;
      username: string | null;
      rsvpStatus: "CONFIRMED" | "PENDING" | "DECLINED" | null;
    }> = [];

    for (const row of filtered) {
      if (!row.telegram_id) {
        skippedNoTelegram += 1;
        skippedNoTelegramUsers.push({
          userId: row.user_id,
          name: row.name,
          nickname: row.nickname,
          username: row.username,
          rsvpStatus: row.rsvp_status,
        });
        continue;
      }
      try {
        const dispatched = await dispatchNotificationMessage({
          chatId: row.telegram_id,
          text,
          type: "EVENT_REMINDER",
          actorUserId: access.userId,
          recipientUserId: row.user_id,
          teamId: event.team_id,
          eventId,
          correlationId: req.correlationId,
        });
        if (dispatched.mode === "QUEUE") queued += 1;
        else sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Send failed";
        failed.push({
          userId: row.user_id,
          name: row.name,
          nickname: row.nickname,
          username: row.username,
          reason,
          code: classifyTelegramSendError(reason),
        });
      }
    }

    await writeAudit(access.userId, "notifications.event_reminder.send", {
      eventId,
      teamId: event.team_id,
      actorRole,
      audience: payload.audience as EventReminderAudience,
      template: payload.template as EventReminderTemplate,
      gameId: gameContext?.id || null,
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      failed: failed.length,
    });

    return res.json({
      success: true,
      deliveryMode: isNotificationsQueueEnabled() ? "QUEUE" : "SYNC",
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      skippedNoTelegramUsers,
      failed,
    });
  })
);

notificationsRouter.post(
  "/finance/members/:userId/remind-debt",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const payload = debtReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);

    const ctx = await getActiveContext(req as any);
    const teamId = payload.teamId ?? ctx?.teamId;
    if (!teamId) return res.status(403).json({ detail: "Active team context required" });
    const actorRole = await resolveActorRoleForTeam(access, teamId);
    if (!actorRole) return res.status(403).json({ detail: "No access to this team" });
    assertCanSendDebtReminder(actorRole);

    const teamResult = await query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = $1`, [teamId]);
    const team = teamResult.rows[0];
    if (!team) return res.status(404).json({ detail: "Team not found" });

    const debtors = await getTeamDebtorsSummary(teamId);
    const row = debtors.rows.find((d) => d.user_id === userId);
    if (!row) return res.status(400).json({ detail: "Selected user has no debt in current team" });

    if (!row.telegram_id) return res.status(400).json({ detail: "User has no Telegram linked" });

    let dispatched: { mode: "SYNC" | "QUEUE" } | null = null;
    const failed: Array<{ userId: string; reason: string }> = [];
    try {
      dispatched = await dispatchNotificationMessage({
        chatId: row.telegram_id,
        text: buildTeamDebtReminderText({
          teamName: team.name,
          amountOutstanding: Number(row.amount_outstanding),
          customText: payload.customText,
        }),
        type: "MEMBER_DEBT_REMINDER",
        actorUserId: access.userId,
        recipientUserId: row.user_id,
        teamId,
        correlationId: req.correlationId,
      });
    } catch (error) {
      failed.push({ userId: row.user_id, reason: error instanceof Error ? error.message : "Send failed" });
    }

    await writeAudit(access.userId, "notifications.member_debt_reminder.send", {
      teamId,
      userId,
      sent: dispatched?.mode === "SYNC" ? 1 : 0,
      queued: dispatched?.mode === "QUEUE" ? 1 : 0,
      failed: failed.length,
    });
    return res.json({
      success: true,
      deliveryMode: isNotificationsQueueEnabled() ? "QUEUE" : "SYNC",
      attempted: 1,
      sent: dispatched?.mode === "SYNC" ? 1 : 0,
      queued: dispatched?.mode === "QUEUE" ? 1 : 0,
      skippedNoTelegram: 0,
      failed,
    });
  })
);

notificationsRouter.post(
  "/finance/events/:eventId/remind-debtors",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = debtReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);

    const eventResult = await query<{
      id: string;
      team_id: string;
      title: string;
      start_at: string;
      location: string | null;
      team_name: string;
      team_timezone: string | null;
    }>(
      `SELECT e.id, e.team_id, e.title, e.start_at::text, e.location, t.name AS team_name, t.timezone AS team_timezone
       FROM events e
       JOIN teams t ON t.id = e.team_id
       WHERE e.id = $1 AND e.is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ detail: "Event not found" });

    const actorRole = await resolveActorRoleForTeam(access, event.team_id);
    if (!actorRole) return res.status(403).json({ detail: "No access to this team event" });
    assertCanSendDebtReminder(actorRole);

    const selectedIds = new Set(payload.userIds || []);
    const debtors = await query<{
      user_id: string;
      telegram_id: string | null;
      amount_outstanding: string;
    }>(
      `WITH charge_paid AS (
         SELECT c.id,
                c.user_id,
                c.amount_due,
                COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
         FROM event_member_charges c
         LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
         WHERE c.event_id = $1
         GROUP BY c.id, c.user_id, c.amount_due
       )
       SELECT u.id AS user_id,
              u.telegram_id::text AS telegram_id,
              COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::text AS amount_outstanding
       FROM charge_paid cp
       JOIN users u ON u.id = cp.user_id AND u.is_active = TRUE
       GROUP BY u.id, u.telegram_id
       HAVING COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0) > 0`,
      [eventId]
    );

    const filtered = debtors.rows.filter((row) => selectedIds.size === 0 || selectedIds.has(row.user_id));

    let sent = 0;
    let queued = 0;
    let skippedNoTelegram = 0;
    const failed: Array<{ userId: string; reason: string }> = [];
    for (const row of filtered) {
      if (!row.telegram_id) {
        skippedNoTelegram += 1;
        continue;
      }
      try {
        const dispatched = await dispatchNotificationMessage({
          chatId: row.telegram_id,
          text: buildDebtReminderText({
            event,
            amountOutstanding: Number(row.amount_outstanding),
            customText: payload.customText,
          }),
          type: "EVENT_DEBT_REMINDER",
          actorUserId: access.userId,
          recipientUserId: row.user_id,
          teamId: event.team_id,
          eventId,
          correlationId: req.correlationId,
        });
        if (dispatched.mode === "QUEUE") queued += 1;
        else sent += 1;
      } catch (error) {
        failed.push({ userId: row.user_id, reason: error instanceof Error ? error.message : "Send failed" });
      }
    }

    await writeAudit(access.userId, "notifications.debt_reminder.send", {
      eventId,
      teamId: event.team_id,
      actorRole,
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      failed: failed.length,
    });

    return res.json({
      success: true,
      deliveryMode: isNotificationsQueueEnabled() ? "QUEUE" : "SYNC",
      attempted: filtered.length,
      sent,
      queued,
      skippedNoTelegram,
      failed,
    });
  })
);
