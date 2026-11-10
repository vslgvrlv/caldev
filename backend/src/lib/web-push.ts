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
  sendNotification: (
    subscription: WebPushSubscription,
    payload: string,
    options?: { TTL?: number; urgency?: string; timeout?: number }
  ) => Promise<unknown>;
};

/**
 * Содержимое пуша. `title` и `body` — как было; остальное — для service
 * worker (`pbth/public/push-sw-handler.js`): `url` открывается по тапу
 * (договорённость всех треков), `tag` не даёт пушу о другом событии затереть
 * этот, `actions` и `rsvp` — кнопки «Иду / Не иду» с ключом ответа.
 */
export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
  rsvp?: { token: string };
};

export type WebPushSendOptions = {
  /** Сколько секунд push-сервису держать пуш для устройства без сети. */
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
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
  payload: WebPushPayload,
  options?: WebPushSendOptions
): Promise<WebPushResult> {
  if (!isWebPushEnabled()) return { ok: false, gone: false, reason: "Web push disabled" };
  try {
    await loadWebPushLib().sendNotification(subscription, JSON.stringify(payload), {
      // Без TTL push-сервис держит пуш до четырёх недель: устройство, бывшее
      // без сети, получило бы «завтра тренировка» через неделю.
      TTL: options?.ttlSeconds ?? 12 * 60 * 60,
      urgency: options?.urgency ?? "high",
      timeout: 10_000,
    });
    return { ok: true };
  } catch (error) {
    return classifyWebPushError(error);
  }
}
