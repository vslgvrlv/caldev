import { Router, type Response } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import {
  buildTelegramHandoffCompletionToken,
  buildTelegramHandoffCompletionUrl,
  hashTelegramHandoffCompletionToken,
  isTelegramStartCommandText,
  parseTelegramHandoffWebhookStart,
} from "../../lib/auth-telegram-handoff.js";
import { buildTelegramWebhookSendMessagePayload } from "../../lib/telegram-bot.js";
import { handlePairingUpdate } from "../auth/pairing-webhook.js";
import { logger } from "../../lib/logger.js";

const vendorRouter = Router();

const VENDOR_SOURCES = {
  tailwindcss: "https://cdn.tailwindcss.com",
  telegramWebApp: "https://telegram.org/js/telegram-web-app.js",
} as const;

type VendorName = keyof typeof VENDOR_SOURCES;

type CacheEntry = {
  body: string;
  fetchedAt: number;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<VendorName, CacheEntry>();

type TelegramHandoffAttemptRow = {
  id: string;
  scope: "USER" | "ADMIN";
  status: "PENDING" | "LINK_SENT" | "COMPLETED" | "EXPIRED" | "CANCELLED";
  redirect_to: string;
  telegram_user_id: string | null;
  expires_at: string;
};

async function fetchVendor(name: VendorName): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(VENDOR_SOURCES[name], {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "pbth-backend/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`vendor fetch failed: ${name} status=${response.status}`);
    }
    const body = await response.text();
    if (!body.trim()) {
      throw new Error(`vendor fetch failed: ${name} empty body`);
    }
    // Sometimes upstream/CDN returns HTML/challenge page instead of JS; do not cache garbage.
    if (name === "tailwindcss") {
      const normalized = body.slice(0, 512).toLowerCase();
      if (normalized.includes("<html") || normalized.includes("<!doctype html")) {
        throw new Error(`vendor fetch failed: ${name} returned html`);
      }
      if (!body.includes("tailwind")) {
        throw new Error(`vendor fetch failed: ${name} unexpected body`);
      }
    }
    cache.set(name, { body, fetchedAt: Date.now() });
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function getVendor(name: VendorName): Promise<string> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }

  try {
    return await fetchVendor(name);
  } catch (error) {
    if (cached) {
      console.warn(`[vendor] using stale cache for ${name}`, error);
      return cached.body;
    }
    throw error;
  }
}

function sendJs(res: Response, body: string, options?: { cacheControl?: string; source?: string }) {
  res.setHeader("Cache-Control", options?.cacheControl || "public, max-age=3600, stale-while-revalidate=86400");
  if (options?.source) {
    res.setHeader("X-PBTH-Vendor-Source", options.source);
  }
  res.type("application/javascript; charset=utf-8").send(body);
}

function sendFallback(res: Response, name: string) {
  if (name === "tailwindcss") {
    // Client-side fallback: if backend cannot fetch/cached copy is absent, try direct CDN load from the browser.
    return sendJs(
      res,
      `(function(){try{var s=document.createElement('script');s.src='https://cdn.tailwindcss.com';s.defer=true;s.onerror=function(){console.warn('[vendor] tailwind direct fallback failed')};document.head.appendChild(s);}catch(e){console.warn('[vendor] tailwind fallback inject failed',e);}})();`,
      { cacheControl: "no-store", source: "fallback" }
    );
  }
  if (name === "telegram-web-app") {
    return sendJs(
      res,
      `(function(){try{var existing=document.querySelector('script[data-pbth-vendor="telegram-web-app"]');if(existing){return;}var s=document.createElement('script');s.src='https://telegram.org/js/telegram-web-app.js';s.defer=true;s.dataset.pbthVendor='telegram-web-app';s.onerror=function(){console.warn('[vendor] telegram-web-app direct fallback failed')};document.head.appendChild(s);}catch(e){console.warn('[vendor] telegram-web-app fallback inject failed',e);}})();`,
      { cacheControl: "no-store", source: "fallback" }
    );
  }
  sendJs(
    res,
    `console.warn("[vendor] failed to load ${name}, fallback script returned by backend");`,
    { cacheControl: "no-store", source: "fallback" }
  );
}

function sendTelegramWebhookMessage(
  res: Response,
  chatId: string,
  text: string,
  options?: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: Record<string, unknown>;
  }
) {
  return res.status(200).json(buildTelegramWebhookSendMessagePayload(chatId, text, options));
}

function buildAbsoluteFrontendUrl(path: string) {
  return new URL(path, env.frontendUrl).toString();
}

vendorRouter.get(
  "/tailwindcss.js",
  asyncHandler(async (_req, res) => {
    try {
      const body = await getVendor("tailwindcss");
      sendJs(res, body, { cacheControl: "no-store", source: "cache-or-upstream" });
    } catch (error) {
      console.error("[vendor] tailwindcss fetch error", error);
      sendFallback(res, "tailwindcss");
    }
  })
);

vendorRouter.get(
  "/telegram-web-app.js",
  asyncHandler(async (_req, res) => {
    try {
      const body = await getVendor("telegramWebApp");
      sendJs(res, body, { source: "cache-or-upstream" });
    } catch (error) {
      console.error("[vendor] telegram-web-app fetch error", error);
      sendFallback(res, "telegram-web-app");
    }
  })
);

