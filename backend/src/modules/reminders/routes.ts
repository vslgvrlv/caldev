import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { deliveryReasonText } from "../../lib/notification-dispatch.js";
import { resolveEventAccess, teamRoleOf } from "../../lib/event-access.js";
import { isWebPushEnabled } from "../../lib/web-push.js";
import { resolveEffectiveRsvp } from "../../lib/series-commitment.js";
import { isAutoRemindersEnabled } from "./auto.js";

// Модуль трека «Явка» (ревизия PBTH, 11.11.2026). Подключён основой в `app.ts`.
//   GET/PUT /reminders/settings              — авто-напоминания: включены или нет (свои)
//   GET     /reminders/events/:eventId/delivery — «кому дошло»: капитан и тренер
// Сами авто-напоминания запускает `server.ts` (см. `./auto.ts`).
export const remindersRouter = Router();

const settingsSchema = z.object({ autoEventReminders: z.boolean() });

async function readSettings(userId: string) {
  const result = await query<{ auto_event_reminders: boolean }>(
    `SELECT auto_event_reminders FROM user_notification_settings WHERE user_id = $1`,
    [userId]
  );
  return { autoEventReminders: result.rows[0]?.auto_event_reminders ?? true };
}

remindersRouter.get(
  "/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await readSettings(req.authUser!.id));
  })
);

remindersRouter.put(
  "/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = settingsSchema.parse(req.body ?? {});
    const userId = req.authUser!.id;
    await query(
      `INSERT INTO user_notification_settings (user_id, auto_event_reminders, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET auto_event_reminders = EXCLUDED.auto_event_reminders, updated_at = now()`,
      [userId, payload.autoEventReminders]
    );
    await writeAudit(userId, "reminders.settings.update", { autoEventReminders: payload.autoEventReminders });
    res.json(await readSettings(userId));
  })
);

type DeliveryStatusOut = "SENT" | "QUEUED" | "FAILED" | "NO_CHANNEL";

function deliveryStatus(status: string, errorCode: string | null): DeliveryStatusOut {
  if (errorCode === "NO_CHANNEL") return "NO_CHANNEL";
  if (status === "SENT" || status === "QUEUED" || status === "FAILED" || status === "NO_CHANNEL") return status;
  return "FAILED";
}

