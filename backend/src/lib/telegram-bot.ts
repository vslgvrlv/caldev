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

// Отправка файла в личку боту. Нужна выгрузкам: приложение живёт внутри
// Telegram WebView, где скачивание файла открывает его отдельным окном без
// кнопки «назад» (Василий, 2026-07-31). Файл, пришедший в чат, открывается
// системным просмотрщиком и никуда не уводит из приложения.
export async function sendTelegramBotDocument(
  chatId: string,
  fileName: string,
  content: string,
  options?: { caption?: string; mimeType?: string }
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (options?.caption) form.append("caption", options.caption);
  form.append(
    "document",
    new Blob([content], { type: options?.mimeType ?? "application/octet-stream" }),
    fileName
  );

  const url = `${env.telegram.botApiBaseUrl}/bot${env.telegram.botToken}/sendDocument`;
  const response = await fetch(url, { method: "POST", body: form });

  let payload: TelegramSendMessageResponse | null = null;
  try {
    payload = (await response.json()) as TelegramSendMessageResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram sendDocument failed (${response.status})`);
  }
}

export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  options?: TelegramSendMessageOptions
): Promise<void> {
  const url = `${env.telegram.botApiBaseUrl}/bot${env.telegram.botToken}/sendMessage`;
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
