import crypto from "node:crypto";
import { env } from "../config/env.js";

export type TelegramAuthPayload = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

type TelegramWebAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export function parseTelegramPayload(input: Record<string, unknown>): TelegramAuthPayload {
  return {
    id: String(input.id || ""),
    first_name: input.first_name ? String(input.first_name) : undefined,
    last_name: input.last_name ? String(input.last_name) : undefined,
    username: input.username ? String(input.username) : undefined,
    photo_url: input.photo_url ? String(input.photo_url) : undefined,
    auth_date: String(input.auth_date || ""),
    hash: String(input.hash || ""),
  };
}

export function verifyTelegramAuth(payload: TelegramAuthPayload): { ok: boolean; reason?: string } {
  if (!payload.id || !payload.auth_date || !payload.hash) {
    return { ok: false, reason: "Missing Telegram fields" };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "Invalid auth_date" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > env.telegram.allowedMaxAuthAgeSec) {
    return { ok: false, reason: "Expired auth payload" };
  }

  const dataCheckString = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(env.telegram.botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const expected = Buffer.from(hmac, "hex");
  const actual = Buffer.from(payload.hash, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "Invalid Telegram hash" };
  }

  return { ok: true };
}

export function verifyTelegramWebAppInitData(initData: string): { ok: boolean; payload?: TelegramAuthPayload; reason?: string } {
  if (!initData) {
    return { ok: false, reason: "Missing initData" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = params.get("auth_date");
  const userRaw = params.get("user");
  if (!hash || !authDate || !userRaw) {
    return { ok: false, reason: "Missing Telegram fields" };
  }

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    return { ok: false, reason: "Invalid user payload" };
  }

  if (!user?.id) {
    return { ok: false, reason: "Missing Telegram user id" };
  }

  const authDateNum = Number(authDate);
  if (!Number.isFinite(authDateNum)) {
    return { ok: false, reason: "Invalid auth_date" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDateNum > env.telegram.allowedMaxAuthAgeSec) {
    return { ok: false, reason: "Expired auth payload" };
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(env.telegram.botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const expected = Buffer.from(hmac, "hex");
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "Invalid Telegram hash" };
  }

  return {
    ok: true,
    payload: {
      id: String(user.id),
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      photo_url: user.photo_url,
      auth_date: authDate,
      hash,
    },
  };
}

export function buildTelegramOAuthUrl(options?: { origin?: string; returnTo?: string }): string {
  const botId = env.telegram.botToken.split(":")[0];
  if (!/^\d+$/.test(botId)) {
    throw new Error("Invalid TELEGRAM_BOT_TOKEN format: cannot extract bot_id");
  }

  const origin = options?.origin || env.frontendUrl;
  const returnTo = options?.returnTo || env.telegram.callbackUrl;
  const params = new URLSearchParams({
    bot_id: botId,
    origin,
    return_to: returnTo,
    request_access: "write",
  });

  return `https://oauth.telegram.org/auth?${params.toString()}`;
}

export function buildTelegramStartHtml(options?: { callback?: string; fallback?: string }) {
  const callback = options?.callback || env.telegram.callbackUrl;
  const fallback = options?.fallback || env.frontendUrl;
  const botName = env.telegram.botUsername;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Telegram Login</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1117;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#1a1f2b;border:1px solid #2a3345;border-radius:12px;padding:24px;max-width:360px;width:100%;text-align:center}
    p{color:#9aa7bd;font-size:14px}
  </style>
</head>
<body>
  <div class="card">
    <h1>Вход через Telegram</h1>
    <p>Подтвердите вход, чтобы продолжить.</p>
    <script>
      function onTelegramAuth(user) {
        try {
          if (!user || !user.id || !user.auth_date || !user.hash) {
            window.location.replace("${fallback}?auth_error=telegram_missing_fields");
            return;
          }
          var p = new URLSearchParams();
          p.set("id", String(user.id));
          if (user.first_name) p.set("first_name", String(user.first_name));
          if (user.last_name) p.set("last_name", String(user.last_name));
          if (user.username) p.set("username", String(user.username));
          if (user.photo_url) p.set("photo_url", String(user.photo_url));
          p.set("auth_date", String(user.auth_date));
          p.set("hash", String(user.hash));
          window.location.replace("${callback}?" + p.toString());
        } catch (_e) {
          window.location.replace("${fallback}?auth_error=telegram_callback_js_failed");
        }
      }
    </script>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${botName}"
      data-size="large"
      data-userpic="false"
      data-request-access="write"
      data-auth-url="${callback}"
      data-onauth="onTelegramAuth(user)"></script>
    <p style="margin-top:16px">
      <a href="/api/v1/auth/telegram/direct" style="color:#9ecbff">Если кнопка не сработала, нажмите сюда</a>
    </p>
  </div>
</body>
</html>`;
}
