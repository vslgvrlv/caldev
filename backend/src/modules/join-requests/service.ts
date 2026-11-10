import { query } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { withTransaction } from "../../lib/team-captains.js";
import { findActiveJoinLink, type JoinLinkTeam } from "../teams/join-link.js";
import {
  closeRequestCards,
  linkKeyboard,
  personLabel,
  pushToUsers,
  sendBotMessageSafe,
  sendRequestCard,
} from "./delivery.js";

// Заявки на вступление в команду (трек 1 ревизии, решения Василия 10.11.2026,
// п. 4 и 12).
//
// - Заявка возникает, когда вошедший человек открыл ссылку команды.
// - Все заявки — на игрока. Тренером человека потом делает капитан.
// - Одобряет капитан или тренер команды; пока тренера нет — только капитан.
//   Владелец платформы в чужой команде действует как капитан.
// - Принятая заявка создаёт членство игрока, человеку уходит сообщение со
//   ссылкой на команду. Отклонённую он видит словами на экране заявки.

export type JoinRequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";
export type TeamRole = "CAPTAIN" | "TRAINER" | "PLAYER";

export const JOIN_APPROVER_ROLES: readonly TeamRole[] = ["CAPTAIN", "TRAINER"];

/** Может ли участник с этой ролью решать заявки на вступление. */
export function canDecideJoinRequests(role: TeamRole | null | undefined): boolean {
  return role === "CAPTAIN" || role === "TRAINER";
}

export type NextEvent = { title: string; startAt: string; location: string | null; timezone: string };

export type JoinRequestView = {
  id: string;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  team: { id: string; name: string; shortCode: string };
  /** Ближайшее событие — только пока заявка ждёт решения. Без состава и денег. */
  nextEvent: NextEvent | null;
};

