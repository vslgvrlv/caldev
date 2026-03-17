import type { NextFunction, Request, Response } from "express";
import { query } from "../db/pool.js";

export type AuthUser = {
  id: string;
  telegram_id: string;
  username: string | null;
  name: string;
  nickname: string;
  avatar: string | null;
  is_active: boolean;
  account_role: "ADMIN" | "USER" | null;
  onboarding_completed_at: string | null;
};

export async function attachAuthUser(req: Request): Promise<AuthUser | null> {
  if (!req.session.userId) {
    return null;
  }
  const result = await query<AuthUser>(
    `SELECT id, telegram_id::text, username, name, nickname, avatar, is_active, account_role, onboarding_completed_at
     FROM users
     WHERE id = $1 AND is_active = TRUE`,
    [req.session.userId]
  );
  const user = result.rows[0] ?? null;
  if (user) {
    req.authUser = user;
  }
  return user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await attachAuthUser(req);
  if (!user) {
    return res.status(401).json({ detail: "Authentication required" });
  }
  return next();
}

export default { attachAuthUser, requireAuth };
