import { logger } from "../lib/logger.js";
import { eventUrlFor } from "../lib/notification-dispatch.js";
import {
  buildEventRsvpMessage,
  parseRsvpCallbackPayload,
  replaceLastParagraph,
  rsvpAnsweredLine,
  rsvpKeyboard,
} from "../lib/notification-messages.js";
import { answerTelegramCallbackQuery, editTelegramBotMessageText } from "../lib/telegram-bot.js";
import { findUserByTelegramId, recordRsvpAnswer, type RsvpEventInfo } from "../modules/rsvp/service.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// «Иду / Не иду» в сообщении бота о событии (`rsvp:yes:<id события>`, трек 2).
//
// Ответ пишется за того, кто нажал (`from.id`), а не за того, кому сообщение
// ушло: пересланное в общий чат сообщение не даёт ответить за другого. Нажал
// не участник команды — ничего не пишем. Сообщение правится на месте:
// последний абзац становится «Ты идёшь» / «Ты не идёшь», кнопки остаются —
// передумать можно тем же сообщением.
export const prefix = "rsvp";

async function answer(callbackId: string, text: string) {
  try {
    await answerTelegramCallbackQuery(callbackId, text);
  } catch (error) {
    logger.warn("rsvp.callback.answer_failed", { reason: error instanceof Error ? error.message : String(error) });
  }
}

async function editCard(callback: TelegramCallbackQuery, event: RsvpEventInfo, lastLine: string, withAnswers: boolean) {
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;
  const eventUrl = eventUrlFor({ shortCode: event.teamShortCode, teamId: event.teamId }, event.id);
  const replyMarkup = rsvpKeyboard(event.id, eventUrl, withAnswers);
  const original = typeof callback.message?.text === "string" ? callback.message.text : "";
  const replaced = original
    ? replaceLastParagraph(original, callback.message?.entities as Array<{ offset: number; length: number }> | undefined, lastLine)
    : null;
  try {
    if (replaced) {
      await editTelegramBotMessageText({
        chatId: String(chatId),
        messageId: String(messageId),
        text: replaced.text,
        entities: replaced.entities,
        replyMarkup,
      });
    } else {
      // Текста в нажатии нет (старое сообщение) — собираем карточку заново.
      const card = buildEventRsvpMessage({
        card: {
          eventId: event.id,
          title: event.title,
          startAt: event.startAt,
          location: event.location,
          locationUrl: event.locationUrl,
          teamName: event.teamName,
          timezone: event.timezone,
        },
        kind: "MANUAL",
        state: "UNANSWERED",
        eventUrl,
      });
      const head = card.text.slice(0, card.text.lastIndexOf("\n\n"));
      await editTelegramBotMessageText({
        chatId: String(chatId),
        messageId: String(messageId),
        text: `${head}\n\n${lastLine}`,
        parseMode: "HTML",
        replyMarkup,
      });
    }
  } catch (error) {
    // «message is not modified» и прочие отказы правки не мешают ответу: он уже записан.
    logger.warn("rsvp.callback.edit_failed", { reason: error instanceof Error ? error.message : String(error) });
  }
}

export async function handle(callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  const callbackId = String(callback.id);
  const parsed = parseRsvpCallbackPayload(ctx.payload);
  if (!parsed) {
    await answer(callbackId, "Кнопка устарела. Открой событие в приложении.");
    return true;
  }

  const userId = await findUserByTelegramId(callback.from?.id as string | number | undefined);
  const status = parsed.answer === "yes" ? "CONFIRMED" : "DECLINED";
  const result = await recordRsvpAnswer({ userId, eventId: parsed.eventId, status, source: "telegram" });

  if (!result.ok) {
    if (result.reason === "EVENT_NOT_FOUND") {
      await answer(callbackId, "Событие не найдено: его удалили.");
      return true;
    }
    if (result.reason === "NOT_MEMBER") {
      // Сообщение не трогаем: оно могло прийти в чат, где его видят другие.
      await answer(
        callbackId,
        userId ? "Ты не в составе этой команды — ответ не записан." : "Не нашёл тебя в PBTH. Войди в приложение через Telegram."
      );
      return true;
    }
    if (result.reason === "CANCELLED") {
      await answer(callbackId, "Событие отменено.");
      await editCard(callback, result.event, "Событие отменено.", false);
      return true;
    }
    await answer(callbackId, "Событие уже началось — ответ не записан.");
    await editCard(callback, result.event, "Событие уже началось, отвечать поздно.", false);
    return true;
  }

  logger.info("rsvp.callback.recorded", { correlationId: ctx.correlationId, eventId: result.event.id, status });
  const same = result.previous === status;
  await answer(
    callbackId,
    status === "CONFIRMED" ? (same ? "Уже записано: ты идёшь." : "Записал: ты идёшь.") : same ? "Уже записано: ты не идёшь." : "Записал: ты не идёшь."
  );
  // Правим и при повторе: ответ мог прийти из приложения, а сообщение ещё
  // показывает «ответа нет». Если текст тот же, Telegram откажет — это не ошибка.
  await editCard(callback, result.event, rsvpAnsweredLine(status), true);
  return true;
}
