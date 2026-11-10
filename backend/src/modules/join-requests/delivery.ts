import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import { logger } from "../../lib/logger.js";
import {
  answerTelegramCallbackQuery,
  editTelegramBotMessageText,
  sendTelegramBotMessage,
} from "../../lib/telegram-bot.js";
import { isWebPushEnabled, sendWebPush } from "../../lib/web-push.js";

// Доставка сообщений трека 1: карточки заявок в боте, пуши, итог человеку.
// Отправка идёт готовыми функциями `lib/telegram-bot.ts` и `lib/web-push.ts`.
// Сбой доставки не роняет действие: заявка создана или решена в базе, а
// сообщение — лучшая попытка. В лог — без текста и без id чатов.

export type RequestKind = "join" | "team";

type InlineButton = { text: string; callback_data?: string; url?: string };

export function appUrl(path: string): string {
  return new URL(path, env.frontendUrl).toString();
}

// Telegram принимает кнопку-ссылку только с адресом https. На стенде адрес
// http — такую кнопку не ставим, ссылка остаётся в тексте.
function urlButton(text: string, path: string): InlineButton | null {
  const url = appUrl(path);
  return url.startsWith("https://") ? { text, url } : null;
}

export function decisionKeyboard(prefix: RequestKind, requestId: string, openPath?: string) {
  const rows: InlineButton[][] = [
    [
      { text: "Принять", callback_data: `${prefix}:approve:${requestId}` },
      { text: "Отклонить", callback_data: `${prefix}:decline:${requestId}` },
    ],
  ];
  const open = openPath ? urlButton("Открыть в приложении", openPath) : null;
  if (open) rows.push([open]);
  return { inline_keyboard: rows };
}

/**
 * Кнопка-ссылка под сообщением человеку («Открыть команду»). Ставится всегда,
 * как «Открыть событие» в напоминаниях трека 2: в проде и на staging адрес
 * https, а локальный стенд ходит в заглушку Bot API.
 */
export function linkKeyboard(text: string, path: string) {
  return { inline_keyboard: [[{ text, url: appUrl(path) }]] };
}

export async function sendBotMessageSafe(
  chatId: string | null | undefined,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<string | null> {
  if (!chatId || !env.telegram.botToken) return null;
  try {
    const sent = await sendTelegramBotMessage(chatId, text, replyMarkup ? { replyMarkup } : undefined);
    return sent.messageId;
  } catch (error) {
    logger.warn("track1.bot_send_failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Карточка заявки одобряющему; id сообщения запоминается, чтобы потом закрыть. */
export async function sendRequestCard(params: {
  kind: RequestKind;
  requestId: string;
  chatId: string | null | undefined;
  text: string;
  openPath?: string;
}): Promise<void> {
  const messageId = await sendBotMessageSafe(
    params.chatId,
    params.text,
    decisionKeyboard(params.kind, params.requestId, params.openPath)
  );
  if (!messageId || !params.chatId) return;
  await query(
    `INSERT INTO request_bot_messages (kind, request_id, chat_id, message_id, text) VALUES ($1, $2, $3, $4, $5)`,
    [params.kind, params.requestId, params.chatId, messageId, params.text]
  ).catch((error) => {
    logger.warn("track1.bot_card_store_failed", { error: error instanceof Error ? error.message : String(error) });
  });
}

/**
 * Заявка решена — у всех, кому ушла карточка, кнопки снимаются и
 * дописывается итог. Так второй одобряющий не нажмёт «Принять» впустую.
 */
export async function closeRequestCards(kind: RequestKind, requestId: string, verdict: string): Promise<void> {
  const cards = await query<{ chat_id: string; message_id: string; text: string }>(
    `SELECT chat_id, message_id, text FROM request_bot_messages WHERE kind = $1 AND request_id = $2`,
    [kind, requestId]
  );
  await Promise.allSettled(
    cards.rows.map(async (card) => {
      try {
        await editTelegramBotMessageText({
          chatId: card.chat_id,
          messageId: card.message_id,
          text: `${card.text}\n\n${verdict}`,
        });
      } catch (error) {
        logger.warn("track1.bot_card_close_failed", { error: error instanceof Error ? error.message : String(error) });
      }
    })
  );
}

export async function answerCallbackSafe(callbackId: string | undefined, text: string): Promise<void> {
  if (!callbackId) return;
  try {
    await answerTelegramCallbackQuery(callbackId, text);
  } catch (error) {
    logger.warn("track1.bot_answer_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Пуш всем устройствам людей. Протухшие подписки (404/410) удаляются. */
export async function pushToUsers(userIds: string[], payload: { title: string; body: string }): Promise<void> {
  if (!isWebPushEnabled() || userIds.length === 0) return;
  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)`,
    [userIds]
  );
  await Promise.allSettled(
    subs.rows.map(async (sub) => {
      const result = await sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      if (!result.ok && result.gone) {
        await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]).catch(() => {});
      }
    })
  );
}

/** Имя человека для сообщений: «Иван Петров (@ivan)». */
export function personLabel(user: { name: string | null; nickname?: string | null; username?: string | null }): string {
  const name = String(user.name || user.nickname || "Без имени").trim();
  const handle = user.username ? `@${user.username}` : "";
  return handle ? `${name} (${handle})` : name;
}

/**
 * Отказ в общем формате `{ code, detail, correlationId }`. Свои коды трека
 * (`JOIN_LINK_NOT_FOUND`, `INVITE_USED` …) — без правки общего списка кодов.
 */
export function sendTrackError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  detail: string,
  extra?: Record<string, unknown>
) {
  return res.status(status).json({ code, detail, correlationId: req.correlationId, ...(extra || {}) });
}
