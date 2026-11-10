import { query } from "../db/pool.js";
import { canChooseAdminRole } from "../lib/entry-role.js";
import { answerCallbackSafe } from "../modules/join-requests/delivery.js";
import { decideTeamRequest, TeamDecisionError } from "../modules/team-requests/service.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// Заявка на создание команды: «Принять» / «Отклонить» у владельца платформы
// (`team:approve:<id заявки>`, `team:decline:<id заявки>`). Нажать может только
// аккаунт из списка владельцев (`ADMIN_ROLE_ALLOWLIST_*`).
export const prefix = "team";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  const [action, requestId] = ctx.payload.split(":");
  if ((action !== "approve" && action !== "decline") || !requestId || !UUID_RE.test(requestId)) {
    await answerCallbackSafe(callback.id, "Кнопка устарела");
    return true;
  }
  const fromId = callback.from?.id !== undefined ? String(callback.from.id) : "";
  const found = fromId
    ? await query<{ id: string; telegram_id: string; username: string | null }>(
        `SELECT id, telegram_id::text AS telegram_id, username FROM users WHERE telegram_id = $1::bigint AND is_active = TRUE`,
        [fromId]
      )
    : null;
  const user = found?.rows[0];
  if (!user || !canChooseAdminRole(user)) {
    await answerCallbackSafe(callback.id, "Решать заявки на команды может только владелец платформы");
    return true;
  }
  try {
    const request = await decideTeamRequest({ requestId, decision: action, actorUserId: user.id });
    await answerCallbackSafe(
      callback.id,
      action === "approve" ? `Команда создана: ${request.team?.shortCode ?? ""}` : "Заявка отклонена"
    );
  } catch (error) {
    if (!(error instanceof TeamDecisionError)) throw error;
    await answerCallbackSafe(callback.id, error.code === "NOT_FOUND" ? "Заявка не найдена" : "Заявка уже решена");
  }
  return true;
}