vendorRouter.post(
  "/telegram/webhook",
  asyncHandler(async (req, res) => {
    if (!env.telegram.webhookSecret) {
      return res.status(503).json({ detail: "Telegram webhook is not configured", code: "WEBHOOK_DISABLED" });
    }

    const providedSecret = String(req.get("x-telegram-bot-api-secret-token") || "");
    if (providedSecret !== env.telegram.webhookSecret) {
      return res.status(401).json({ detail: "Invalid Telegram webhook secret", code: "AUTH_REQUIRED" });
    }

    // Сопряжение разбирается первым: это основной вход (#109), и оно
    // единственное умеет отвечать на callback_query.
    if (await handlePairingUpdate(req.body ?? {})) {
      return res.status(200).json({ ok: true });
    }

    const rawMessageText = String(req.body?.message?.text || "").trim();
    const start = parseTelegramHandoffWebhookStart(req.body ?? {});
    logger.info("telegram.webhook.received", {
      correlationId: req.correlationId,
      text: rawMessageText.slice(0, 160),
      parsedAttemptKey: start?.attemptKey ?? null,
      chatId: req.body?.message?.chat?.id ? String(req.body.message.chat.id) : null,
      userId: req.body?.message?.from?.id ? String(req.body.message.from.id) : null,
    });

    if (!start) {
      if (isTelegramStartCommandText(rawMessageText) && req.body?.message?.chat?.id !== undefined) {
        return sendTelegramWebhookMessage(
          res,
          String(req.body.message.chat.id),
          "Чтобы войти, откройте сайт и нажмите кнопку входа. Я жду одноразовый код входа от сайта, без него я не смогу пустить внутрь.",
          {
            replyMarkup: {
              inline_keyboard: [
                [{ text: "Открыть PBTH", url: buildAbsoluteFrontendUrl("/login") }],
                [{ text: "Открыть admin", url: buildAbsoluteFrontendUrl("/admin/login") }],
              ],
            },
          }
        );
      }
      return res.status(200).json({ ok: true, ignored: true });
    }

    const attemptResult = await query<TelegramHandoffAttemptRow>(
      `SELECT id, scope::text, status::text, redirect_to, telegram_user_id, expires_at
       FROM auth_telegram_handoff_attempts
       WHERE attempt_key = $1
       LIMIT 1`,
      [start.attemptKey]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) {
      return sendTelegramWebhookMessage(
        res,
        start.telegramChatId,
        "Ссылка входа не найдена. Вернитесь на сайт и начните вход заново."
      );
    }

    if (new Date(attempt.expires_at).getTime() <= Date.now() || attempt.status === "EXPIRED") {
      await query(
        `UPDATE auth_telegram_handoff_attempts
         SET status = 'EXPIRED',
             completion_token_hash = NULL,
             completion_token_expires_at = NULL
         WHERE id = $1`,
        [attempt.id]
      );
      return sendTelegramWebhookMessage(
        res,
        start.telegramChatId,
        "Ссылка входа уже истекла. Вернитесь на сайт и запросите новую."
      );
    }

    if (attempt.status === "COMPLETED" || attempt.status === "CANCELLED") {
      return sendTelegramWebhookMessage(
        res,
        start.telegramChatId,
        "Этот запрос входа уже завершён. Если нужен новый вход, откройте сайт и начните заново."
      );
    }

    if (attempt.telegram_user_id && attempt.telegram_user_id !== start.telegramUserId) {
      return sendTelegramWebhookMessage(
        res,
        start.telegramChatId,
        "Этот запрос входа уже привязан к другому Telegram-аккаунту."
      );
    }

    const completionToken = buildTelegramHandoffCompletionToken();
    const completionUrl = buildTelegramHandoffCompletionUrl(env.frontendUrl, completionToken);
    await query(
      `UPDATE auth_telegram_handoff_attempts
       SET status = 'LINK_SENT',
           telegram_user_id = $2,
           telegram_chat_id = $3,
           telegram_profile = $4::jsonb,
           completion_token_hash = $5,
           completion_token_expires_at = NOW() + make_interval(secs => $6),
           last_sent_at = NOW()
       WHERE id = $1`,
      [
        attempt.id,
        start.telegramUserId,
        start.telegramChatId,
        JSON.stringify(start.profile),
        hashTelegramHandoffCompletionToken(completionToken),
        env.telegramHandoff.tokenTtlSeconds,
      ]
    );

    const buttonText = attempt.scope === "ADMIN" ? "Войти в admin" : "Войти в PBTH";
    const accessLabel = attempt.scope === "ADMIN" ? "в админку" : "на сайт";
    return sendTelegramWebhookMessage(
      res,
      start.telegramChatId,
      `${start.profile.first_name || "Пользователь"}, вход готов. Нажмите кнопку ниже, чтобы вернуться ${accessLabel}. Ссылка одноразовая и действует 10 минут.`,
      {
        replyMarkup: {
          inline_keyboard: [[{ text: buttonText, url: completionUrl }]],
        },
      }
    );
  })
);

export { vendorRouter };