function iso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function loadNextEvent(teamId: string): Promise<NextEvent | null> {
  const result = await query<{ title: string; start_at: Date; location: string | null; timezone: string }>(
    `SELECT e.title, e.start_at, e.location, t.timezone
     FROM events e
     JOIN teams t ON t.id = e.team_id
     WHERE e.team_id = $1 AND e.is_cancelled = FALSE AND e.start_at >= NOW()
     ORDER BY e.start_at ASC
     LIMIT 1`,
    [teamId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { title: row.title, startAt: iso(row.start_at)!, location: row.location, timezone: row.timezone };
}

type RequestRow = {
  id: string;
  status: JoinRequestStatus;
  created_at: Date;
  decided_at: Date | null;
  team_id: string;
  team_name: string;
  team_short_code: string;
  user_id: string;
};

const REQUEST_SELECT = `
  SELECT r.id, r.status::text AS status, r.created_at, r.decided_at, r.user_id,
         t.id AS team_id, t.name AS team_name, t.short_code AS team_short_code
  FROM team_join_requests r
  JOIN teams t ON t.id = r.team_id`;

async function toView(row: RequestRow): Promise<JoinRequestView> {
  return {
    id: row.id,
    status: row.status,
    createdAt: iso(row.created_at)!,
    decidedAt: iso(row.decided_at),
    team: { id: row.team_id, name: row.team_name, shortCode: row.team_short_code },
    nextEvent: row.status === "PENDING" ? await loadNextEvent(row.team_id) : null,
  };
}

export async function getJoinRequest(requestId: string): Promise<(JoinRequestView & { userId: string }) | null> {
  const result = await query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [requestId]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...(await toView(row)), userId: row.user_id };
}

/** Заявки человека: ждущие и последние решённые, новые сверху. */
export async function listMyJoinRequests(userId: string): Promise<JoinRequestView[]> {
  const result = await query<RequestRow>(
    `${REQUEST_SELECT}
     WHERE r.user_id = $1 AND (r.status = 'PENDING' OR r.decided_at > NOW() - INTERVAL '30 days')
     ORDER BY r.created_at DESC
     LIMIT 20`,
    [userId]
  );
  return Promise.all(result.rows.map(toView));
}

export async function findMembership(teamId: string, userId: string): Promise<{ id: string; role: TeamRole } | null> {
  const result = await query<{ id: string; role: TeamRole }>(
    `SELECT id, role::text AS role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return result.rows[0] ?? null;
}

export type CreateJoinRequestResult =
  | { kind: "invalid_link" }
  | { kind: "member"; team: { id: string; name: string; shortCode: string } }
  | { kind: "request"; created: boolean; request: JoinRequestView };

async function notifyApprovers(request: JoinRequestView, link: JoinLinkTeam, requesterId: string) {
  const requester = await query<{ name: string; nickname: string; username: string | null }>(
    `SELECT name, nickname, username FROM users WHERE id = $1`,
    [requesterId]
  );
  const who = personLabel(requester.rows[0] ?? { name: "Новичок" });
  const approvers = await query<{ id: string; telegram_id: string | null }>(
    `SELECT u.id, u.telegram_id::text AS telegram_id
     FROM team_memberships tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1 AND tm.role IN ('CAPTAIN', 'TRAINER') AND u.is_active = TRUE`,
    [link.teamId]
  );
  const text = `Заявка в команду «${link.teamName}»: ${who}. Принять в состав игроком?`;
  const openPath = `/t/${encodeURIComponent(link.teamShortCode.toLowerCase())}/requests`;
  await Promise.allSettled([
    ...approvers.rows.map((approver) =>
      sendRequestCard({ kind: "join", requestId: request.id, chatId: approver.telegram_id, text, openPath })
    ),
    pushToUsers(
      approvers.rows.map((a) => a.id),
      { title: "Заявка в команду", body: `${who} хочет в «${link.teamName}»` }
    ),
  ]);
}

/**
 * Вошедший человек открыл ссылку команды. Участнику команды заявка не нужна;
 * повторное открытие ссылки отдаёт ту же ждущую заявку, а не новую.
 */
export async function createJoinRequest(userId: string, rawCode: unknown): Promise<CreateJoinRequestResult> {
  const link = await findActiveJoinLink(rawCode);
  if (!link) return { kind: "invalid_link" };
  const team = { id: link.teamId, name: link.teamName, shortCode: link.teamShortCode };

  if (await findMembership(link.teamId, userId)) return { kind: "member", team };

  const inserted = await query<{ id: string }>(
    `INSERT INTO team_join_requests (team_id, user_id, link_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [link.teamId, userId, link.linkId]
  );
  let requestId = inserted.rows[0]?.id ?? null;
  const created = Boolean(requestId);
  if (!requestId) {
    const pending = await query<{ id: string }>(
      `SELECT id FROM team_join_requests WHERE team_id = $1 AND user_id = $2 AND status = 'PENDING'`,
      [link.teamId, userId]
    );
    requestId = pending.rows[0]?.id ?? null;
  }
  if (!requestId) throw new Error("Join request was neither created nor found");

  const request = (await getJoinRequest(requestId))!;
  if (created) {
    await writeAudit(userId, "join_requests.create", { teamId: link.teamId, requestId, linkId: link.linkId });
    await notifyApprovers(request, link, userId);
  }
  return { kind: "request", created, request };
}

/** Ждущие заявки команды для экрана капитана и значка в шапке. */
export async function listPendingTeamRequests(teamId: string) {
  const result = await query<{
    id: string;
    created_at: Date;
    user_id: string;
    name: string;
    nickname: string;
    username: string | null;
    avatar: string | null;
  }>(
    `SELECT r.id, r.created_at, u.id AS user_id, u.name, u.nickname, u.username, u.avatar
     FROM team_join_requests r
     JOIN users u ON u.id = r.user_id
     WHERE r.team_id = $1 AND r.status = 'PENDING'
     ORDER BY r.created_at ASC`,
    [teamId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: iso(row.created_at)!,
    user: { id: row.user_id, name: row.name, nickname: row.nickname, username: row.username, avatar: row.avatar },
  }));
}

export type DecideErrorCode = "NOT_FOUND" | "FORBIDDEN" | "ALREADY_DECIDED";

export class JoinDecisionError extends Error {
  constructor(public code: DecideErrorCode, public status: number, message: string, public currentStatus?: JoinRequestStatus) {
    super(message);
  }
}

export type DecideJoinParams = {
  requestId: string;
  decision: "approve" | "decline";
  actor: {
    userId: string;
    /**
     * Роль в команде заявки, если её уже определил вызывающий (приложение —
     * через `resolveTeamAccess`, владелец там получает роль капитана).
     * Не передана — берётся из состава (кнопка в боте).
     */
    role?: TeamRole | null;
    via?: "membership" | "owner" | "bot";
  };
};

export type DecideJoinResult = {
  requestId: string;
  status: "APPROVED" | "DECLINED";
  teamId: string;
  teamName: string;
  teamShortCode: string;
  userId: string;
  membershipId: string | null;
};

/** Решение по заявке. Проверка прав и смена статуса — в одной транзакции. */
export async function decideJoinRequest(params: DecideJoinParams): Promise<DecideJoinResult> {
  const { requestId, decision, actor } = params;
  const result = await withTransaction(async (client) => {
    const found = await client.query<{ id: string; team_id: string; user_id: string; status: JoinRequestStatus }>(
      `SELECT id, team_id, user_id, status::text AS status FROM team_join_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    const request = found.rows[0];
    if (!request) throw new JoinDecisionError("NOT_FOUND", 404, "Join request not found");

    let role = actor.role ?? null;
    if (actor.role === undefined) {
      const membership = await client.query<{ role: TeamRole }>(
        `SELECT role::text AS role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
        [request.team_id, actor.userId]
      );
      role = membership.rows[0]?.role ?? null;
    }
    if (!canDecideJoinRequests(role)) {
      throw new JoinDecisionError("FORBIDDEN", 403, "Only the team captain or trainer can decide join requests");
    }
    if (request.status !== "PENDING") {
      throw new JoinDecisionError("ALREADY_DECIDED", 409, "Join request is already decided", request.status);
    }

    let membershipId: string | null = null;
    if (decision === "approve") {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
         VALUES ($1, $2, 'PLAYER', 'ACTIVE', 0)
         ON CONFLICT (user_id, team_id) DO NOTHING
         RETURNING id`,
        [request.user_id, request.team_id]
      );
      membershipId = inserted.rows[0]?.id ?? null;
      if (!membershipId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
          [request.user_id, request.team_id]
        );
        membershipId = existing.rows[0]?.id ?? null;
      }
    }

    const status = decision === "approve" ? "APPROVED" : "DECLINED";
    await client.query(
      `UPDATE team_join_requests
       SET status = $2::join_request_status, decided_by = $3, decided_at = NOW(), membership_id = $4
       WHERE id = $1`,
      [requestId, status, actor.userId, membershipId]
    );
    const team = await client.query<{ name: string; short_code: string }>(
      `SELECT name, short_code FROM teams WHERE id = $1`,
      [request.team_id]
    );
    return {
      requestId,
      status,
      teamId: request.team_id,
      teamName: team.rows[0]?.name ?? "",
      teamShortCode: team.rows[0]?.short_code ?? "",
      userId: request.user_id,
      membershipId,
    } as DecideJoinResult;
  });

  await writeAudit(actor.userId, result.status === "APPROVED" ? "join_requests.approve" : "join_requests.decline", {
    teamId: result.teamId,
    requestId,
    userId: result.userId,
    membershipId: result.membershipId,
    via: actor.via ?? null,
  });
  await afterDecision(result, actor.userId);
  return result;
}

async function afterDecision(result: DecideJoinResult, actorId: string) {
  const actor = await query<{ name: string; nickname: string }>(`SELECT name, nickname FROM users WHERE id = $1`, [actorId]);
  const actorName = String(actor.rows[0]?.name || actor.rows[0]?.nickname || "").trim();
  const by = actorName ? ` — ${actorName}` : "";
  const verdict = result.status === "APPROVED" ? `✅ Принят${by}` : `✋ Отклонён${by}`;

  const tasks: Array<Promise<unknown>> = [closeRequestCards("join", result.requestId, verdict)];
  if (result.status === "APPROVED") {
    const requester = await query<{ telegram_id: string | null }>(
      `SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1`,
      [result.userId]
    );
    const teamPath = `/t/${encodeURIComponent(result.teamShortCode.toLowerCase())}`;
    tasks.push(
      sendBotMessageSafe(
        requester.rows[0]?.telegram_id,
        `Тебя приняли в команду «${result.teamName}». Расписание и явка — в приложении.`,
        linkKeyboard("Открыть команду", teamPath)
      ),
      pushToUsers([result.userId], { title: "Тебя приняли в команду", body: `«${result.teamName}» ждёт тебя в приложении` })
    );
  }
  await Promise.allSettled(tasks);
}
