import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";

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
