import { Router } from "express";
import { validate as isUuid } from "uuid";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { hashIcsToken } from "../../lib/ics.js";
import { writeAudit } from "../../lib/audit.js";
import { buildIcsToken } from "../ics/token.js";

export const profileRouter = Router();

function toWebcalUrl(url: string) {
  if (url.startsWith("https://")) {
    return `webcal://${url.slice("https://".length)}`;
  }
  if (url.startsWith("http://")) {
    return `webcal://${url.slice("http://".length)}`;
  }
  return url;
}

async function ensureIcsToken(userId: string) {
  const existing = await query<{ id: string; user_id: string; token_hash: string; is_active: boolean }>(
    `SELECT id, user_id, token_hash, is_active
     FROM ics_tokens
     WHERE user_id = $1`,
    [userId]
  );

  if (!existing.rowCount) {
    const created = await query<{ id: string; user_id: string; token_hash: string }>(
      `INSERT INTO ics_tokens (user_id, token_hash, is_active, rotated_at)
       VALUES ($1, '', TRUE, NOW())
       RETURNING id, user_id, token_hash`,
      [userId]
    );
    const token = buildIcsToken(created.rows[0].id, userId);
    await query(`UPDATE ics_tokens SET token_hash = $1 WHERE user_id = $2`, [hashIcsToken(token), userId]);
    return token;
  }

  if (!existing.rows[0].is_active) {
    await query(`UPDATE ics_tokens SET is_active = TRUE WHERE user_id = $1`, [userId]);
  }

  return buildIcsToken(existing.rows[0].id, userId);
}

profileRouter.get(
  "/ics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;
    const token = await ensureIcsToken(userId);
    let teamId: string | null = req.query.teamId ? String(req.query.teamId) : null;

    if (teamId) {
      const check = await query<{ team_id: string }>(
        `SELECT team_id FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
        [userId, teamId]
      );
      if (!check.rowCount) {
        teamId = null;
      }
    }

    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    const url = `${req.protocol}://${req.get("host")}/calendar/ics/${token}.ics${qs}`;
    return res.json({
      url,
      subscriptionUrl: toWebcalUrl(url),
      downloadUrl: `/calendar/ics/${token}.ics${qs ? `${qs}&` : "?"}download=1`,
      hasToken: true,
    });
  })
);

profileRouter.post(
  "/ics/rotate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;

    const updated = await query<{ id: string }>(
      `UPDATE ics_tokens
       SET id = gen_random_uuid(), rotated_at = NOW(), is_active = TRUE
       WHERE user_id = $1
       RETURNING id`,
      [userId]
    );

    let tokenId: string;
    if (updated.rowCount) {
      tokenId = updated.rows[0].id;
    } else {
      const inserted = await query<{ id: string }>(
        `INSERT INTO ics_tokens (user_id, token_hash, is_active, rotated_at)
         VALUES ($1, '', TRUE, NOW())
         RETURNING id`,
        [userId]
      );
      tokenId = inserted.rows[0].id;
    }

    if (!isUuid(tokenId)) {
      throw new Error("Invalid token id");
    }

    const token = buildIcsToken(tokenId, userId);
    await query(`UPDATE ics_tokens SET token_hash = $1 WHERE user_id = $2`, [hashIcsToken(token), userId]);

    await writeAudit(userId, "profile.ics.rotate", {});

    let teamQuery = "";
    if (req.query.teamId) {
      const teamId = String(req.query.teamId);
      const check = await query<{ team_id: string }>(
        `SELECT team_id FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
        [userId, teamId]
      );
      if (check.rowCount) {
        teamQuery = `?teamId=${encodeURIComponent(teamId)}`;
      }
    }

    const url = `${req.protocol}://${req.get("host")}/calendar/ics/${token}.ics${teamQuery}`;
    return res.json({
      url,
      subscriptionUrl: toWebcalUrl(url),
      downloadUrl: `/calendar/ics/${token}.ics${teamQuery ? `${teamQuery}&` : "?"}download=1`,
      hasToken: true,
    });
  })
);

profileRouter.get(
  "/ics/download",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = await ensureIcsToken(req.authUser!.id);
    const params = new URLSearchParams();
    if (req.query.teamId) {
      params.set("teamId", String(req.query.teamId));
    }
    params.set("download", "1");
    return res.redirect(`/calendar/ics/${token}.ics?${params.toString()}`);
  })
);
