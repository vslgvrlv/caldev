import { Router } from "express";
import { validate as isUuid } from "uuid";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { buildIcsFeed } from "../../lib/ics.js";
import { validateIcsToken } from "./token.js";
import { env } from "../../config/env.js";

export const icsRouter = Router();

icsRouter.get(
  "/ics/:token.ics",
  asyncHandler(async (req, res) => {
    const rawToken = String(req.params.token || "");
    const tokenId = rawToken.split(".")[0] || "";

    if (!isUuid(tokenId)) {
      return res.status(401).send("Invalid token");
    }

    const tokenRow = await query<{ token_hash: string; user_id: string; is_active: boolean }>(
      `SELECT token_hash, user_id, is_active
       FROM ics_tokens
       WHERE id = $1`,
      [tokenId]
    );

    if (!tokenRow.rowCount || !tokenRow.rows[0].is_active) {
      return res.status(401).send("Token not found");
    }

    const tokenData = tokenRow.rows[0];
    if (!validateIcsToken(rawToken, tokenId, tokenData.user_id, tokenData.token_hash)) {
      return res.status(401).send("Token verification failed");
    }

    const memberships = await query<{ team_id: string }>(
      `SELECT team_id FROM team_memberships WHERE user_id = $1 ORDER BY team_id`,
      [tokenData.user_id]
    );

    if (!memberships.rowCount) {
      return res.status(404).send("No team memberships");
    }

    const requestedTeamId = req.query.teamId ? String(req.query.teamId) : null;
    let selectedTeamIds: string[];

    if (requestedTeamId) {
      const found = memberships.rows.some((m) => m.team_id === requestedTeamId);
      if (!found) {
        return res.status(403).send("Token has no access to this team");
      }
      selectedTeamIds = [requestedTeamId];
    } else {
      selectedTeamIds = memberships.rows.map((m) => m.team_id);
    }

    const eventsResult = await query<{
      id: string;
      title: string;
      description: string | null;
      location: string | null;
      start_at: string;
      end_at: string | null;
    }>(
      `SELECT id, title, description, location, start_at, end_at
       FROM events e
       JOIN rsvps r ON r.event_id = e.id
       WHERE e.team_id = ANY($1::uuid[])
         AND e.is_cancelled = FALSE
         AND r.user_id = $2
         AND r.status IN ('CONFIRMED', 'PENDING')
         AND (e.series_id IS NULL OR e.start_at <= NOW() + make_interval(days => $3::int))
       ORDER BY e.start_at ASC`,
      [selectedTeamIds, tokenData.user_id, env.ics.recurringWindowDays]
    );

    await query(`UPDATE ics_tokens SET last_used_at = NOW() WHERE id = $1`, [tokenId]);

    const payload = buildIcsFeed(eventsResult.rows);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    if (req.query.download === "1") {
      const suffix = requestedTeamId || "all";
      res.setHeader("Content-Disposition", `attachment; filename="pbth-${suffix}.ics"`);
    }
    return res.send(payload);
  })
);
