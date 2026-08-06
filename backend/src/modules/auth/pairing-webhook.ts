// Телеграм-половина входа по коду сопряжения (#109).
//
// Здесь человек подтверждает вход — внутри чата, нажатием callback-кнопки.
// Ни одна кнопка отсюда не ведёт по ссылке: переход открывает произвольный
// браузер, и именно это ломало вход в PWA на домашнем экране iOS.

import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import {
  buildPairingConfirmationKeyboard,
  buildPairingConfirmationText,
  classifyPairingStatus,
  hashPairingCode,
  parsePairingCallbackData,
  parsePairingCodeFromText,
  type PairingAttemptStatus,
} from "../../lib/auth-pairing.js";
import {
  answerTelegramCallbackQuery,
  editTelegramBotMessageText,
  sendTelegramBotMessage,
} from "../../lib/telegram-bot.js";
import { logger } from "../../lib/logger.js";

type PairingRow = {
  id: string;
  status: string;
  scope: "USER" | "ADMIN";
  device_label: string | null;
  requested_ip: string | null;
  telegram_user_id: string | null;
  confirmation_message_id: string | null;
  expires_at: string;
};

function publicHost(): string {
  try {
    return new URL(env.frontendUrl).host;
  } catch {
    return env.frontendUrl;
  }
}

async function markExpired(attemptId: string): Promise<void> {
  await query(
    `UPDATE auth_pairing_attempts
        SET status = 'EXPIRED'
      WHERE id = $1 AND status IN ('PENDING', 'CLAIMED')`,
    [attemptId]
  );
}

// Карточка правится на месте, а не дублируется новым сообщением. Текст берём
// тот, что Telegram вернул в апдейте: он уже без разметки, поэтому дописываем
// строку и отправляем как обычный текст — иначе угловые скобки из имени
// пользователя сломали бы HTML.
async function closeCard(params: {
  chatId: string;
  messageId: string | null | undefined;
  originalText: string;
  verdict: string;
}): Promise<void> {
  if (!params.messageId) return;
  try {
    await editTelegramBotMessageText({
      chatId: params.chatId,
      messageId: params.messageId,
      text: `${params.originalText}\n\n${params.verdict}`,
    });
  } catch (error) {
    // Не смогли отредактировать — вход от этого не ломается, статус уже в базе.
    logger.warn("pairing.card.edit_failed", { error: String(error) });
  }
}

async function handleCallback(update: Record<string, any>): Promise<boolean> {
  const callback = update?.callback_query;
  const action = parsePairingCallbackData(callback?.data);
  if (!action) return false;

  const callbackId = String(callback.id);
  const chatId = callback?.message?.chat?.id ? String(callback.message.chat.id) : null;
  const messageId = callback?.message?.message_id ? String(callback.message.message_id) : null;
  const originalText = String(callback?.message?.text || "");
  const fromId = callback?.from?.id ? String(callback.from.id) : null;

  const result = await query<PairingRow>(
    `SELECT id, status::text, scope::text, device_label, requested_ip,
            telegram_user_id, confirmation_message_id, expires_at
       FROM auth_pairing_attempts
      WHERE id = $1
      LIMIT 1`,
    [action.attemptId]
  );
  const attempt = result.rows[0];

  if (!attempt) {
    await answerTelegramCallbackQuery(callbackId, "Запрос входа не найден");
    return true;
  }

  // Нажать может только тот, кому карточку прислали. Иначе пересланная в чат
  // карточка позволяла бы постороннему подтвердить чужой вход.
  if (attempt.telegram_user_id && fromId && attempt.telegram_user_id !== fromId) {
    await answerTelegramCallbackQuery(callbackId, "Это подтверждение не для вашего аккаунта");
    return true;
  }

  const status = classifyPairingStatus({
    status: attempt.status as PairingAttemptStatus,
    expiresAt: attempt.expires_at,
    now: Date.now(),
  });

  if (status === "expired") {
    await markExpired(attempt.id);
    await answerTelegramCallbackQuery(callbackId, "Код уже истёк");
    if (chatId) {
      await closeCard({ chatId, messageId, originalText, verdict: "⌛ Код истёк — запросите новый на экране входа." });
    }
    return true;
  }

  if (status === "approved") {
    await answerTelegramCallbackQuery(callbackId, "Вход уже подтверждён");
    return true;
  }

  if (status === "denied") {
    await answerTelegramCallbackQuery(callbackId, "Запрос уже отклонён");
    return true;
  }

  if (action.action === "deny") {
    await query(
      `UPDATE auth_pairing_attempts SET status = 'DENIED' WHERE id = $1 AND status = 'CLAIMED'`,
      [attempt.id]
    );
    // «Это не я» — сигнал, что кто-то пытался войти под этим аккаунтом.
    // Записывается всегда, даже если пользователя в базе ещё нет.
    const owner = await query<{ id: string }>(
      `SELECT id FROM users WHERE telegram_id = $1::bigint LIMIT 1`,
      [attempt.telegram_user_id]
    );
    await writeAudit(owner.rows[0]?.id ?? null, "auth.pairing.denied", {
      attemptId: attempt.id,
      scope: attempt.scope,
      telegramUserId: attempt.telegram_user_id,
      deviceLabel: attempt.device_label,
      requestedIp: attempt.requested_ip,
    });
    await answerTelegramCallbackQuery(callbackId, "Вход отклонён");
    if (chatId) {
      await closeCard({
        chatId,
        messageId,
        originalText,
        verdict: "✋ Отклонён. Код больше не работает.",
      });
    }
    return true;
  }

  const approved = await query<{ id: string }>(
    `UPDATE auth_pairing_attempts
        SET status = 'APPROVED', approved_at = NOW()
      WHERE id = $1 AND status = 'CLAIMED'
      RETURNING id`,
    [attempt.id]
  );
  if (!approved.rows[0]) {
    await answerTelegramCallbackQuery(callbackId, "Запрос уже обработан");
    return true;
  }

  await answerTelegramCallbackQuery(callbackId, "Готово — приложение уже открылось");
  if (chatId) {
    await closeCard({
      chatId,
      messageId,
      originalText,
      verdict: "✅ Принят. Вернитесь в приложение — вы уже вошли.",
    });
  }
  return true;
}

