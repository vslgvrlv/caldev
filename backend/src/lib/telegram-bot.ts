import { env } from "../config/env.js";

type TelegramSendMessageResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
};

export function buildTelegramBotApiUrl(botToken: string, method: string, baseUrl = env.telegram.botApiBaseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/bot${botToken}/${method}`;
}

export function buildTelegramBotHeaders(relayToken = env.telegram.relayToken) {
  return {
    "Content-Type": "application/json",
    ...(relayToken ? { "X-Telegram-Relay-Token": relayToken } : {}),
  };
}

export async function sendTelegramBotMessage(chatId: string, text: string): Promise<void> {
  const url = buildTelegramBotApiUrl(env.telegram.botToken, "sendMessage");
  const response = await fetch(url, {
    method: "POST",
    headers: buildTelegramBotHeaders(),
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
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
