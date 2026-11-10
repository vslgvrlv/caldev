import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "../../config/env.js";
import { pool, query } from "../../db/pool.js";

// Постоянная ссылка команды `/join/<код>` (трек 1 ревизии, решение Василия
// 10.11.2026, п. 4). У команды одна живая ссылка; капитан может отозвать её и
// выпустить новую. Ссылка не впускает в команду сама — она создаёт заявку,
// которую одобряет капитан или тренер.
//
// Код — шесть знаков без похожих друг на друга букв и цифр (нет 0/O, 1/I/L):
// его диктуют голосом и набирают с бумаги. Регистр не важен.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_RE = /^[A-Za-z0-9]{4,16}$/;

export type JoinLink = { id: string; teamId: string; code: string; createdAt: string };

type Db = Pick<PoolClient, "query">;

export function generateJoinCode(length = JOIN_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Код из адреса или из поля ввода: без пробелов и дефисов, верхний регистр. */
export function normalizeJoinCode(raw: unknown): string | null {
  const value = String(raw ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return JOIN_CODE_RE.test(value) ? value : null;
}

export function joinLinkUrl(code: string): string {
  return new URL(`/join/${encodeURIComponent(code)}`, env.frontendUrl).toString();
}

function toLink(row: { id: string; team_id: string; code: string; created_at: string | Date }): JoinLink {
  return {
    id: row.id,
    teamId: row.team_id,
    code: row.code,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

async function selectActive(db: Db, teamId: string): Promise<JoinLink | null> {
  const result = await db.query(
    `SELECT id, team_id, code, created_at FROM team_join_links WHERE team_id = $1 AND revoked_at IS NULL`,
    [teamId]
  );
  return result.rows[0] ? toLink(result.rows[0]) : null;
}

async function insertLink(db: Db, teamId: string, createdBy: string | null): Promise<JoinLink | null> {
  // Совпадение кода с уже выпущенным (живым или отозванным) — новая попытка.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateJoinCode();
    const result = await db.query(
      `INSERT INTO team_join_links (team_id, code, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, team_id, code, created_at`,
      [teamId, code, createdBy]
    );
    if (result.rows[0]) return toLink(result.rows[0]);
    // Конфликт мог быть и по «одна живая ссылка на команду» — её выпустил
    // соседний запрос. Тогда отдаём её.
    const active = await selectActive(db, teamId);
    if (active) return active;
  }
  return null;
}

/** Живая ссылка команды; если её ещё нет — выпускает. */
export async function ensureActiveJoinLink(teamId: string, createdBy: string | null, db: Db = pool): Promise<JoinLink> {
  const existing = await selectActive(db, teamId);
  if (existing) return existing;
  const created = await insertLink(db, teamId, createdBy);
  if (!created) throw new Error("Could not issue a team join link");
  return created;
}

/** «Отозвать и выпустить новую»: старая ссылка перестаёт работать сразу. */
export async function rotateJoinLink(teamId: string, actorId: string): Promise<JoinLink> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT 1 FROM teams WHERE id = $1 FOR UPDATE`, [teamId]);
    await client.query(
      `UPDATE team_join_links SET revoked_at = NOW(), revoked_by = $2 WHERE team_id = $1 AND revoked_at IS NULL`,
      [teamId, actorId]
    );
    const created = await insertLink(client, teamId, actorId);
    if (!created) throw new Error("Could not issue a team join link");
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export type JoinLinkTeam = {
  linkId: string;
  code: string;
  teamId: string;
  teamName: string;
  teamShortCode: string;
};

/** Живая ссылка по коду. Отозванная или выдуманная — null. */
export async function findActiveJoinLink(rawCode: unknown): Promise<JoinLinkTeam | null> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return null;
  const result = await query<{ id: string; code: string; team_id: string; name: string; short_code: string }>(
    `SELECT l.id, l.code, l.team_id, t.name, t.short_code
     FROM team_join_links l
     JOIN teams t ON t.id = l.team_id
     WHERE upper(l.code) = $1 AND l.revoked_at IS NULL`,
    [code]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { linkId: row.id, code: row.code, teamId: row.team_id, teamName: row.name, teamShortCode: row.short_code };
}
