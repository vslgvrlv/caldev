import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { findTeamId, isPlatformOwner, resolveTeamAccess, sendTeamAccessError } from "../../lib/team-access.js";
import { loadTeamJournal } from "./journal.js";
import { suggestShortCode } from "./short-code.js";

// Консоль владельца платформы (трек 3 ревизии, боль Б3). Ручки консоли —
// только владельцу (`isPlatformOwner`: список допуска и доверенный вход).
// Всё, что владелец делает внутри команды, он делает экранами капитана по
// адресу `/t/<код>`, а не отсюда: консоль показывает список команд, заявки на
// создание и помогает команде (открыть как капитан, пригласить капитана).
//
// Исключение — журнал команды: его видит и капитан этой команды.

export const platformRouter = Router();

function requireOwner(req: Request, res: Response): boolean {
  if (isPlatformOwner(req)) return true;
  res.status(403).json({ detail: "Доступно только владельцу платформы", code: "FORBIDDEN" });
  return false;
}

type TeamRow = {
  id: string;
  name: string;
  short_code: string;
  timezone: string;
  created_at: string;
  members_count: string;
  captains: string | null;
  next_event_id: string | null;
  next_event_title: string | null;
  next_event_start_at: string | null;
  last_activity_at: string | null;
  is_mine: boolean;
};

const TEAM_SUMMARY_SQL = `
  SELECT t.id,
         t.name,
         t.short_code,
         t.timezone,
         t.created_at,
         (SELECT COUNT(*) FROM team_memberships tm JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
           WHERE tm.team_id = t.id)::text AS members_count,
         (SELECT string_agg(u.name, ', ' ORDER BY u.name) FROM team_memberships tm JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = t.id AND tm.role = 'CAPTAIN') AS captains,
         ne.id AS next_event_id,
         ne.title AS next_event_title,
         ne.start_at AS next_event_start_at,
         GREATEST(
           t.created_at,
           (SELECT MAX(e.updated_at) FROM events e WHERE e.team_id = t.id),
           (SELECT MAX(r.updated_at) FROM rsvps r JOIN events e ON e.id = r.event_id WHERE e.team_id = t.id),
           (SELECT MAX(tr.created_at) FROM transactions tr WHERE tr.team_id = t.id),
           (SELECT MAX(tm.updated_at) FROM team_memberships tm WHERE tm.team_id = t.id)
         ) AS last_activity_at,
         EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = t.id AND tm.user_id = $1) AS is_mine
  FROM teams t
  LEFT JOIN LATERAL (
    SELECT e.id, e.title, e.start_at FROM events e
    WHERE e.team_id = t.id AND e.is_cancelled = FALSE AND e.start_at >= NOW()
    ORDER BY e.start_at ASC
    LIMIT 1
  ) ne ON TRUE`;

// Заявки на вступление — таблица трека 1. Пока её нет (или она устроена
// иначе), число заявок неизвестно: `null`, и консоль его не показывает.
async function pendingJoinRequests(teamIds: string[]): Promise<Map<string, number> | null> {
  if (!teamIds.length) return new Map();
  try {
    const table = await query<{ exists: boolean }>(
      `SELECT to_regclass('public.team_join_requests') IS NOT NULL AS exists`
    );
    if (!table.rows[0]?.exists) return null;
    const rows = await query<{ team_id: string; count: string }>(
      `SELECT team_id::text AS team_id, COUNT(*)::text AS count
       FROM team_join_requests
       WHERE team_id = ANY($1::uuid[]) AND upper(status::text) = 'PENDING'
       GROUP BY team_id`,
      [teamIds]
    );
    return new Map(rows.rows.map((row) => [row.team_id, Number(row.count)]));
  } catch {
    return null;
  }
}

function mapTeam(row: TeamRow, joinRequests: Map<string, number> | null) {
  return {
    id: row.id,
    name: row.name,
    shortCode: row.short_code,
    timezone: row.timezone,
    createdAt: row.created_at,
    membersCount: Number(row.members_count),
    captains: row.captains ? row.captains.split(", ") : [],
    nextEvent: row.next_event_id
      ? { id: row.next_event_id, title: row.next_event_title, startAt: row.next_event_start_at }
      : null,
    pendingJoinRequests: joinRequests ? joinRequests.get(row.id) ?? 0 : null,
    lastActivityAt: row.last_activity_at,
    isMine: row.is_mine,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Все команды с состоянием. `q` — поиск по названию и коду.
platformRouter.get(
  "/teams",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const q = z.string().trim().max(80).optional().parse(typeof req.query.q === "string" ? req.query.q : undefined);
    const rows = await query<TeamRow>(
      `${TEAM_SUMMARY_SQL}
       WHERE ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%' OR t.short_code ILIKE '%' || $2 || '%')
       ORDER BY t.name ASC`,
      [req.authUser!.id, q ? escapeLike(q) : null]
    );
    const joinRequests = await pendingJoinRequests(rows.rows.map((row) => row.id));
    return res.json({ items: rows.rows.map((row) => mapTeam(row, joinRequests)) });
  })
);

