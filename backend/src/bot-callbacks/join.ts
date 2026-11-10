import { query } from "../db/pool.js";
import { answerCallbackSafe } from "../modules/join-requests/delivery.js";
import { decideJoinRequest, JoinDecisionError } from "../modules/join-requests/service.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// Заявка на вступление: «Принять» / «Отклонить» в карточке у капитана или
// тренера (`join:approve:<id заявки>`, `join:decline:<id заявки>`).
//
// Кто нажал — по Telegram-аккаунту кнопки, права — по составу команды заявки.
// Пересланная в чужой чат карточка ничего не даёт: посторонний не капитан.
export const prefix = "join";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseJoinPayload(payload: string): { decision: "approve" | "decline"; requestId: string } | null {
  const [action, requestId] = payload.split(":");
  if ((action !== "approve" && action !== "decline") || !requestId || !UUID_RE.test(requestId)) return null;
  return { decision: action, requestId };
}

export async function handle(callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  const parsed = parseJoinPayload(ctx.payload);
  if (!parsed) {
    await answerCallbackSafe(callback.id, "Кнопка устарела");
    return true;
  }
  const fromId = callback.from?.id !== undefined ? String(callback.from.id) : "";
  const user = fromId
    ? await query<{ id: string }>(`SELECT id FROM users WHERE telegram_id = $1::bigint AND is_active = TRUE`, [fromId])
    : null;
  const actorId = user?.rows[0]?.id;
  if (!actorId) {
    await answerCallbackSafe(callback.id, "Сначала войди в приложение");
    return true;
  }

  try {
    const result = await decideJoinRequest({
      requestId: parsed.requestId,
      decision: parsed.decision,
      actor: { userId: actorId, via: "bot" },
    });
    await answerCallbackSafe(callback.id, result.status === "APPROVED" ? "Принят в команду" : "Заявка отклонена");
  } catch (error) {
    if (!(error instanceof JoinDecisionError)) throw error;
    const text =
      error.code === "FORBIDDEN"
        ? "Решать заявки может капитан или тренер команды"
        : error.code === "NOT_FOUND"
          ? "Заявка не найдена"
          : error.currentStatus === "APPROVED"
            ? "Уже принят"
            : "Заявка уже решена";
    await answerCallbackSafe(callback.id, text);
  }
  return true;
}
