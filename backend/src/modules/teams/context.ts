import type { Request } from "express";
import { resolveTeamAccess } from "../../lib/team-access.js";

// Совместимость: раньше команда бралась только из сессии. Теперь источник —
// общий `resolveTeamAccess` (параметр → заголовок → `?team=` → сессия).
// Новым ручкам звать `resolveTeamAccess` напрямую.

export type ActiveContext = {
  membershipId: string | null;
  teamId: string;
  role: "CAPTAIN" | "TRAINER" | "PLAYER";
  userId: string;
  via: "membership" | "owner";
};

/** @deprecated используйте `resolveTeamAccess` из `lib/team-access.ts`. */
export async function getActiveContext(req: Request): Promise<ActiveContext | null> {
  const access = await resolveTeamAccess(req);
  if (!access || !req.authUser) return null;
  return { membershipId: access.membershipId, teamId: access.teamId, role: access.role, userId: req.authUser.id, via: access.via };
}
