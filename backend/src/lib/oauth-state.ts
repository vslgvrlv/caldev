import crypto from "node:crypto";
import { pool } from "../db/pool.js";

export type OAuthIntent = "login" | "link";

export interface OAuthStateRow {
  state: string;
  provider: string;
  intent: OAuthIntent;
  linkUserId: string | null;
  redirectTo: string;
  codeVerifier: string | null;
  nonce: string | null;
  // Отпечатки браузера, начавшего вход или привязку (хэши IP и User-Agent).
  ipHash: string | null;
  uaHash: string | null;
  expiresAt: Date;
}

export interface CreateStateInput {
  provider: string;
  intent: OAuthIntent;
  redirectTo: string;
  ttlSeconds: number;
  ipHash: string | null;
  uaHash: string | null;
  linkUserId: string | null;
  codeVerifier: string | null;
  nonce: string | null;
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function mapRow(row: any): OAuthStateRow {
  return {
    state: row.state,
    provider: row.provider,
    intent: row.intent,
    linkUserId: row.link_user_id,
    redirectTo: row.redirect_to,
    codeVerifier: row.code_verifier,
    nonce: row.nonce,
    ipHash: row.ip_hash ?? null,
    uaHash: row.ua_hash ?? null,
    expiresAt: row.expires_at,
  };
}

export async function createState(input: CreateStateInput): Promise<{ state: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  await pool.query(
    `INSERT INTO auth_oauth_state
       (state, provider, intent, link_user_id, redirect_to, code_verifier, nonce, ip_hash, ua_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      token,
      input.provider,
      input.intent,
      input.linkUserId,
      input.redirectTo,
      input.codeVerifier,
      input.nonce,
      input.ipHash,
      input.uaHash,
      expiresAt,
    ]
  );
  return { state: token, expiresAt };
}

/**
 * Single-use consume. Atomically deletes the row, returning the mapped state
 * if it existed, matched the expected provider, and was not yet expired.
 * Returns null otherwise (no replay possible).
 */
export async function consumeState(state: string, provider: string): Promise<OAuthStateRow | null> {
  const { rows } = await pool.query(
    `DELETE FROM auth_oauth_state
      WHERE state = $1
        AND provider = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING state, provider, intent, link_user_id, redirect_to, code_verifier, nonce, ip_hash, ua_hash, expires_at`,
    [state, provider]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function pruneExpiredStates(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM auth_oauth_state WHERE expires_at < NOW() - INTERVAL '1 day'`
  );
  return rowCount ?? 0;
}

/**
 * Тот же ли браузер завершает поток, что его начал. Привязка Яндекса идёт без
 * cookie (в браузере Telegram она теряется), поэтому без этой сверки чужой
 * человек, открывший ссылку на согласие Яндекса, привязывал свой Яндекс к
 * аккаунту того, кто ссылку выпустил (ревью безопасности 10.11.2026, №7).
 * IP обязателен: без него отпечаток подделать проще всего.
 */
export function sameBrowserAsState(
  row: Pick<OAuthStateRow, "ipHash" | "uaHash">,
  current: { ipHash: string | null; uaHash: string | null }
): boolean {
  if (!row.ipHash || row.ipHash !== current.ipHash) return false;
  return (row.uaHash ?? null) === (current.uaHash ?? null);
}
