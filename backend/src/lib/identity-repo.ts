import { pool } from "../db/pool.js";

export interface IdentityRow {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
  linkedAt: Date;
}

export type LinkConflict = "PROVIDER_SUBJECT_TAKEN" | "USER_PROVIDER_TAKEN";

export interface LinkResult {
  identity: IdentityRow | null;
  conflict: LinkConflict | null;
}

function mapRow(row: any): IdentityRow {
  return {
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    email: row.email,
    linkedAt: row.linked_at,
  };
}

export async function findIdentity(provider: string, providerUserId: string): Promise<IdentityRow | null> {
  const { rows } = await pool.query(
    `SELECT user_id, provider, provider_user_id, email, linked_at
       FROM user_identities
      WHERE provider = $1 AND provider_user_id = $2
      LIMIT 1`,
    [provider, providerUserId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listIdentitiesForUser(userId: string): Promise<IdentityRow[]> {
  const { rows } = await pool.query(
    `SELECT user_id, provider, provider_user_id, email, linked_at
       FROM user_identities
      WHERE user_id = $1
      ORDER BY linked_at ASC`,
    [userId]
  );
  return rows.map(mapRow);
}

export async function linkIdentity(input: {
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
}): Promise<LinkResult> {
  // Race-safe: ON CONFLICT DO NOTHING covers both UNIQUE constraints atomically.
  // No PostgreSQL "ON CONFLICT (..) WHERE .." needed — we let either UNIQUE fire
  // and then resolve which one in a follow-up SELECT.
  const { rows } = await pool.query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING user_id, provider, provider_user_id, email, linked_at`,
    [input.userId, input.provider, input.providerUserId, input.email]
  );
  if (rows[0]) {
    return { identity: mapRow(rows[0]), conflict: null };
  }
  // Conflict happened. Distinguish which UNIQUE fired so callers can return
  // the right error code.
  const subjectCheck = await pool.query(
    `SELECT 1 FROM user_identities WHERE provider = $1 AND provider_user_id = $2`,
    [input.provider, input.providerUserId]
  );
  if (subjectCheck.rowCount && subjectCheck.rowCount > 0) {
    return { identity: null, conflict: "PROVIDER_SUBJECT_TAKEN" };
  }
  return { identity: null, conflict: "USER_PROVIDER_TAKEN" };
}

export async function unlinkIdentity(userId: string, provider: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM user_identities WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return (rowCount ?? 0) > 0;
}

export async function countIdentitiesForUser(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM user_identities WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0].count);
}
