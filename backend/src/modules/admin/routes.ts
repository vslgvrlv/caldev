import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { canChooseAdminRole, getEffectiveEntryRole } from "../../lib/entry-role.js";
import { writeAudit } from "../../lib/audit.js";

export const adminRouter = Router();

function ensureOwnerAdmin(req: Parameters<typeof requireAuth>[0]) {
  const user = req.authUser!;
  const effectiveRole = getEffectiveEntryRole(req, user);
  if (effectiveRole !== "ADMIN" || !canChooseAdminRole(user)) {
    return false;
  }
  return true;
}

adminRouter.get(
  "/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }

    const users = await query<{
      id: string;
      username: string | null;
      name: string;
      nickname: string;
      account_role: "ADMIN" | "USER" | null;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, username, name, nickname, account_role, is_active, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const teams = await query<{
      id: string;
      name: string;
      short_code: string;
      budget: string;
      created_at: string;
      members_count: string;
      captains_count: string;
    }>(
      `SELECT t.id, t.name, t.short_code, t.budget::text, t.created_at,
              COUNT(tm.id)::text AS members_count,
              COUNT(*) FILTER (WHERE tm.role = 'CAPTAIN')::text AS captains_count
       FROM teams t
       LEFT JOIN team_memberships tm ON tm.team_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT 200`
    );

    const memberships = await query<{
      id: string;
      team_id: string;
      team_name: string;
      user_id: string;
      username: string | null;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
      created_at: string;
    }>(
      `SELECT tm.id, tm.team_id, t.name AS team_name, tm.user_id, u.username, tm.role::text, tm.status::text, tm.created_at
       FROM team_memberships tm
       JOIN teams t ON t.id = tm.team_id
       JOIN users u ON u.id = tm.user_id
       ORDER BY tm.created_at DESC
       LIMIT 400`
    );

    const invites = await query<{
      id: string;
      token: string;
      team_id: string;
      team_name: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      expires_at: string;
      used_at: string | null;
      is_revoked: boolean;
      created_at: string;
    }>(
      `SELECT i.id, i.token::text, i.team_id, t.name AS team_name, i.role::text, i.expires_at, i.used_at, i.is_revoked, i.created_at
       FROM team_invites i
       JOIN teams t ON t.id = i.team_id
       ORDER BY i.created_at DESC
       LIMIT 400`
    );

    return res.json({
      users: users.rows,
      teams: teams.rows.map((t) => ({
        ...t,
        budget: Number(t.budget),
        members_count: Number(t.members_count),
        captains_count: Number(t.captains_count),
      })),
      memberships: memberships.rows,
      invites: invites.rows,
    });
  })
);

const patchUserSchema = z
  .object({
    accountRole: z.enum(["ADMIN", "USER"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.accountRole !== undefined || v.isActive !== undefined, {
    message: "Nothing to update",
  });

adminRouter.patch(
  "/users/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const userId = z.string().uuid().parse(req.params.userId);
    const payload = patchUserSchema.parse(req.body);

    const updated = await query(
      `UPDATE users
       SET account_role = COALESCE($2::account_role, account_role),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [userId, payload.accountRole ?? null, payload.isActive ?? null]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "User not found" });
    }

    await writeAudit(req.authUser!.id, "admin.user.patch", { userId, payload });
    return res.json({ ok: true });
  })
);

adminRouter.delete(
  "/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const deleted = await query(`DELETE FROM team_memberships WHERE id = $1 RETURNING id`, [membershipId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }
    await writeAudit(req.authUser!.id, "admin.membership.delete", { membershipId });
    return res.json({ ok: true });
  })
);

adminRouter.patch(
  "/invites/:inviteId/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const inviteId = z.string().uuid().parse(req.params.inviteId);
    const updated = await query(
      `UPDATE team_invites
       SET is_revoked = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [inviteId]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "Invite not found" });
    }
    await writeAudit(req.authUser!.id, "admin.invite.revoke", { inviteId });
    return res.json({ ok: true });
  })
);

adminRouter.delete(
  "/teams/:teamId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const teamId = z.string().uuid().parse(req.params.teamId);
    const deleted = await query(`DELETE FROM teams WHERE id = $1 RETURNING id`, [teamId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }
    await writeAudit(req.authUser!.id, "admin.team.delete", { teamId });
    return res.json({ ok: true });
  })
);
