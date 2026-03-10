import crypto from "node:crypto";
import { query } from "../db/pool.js";

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function pruneExpiredAuthArtifacts() {
  await query(`DELETE FROM auth_replay_guard WHERE expires_at <= NOW()`);
  await query(`DELETE FROM auth_oidc_state WHERE expires_at <= NOW()`);
}

export async function registerReplayPayload(params: {
  provider: "telegram_webapp" | "telegram_callback" | "telegram_oidc";
  rawPayload: string;
  subjectId?: string | null;
  ttlSeconds: number;
}) {
  const payloadHash = sha256Hex(params.rawPayload);
  const inserted = await query(
    `INSERT INTO auth_replay_guard (provider, payload_hash, subject_id, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))
     ON CONFLICT DO NOTHING
     RETURNING payload_hash`,
    [params.provider, payloadHash, params.subjectId ?? null, params.ttlSeconds]
  );
  return {
    ok: (inserted.rowCount ?? 0) > 0,
    payloadHash,
  };
}