async function handleCode(update: Record<string, any>): Promise<boolean> {
  const message = update?.message;
  const code = parsePairingCodeFromText(message?.text);
  if (!code) return false;

  const chatId = message?.chat?.id ? String(message.chat.id) : null;
  const fromId = message?.from?.id ? String(message.from.id) : null;
  if (!chatId || !fromId) return false;

  const result = await query<PairingRow>(
    `SELECT id, status::text, scope::text, device_label, requested_ip,
            telegram_user_id, confirmation_message_id, expires_at
       FROM auth_pairing_attempts
      WHERE code_hash = $1
      LIMIT 1`,
    [hashPairingCode(code)]
  );
  const attempt = result.rows[0];

  if (!attempt) {
    await sendTelegramBotMessage(
      chatId,
      "Такого кода нет. Проверьте, что переписали его с экрана целиком, или запросите новый — коды живут 5 минут."
    );
    return true;
  }

  const status = classifyPairingStatus({
    status: attempt.status as PairingAttemptStatus,
    expiresAt: attempt.expires_at,
    now: Date.now(),
  });

  if (status === "expired") {
    await markExpired(attempt.id);
    await sendTelegramBotMessage(chatId, "Код истёк. Нажмите «Получить новый код» на экране входа.");
    return true;
  }

  if (status === "denied") {
    await sendTelegramBotMessage(chatId, "Этот запрос входа уже отклонён. Начните вход заново.");
    return true;
  }

  if (status === "approved") {
    await sendTelegramBotMessage(chatId, "Этот вход уже подтверждён — вернитесь в приложение.");
    return true;
  }

  if (attempt.telegram_user_id && attempt.telegram_user_id !== fromId) {
    await sendTelegramBotMessage(chatId, "Этот код уже привязан к другому Telegram-аккаунту.");
    return true;
  }

  const profile = {
    id: fromId,
    username: message?.from?.username ? String(message.from.username) : undefined,
    first_name: message?.from?.first_name ? String(message.from.first_name) : undefined,
    last_name: message?.from?.last_name ? String(message.from.last_name) : undefined,
    photo_url: message?.from?.photo_url ? String(message.from.photo_url) : undefined,
  };

  await query(
    `UPDATE auth_pairing_attempts
        SET status = 'CLAIMED',
            telegram_user_id = $2,
            telegram_chat_id = $3,
            telegram_profile = $4::jsonb
      WHERE id = $1`,
    [attempt.id, fromId, chatId, JSON.stringify(profile)]
  );

  // Старая карточка гасится: если человек прислал код второй раз, живой
  // должна остаться ровно одна кнопка подтверждения.
  if (attempt.confirmation_message_id) {
    await closeCard({
      chatId,
      messageId: attempt.confirmation_message_id,
      originalText: "Запрос входа",
      verdict: "↻ Заменён новой карточкой ниже.",
    });
  }

  const sent = await sendTelegramBotMessage(
    chatId,
    buildPairingConfirmationText({
      firstName: profile.first_name,
      code,
      host: publicHost(),
      deviceLabel: attempt.device_label,
      requestedIp: attempt.requested_ip,
    }),
    {
      parseMode: "HTML",
      replyMarkup: buildPairingConfirmationKeyboard(attempt.id),
    }
  );

  if (sent.messageId) {
    await query(`UPDATE auth_pairing_attempts SET confirmation_message_id = $2 WHERE id = $1`, [
      attempt.id,
      sent.messageId,
    ]);
  }
  return true;
}

// Возвращает true, если апдейт относился к сопряжению и уже обработан.
// Вебхук после этого просто отвечает 200 и ничего не досылает: все сообщения
// здесь отправлены прямыми вызовами Bot API, потому что нам нужен message_id
// карточки, а ответ на вебхук его не возвращает.
export async function handlePairingUpdate(update: Record<string, any>): Promise<boolean> {
  if (!env.authPairing.enabled) return false;
  if (await handleCallback(update)) return true;
  return handleCode(update);
}