// Подсказка короткого кода для новой команды: свободный, из названия.
platformRouter.get(
  "/teams/code-suggestion",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const name = z.string().trim().min(1).max(80).parse(req.query.name);
    return res.json({ shortCode: await freeShortCode(suggestShortCode(name)) });
  })
);

async function shortCodeTaken(code: string): Promise<boolean> {
  const result = await query(`SELECT 1 FROM teams WHERE lower(short_code) = lower($1)`, [code]);
  return Boolean(result.rowCount);
}

async function freeShortCode(base: string): Promise<string> {
  if (!(await shortCodeTaken(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 14)}${n}`;
    if (!(await shortCodeTaken(candidate))) return candidate;
  }
  return `${base.slice(0, 8)}${Date.now() % 100_000}`;
}

const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  shortCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,16}$/)
    .optional(),
  timezone: z.string().trim().min(1).max(64).default("Europe/Moscow"),
});

// Создать команду самому. Владелец в состав не попадает: дальше он
// приглашает капитана из карточки команды.
platformRouter.post(
  "/teams",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const parsed = createTeamSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ detail: "Название — от 2 до 80 знаков, код — латиница и цифры, 2–16 знаков", code: "VALIDATION_ERROR" });
    }
    const payload = parsed.data;
    let shortCode = payload.shortCode ? payload.shortCode.toUpperCase() : await freeShortCode(suggestShortCode(payload.name));
    if (payload.shortCode && (await shortCodeTaken(shortCode))) {
      return res.status(409).json({ detail: "Такой код уже занят", code: "SHORT_CODE_TAKEN" });
    }
    let created;
    try {
      created = await query<{ id: string; name: string; short_code: string }>(
        `INSERT INTO teams (name, short_code, timezone) VALUES ($1, $2, $3) RETURNING id, name, short_code`,
        [payload.name, shortCode, payload.timezone]
      );
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ detail: "Такой код уже занят", code: "SHORT_CODE_TAKEN" });
      }
      throw error;
    }
    shortCode = created.rows[0].short_code;
    await writeAudit(req.authUser!.id, "platform.team.create", { teamId: created.rows[0].id });
    return res.status(201).json({ team: { id: created.rows[0].id, name: created.rows[0].name, shortCode } });
  })
);

// Карточка команды: состояние, состав, ближайшие события.
platformRouter.get(
  "/teams/:team",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireOwner(req, res)) return;
    const value = z.string().trim().min(1).max(64).parse(req.params.team);
    const teamId = await findTeamId(value, true);
    if (!teamId) return res.status(404).json({ detail: "Команда не найдена", code: "TEAM_NOT_FOUND" });

    const teamRows = await query<TeamRow>(`${TEAM_SUMMARY_SQL} WHERE t.id = $2`, [req.authUser!.id, teamId]);
    const joinRequests = await pendingJoinRequests([teamId]);
    const members = await query<{ id: string; name: string; nickname: string; role: string; status: string }>(
      `SELECT u.id, u.name, u.nickname, tm.role::text AS role, tm.status::text AS status
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
       WHERE tm.team_id = $1
       ORDER BY CASE tm.role WHEN 'CAPTAIN' THEN 0 WHEN 'TRAINER' THEN 1 ELSE 2 END, u.name`,
      [teamId]
    );
    const events = await query<{ id: string; title: string; type: string; start_at: string }>(
      `SELECT id, title, type::text AS type, start_at FROM events
       WHERE team_id = $1 AND is_cancelled = FALSE AND start_at >= NOW()
       ORDER BY start_at ASC LIMIT 5`,
      [teamId]
    );
    return res.json({
      team: mapTeam(teamRows.rows[0], joinRequests),
      members: members.rows.map((m) => ({ id: m.id, name: m.name, nickname: m.nickname, role: m.role, status: m.status })),
      upcomingEvents: events.rows.map((e) => ({ id: e.id, title: e.title, type: e.type, startAt: e.start_at })),
    });
  })
);

// Журнал команды — капитану этой команды и владельцу платформы.
platformRouter.get(
  "/teams/:teamId/journal",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    let access;
    try {
      access = await resolveTeamAccess(req, { param: teamId });
    } catch (error) {
      if (sendTeamAccessError(res, error)) return;
      throw error;
    }
    if (!access || access.role !== "CAPTAIN") {
      return res.status(403).json({ detail: "Журнал команды доступен капитану", code: "FORBIDDEN" });
    }
    const limit = z.coerce.number().int().min(1).max(200).default(60).parse(req.query.limit ?? undefined);
    return res.json({ items: await loadTeamJournal(teamId, limit) });
  })
);