remindersRouter.get(
  "/events/:eventId/delivery",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const ev = await query<{ team_id: string; series_id: string | null }>(
      `SELECT team_id, series_id::text AS series_id FROM events WHERE id = $1`,
      [eventId]
    );
    const event = ev.rows[0];
    if (!event) return res.status(404).json({ detail: "Событие не найдено", code: "EVENT_NOT_FOUND" });

    // Журнал доставки — капитану и тренеру (владелец платформы — как капитан,
    // `resolveEventAccess`): игроку и гостю события незачем видеть, кому из
    // команды не дошло и почему (находка ревью №16).
    const role = teamRoleOf(await resolveEventAccess(req, eventId));
    if (role !== "CAPTAIN" && role !== "TRAINER") {
      return res.status(403).json({ detail: "Журнал доставки видят капитан и тренер", code: "FORBIDDEN" });
    }

    const membersResult = await query<{
      user_id: string;
      name: string;
      nickname: string;
      has_telegram: boolean;
      has_push: boolean;
      auto_off: boolean;
      rsvp_status: "PENDING" | "CONFIRMED" | "DECLINED" | null;
      committed: boolean;
    }>(
      `SELECT tm.user_id,
              u.name,
              u.nickname,
              (u.telegram_id IS NOT NULL) AS has_telegram,
              EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = tm.user_id) AS has_push,
              (s.auto_event_reminders IS FALSE) AS auto_off,
              r.status::text AS rsvp_status,
              (c.id IS NOT NULL) AS committed
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
         LEFT JOIN user_notification_settings s ON s.user_id = tm.user_id
         LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
         LEFT JOIN event_series_commitment c
           ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
        WHERE tm.team_id = $2
        ORDER BY u.name ASC`,
      [eventId, event.team_id, event.series_id]
    );
    const nameById = new Map(membersResult.rows.map((m) => [m.user_id, { name: m.name, nickname: m.nickname }]));
    const pushOn = isWebPushEnabled();

    // Последняя ручная рассылка: по номеру рассылки, у старых строк без
    // номера — всё, что ушло за пять минут до последней строки.
    const latest = await query<{ batch_id: string | null; created_at: Date }>(
      `SELECT batch_id::text AS batch_id, created_at
         FROM notification_deliveries
        WHERE event_id = $1 AND kind = 'EVENT_REMINDER'
        ORDER BY created_at DESC
        LIMIT 1`,
      [eventId]
    );
    let lastBroadcast: null | {
      at: string;
      total: number;
      delivered: number;
      failed: number;
      noChannel: number;
      items: Array<{ userId: string; name: string; nickname: string; status: DeliveryStatusOut; channel: string | null; reason: string | null }>;
    } = null;
    const last = latest.rows[0];
    if (last) {
      const rows = await query<{ user_id: string; status: string; channel: string | null; error_code: string | null; created_at: Date }>(
        last.batch_id
          ? `SELECT user_id, status, channel, error_code, created_at FROM notification_deliveries
              WHERE event_id = $1 AND kind = 'EVENT_REMINDER' AND batch_id = $2::uuid ORDER BY created_at ASC`
          : `SELECT user_id, status, channel, error_code, created_at FROM notification_deliveries
              WHERE event_id = $1 AND kind = 'EVENT_REMINDER' AND batch_id IS NULL
                AND created_at >= $2::timestamptz - INTERVAL '5 minutes' ORDER BY created_at ASC`,
        [eventId, last.batch_id ?? last.created_at]
      );
      const items = rows.rows.map((row) => {
        const status = deliveryStatus(row.status, row.error_code);
        const who = nameById.get(row.user_id) ?? { name: "Бывший участник", nickname: "" };
        return {
          userId: row.user_id,
          name: who.name,
          nickname: who.nickname,
          status,
          channel: row.channel,
          reason: status === "FAILED" || status === "NO_CHANNEL" ? deliveryReasonText(row.error_code) : null,
        };
      });
      lastBroadcast = {
        at: new Date(last.created_at).toISOString(),
        total: items.length,
        delivered: items.filter((i) => i.status === "SENT" || i.status === "QUEUED").length,
        failed: items.filter((i) => i.status === "FAILED").length,
        noChannel: items.filter((i) => i.status === "NO_CHANNEL").length,
        items,
      };
    }

    const autoRows = await query<{
      user_id: string;
      count: string;
      last_at: Date;
      last_status: string;
      last_error_code: string | null;
      last_slot: string;
    }>(
      `SELECT DISTINCT ON (user_id)
              user_id,
              COUNT(*) OVER (PARTITION BY user_id)::text AS count,
              created_at AS last_at,
              status AS last_status,
              error_code AS last_error_code,
              slot AS last_slot
         FROM event_auto_reminders
        WHERE event_id = $1
        ORDER BY user_id, created_at DESC`,
      [eventId]
    );
    const auto = autoRows.rows.map((row) => {
      const status = deliveryStatus(row.last_status === "CLAIMED" ? "QUEUED" : row.last_status, row.last_error_code);
      const who = nameById.get(row.user_id) ?? { name: "Бывший участник", nickname: "" };
      return {
        userId: row.user_id,
        name: who.name,
        nickname: who.nickname,
        count: Number(row.count),
        lastAt: new Date(row.last_at).toISOString(),
        lastSlot: row.last_slot,
        lastStatus: status,
        lastReason: status === "FAILED" || status === "NO_CHANNEL" ? deliveryReasonText(row.last_error_code) : null,
      };
    });

    const hasSeries = Boolean(event.series_id);
    res.json({
      eventId,
      autoRemindersEnabled: isAutoRemindersEnabled(),
      lastBroadcast,
      auto,
      members: membersResult.rows.map((m) => ({
        userId: m.user_id,
        name: m.name,
        nickname: m.nickname,
        rsvpStatus: resolveEffectiveRsvp({ explicit: m.rsvp_status, hasSeries, committedToSeries: m.committed }),
        autoRemindersOff: m.auto_off,
        channels: { telegram: m.has_telegram, push: pushOn && m.has_push },
      })),
    });
  })
);
