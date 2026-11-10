import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { withTransaction } from "../../lib/team-captains.js";
import { ensureActiveJoinLink } from "../teams/join-link.js";
import {
  closeRequestCards,
  linkKeyboard,
  personLabel,
  pushToUsers,
  sendBotMessageSafe,
  sendRequestCard,
} from "../join-requests/delivery.js";

// Заявки на создание команды (трек 1 ревизии, решение Василия 10.11.2026,
// п. 5): человек без команды просит команду, владелец платформы одобряет одним
// тапом. Одобренная заявка создаёт команду с коротким кодом из названия,
// подавший становится капитаном, выпускается ссылка команды.
//
// Контракт ручек для консоли трека 3 (не менять):
//   GET  /team-requests?status=pending
//   POST /team-requests/:id/approve
//   POST /team-requests/:id/decline

export type TeamRequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";

export type TeamRequestView = {
  id: string;
  name: string;
  status: TeamRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  team: { id: string; name: string; shortCode: string } | null;
  user: { id: string; name: string; nickname: string; username: string | null };
};

function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

const SELECT = `
  SELECT r.id, r.team_name, r.status::text AS status, r.created_at, r.decided_at,
         t.id AS team_id, t.name AS created_team_name, t.short_code,
         u.id AS user_id, u.name AS user_name, u.nickname, u.username
  FROM team_creation_requests r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN teams t ON t.id = r.team_id`;

type Row = {
  id: string;
  team_name: string;
  status: TeamRequestStatus;
  created_at: Date;
  decided_at: Date | null;
  team_id: string | null;
  created_team_name: string | null;
  short_code: string | null;
  user_id: string;
  user_name: string;
  nickname: string;
  username: string | null;
};

function toView(row: Row): TeamRequestView {
  return {
    id: row.id,
    name: row.team_name,
    status: row.status,
    createdAt: iso(row.created_at)!,
    decidedAt: iso(row.decided_at),
    team: row.team_id ? { id: row.team_id, name: row.created_team_name ?? row.team_name, shortCode: row.short_code ?? "" } : null,
    user: { id: row.user_id, name: row.user_name, nickname: row.nickname, username: row.username },
  };
}

export async function getTeamRequest(id: string): Promise<TeamRequestView | null> {
  const result = await query<Row>(`${SELECT} WHERE r.id = $1`, [id]);
  return result.rows[0] ? toView(result.rows[0]) : null;
}

export async function listTeamRequests(status: TeamRequestStatus | null): Promise<TeamRequestView[]> {
  const result = status
    ? await query<Row>(`${SELECT} WHERE r.status = $1::join_request_status ORDER BY r.created_at ASC LIMIT 200`, [status])
    : await query<Row>(`${SELECT} ORDER BY r.created_at DESC LIMIT 200`);
  return result.rows.map(toView);
}

export async function listMyTeamRequests(userId: string): Promise<TeamRequestView[]> {
  const result = await query<Row>(
    `${SELECT}
     WHERE r.user_id = $1 AND (r.status = 'PENDING' OR r.decided_at > NOW() - INTERVAL '30 days')
     ORDER BY r.created_at DESC LIMIT 10`,
    [userId]
  );
  return result.rows.map(toView);
}

// --- Короткий код команды из названия ---------------------------------------

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(word: string): string {
  return [...word.toLowerCase()].map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join("").replace(/[^a-z0-9]/g, "");
}

/**
 * База кода: первые буквы слов («Дневной Дозор» → DD, «Holy Guns» → HG), у
 * названия из одного слова — его первые четыре буквы («Тигры» → TIGR).
 */
export function shortCodeBase(name: string): string {
  const words = String(name || "")
    .split(/[^\p{L}\p{N}]+/u)
    .map(transliterate)
    .filter(Boolean);
  if (words.length === 0) return "TEAM";
  const base = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 6);
  return (base.length >= 2 ? base : "TEAM").toUpperCase();
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Свободный код: база, затем база с цифрой (DD, DD2, DD3 …). */
export async function uniqueShortCode(name: string, db: Db): Promise<string> {
  const base = shortCodeBase(name);
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}${n}`;
    const taken = await db.query(`SELECT 1 FROM teams WHERE lower(short_code) = lower($1) LIMIT 1`, [candidate]);
    if (taken.rows.length === 0) return candidate;
  }
  throw new Error("No free team short code");
}

// --- Заявка и решение ---------------------------------------------------------

/** Telegram-аккаунты владельцев платформы — им уходят карточки заявок. */
async function ownerChats(): Promise<Array<{ userId: string | null; chatId: string }>> {
  const ids = new Set(env.adminRoleAllowlist.telegramIds.map(String).filter(Boolean));
  const result = await query<{ id: string; telegram_id: string }>(
    `SELECT id, telegram_id::text AS telegram_id FROM users
     WHERE is_active = TRUE AND telegram_id IS NOT NULL
       AND (telegram_id::text = ANY($1::text[]) OR lower(username) = ANY($2::text[]))`,
    [[...ids], env.adminRoleAllowlist.usernames]
  );
  const chats = new Map<string, string | null>();
  for (const id of ids) chats.set(id, null);
  for (const row of result.rows) chats.set(row.telegram_id, row.id);
  return [...chats.entries()].map(([chatId, userId]) => ({ chatId, userId }));
}

export type CreateTeamRequestResult = { created: boolean; request: TeamRequestView };

export async function createTeamRequest(userId: string, rawName: string): Promise<CreateTeamRequestResult> {
  const name = rawName.replace(/\s+/g, " ").trim();
  const inserted = await query<{ id: string }>(
    `INSERT INTO team_creation_requests (user_id, team_name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [userId, name]
  );
  let id = inserted.rows[0]?.id ?? null;
  const created = Boolean(id);
  if (!id) {
    const pending = await query<{ id: string }>(
      `SELECT id FROM team_creation_requests WHERE user_id = $1 AND status = 'PENDING'`,
      [userId]
    );
    id = pending.rows[0]?.id ?? null;
  }
  if (!id) throw new Error("Team request was neither created nor found");
  const request = (await getTeamRequest(id))!;
  if (created) {
    await writeAudit(userId, "team_requests.create", { requestId: id, name });
    const who = personLabel({ name: request.user.name, username: request.user.username });
    const text = `Заявка на новую команду «${name}» от ${who}. Создать команду и сделать его капитаном?`;
    const owners = await ownerChats();
    await Promise.allSettled([
      ...owners.map((owner) => sendRequestCard({ kind: "team", requestId: id!, chatId: owner.chatId, text, openPath: "/admin" })),
      pushToUsers(
        owners.map((o) => o.userId).filter((v): v is string => Boolean(v)),
        { title: "Заявка на команду", body: `${who}: «${name}»` }
      ),
    ]);
  }
  return { created, request };
}

