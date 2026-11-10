import { handlePairingCallback } from "../modules/auth/pairing-webhook.js";
import type { BotCallbackContext, TelegramCallbackQuery } from "./types.js";

// Вход по коду: «Это я» / «Не я» на карточке подтверждения (`pair:<действие>:<id>`).
export const prefix = "pair";

export async function handle(_callback: TelegramCallbackQuery, ctx: BotCallbackContext): Promise<boolean> {
  return handlePairingCallback(ctx.update);
}
