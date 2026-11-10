import { query } from "../db/pool.js";
import { auditMarks } from "./team-access.js";

// Если в запросе владелец платформы действовал в команде, где не состоит,
// запись получает пометку `actorVia: "owner"` (решение Василия 10.11.2026,
// п. 11: каждое его действие видно в журнале команды как «владелец платформы»).
export async function writeAudit(userId: string | null, action: string, payload: unknown = {}) {
  const marks = auditMarks();
  const body =
    marks && payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), ...marks }
      : marks
        ? { value: payload, ...marks }
        : payload;
  await query(
    `INSERT INTO audit_logs (user_id, action, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [userId, action, JSON.stringify(body)]
  );
}
