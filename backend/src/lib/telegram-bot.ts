import { env } from "../config/env.js";

type TelegramSendMessageResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: { message_id?: number };
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

async function callTelegramBotApi(
  method: string,
  payload: Record<string, unknown>
): Promise<TelegramSendMessageResponse> {
  const url = `${env.telegram.botApiBaseUrl}/bot${env.telegram.botToken}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body: TelegramSendMessageResponse | null = null;
  try {
    body = (await response.json()) as TelegramSendMessageResponse;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.description || `Telegram ${method} failed (${response.status})`);
  }
  return body;
}

// Возвращает id отправленного сообщения: карточка подтверждения входа (#109)
// потом редактируется на месте, а не дублируется новым сообщением.
export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  options?: TelegramSendMessageOptions
): Promise<{ messageId: string | null }> {
  const body = await callTelegramBotApi("sendMessage", buildTelegramSendMessagePayload(chatId, text, options));
  const messageId = body.result?.message_id;
  return { messageId: messageId === undefined ? null : String(messageId) };
}

// Правка карточки на месте. Так делает сам Telegram в своей карточке
// авторизации: нажал «Принять» — то же сообщение получает «✅ Принят».
// Лента чата не засоряется, а история решения остаётся ровно там, где её
// принимали.
export async function editTelegramBotMessageText(params: {
  chatId: string;
  messageId: string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
}): Promise<void> {
  await callTelegramBotApi("editMessageText", {
    chat_id: params.chatId,
    message_id: Number(params.messageId),
    text: params.text,
    disable_web_page_preview: true,
    ...(params.parseMode ? { parse_mode: params.parseMode } : {}),
    // Пустой inline_keyboard снимает кнопки: решение принято, нажимать больше
    // нечего, и повторный тап не должен выглядеть возможным.
    reply_markup: params.replyMarkup ?? { inline_keyboard: [] },
  });
}

// Гасит «часики» на кнопке. Без этого Telegram крутит спиннер до таймаута,
// и человек не понимает, засчиталось нажатие или нет.
export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegramBotApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}
