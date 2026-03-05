import { query } from "../db/pool.js";

export async function writeAudit(userId: string | null, action: string, payload: unknown = {}) {
  await query(
    `INSERT INTO audit_logs (user_id, action, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [userId, action, JSON.stringify(payload)]
  );
}
