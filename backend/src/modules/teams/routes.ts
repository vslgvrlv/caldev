import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { canChooseAdminRole } from "../../lib/entry-role.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";

const createTeamSchema = z.object({
  name: z.string().min(2).max(120),
  shortCode: z.string().min(1).max(20),
  logo: z.string().url().optional(),
  timezone: z.string().min(2).max(80).default("Europe/Moscow"),
});

const createMembershipSchema = z.object({
  usernameOrId: z.string().min(1),
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]),
});

const updateMembershipSchema = z.object({
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]).optional(),
  status: z.enum(["ACTIVE", "INJURED", "RESERVE", "VACATION"]).optional(),
}).refine((value) => value.teamRole !== undefined || value.status !== undefined, {
  message: "At least one field (teamRole or status) is required",
});

const createInviteSchema = z.object({
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]).default("PLAYER"),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
});

async function getTeamRoleForUser(teamId: string, userId: string): Promise<"CAPTAIN" | "TRAINER" | "PLAYER" | null> {
  const roleResult = await query<{ role: "CAPTAIN" | "TRAINER" | "PLAYER" }>(
    `SELECT role::text AS role
     FROM team_memberships
     WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return roleResult.rows[0]?.role ?? null;
}

export const teamsRouter = Router();

teamsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const ownTeams =
      effectiveRole === "ADMIN"
        ? await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; role: string; timezone: string }>(
            `SELECT t.id, t.name, t.short_code, t.logo, t.budget::text, t.timezone, 'CAPTAIN'::text AS role
             FROM teams t
             ORDER BY t.name ASC`
          )
        : await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; role: string; timezone: string }>(
            `SELECT t.id, t.name, t.short_code, t.logo, t.budget::text, t.timezone, tm.role::text
             FROM team_memberships tm
             JOIN teams t ON t.id = tm.team_id
             WHERE tm.user_id = $1 AND tm.role = 'CAPTAIN'
             ORDER BY t.name ASC`,
            [req.authUser!.id]
          );
    return res.json({
      teams: ownTeams.rows.map((t) => ({
        id: t.id,
        name: t.name,
        shortCode: t.short_code,
        logo: t.logo,
        budget: Number(t.budget),
        timezone: t.timezone,
        role: t.role,
      })),
    });
  })
);

teamsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    if (effectiveRole !== "ADMIN") {
      return res.status(403).json({ detail: "Only account admin can create teams" });
    }

    const payload = createTeamSchema.parse(req.body);
    let created;
    try {
      created = await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; timezone: string }>(
        `INSERT INTO teams (name, short_code, logo, timezone)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, short_code, logo, budget::text, timezone`,
        [payload.name, payload.shortCode, payload.logo ?? null, payload.timezone]
      );
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ detail: "Team with this short code already exists" });
      }
      throw error;
    }

    await writeAudit(req.authUser!.id, "teams.create", { teamId: created.rows[0].id });
    return res.status(201).json({
      team: {
        id: created.rows[0].id,
        name: created.rows[0].name,
        shortCode: created.rows[0].short_code,
        logo: created.rows[0].logo,
        budget: Number(created.rows[0].budget),
        timezone: created.rows[0].timezone,
      },
    });
  })
);

teamsRouter.post(
  "/:teamId/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    if (effectiveRole !== "USER") {
      return sendError(req, res, 403, "ROLE_REQUIRED", "Only user entry-role can join team by invite");
    }

    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) {
      return sendError(req, res, 404, "NOT_FOUND", "Team not found");
    }

    const upsert = await query<{ id: string }>(
      `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
       VALUES ($1, $2, 'PLAYER', 'ACTIVE', 0)
       ON CONFLICT (user_id, team_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [req.authUser!.id, teamId]
    );

    req.session.activeMembershipId = upsert.rows[0].id;
    req.session.activeTeamId = teamId;

    await writeAudit(req.authUser!.id, "teams.join_by_invite", {
      membershipId: upsert.rows[0].id,
      teamId,
    });

    return res.json({ ok: true, membershipId: upsert.rows[0].id });
  })
);

