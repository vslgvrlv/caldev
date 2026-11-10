import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";
import { env } from "../../config/env.js";
import { verifyRsvpToken } from "../../lib/notification-rsvp-token.js";
import { recordRsvpAnswer } from "./service.js";

const rsvpSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().optional(),
  status: z.enum(["UNANSWERED", "PENDING", "CONFIRMED", "DECLINED"]),
});

export const rsvpRouter = Router();

rsvpRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = rsvpSchema.parse(req.body);
    const userId = req.authUser!.id;

    const eventCheck = await query<{ id: string }>(
      `SELECT e.id
       FROM events e
       JOIN team_memberships tm ON tm.team_id = e.team_id
       WHERE e.id = $1
         AND e.is_cancelled = FALSE
         AND tm.user_id = $2`,
      [payload.eventId, userId]
    );
    if (!eventCheck.rowCount) {
      return sendError(req, res, 404, "EVENT_NOT_FOUND", "Event not found or not available for this user");
    }

    if (payload.status === "UNANSWERED") {
      await query(
        `DELETE FROM rsvps
         WHERE event_id = $1 AND user_id = $2`,
        [payload.eventId, userId]
      );
    } else {
      await query(
        `INSERT INTO rsvps (event_id, user_id, status, updated_at)
         VALUES ($1, $2, $3::rsvp_status, NOW())
         ON CONFLICT (event_id, user_id)
         DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
        [payload.eventId, userId, payload.status]
      );
    }

    await writeAudit(userId, "rsvp.update", { eventId: payload.eventId, status: payload.status });

    return res.json({ success: true, eventId: payload.eventId, rsvpStatus: payload.status });
  })
);

// Ответ кнопкой из пуша (трек 2 ревизии). Зовёт service worker без открытого
// приложения, поэтому вместо сессии — подписанный ключ из самого пуша: в нём
// событие и человек. Права в команде проверяются заново при записи.
const pushAnswerSchema = z.object({
  token: z.string().min(10).max(2000),
  status: z.enum(["CONFIRMED", "DECLINED"]),
});

const PUSH_ANSWER_TEXT = {
  CONFIRMED: "Ты идёшь.",
  DECLINED: "Ты не идёшь.",
  NOT_MEMBER: "Ты больше не в составе команды — ответ не записан.",
  CANCELLED: "Событие отменено.",
  STARTED: "Событие уже началось — ответ не записан.",
  EVENT_NOT_FOUND: "Событие не найдено.",
  BAD_TOKEN: "Кнопка устарела. Открой событие в приложении.",
} as const;

rsvpRouter.post(
  "/push",
  asyncHandler(async (req, res) => {
    const parsed = pushAnswerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, code: "BAD_TOKEN", message: PUSH_ANSWER_TEXT.BAD_TOKEN });
    }
    const claims = verifyRsvpToken(parsed.data.token, env.session.secret);
    if (!claims) {
      return res.status(403).json({ ok: false, code: "BAD_TOKEN", message: PUSH_ANSWER_TEXT.BAD_TOKEN });
    }
    const result = await recordRsvpAnswer({
      userId: claims.userId,
      eventId: claims.eventId,
      status: parsed.data.status,
      source: "push",
    });
    if (!result.ok) {
      const status = result.reason === "EVENT_NOT_FOUND" ? 404 : result.reason === "NOT_MEMBER" ? 403 : 409;
      return res.status(status).json({ ok: false, code: result.reason, message: PUSH_ANSWER_TEXT[result.reason] });
    }
    return res.json({
      ok: true,
      eventId: result.event.id,
      rsvpStatus: result.status,
      message: PUSH_ANSWER_TEXT[result.status],
    });
  })
);
