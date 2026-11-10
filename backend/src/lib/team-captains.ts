import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

// Капитаны команды: кто может менять и убирать капитанов.
//
// - Назначает капитана только владелец платформы (капитан — нет; так было в
//   `/teams`, а admin v1 это правило обходил).
// - Чужого капитана понижает или исключает только владелец. Капитан может
//   понизить или исключить себя сам.
// - Последнего капитана не понижает и не исключает никто: команда без капитана
//   остаётся без управления.
//
// Проверка и само изменение идут в одной транзакции под блокировкой строки
// команды: иначе два одновременных понижения двух капитанов оставят команду
// без капитана.

export type TeamRole = "CAPTAIN" | "TRAINER" | "PLAYER";

export type CaptainGuardCode = "MEMBERSHIP_NOT_FOUND" | "CAPTAIN_ASSIGN_FORBIDDEN" | "CAPTAIN_PROTECTED" | "LAST_CAPTAIN";

export class CaptainGuardError extends Error {
  constructor(public code: CaptainGuardCode, public status: number, message: string) {
    super(message);
  }
}

export const CAPTAIN_GUARD_MESSAGES: Record<CaptainGuardCode, string> = {
  MEMBERSHIP_NOT_FOUND: "Membership not found",
  CAPTAIN_ASSIGN_FORBIDDEN: "Captain cannot assign captain role",
  CAPTAIN_PROTECTED: "Only the platform owner can change another captain",
  LAST_CAPTAIN: "Нельзя понизить или исключить последнего капитана команды",
};

const STATUS: Record<CaptainGuardCode, number> = {
  MEMBERSHIP_NOT_FOUND: 404,
  CAPTAIN_ASSIGN_FORBIDDEN: 403,
  CAPTAIN_PROTECTED: 403,
  LAST_CAPTAIN: 409,
};

function fail(code: CaptainGuardCode): never {
  throw new CaptainGuardError(code, STATUS[code], CAPTAIN_GUARD_MESSAGES[code]);
}

export type MembershipChange =
  | { kind: "update"; role?: TeamRole | null }
  | { kind: "delete" };

export type CaptainGuardActor = { userId: string; isOwner: boolean };

type Target = { id: string; user_id: string; role: TeamRole };

/**
 * Проверяет изменение участника. Вызывать внутри транзакции: функция берёт
 * блокировку строки команды и держит её до конца транзакции.
 * `target` — null, если участника ещё нет (добавление).
 */
export async function assertCaptainChangeAllowed(
  client: PoolClient,
  params: { teamId: string; target: Target | null; change: MembershipChange; actor: CaptainGuardActor }
): Promise<void> {
  const { teamId, target, change, actor } = params;
  await client.query(`SELECT 1 FROM teams WHERE id = $1 FOR UPDATE`, [teamId]);

  const nextRole = change.kind === "update" ? change.role ?? null : null;
  if (nextRole === "CAPTAIN" && target?.role !== "CAPTAIN" && !actor.isOwner) {
    fail("CAPTAIN_ASSIGN_FORBIDDEN");
  }

  if (!target || target.role !== "CAPTAIN") return;
  const losesCaptain = change.kind === "delete" || (nextRole !== null && nextRole !== "CAPTAIN");
  if (!losesCaptain) return;

  if (!actor.isOwner && target.user_id !== actor.userId) {
    fail("CAPTAIN_PROTECTED");
  }

  const captains = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM team_memberships WHERE team_id = $1 AND role = 'CAPTAIN'`,
    [teamId]
  );
  if (Number(captains.rows[0]?.total || "0") <= 1) {
    fail("LAST_CAPTAIN");
  }
}

export async function loadMembershipForUpdate(client: PoolClient, teamId: string, membershipId: string): Promise<Target | null> {
  const result = await client.query<Target>(
    `SELECT id, user_id, role::text AS role FROM team_memberships WHERE id = $1 AND team_id = $2 FOR UPDATE`,
    [membershipId, teamId]
  );
  return result.rows[0] ?? null;
}

export async function loadMembershipByUserForUpdate(client: PoolClient, teamId: string, userId: string): Promise<Target | null> {
  const result = await client.query<Target>(
    `SELECT id, user_id, role::text AS role FROM team_memberships WHERE user_id = $1 AND team_id = $2 FOR UPDATE`,
    [userId, teamId]
  );
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Ответ клиенту в прежнем формате ручек участников: `{ detail, code }`. */
export function sendCaptainGuardError(res: any, error: unknown): boolean {
  if (error instanceof CaptainGuardError) {
    res.status(error.status).json({ detail: error.message, code: error.code });
    return true;
  }
  return false;
}
