import type { Request } from "express";
import { query } from "../../db/pool.js";

export type ActiveContext = {
  membershipId: string;
  teamId: string;
  role: "CAPTAIN" | "TRAINER" | "PLAYER";
  userId: string;
};

export async function getActiveContext(req: Request): Promise<ActiveContext | null> {
  const userId = req.authUser?.id;
  if (!userId || !req.session.activeMembershipId || !req.session.activeTeamId) {
    return null;
  }

  const result = await query<{
    id: string;
    team_id: string;
    role: "CAPTAIN" | "TRAINER" | "PLAYER";
    user_id: string;
  }>(
    `SELECT id, team_id, role, user_id
     FROM team_memberships
     WHERE id = $1 AND team_id = $2 AND user_id = $3`,
    [req.session.activeMembershipId, req.session.activeTeamId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    membershipId: row.id,
    teamId: row.team_id,
    role: row.role,
    userId: row.user_id,
  };
}
