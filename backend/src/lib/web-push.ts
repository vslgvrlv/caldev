// Web Push (VAPID) — транспорт напоминаний вместо Telegram bot (#36). Хостинг
// режет исходящий трафик на Telegram, Web Push идёт прямым TLS к push-сервису
// браузера (FCM/Mozilla/Apple) и не зависит от relay.
import { createRequire } from "node:module";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);

export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type WebPushResult = { ok: true } | { ok: false; gone: boolean; reason: string };

/**
 * 404/410 от push-сервиса значит "подписка больше не существует" (пользователь
 * снял разрешение, очистил данные браузера, переустановил приложение) — такую
 * подписку нужно удалить, а не повторять попытку бесконечно.
 */
export function classifyWebPushError(error: unknown): WebPushResult {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  const gone = statusCode === 404 || statusCode === 410;
  const reason = error instanceof Error ? error.message : String(error);
  return { ok: false, gone, reason };
}

export function isWebPushEnabled(): boolean {
  return env.push.enabled && Boolean(env.push.vapidPublicKey) && Boolean(env.push.vapidPrivateKey);
}

type WebPushLib = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (subscription: WebPushSubscription, payload: string) => Promise<unknown>;
};

let configured = false;
let lib: WebPushLib | null = null;

function loadWebPushLib(): WebPushLib {
  if (!lib) {
    const loaded = require("web-push");
    lib = (loaded?.default || loaded) as WebPushLib;
  }
  if (!configured) {
    lib.setVapidDetails(env.push.vapidSubject, env.push.vapidPublicKey, env.push.vapidPrivateKey);
    configured = true;
  }
  return lib;
}

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: { title: string; body: string }
): Promise<WebPushResult> {
  if (!isWebPushEnabled()) return { ok: false, gone: false, reason: "Web push disabled" };
  try {
    await loadWebPushLib().sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    return classifyWebPushError(error);
  }
}
