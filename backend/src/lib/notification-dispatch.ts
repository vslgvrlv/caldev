// Доставка одного уведомления одному человеку: пуш первым, Telegram — если
// пуша нет или ни одно устройство его не приняло (#36). Общая для ручных
// напоминаний (`modules/notifications`) и авто-напоминаний (`modules/reminders`).

import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { enqueueTelegramNotification, isNotificationsQueueEnabled } from "./notification-queue.js";
import { signRsvpToken } from "./notification-rsvp-token.js";
import { sendTelegramBotMessage } from "./telegram-bot.js";
import { isWebPushEnabled, sendWebPush, type WebPushPayload } from "./web-push.js";

export type NotificationType =
  | "EVENT_REMINDER"
  | "EVENT_AUTO_REMINDER"
  | "EVENT_DEBT_REMINDER"
  | "TEAM_DEBT_REMINDER"
  | "MEMBER_DEBT_REMINDER";

export type DeliveryMode = "PUSH" | "SYNC" | "QUEUE";

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };

export type OutgoingMessage = {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
  push: Omit<WebPushPayload, "rsvp">;
};

export type TelegramErrorCode = "CHAT_NOT_FOUND" | "BOT_BLOCKED" | "USER_DEACTIVATED" | "SEND_FAILED" | "NO_CHANNEL";

export function classifyTelegramSendError(reason: string): Exclude<TelegramErrorCode, "NO_CHANNEL"> {
  const text = String(reason ?? "").toLowerCase();
  if (text.includes("chat not found")) return "CHAT_NOT_FOUND";
  if (text.includes("blocked by the user")) return "BOT_BLOCKED";
  if (text.includes("user is deactivated")) return "USER_DEACTIVATED";
  return "SEND_FAILED";
}

/** Почему не дошло — по-русски, для капитана. */
export function deliveryReasonText(code: string | null | undefined): string {
  switch (code) {
    case "NO_CHANNEL":
      return "нет канала: не входил через Telegram и не включил уведомления";
    case "CHAT_NOT_FOUND":
      return "не запускал бота в Telegram";
    case "BOT_BLOCKED":
      return "заблокировал бота в Telegram";
    case "USER_DEACTIVATED":
      return "аккаунт Telegram удалён";
    case "SEND_FAILED":
      return "Telegram не принял сообщение";
    default:
      return "не удалось отправить";
  }
}

/** Код команды для адреса: короткий код в нижнем регистре, иначе id. */
export function teamCodeForUrl(team: { shortCode?: string | null; teamId: string }): string {
  const code = String(team.shortCode ?? "").trim();
  return (code || team.teamId).toLowerCase();
}

export function appUrl(path: string): string {
  return new URL(path, env.frontendUrl).toString();
}

export function eventUrlFor(team: { shortCode?: string | null; teamId: string }, eventId: string): string {
  return appUrl(`/t/${encodeURIComponent(teamCodeForUrl(team))}/event/${encodeURIComponent(eventId)}`);
}

export function moneyUrlFor(team: { shortCode?: string | null; teamId: string }): string {
  return appUrl(`/t/${encodeURIComponent(teamCodeForUrl(team))}/money`);
}

/** Одним запросом по всем получателям, а не N+1. */
export async function resolvePushSubscriptionsByUsers(userIds: string[]): Promise<Map<string, PushSubscriptionRow[]>> {
  const map = new Map<string, PushSubscriptionRow[]>();
  if (!isWebPushEnabled() || userIds.length === 0) return map;
  const rows = await query<{ user_id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)`,
    [userIds]
  );
  for (const row of rows.rows) {
    const existing = map.get(row.user_id) ?? [];
    existing.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    map.set(row.user_id, existing);
  }
  return map;
}

export type DispatchParams = {
  chatId?: string | null;
  pushSubscriptions: PushSubscriptionRow[];
  message: OutgoingMessage;
  type: NotificationType;
  actorUserId?: string | null;
  recipientUserId: string;
  teamId?: string;
  eventId?: string;
  /** Начало события: до него держим пуш и годен ключ ответа из пуша. */
  eventStartAt?: string | Date | null;
  correlationId?: string;
};

function pushTtlSeconds(startAt: string | Date | null | undefined): number {
  const DAY = 24 * 60 * 60;
  if (!startAt) return 12 * 60 * 60;
  const seconds = Math.floor((new Date(startAt).getTime() - Date.now()) / 1000);
  if (!Number.isFinite(seconds)) return 12 * 60 * 60;
  return Math.max(60, Math.min(DAY, seconds));
}

/**
 * Пуш — основной транспорт: пробуем первым, протухшие подписки (404/410)
 * убираем, и только если ни одно устройство не приняло — Telegram. Получатель
 * без обоих каналов — ошибка: вызывающий код проверяет это заранее.
 */
export async function dispatchNotification(params: DispatchParams): Promise<{ mode: DeliveryMode }> {
  if (params.pushSubscriptions.length > 0) {
    const payload: WebPushPayload = { ...params.message.push };
    if (payload.actions?.length && params.eventId && params.eventStartAt) {
      payload.rsvp = {
        token: signRsvpToken(
          { eventId: params.eventId, userId: params.recipientUserId, expiresAt: new Date(params.eventStartAt).getTime() },
          env.session.secret
        ),
      };
    } else {
      delete payload.actions;
    }
    let anySent = false;
    for (const sub of params.pushSubscriptions) {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { ttlSeconds: pushTtlSeconds(params.eventStartAt), urgency: "high" }
      );
      if (result.ok) {
        anySent = true;
      } else if (result.gone) {
        await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]).catch(() => {});
      }
    }
    if (anySent) return { mode: "PUSH" };
  }

  if (!params.chatId) {
    throw new Error("No delivery channel available (no push subscription, no Telegram)");
  }

  if (!isNotificationsQueueEnabled()) {
    await sendTelegramBotMessage(params.chatId, params.message.text, {
      ...(params.message.parseMode ? { parseMode: params.message.parseMode } : {}),
      ...(params.message.replyMarkup ? { replyMarkup: params.message.replyMarkup } : {}),
    });
    return { mode: "SYNC" };
  }

  await enqueueTelegramNotification({
    chatId: params.chatId,
    text: params.message.text,
    parseMode: params.message.parseMode,
    replyMarkup: params.message.replyMarkup,
    context: {
      type: params.type,
      actorUserId: params.actorUserId ?? undefined,
      recipientUserId: params.recipientUserId,
      teamId: params.teamId,
      eventId: params.eventId,
      correlationId: params.correlationId,
    },
  });
  return { mode: "QUEUE" };
}
