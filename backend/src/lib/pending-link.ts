import crypto from "node:crypto";
import { pool } from "../db/pool.js";

export interface PendingLinkRow {
  token: string;
  userId: string;
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  providerDisplayName: string | null;
  expiresAt: Date;
}

export interface CreatePendingLinkInput {
  userId: string;
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  providerDisplayName: string | null;
  ttlSeconds: number;
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function mapRow(r: any): PendingLinkRow {
  return {
    token: r.token,
    userId: r.user_id,
    provider: r.provider,
    providerUserId: r.provider_user_id,
    providerEmail: r.provider_email,
    providerDisplayName: r.provider_display_name,
    expiresAt: r.expires_at,
  };
}

export async function createPendingLink(
  input: CreatePendingLinkInput
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
  await pool.query(
    `INSERT INTO auth_oauth_pending_link
       (token, user_id, provider, provider_user_id, provider_email, provider_display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      token,
      input.userId,
      input.provider,
      input.providerUserId,
      input.providerEmail,
      input.providerDisplayName,
      expiresAt,
    ]
  );
  return { token, expiresAt };
}

/** Single-use consume: atomic DELETE ... RETURNING. */
export async function consumePendingLink(
  token: string,
  userId: string
): Promise<PendingLinkRow | null> {
  const { rows } = await pool.query(
    `DELETE FROM auth_oauth_pending_link
      WHERE token = $1 AND user_id = $2 AND expires_at > NOW()
      RETURNING token, user_id, provider, provider_user_id, provider_email, provider_display_name, expires_at`,
    [token, userId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Peek without consuming, used by the pre-confirmation page to show details. */
export async function peekPendingLink(
  token: string,
  userId: string
): Promise<PendingLinkRow | null> {
  const { rows } = await pool.query(
    `SELECT token, user_id, provider, provider_user_id, provider_email, provider_display_name, expires_at
       FROM auth_oauth_pending_link
      WHERE token = $1 AND user_id = $2 AND expires_at > NOW()
      LIMIT 1`,
    [token, userId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function pruneExpiredPendingLinks(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM auth_oauth_pending_link WHERE expires_at < NOW() - INTERVAL '1 day'`
  );
  return rowCount ?? 0;
}
