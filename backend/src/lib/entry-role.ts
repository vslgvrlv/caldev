import type { Request } from "express";
import { env } from "../config/env.js";
import type { AuthUser } from "../middleware/auth.js";

export type EntryRole = "ADMIN" | "USER";

export function canChooseAdminRole(user: Pick<AuthUser, "telegram_id" | "username">): boolean {
  const username = (user.username || "").toLowerCase();
  return env.adminRoleAllowlist.telegramIds.includes(user.telegram_id) || env.adminRoleAllowlist.usernames.includes(username);
}

export function getEffectiveEntryRole(req: Request, user: Pick<AuthUser, "telegram_id" | "username">): EntryRole | null {
  if (canChooseAdminRole(user)) {
    return req.session.entryRole ?? null;
  }
  return "USER";
}