teamsRouter.post(
  "/:teamId/invites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const payload = createInviteSchema.parse(req.body ?? {});
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const teamRole = await getTeamRoleForUser(teamId, req.authUser!.id);

    const isRootAdmin = effectiveRole === "ADMIN";
    const isCaptain = teamRole === "CAPTAIN";
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can create invites" });
    }
    if (!isRootAdmin && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot issue captain invites" });
    }

    const expiresAt = new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000);
    const created = await query<{ token: string; expires_at: string; role: "CAPTAIN" | "TRAINER" | "PLAYER" }>(
      `INSERT INTO team_invites (team_id, role, created_by, expires_at)
       VALUES ($1, $2::membership_role, $3, $4)
       RETURNING token::text, expires_at, role::text`,
      [teamId, payload.teamRole, req.authUser!.id, expiresAt.toISOString()]
    );

    await writeAudit(req.authUser!.id, "teams.invite.create", {
      teamId,
      token: created.rows[0].token,
      role: payload.teamRole,
      expiresAt: created.rows[0].expires_at,
    });

    return res.status(201).json({
      token: created.rows[0].token,
      role: created.rows[0].role,
      expiresAt: created.rows[0].expires_at,
    });
  })
);

teamsRouter.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const token = z.string().uuid().parse(req.params.token);
    const inviteResult = await query<{
      team_id: string;
      team_name: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      expires_at: string;
      is_revoked: boolean;
      used_at: string | null;
    }>(
      `SELECT i.team_id, t.name AS team_name, i.role::text, i.expires_at, i.is_revoked, i.used_at
       FROM team_invites i
       JOIN teams t ON t.id = i.team_id
       WHERE i.token = $1`,
      [token]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      return sendError(req, res, 404, "INVITE_NOT_FOUND", "Invite not found");
    }
    const isExpired = new Date(invite.expires_at).getTime() < Date.now();
    const isUsed = invite.used_at !== null;
    if (invite.is_revoked) {
      return sendError(req, res, 409, "INVITE_REVOKED", "Invite is revoked");
    }
    if (isExpired) {
      return sendError(req, res, 409, "INVITE_EXPIRED", "Invite expired");
    }
    return res.json({
      teamId: invite.team_id,
      teamName: invite.team_name,
      role: invite.role,
      expiresAt: invite.expires_at,
      isValid: true,
      isExpired,
      isUsed,
      isRevoked: invite.is_revoked,
    });
  })
);

teamsRouter.post(
  "/invites/:token/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = z.string().uuid().parse(req.params.token);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    console.info("[teams] invite.accept attempt", {
      token,
      userId: req.authUser!.id,
      username: req.authUser!.username,
      accountRole: req.authUser!.account_role,
      entryRole: effectiveRole,
      ip: req.ip,
    });
    if (effectiveRole !== "USER") {
      console.warn("[teams] invite.accept denied: non-user entry role", {
        token,
        userId: req.authUser!.id,
        entryRole: effectiveRole,
      });
      return sendError(req, res, 403, "ROLE_REQUIRED", "Only user entry-role can accept invite");
    }

    const inviteResult = await query<{
      id: string;
      team_id: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      expires_at: string;
      is_revoked: boolean;
      used_at: string | null;
    }>(
      `SELECT id, team_id, role::text, expires_at, is_revoked, used_at
       FROM team_invites
       WHERE token = $1`,
      [token]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      console.warn("[teams] invite.accept failed: invite not found", { token, userId: req.authUser!.id });
      return sendError(req, res, 404, "INVITE_NOT_FOUND", "Invite not found");
    }
    if (invite.is_revoked) {
      console.warn("[teams] invite.accept failed: revoked", { token, userId: req.authUser!.id });
      return sendError(req, res, 409, "INVITE_REVOKED", "Invite is revoked");
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      console.warn("[teams] invite.accept failed: expired", { token, userId: req.authUser!.id, expiresAt: invite.expires_at });
      return sendError(req, res, 409, "INVITE_EXPIRED", "Invite expired");
    }

    const existingMembership = await query<{ id: string }>(
      `SELECT id FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
      [req.authUser!.id, invite.team_id]
    );
    if (existingMembership.rowCount) {
      return sendError(req, res, 409, "ALREADY_MEMBER", "User is already a team member", {
        membershipId: existingMembership.rows[0].id,
        teamId: invite.team_id,
      });
    }

    const membership = await query<{ id: string }>(
      `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
       VALUES ($1, $2, $3::membership_role, 'ACTIVE', 0)
       RETURNING id`,
      [req.authUser!.id, invite.team_id, invite.role]
    );

    await query(
      `UPDATE team_invites
       SET used_by = COALESCE(used_by, $2), used_at = COALESCE(used_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [invite.id, req.authUser!.id]
    );

    req.session.activeMembershipId = membership.rows[0].id;
    req.session.activeTeamId = invite.team_id;

    await writeAudit(req.authUser!.id, "teams.invite.accept", {
      teamId: invite.team_id,
      membershipId: membership.rows[0].id,
      token,
    });

    console.info("[teams] invite.accept success", {
      token,
      userId: req.authUser!.id,
      membershipId: membership.rows[0].id,
      teamId: invite.team_id,
      role: invite.role,
    });

    return res.json({ ok: true, membershipId: membership.rows[0].id, teamId: invite.team_id });
  })
);

