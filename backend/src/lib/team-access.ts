import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { isTrustedAdminAuthMethod } from "./auth-telegram-handoff.js";
import { canChooseAdminRole } from "./entry-role.js";

// Команда запроса — контракт основы ревизии 11.11.2026.
//
// Откуда берётся команда, по приоритету:
//   1. параметр ручки (`/teams/:teamId/...`) — передаёт сама ручка;
//   2. заголовок `X-PBTH-Team: <id команды>` — его шлёт новый клиент со всех
//      экранов `/t/:team/*`;
//   3. `?team=<id>` (код команды — только там, где ручка разрешила: `/init`);
//   4. активная команда в сессии — так работает старый фронтенд.
//
// Ответ: `{ teamId, membershipId | null, role, via }`.
//   via = 'membership' — человек состоит в команде, роль из состава;
//   via = 'owner'      — владелец платформы без членства, действует как капитан.
// Владелец получает доступ только при явной команде в запросе (1–3), из
// сессии — никогда: без явной команды ответы прежние. В составе он не
// числится, поэтому уведомления команды ему не уходят; записи журнала в таком
// запросе получают пометку владельца (см. `auditMarks`).

export const TEAM_HEADER = "x-pbth-team";

export type TeamRole = "CAPTAIN" | "TRAINER" | "PLAYER";
export type TeamAccessVia = "membership" | "owner";
export type TeamSource = "param" | "header" | "query" | "session";

export type TeamAccess = {
  teamId: string;
  membershipId: string | null;
  role: TeamRole;
  via: TeamAccessVia;
  source: TeamSource;
};

export type TeamAccessErrorCode = "TEAM_NOT_FOUND" | "TEAM_ACCESS_DENIED" | "TEAM_CONTEXT_REQUIRED";

export class TeamAccessError extends Error {
  constructor(public code: TeamAccessErrorCode, public status: number, message: string) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type RequestedTeam = { value: string; source: Exclude<TeamSource, "session"> };

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || null;
  return null;
}

/** Явная команда в запросе (параметр → заголовок → `?team=`), без обращения к базе. */
export function readRequestedTeam(req: Request, param?: string | null): RequestedTeam | null {
  if (param) return { value: param, source: "param" };
  const header = firstString(req.get(TEAM_HEADER));
  if (header) return { value: header, source: "header" };
  const fromQuery = firstString(req.query?.team);
  if (fromQuery) return { value: fromQuery, source: "query" };
  return null;
}

/** Есть ли в запросе явная команда — новое поведение включается только при ней. */
export function hasExplicitTeam(req: Request, param?: string | null): boolean {
  return readRequestedTeam(req, param) !== null;
}

/** Владелец платформы: список `ADMIN_ROLE_ALLOWLIST_*` и, если требуется, доверенный способ входа. */
export function isPlatformOwner(req: Request): boolean {
  const user = req.authUser;
  if (!user) return false;
  if (!canChooseAdminRole(user)) return false;
  if (env.telegramOidc.adminRequired && !isTrustedAdminAuthMethod(req.session.authMethod)) return false;
  return true;
}

/** Команда по id или короткому коду (без учёта регистра). `null` — нет такой. */
export async function findTeamId(value: string, allowShortCode: boolean): Promise<string | null> {
  if (isUuid(value)) {
    const byId = await query<{ id: string }>(`SELECT id FROM teams WHERE id = $1`, [value]);
    if (byId.rows[0]) return byId.rows[0].id;
  }
  if (allowShortCode && SHORT_CODE_RE.test(value)) {
    // Код в адресе — в нижнем регистре, в базе — как ввёл капитан.
    const byCode = await query<{ id: string }>(
      `SELECT id FROM teams WHERE lower(short_code) = lower($1) ORDER BY created_at ASC LIMIT 1`,
      [value]
    );
    if (byCode.rows[0]) return byCode.rows[0].id;
  }
  return null;
}

async function sessionAccess(req: Request): Promise<TeamAccess | null> {
  const userId = req.authUser?.id;
  if (!userId || !req.session.activeMembershipId || !req.session.activeTeamId) return null;
  const result = await query<{ id: string; team_id: string; role: TeamRole }>(
    `SELECT id, team_id, role::text AS role
     FROM team_memberships
     WHERE id = $1 AND team_id = $2 AND user_id = $3`,
    [req.session.activeMembershipId, req.session.activeTeamId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { teamId: row.team_id, membershipId: row.id, role: row.role, via: "membership", source: "session" };
}

export type ResolveTeamAccessOptions = {
  /** Команда из параметра ручки. */
  param?: string | null;
  /** Принимать короткий код команды (только `/init`). */
  allowShortCode?: boolean;
  /** Не смотреть в сессию: нужна явная команда. */
  explicitOnly?: boolean;
};

/**
 * Команда запроса и права в ней. `null` — команды нет ни в запросе, ни в
 * сессии. Явно указанная, но недоступная команда — `TeamAccessError`.
 */
export async function resolveTeamAccess(req: Request, options: ResolveTeamAccessOptions = {}): Promise<TeamAccess | null> {
  const userId = req.authUser?.id;
  if (!userId) throw new TeamAccessError("TEAM_ACCESS_DENIED", 401, "Authentication required");

  const requested = readRequestedTeam(req, options.param);
  if (!requested) {
    return options.explicitOnly ? null : sessionAccess(req);
  }

  const teamId = await findTeamId(requested.value, Boolean(options.allowShortCode));
  if (!teamId) throw new TeamAccessError("TEAM_NOT_FOUND", 404, "Team not found");

  const membership = await query<{ id: string; role: TeamRole }>(
    `SELECT id, role::text AS role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  if (membership.rows[0]) {
    return {
      teamId,
      membershipId: membership.rows[0].id,
      role: membership.rows[0].role,
      via: "membership",
      source: requested.source,
    };
  }

  if (isPlatformOwner(req)) {
    markOwnerAccess(teamId);
    return { teamId, membershipId: null, role: "CAPTAIN", via: "owner", source: requested.source };
  }

  throw new TeamAccessError("TEAM_ACCESS_DENIED", 403, "No access to this team");
}

/** Ответ клиенту на отказ — в общем формате `{ detail, code }`. */
export function sendTeamAccessError(res: Response, error: unknown): boolean {
  if (error instanceof TeamAccessError) {
    res.status(error.status).json({ detail: error.message, code: error.code });
    return true;
  }
  return false;
}

// --- Пометка владельца в журнале ---------------------------------------------
//
// Контекст живёт один запрос. `resolveTeamAccess` отмечает в нём, что
// владелец действует в чужой команде, и `writeAudit` добавляет пометку ко
// всем записям этого запроса — ручкам ничего передавать не нужно.

type AuditContext = { ownerTeamIds: Set<string> };

const auditStorage = new AsyncLocalStorage<AuditContext>();

export function auditContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  auditStorage.run({ ownerTeamIds: new Set() }, () => next());
}

/** Отметить, что владелец в этом запросе действует в чужой команде (для `lib/event-access.ts`). */
export function markOwnerAccess(teamId: string) {
  auditStorage.getStore()?.ownerTeamIds.add(teamId);
}

/** Поля, которые `writeAudit` добавляет к записи. Пусто, если владелец не действовал. */
export function auditMarks(): { actorVia: "owner"; ownerTeamIds: string[] } | null {
  const store = auditStorage.getStore();
  if (!store || store.ownerTeamIds.size === 0) return null;
  return { actorVia: "owner", ownerTeamIds: [...store.ownerTeamIds] };
}
