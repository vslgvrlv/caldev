import { env } from "../config/env.js";

type TelegramSendMessageResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
};

export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  options?: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: Record<string, unknown>;
  }
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode,
      reply_markup: options?.replyMarkup,
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
