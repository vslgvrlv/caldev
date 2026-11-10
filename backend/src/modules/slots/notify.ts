// Уведомления об открытых слотах: подписчикам — «есть свободный слот» с
// кнопкой «Записаться», капитану и тренеру — «<имя> занял слот» с кнопкой
// «Снять», снятому гостю — «тебя сняли со слота» с кнопкой «Свободные слоты». Уходят пушем и в бота сразу (решение 27), готовыми функциями
// `lib/telegram-bot.ts` и `lib/web-push.ts`; сами эти файлы не меняются.
//
// Дубли. Перед отправкой в `slot_notifications` вставляется строка с ключом
// (событие, человек, вид, ключ открытия). Не вставилась — это уведомление
// человек уже получил, второй раз не шлём. Так одно открытие не приходит
// дважды, даже если два запроса разошлют его одновременно.
//
// Рассылка идёт после ответа капитану, в фоне: открытие слотов не должно ждать
// Telegram по каждому подписчику. Тестам — `flushSlotNotifications()`.

import { env } from "../../config/env.js";
import { query } from "../../db/pool.js";
import { logger } from "../../lib/logger.js";
import { sendTelegramBotMessage } from "../../lib/telegram-bot.js";
import { isWebPushEnabled, sendWebPush } from "../../lib/web-push.js";
import { buildSlotBookedText, buildSlotOpenText, buildSlotRemovedText } from "./format.js";

export type SlotNotificationKind = "OPEN" | "FREED" | "BOOKED";

type Recipient = { user_id: string; telegram_id: string | null };

type Delivery = {
  text: string;
  keyboard?: Record<string, unknown>;
  push: { title: string; body: string; url: string };
};

const inflight = new Set<Promise<unknown>>();

export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const promise = task().catch((error) => {
    logger.error("slots.notify.failed", { label, error: error instanceof Error ? error.message : String(error) });
  });
  inflight.add(promise);
  void promise.finally(() => inflight.delete(promise));
}

/** Дождаться всех фоновых рассылок (тесты, остановка процесса). */
export async function flushSlotNotifications(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}

function appUrl(path: string): string {
  return `${env.frontendUrl.replace(/\/+$/, "")}${path}`;
}

/** Адрес события для подписчика и гостя — экран `/teams` трека. */
export function guestEventPath(eventId: string): string {
  return `/teams?event=${encodeURIComponent(eventId)}`;
}

export function slotOfferKeyboard(eventId: string) {
  return {
    inline_keyboard: [
      [{ text: "Записаться", callback_data: `slot:book:${eventId}` }],
      [{ text: "Открыть в приложении", url: appUrl(guestEventPath(eventId)) }],
    ],
  };
}

export function slotGuestKeyboard(guestId: string, eventPath: string) {
  return {
    inline_keyboard: [
      [{ text: "Снять", callback_data: `slot:rm:${guestId}` }],
      [{ text: "Открыть событие", url: appUrl(eventPath) }],
    ],
  };
}

async function claim(eventId: string, userId: string, kind: SlotNotificationKind, key: string): Promise<boolean> {
  const result = await query(
    `INSERT INTO slot_notifications (event_id, user_id, kind, dedupe_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING 1`,
    [eventId, userId, kind, key]
  );
  return (result.rowCount ?? 0) > 0;
}

async function pushSubscriptions(userIds: string[]) {
  const map = new Map<string, Array<{ endpoint: string; p256dh: string; auth: string }>>();
  if (!isWebPushEnabled() || userIds.length === 0) return map;
  const rows = await query<{ user_id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );
  for (const row of rows.rows) {
    const list = map.get(row.user_id) ?? [];
    list.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    map.set(row.user_id, list);
  }
  return map;
}

