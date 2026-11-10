import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logger } from "../lib/logger.js";
import { callbackPrefix, type BotCallbackHandler, type TelegramCallbackQuery } from "./types.js";

// Загрузчик обработчиков кнопок бота: все файлы каталога, кроме служебных.
// Один префикс — один файл; повтор префикса — ошибка при старте, а не тихая
// подмена чужого обработчика.

const SERVICE_FILES = new Set(["index", "types"]);
const here = path.dirname(fileURLToPath(import.meta.url));

let registryPromise: Promise<Map<string, BotCallbackHandler>> | null = null;

function isHandlerFile(file: string): boolean {
  if (file.endsWith(".d.ts") || file.endsWith(".map")) return false;
  if (!/\.(ts|js|mjs)$/.test(file)) return false;
  if (/\.test\./.test(file)) return false;
  return !SERVICE_FILES.has(file.replace(/\.(ts|js|mjs)$/, ""));
}

function asHandler(mod: Record<string, any>): BotCallbackHandler | null {
  const source = mod.default && typeof mod.default === "object" ? mod.default : mod;
  if (typeof source.prefix === "string" && typeof source.handle === "function") {
    return { prefix: source.prefix, handle: source.handle };
  }
  return null;
}

export async function loadBotCallbacks(dir: string = here): Promise<Map<string, BotCallbackHandler>> {
  const registry = new Map<string, BotCallbackHandler>();
  const files = readdirSync(dir).filter(isHandlerFile).sort();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const handler = asHandler(mod);
    if (!handler) {
      throw new Error(`bot-callbacks/${file}: expected exports { prefix, handle }`);
    }
    if (registry.has(handler.prefix)) {
      throw new Error(`bot-callbacks/${file}: duplicate prefix "${handler.prefix}"`);
    }
    registry.set(handler.prefix, handler);
  }
  return registry;
}

export function getBotCallbacks(): Promise<Map<string, BotCallbackHandler>> {
  if (!registryPromise) {
    registryPromise = loadBotCallbacks().catch((error) => {
      registryPromise = null;
      throw error;
    });
  }
  return registryPromise;
}

/** Кнопка из обновления Telegram → обработчик по префиксу. false — не наша кнопка. */
export async function dispatchBotCallback(update: Record<string, any>, correlationId?: string): Promise<boolean> {
  const callback = update?.callback_query as TelegramCallbackQuery | undefined;
  if (!callback) return false;
  const prefix = callbackPrefix(callback.data);
  if (!prefix) return false;
  const handler = (await getBotCallbacks()).get(prefix);
  if (!handler) {
    logger.info("telegram.callback.unknown_prefix", { correlationId, prefix });
    return false;
  }
  const data = String(callback.data);
  const payload = data.length > prefix.length ? data.slice(prefix.length + 1) : "";
  return handler.handle(callback, { update, payload, correlationId });
}
