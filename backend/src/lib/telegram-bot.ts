import { env } from "../config/env.js";

type TelegramSendMessageResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
};

type TelegramSendMessageOptions = {
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
};

type TelegramSendMessagePayload = {
  chat_id: string;
  text: string;
  disable_web_page_preview: boolean;
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: Record<string, unknown>;
};

export function buildTelegramSendMessagePayload(
  chatId: string,
  text: string,
  options?: TelegramSendMessageOptions
): TelegramSendMessagePayload {
  return {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  };
}

export function buildTelegramWebhookSendMessagePayload(
  chatId: string,
  text: string,
  options?: TelegramSendMessageOptions
) {
  return {
    method: "sendMessage" as const,
    ...buildTelegramSendMessagePayload(chatId, text, options),
  };
}

export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  options?: TelegramSendMessageOptions
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTelegramSendMessagePayload(chatId, text, options)),
  });

  let payload: TelegramSendMessageResponse | null = null;
  try {
    payload = (await response.json()) as TelegramSendMessageResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram sendMessage failed (${response.status})`);
  }
}