export type TeamDecisionErrorCode = "NOT_FOUND" | "ALREADY_DECIDED";

export class TeamDecisionError extends Error {
  constructor(public code: TeamDecisionErrorCode, public status: number, message: string, public currentStatus?: TeamRequestStatus) {
    super(message);
  }
}

/** Решение владельца. Права проверяет вызывающий: ручка или кнопка бота. */
export async function decideTeamRequest(params: {
  requestId: string;
  decision: "approve" | "decline";
  actorUserId: string;
}): Promise<TeamRequestView> {
  const { requestId, decision, actorUserId } = params;
  const outcome = await withTransaction(async (client) => {
    const found = await client.query<{ id: string; user_id: string; team_name: string; status: TeamRequestStatus }>(
      `SELECT id, user_id, team_name, status::text AS status FROM team_creation_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    const request = found.rows[0];
    if (!request) throw new TeamDecisionError("NOT_FOUND", 404, "Team request not found");
    if (request.status !== "PENDING") {
      throw new TeamDecisionError("ALREADY_DECIDED", 409, "Team request is already decided", request.status);
    }
    if (decision === "decline") {
      await client.query(
        `UPDATE team_creation_requests SET status = 'DECLINED', decided_by = $2, decided_at = NOW() WHERE id = $1`,
        [requestId, actorUserId]
      );
      return { teamId: null as string | null, userId: request.user_id };
    }
    // Коды выдаются под блокировкой: две одобренные одновременно «Дозор» и
    // «Дельта Зулу» не получат обе DZ.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('pbth:team-short-code'))`);
    const shortCode = await uniqueShortCode(request.team_name, client);
    const team = await client.query<{ id: string }>(
      `INSERT INTO teams (name, short_code) VALUES ($1, $2) RETURNING id`,
      [request.team_name, shortCode]
    );
    const teamId = team.rows[0].id;
    await client.query(
      `INSERT INTO team_memberships (user_id, team_id, role, status, balance) VALUES ($1, $2, 'CAPTAIN', 'ACTIVE', 0)`,
      [request.user_id, teamId]
    );
    await ensureActiveJoinLink(teamId, request.user_id, client);
    await client.query(
      `UPDATE team_creation_requests SET status = 'APPROVED', team_id = $3, decided_by = $2, decided_at = NOW() WHERE id = $1`,
      [requestId, actorUserId, teamId]
    );
    return { teamId, userId: request.user_id };
  });

  const view = (await getTeamRequest(requestId))!;
  await writeAudit(actorUserId, decision === "approve" ? "team_requests.approve" : "team_requests.decline", {
    requestId,
    teamId: outcome.teamId,
    userId: outcome.userId,
  });

  const verdict = decision === "approve" ? `✅ Команда создана, код ${view.team?.shortCode ?? ""}` : "✋ Отклонена";
  const tasks: Array<Promise<unknown>> = [closeRequestCards("team", requestId, verdict)];
  const requester = await query<{ telegram_id: string | null }>(
    `SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1`,
    [outcome.userId]
  );
  if (decision === "decline") {
    // Отказ — коротко и без имени того, кто отклонил.
    tasks.push(sendBotMessageSafe(requester.rows[0]?.telegram_id, `Заявку на команду «${view.name}» отклонили.`));
  }
  if (decision === "approve" && view.team) {
    const path = `/t/${encodeURIComponent(view.team.shortCode.toLowerCase())}`;
    tasks.push(
      sendBotMessageSafe(
        requester.rows[0]?.telegram_id,
        `Команда «${view.team.name}» создана, ты в ней капитан. Позови ребят: ссылка команды — на экране «Команда».`,
        linkKeyboard("Открыть команду", path)
      ),
      pushToUsers([outcome.userId], { title: "Команда создана", body: `«${view.team.name}»: ты капитан` })
    );
  }
  await Promise.allSettled(tasks);
  return view;
}
