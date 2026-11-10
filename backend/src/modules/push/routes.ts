// Web Push subscribe/unsubscribe (#36). GET /vapid-key отдаёт публичный ключ,
// чтобы фронтенд не хранил его в сборке отдельной переменной — один источник
// правды (env сервера), прочитанный один раз при открытии профиля.
import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { isWebPushEnabled } from "../../lib/web-push.js";

export const pushRouter = Router();

pushRouter.get("/vapid-key", (_req, res) => {
  if (!isWebPushEnabled()) return res.status(204).end();
  res.json({ publicKey: env.push.vapidPublicKey });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

pushRouter.post(
  "/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isWebPushEnabled()) return res.status(503).json({ detail: "Push notifications are disabled" });
    const payload = subscribeSchema.parse(req.body ?? {});
    const userId = (req as any).authUser.id;
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null;

    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         last_seen_at = now()`,
      [userId, payload.endpoint, payload.keys.p256dh, payload.keys.auth, userAgent]
    );

    res.json({ ok: true });
  })
);

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRouter.post(
  "/unsubscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = unsubscribeSchema.parse(req.body ?? {});
    const userId = (req as any).authUser.id;
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [payload.endpoint, userId]);
    res.json({ ok: true });
  })
);
