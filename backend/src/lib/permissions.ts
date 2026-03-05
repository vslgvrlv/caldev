import { query } from "../db/pool.js";

export type Membership = {
  id: string;
  user_id: string;
  team_id: string;
  role: "CAPTAIN" | "TRAINER" | "PLAYER";
  status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
  balance: string;
};

export async function getMembershipById(membershipId: string): Promise<Membership | null> {
  const result = await query<Membership>(
    `SELECT id, user_id, team_id, role, status, balance::text
     FROM team_memberships
     WHERE id = $1`,
    [membershipId]
  );
  return result.rows[0] ?? null;
}

export async function getUserMemberships(userId: string): Promise<Array<Membership & { team_name: string; team_short_code: string }>> {
  const result = await query<Membership & { team_name: string; team_short_code: string }>(
    `SELECT tm.id, tm.user_id, tm.team_id, tm.role, tm.status, tm.balance::text, t.name AS team_name, t.short_code AS team_short_code
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1
     ORDER BY t.name ASC`,
    [userId]
  );
  return result.rows;
}

export function isTeamManager(role: string): boolean {
  return role === "CAPTAIN";
}