teamsRouter.post(
  "/:teamId/memberships",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const payload = createMembershipSchema.parse(req.body);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const teamRole = await getTeamRoleForUser(teamId, req.authUser!.id);
    const isRootAdmin = effectiveRole === "ADMIN";
    const isCaptain = teamRole === "CAPTAIN";
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }
    if (!isRootAdmin && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot assign captain role" });
    }

    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.usernameOrId);
    const userResult = await query<{ id: string; username: string | null; telegram_id: string; account_role: "ADMIN" | "USER" | null }>(
      isUuid
        ? `SELECT id, username, telegram_id::text, account_role FROM users WHERE id = $1 AND is_active = TRUE`
        : `SELECT id, username, telegram_id::text, account_role FROM users WHERE lower(username) = lower($1) AND is_active = TRUE`,
      [payload.usernameOrId]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ detail: "User not found" });
    }

    if (user.account_role === "ADMIN") {
      const eligibleForDualMode = canChooseAdminRole({ telegram_id: user.telegram_id, username: user.username });
      if (!eligibleForDualMode) {
        return res.status(409).json({ detail: "Target user has admin account role and cannot be a team member" });
      }
      await query(
        `UPDATE users
         SET account_role = 'USER', role_selected_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
    }

    let inserted;
    try {
      inserted = await query<{ id: string }>(
        `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
         VALUES ($1, $2, $3::membership_role, 'ACTIVE', 0)
         ON CONFLICT (user_id, team_id)
         DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
         RETURNING id`,
        [user.id, teamId, payload.teamRole]
      );
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("admin account cannot")) {
        return res.status(409).json({ detail: "Target user has admin account role and cannot be a team member" });
      }
      throw error;
    }

    await writeAudit(req.authUser!.id, "teams.membership.upsert", {
      membershipId: inserted.rows[0].id,
      teamId,
      userId: user.id,
      role: payload.teamRole,
    });

    return res.status(201).json({ membershipId: inserted.rows[0].id });
  })
);

teamsRouter.patch(
  "/:teamId/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const payload = updateMembershipSchema.parse(req.body);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const teamRole = await getTeamRoleForUser(teamId, req.authUser!.id);
    const isRootAdmin = effectiveRole === "ADMIN";
    const isCaptain = teamRole === "CAPTAIN";
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }
    if (!isRootAdmin && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot assign captain role" });
    }

    const updated = await query<{ id: string }>(
      `UPDATE team_memberships
       SET role = COALESCE($3::membership_role, role),
           status = COALESCE($4::player_status, status),
           updated_at = NOW()
       WHERE id = $1 AND team_id = $2
       RETURNING id`,
      [membershipId, teamId, payload.teamRole ?? null, payload.status ?? null]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }

    await writeAudit(req.authUser!.id, "teams.membership.update", {
      membershipId,
      role: payload.teamRole ?? null,
      status: payload.status ?? null,
    });
    return res.json({ ok: true });
  })
);

teamsRouter.delete(
  "/:teamId/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const teamRole = await getTeamRoleForUser(teamId, req.authUser!.id);
    const isRootAdmin = effectiveRole === "ADMIN";
    const isCaptain = teamRole === "CAPTAIN";
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }

    const deleted = await query<{ id: string }>(
      `DELETE FROM team_memberships
       WHERE id = $1 AND team_id = $2
       RETURNING id`,
      [membershipId, teamId]
    );
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }

    await writeAudit(req.authUser!.id, "teams.membership.delete", { membershipId });
    return res.json({ ok: true });
  })
);
