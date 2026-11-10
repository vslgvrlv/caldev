import { query } from "../db/pool.js";
import { logger } from "../lib/logger.js";
import { answerTelegramCallbackQuery, editTelegramBotMessageText } from "../lib/telegram-bot.js";
import { writeAudit } from "../lib/audit.js";
import { SLOT_VERDICT, appendVerdict } from "../modules/slots/format.js";
import { book, cancelBooking, guestByRow, membershipRole } from "../modules/slots/service.js";
import { guestEventPath } from "../modules/slots/notify.js";
import { env } from "../config/env.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// Кнопки уведомлений об открытых слотах (трек 4):
//   `slot:book:<id события>` — «Записаться» у подписчика: запись сразу, без
//                              одобрения; сообщение правится на «Ты записан» или
//                              «Мест уже нет»;
//   `slot:rm:<id записи>`    — «Снять» у капитана и тренера.
export const prefix = "slot";

type Card = { chatId: string | null; messageId: string | null; text: string };

function cardOf(callback: TelegramCallbackQuery): Card {
  return {
    chatId: callback.message?.chat?.id !== undefined ? String(callback.message.chat.id) : null,
    messageId: callback.message?.message_id !== undefined ? String(callback.message.message_id) : null,
    text: String(callback.message?.text || ""),
  };
}

async function closeCard(card: Card, verdict: string, replyMarkup?: Record<string, unknown>) {
  if (!card.chatId || !card.messageId) return;
  try {
    await editTelegramBotMessageText({
      chatId: card.chatId,
      messageId: card.messageId,
      text: appendVerdict(card.text, verdict),
      ...(replyMarkup ? { replyMarkup } : {}),
    });
  } catch (error) {
    // Сообщение могли удалить или уже поправить — запись от этого не зависит.
    logger.warn("slots.callback.edit_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function answer(callbackId: string, text: string) {
  try {
    await answerTelegramCallbackQuery(callbackId, text);
  } catch (error) {
    logger.warn("slots.callback.answer_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function userByTelegram(fromId: unknown): Promise<string | null> {
  if (fromId === undefined || fromId === null || !/^\d{1,20}$/.test(String(fromId))) return null;
  const result = await query<{ id: string }>(
    `SELECT id FROM users WHERE telegram_id = $1::bigint AND is_active = TRUE`,
    [String(fromId)]
  );
  return result.rows[0]?.id ?? null;
}

function openEventKeyboard(eventId: string) {
  const url = `${env.frontendUrl.replace(/\/+$/, "")}${guestEventPath(eventId)}`;
  return { inline_keyboard: [[{ text: "Открыть событие", url }]] };
}

async function handleBook(callback: TelegramCallbackQuery, eventId: string): Promise<boolean> {
  const card = cardOf(callback);
  const userId = await userByTelegram(callback.from?.id);
  if (!userId) {
    await answer(callback.id, SLOT_VERDICT.noUser);
    return true;
  }
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    await answer(callback.id, SLOT_VERDICT.notFound);
    return true;
  }
  const result = await book(userId, eventId);
  if (result.ok) {
    await writeAudit(userId, "slots.book", { eventId, outcome: result.outcome, via: "bot" });
    const verdict = result.outcome === "BOOKED" ? SLOT_VERDICT.booked : SLOT_VERDICT.already;
    await answer(callback.id, verdict);
    await closeCard(card, verdict, openEventKeyboard(eventId));
    return true;
  }
  const verdict = {
    FULL: SLOT_VERDICT.full,
    CLOSED: SLOT_VERDICT.closed,
    STARTED: SLOT_VERDICT.started,
    MEMBER: SLOT_VERDICT.member,
    NOT_FOLLOWER: SLOT_VERDICT.notFollower,
    NOT_FOUND: SLOT_VERDICT.notFound,
  }[result.outcome];
  await answer(callback.id, verdict);
  // Подписка ещё жива, а мест нет — кнопку убираем: новое уведомление придёт,
  // когда место освободится.
  await closeCard(card, verdict);
  return true;
}

async function handleRemove(callback: TelegramCallbackQuery, guestId: string): Promise<boolean> {
  const card = cardOf(callback);
  const actorId = await userByTelegram(callback.from?.id);
  const guest = await guestByRow(guestId);
  if (!actorId || !guest) {
    await answer(callback.id, guest ? SLOT_VERDICT.notManager : SLOT_VERDICT.notFound);
    return true;
  }
  const role = await membershipRole(actorId, guest.team_id);
  if (role !== "CAPTAIN" && role !== "TRAINER") {
    await answer(callback.id, SLOT_VERDICT.notManager);
    return true;
  }
  if (guest.status !== "BOOKED") {
    await answer(callback.id, SLOT_VERDICT.alreadyGone);
    await closeCard(card, SLOT_VERDICT.alreadyGone);
    return true;
  }
  const outcome = await cancelBooking({
    eventId: guest.event_id,
    guestUserId: guest.user_id,
    actorId,
    status: "REMOVED",
  });
  const verdict = outcome === "CANCELLED" ? SLOT_VERDICT.removed : SLOT_VERDICT.alreadyGone;
  if (outcome === "CANCELLED") {
    await writeAudit(actorId, "slots.remove_guest", {
      teamId: guest.team_id,
      eventId: guest.event_id,
      guestUserId: guest.user_id,
      via: "bot",
    });
  }
  await answer(callback.id, verdict);
  await closeCard(card, verdict);
  return true;
}

export async function handle(callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  const [action, id = ""] = ctx.payload.split(":");
  if (action === "book") return handleBook(callback, id);
  if (action === "rm") return handleRemove(callback, id);
  return false;
}
