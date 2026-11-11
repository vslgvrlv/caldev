import { query } from "../db/pool.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { eventUrlFor } from "../lib/notification-dispatch.js";
import { linkKeyboard, parseSeriesCallbackPayload, replaceLastParagraph, SERIES_COMMITTED_LINE } from "../lib/notification-messages.js";
import { answerTelegramCallbackQuery, editTelegramBotMessageText } from "../lib/telegram-bot.js";
import { findUserByTelegramId } from "../modules/rsvp/service.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// «Иду на все» в сообщении бота о новых занятиях (`series:yes:<id серии>`,
// спека event_announcements, 11.11.2026).
//
// Согласие пишется за того, кто нажал (`from.id`), и только участнику команды
// серии — так же, как `POST /events/series/:seriesId/commit`. Сообщение
// правится на месте: последний абзац становится «Ты ходишь на все занятия…»,
// кнопка «Иду на все» убирается, «Открыть» остаётся.
export const prefix = "series";

async function answer(callbackId: string, text: string) {
  try {
    await answerTelegramCallbackQuery(callbackId, text);
  } catch (error) {
    logger.warn("series.callback.answer_failed", { reason: error instanceof Error ? error.message : String(error) });
  }
}

type SeriesRow = { team_id: string; short_code: string | null; is_member: boolean; open_event_id: string | null };

export async function handle(callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  const callbackId = String(callback.id);
  const parsed = parseSeriesCallbackPayload(ctx.payload);
  if (!parsed) {
    await answer(callbackId, "Кнопка устарела. Открой событие в приложении.");
    return true;
  }

  const userId = await findUserByTelegramId(callback.from?.id as string | number | undefined);
  const seriesResult = await query<SeriesRow>(
    `SELECT s.team_id,
            t.short_code,
            EXISTS (
              SELECT 1 FROM team_memberships tm
              JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
              WHERE tm.team_id = s.team_id AND tm.user_id = $2
            ) AS is_member,
            (SELECT e.id FROM events e
              WHERE e.series_id = s.id AND e.is_cancelled = FALSE
              ORDER BY (e.start_at > now()) DESC, e.start_at ASC
              LIMIT 1) AS open_event_id
       FROM event_series s
       JOIN teams t ON t.id = s.team_id
      WHERE s.id = $1`,
    [parsed.seriesId, userId]
  );
  const series = seriesResult.rows[0];
  if (!series) {
    await answer(callbackId, "Занятия не найдены: их удалили.");
    return true;
  }
  if (!userId || !series.is_member) {
    // Сообщение не трогаем: оно могло прийти в чат, где его видят другие.
    await answer(
      callbackId,
      userId ? "Ты не в составе этой команды — ответ не записан." : "Не нашёл тебя в PBTH. Войди в приложение через Telegram."
    );
    return true;
  }

  await query(
    `INSERT INTO event_series_commitment (series_id, user_id, status)
     VALUES ($1, $2, 'COMMITTED')
     ON CONFLICT (series_id, user_id) DO UPDATE SET status = 'COMMITTED', updated_at = now()`,
    [parsed.seriesId, userId]
  );
  await writeAudit(userId, "events.series.commit", { seriesId: parsed.seriesId, source: "telegram" });
  logger.info("series.callback.committed", { correlationId: ctx.correlationId, seriesId: parsed.seriesId });
  await answer(callbackId, "Записал на все занятия");

  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const original = typeof callback.message?.text === "string" ? callback.message.text : "";
  if (chatId === undefined || messageId === undefined || !original) return true;
  const replaced = replaceLastParagraph(
    original,
    callback.message?.entities as Array<{ offset: number; length: number }> | undefined,
    SERIES_COMMITTED_LINE
  );
  if (!replaced) return true;
  const openUrl = series.open_event_id
    ? eventUrlFor({ shortCode: series.short_code, teamId: series.team_id }, series.open_event_id)
    : null;
  try {
    await editTelegramBotMessageText({
      chatId: String(chatId),
      messageId: String(messageId),
      text: replaced.text,
      entities: replaced.entities,
      replyMarkup: openUrl ? linkKeyboard("Открыть", openUrl) : { inline_keyboard: [] },
    });
  } catch (error) {
    // «message is not modified» при повторном нажатии — не ошибка: согласие уже записано.
    logger.warn("series.callback.edit_failed", { reason: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