async function deliver(
  recipient: Recipient,
  subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
  message: Delivery
): Promise<{ telegram: string; push: string }> {
  let push = "NONE";
  if (subs.length > 0) {
    push = "FAILED";
    for (const sub of subs) {
      // Поле `url` — договорённость с треком 2: по тапу на пуш открывается оно.
      const payload = { title: message.push.title, body: message.push.body, url: message.push.url };
      const result = await sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      if (result.ok) push = "SENT";
      else if (result.gone) await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [sub.endpoint]).catch(() => {});
    }
  }
  let telegram = "NONE";
  if (recipient.telegram_id) {
    try {
      await sendTelegramBotMessage(recipient.telegram_id, message.text, message.keyboard ? { replyMarkup: message.keyboard } : undefined);
      telegram = "SENT";
    } catch (error) {
      telegram = "FAILED";
      logger.warn("slots.notify.telegram_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { telegram, push };
}

async function sendTo(
  eventId: string,
  kind: SlotNotificationKind,
  key: string,
  recipients: Recipient[],
  message: Delivery
): Promise<number> {
  const claimed: Recipient[] = [];
  for (const recipient of recipients) {
    if (await claim(eventId, recipient.user_id, kind, key)) claimed.push(recipient);
  }
  if (claimed.length === 0) return 0;
  const subs = await pushSubscriptions(claimed.map((r) => r.user_id));
  for (const recipient of claimed) {
    const status = await deliver(recipient, subs.get(recipient.user_id) ?? [], message);
    await query(
      `UPDATE slot_notifications SET telegram_status = $5, push_status = $6
       WHERE event_id = $1 AND user_id = $2 AND kind = $3 AND dedupe_key = $4`,
      [eventId, recipient.user_id, kind, key, status.telegram, status.push]
    );
  }
  return claimed.length;
}

type SlotEventRow = {
  event_id: string;
  team_id: string;
  team_name: string;
  timezone: string | null;
  title: string;
  start_at: string;
  location: string | null;
  capacity: number;
  price: string;
  status: string;
  round: number;
  free_seq: number;
  booked: number;
  enabled: boolean;
};

async function loadSlotEvent(eventId: string): Promise<SlotEventRow | null> {
  const result = await query<SlotEventRow>(
    `SELECT s.event_id, s.team_id, t.name AS team_name, t.timezone, e.title, e.start_at, e.location,
            s.capacity, s.price::text AS price, s.status, s.round, s.free_seq,
            (SELECT COUNT(*)::int FROM event_slot_guests g WHERE g.event_id = s.event_id AND g.status = 'BOOKED') AS booked,
            COALESCE(os.enabled, FALSE) AS enabled
     FROM event_slots s
     JOIN events e ON e.id = s.event_id AND e.is_cancelled = FALSE
     JOIN teams t ON t.id = s.team_id
     LEFT JOIN team_open_schedules os ON os.team_id = s.team_id
     WHERE s.event_id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

/**
 * Подписчики, которым стоит сообщить о свободном месте: не участники
 * команды (им слоты не нужны), не записанные уже гости и не тот, кто только
 * что освободил место.
 */
async function offerRecipients(teamId: string, eventId: string, exclude: string[]): Promise<Recipient[]> {
  const result = await query<Recipient>(
    `SELECT u.id AS user_id, u.telegram_id::text AS telegram_id
     FROM team_followers f
     JOIN users u ON u.id = f.user_id AND u.is_active = TRUE
     WHERE f.team_id = $1
       AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = $1 AND tm.user_id = f.user_id)
       AND NOT EXISTS (SELECT 1 FROM event_slot_guests g WHERE g.event_id = $2 AND g.user_id = f.user_id AND g.status = 'BOOKED')
       AND NOT (f.user_id = ANY($3::uuid[]))
     ORDER BY f.created_at`,
    [teamId, eventId, exclude]
  );
  return result.rows;
}

/**
 * «Есть свободный слот» всем подписчикам. `kind = OPEN` — слоты открыты
 * (ключ — номер открытия), `FREED` — место освободилось после «мест нет»
 * (ключ — открытие и счётчик освобождений).
 */
export async function notifySlotOffer(params: {
  eventId: string;
  kind: "OPEN" | "FREED";
  exclude?: string[];
  now?: Date;
}): Promise<number> {
  const slot = await loadSlotEvent(params.eventId);
  if (!slot || !slot.enabled || slot.status !== "OPEN") return 0;
  if (new Date(slot.start_at).getTime() <= (params.now ?? new Date()).getTime()) return 0;
  const free = slot.capacity - slot.booked;
  if (free <= 0) return 0;
  const key = params.kind === "OPEN" ? `r${slot.round}` : `r${slot.round}:f${slot.free_seq}`;
  const recipients = await offerRecipients(slot.team_id, slot.event_id, params.exclude ?? []);
  const text = buildSlotOpenText({
    teamName: slot.team_name,
    startAt: slot.start_at,
    timeZone: slot.timezone,
    location: slot.location,
    price: slot.price,
    free,
    now: params.now,
  });
  return sendTo(slot.event_id, params.kind, key, recipients, {
    text,
    keyboard: slotOfferKeyboard(slot.event_id),
    push: { title: free === 1 ? "Свободный слот" : "Свободные слоты", body: text, url: guestEventPath(slot.event_id) },
  });
}

/** Капитану и тренеру: «<имя> занял слот» с кнопкой «Снять». */
export async function notifySlotBooked(params: { guestId: string; now?: Date }): Promise<number> {
  const guest = await query<{ id: string; event_id: string; user_id: string; name: string; booked_at: string; status: string }>(
    `SELECT g.id, g.event_id, g.user_id, u.name, g.booked_at, g.status
     FROM event_slot_guests g JOIN users u ON u.id = g.user_id
     WHERE g.id = $1`,
    [params.guestId]
  );
  const row = guest.rows[0];
  if (!row || row.status !== "BOOKED") return 0;
  const slot = await loadSlotEvent(row.event_id);
  if (!slot) return 0;
  const managers = await query<Recipient & { short_code: string | null }>(
    `SELECT u.id AS user_id, u.telegram_id::text AS telegram_id, t.short_code
     FROM team_memberships tm
     JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.team_id = $1 AND tm.role::text IN ('CAPTAIN', 'TRAINER')`,
    [slot.team_id]
  );
  if (managers.rows.length === 0) return 0;
  const code = String(managers.rows[0].short_code || slot.team_id).toLowerCase();
  const eventPath = `/t/${encodeURIComponent(code)}/event/${encodeURIComponent(slot.event_id)}`;
  const text = buildSlotBookedText({
    guestName: row.name,
    eventTitle: slot.title,
    startAt: slot.start_at,
    timeZone: slot.timezone,
    price: slot.price,
    booked: slot.booked,
    capacity: slot.capacity,
    now: params.now,
  });
  const key = `${row.id}:${new Date(row.booked_at).getTime()}`;
  return sendTo(slot.event_id, "BOOKED", key, managers.rows, {
    text,
    keyboard: slotGuestKeyboard(row.id, eventPath),
    push: { title: `${row.name.trim()} занял слот`, body: text.split("\n").slice(1).join(" "), url: eventPath },
  });
}

/** Кнопка под сообщением снятому гостю: экран свободных слотов. */
export const SLOTS_SCREEN_PATH = "/teams";

export function slotRemovedKeyboard() {
  return { inline_keyboard: [[{ text: "Свободные слоты", url: appUrl(SLOTS_SCREEN_PATH) }]] };
}

/**
 * Снятому гостю — «<Команда>: тебя сняли со слота — <событие>, <когда>» в бот
 * и пушем. Только когда снял капитан или тренер: гость, снявшийся сам, об
 * этом знает. Дубли не нужны: запись снимается одним запросом (`status =
 * 'BOOKED'` в UPDATE), второй вызов на ту же запись сюда не доходит.
 */
export async function notifySlotRemoved(params: { eventId: string; guestUserId: string; now?: Date }): Promise<boolean> {
  const event = await query<{ title: string; start_at: string; team_name: string; timezone: string | null }>(
    `SELECT e.title, e.start_at, t.name AS team_name, t.timezone
     FROM events e JOIN teams t ON t.id = e.team_id
     WHERE e.id = $1`,
    [params.eventId]
  );
  const row = event.rows[0];
  if (!row) return false;
  const guest = await query<Recipient>(
    `SELECT id AS user_id, telegram_id::text AS telegram_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [params.guestUserId]
  );
  const recipient = guest.rows[0];
  if (!recipient) return false;
  const text = buildSlotRemovedText({
    teamName: row.team_name,
    eventTitle: row.title,
    startAt: row.start_at,
    timeZone: row.timezone,
    now: params.now,
  });
  const subs = await pushSubscriptions([recipient.user_id]);
  await deliver(recipient, subs.get(recipient.user_id) ?? [], {
    text,
    keyboard: slotRemovedKeyboard(),
    push: { title: "Тебя сняли со слота", body: text, url: SLOTS_SCREEN_PATH },
  });
  return true;
}
