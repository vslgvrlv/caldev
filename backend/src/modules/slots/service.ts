// Открытые слоты: данные и правила. Ручки (`routes.ts`) и кнопки бота
// (`bot-callbacks/slot.ts`) зовут одни и те же функции.
//
// Правила (решения Василия 10.11.2026, п. 23–28):
//   - открытое расписание у команды по умолчанию выключено, включает капитан;
//   - подписка — сам, без одобрения; участнику своей команды не нужна;
//   - подписчик видит только события, где открыты слоты: название, время,
//     место, цену, число свободных мест;
//   - запись — кто первый, без одобрения. Места считаются в одной транзакции
//     под блокировкой строки слотов: двое не займут последнее место;
//   - гость после записи видит событие целиком до его окончания.

import type { PoolClient } from "pg";
import { pool, query } from "../../db/pool.js";
import { runInBackground, notifySlotBooked, notifySlotOffer } from "./notify.js";

export type SlotStatus = "OPEN" | "CLOSED";
export type GuestStatus = "BOOKED" | "LEFT" | "REMOVED";

/** Сколько гость видит событие без времени окончания — от начала. */
export const GUEST_ACCESS_WITHOUT_END = "6 hours";
const EVENT_END_SQL = `COALESCE(e.end_at, e.start_at + INTERVAL '${GUEST_ACCESS_WITHOUT_END}')`;

export const MAX_SLOTS = 50;
export const MAX_PRICE = 1_000_000;

export class SlotError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// --- Команда ---------------------------------------------------------------

export async function isOpenScheduleEnabled(teamId: string): Promise<boolean> {
  const result = await query<{ enabled: boolean }>(`SELECT enabled FROM team_open_schedules WHERE team_id = $1`, [teamId]);
  return Boolean(result.rows[0]?.enabled);
}

export async function setOpenSchedule(teamId: string, enabled: boolean, actorId: string): Promise<void> {
  await query(
    `INSERT INTO team_open_schedules (team_id, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (team_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [teamId, enabled, actorId]
  );
}

export async function followerCount(teamId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM team_followers f JOIN users u ON u.id = f.user_id AND u.is_active = TRUE
     WHERE f.team_id = $1
       AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = f.team_id AND tm.user_id = f.user_id)`,
    [teamId]
  );
  return result.rows[0]?.count ?? 0;
}

export async function membershipRole(userId: string, teamId: string): Promise<string | null> {
  const result = await query<{ role: string }>(
    `SELECT role::text AS role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  return result.rows[0]?.role ?? null;
}

export async function isFollower(userId: string, teamId: string): Promise<boolean> {
  const result = await query(`SELECT 1 FROM team_followers WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function follow(userId: string, teamId: string): Promise<void> {
  if (await membershipRole(userId, teamId)) {
    throw new SlotError("SLOTS_MEMBER", 409, "Ты уже в этой команде — подписка не нужна");
  }
  if (!(await isOpenScheduleEnabled(teamId))) {
    throw new SlotError("SLOTS_SCHEDULE_CLOSED", 409, "Команда закрыла открытое расписание");
  }
  await query(
    `INSERT INTO team_followers (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [teamId, userId]
  );
}

export async function unfollow(userId: string, teamId: string): Promise<void> {
  await query(`DELETE FROM team_followers WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
}

type TeamCardRow = {
  id: string;
  name: string;
  logo: string | null;
  following: boolean;
  enabled: boolean;
  open_events: number;
};

const TEAM_CARD_SQL = `
  SELECT t.id, t.name, t.logo,
         EXISTS (SELECT 1 FROM team_followers f WHERE f.team_id = t.id AND f.user_id = $1) AS following,
         COALESCE(os.enabled, FALSE) AS enabled,
         (SELECT COUNT(*)::int
            FROM event_slots s JOIN events e ON e.id = s.event_id
           WHERE s.team_id = t.id AND s.status = 'OPEN' AND e.is_cancelled = FALSE AND e.start_at > now()) AS open_events
  FROM teams t
  LEFT JOIN team_open_schedules os ON os.team_id = t.id`;

function teamCard(row: TeamCardRow) {
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    following: row.following,
    openSchedule: row.enabled,
    openEvents: row.enabled ? row.open_events : 0,
  };
}

/** Команды с открытым расписанием, кроме своих. */
export async function listOpenTeams(userId: string) {
  const result = await query<TeamCardRow>(
    `${TEAM_CARD_SQL}
     WHERE COALESCE(os.enabled, FALSE) = TRUE
       AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = t.id AND tm.user_id = $1)
     ORDER BY open_events DESC, t.name ASC
     LIMIT 200`,
    [userId]
  );
  return result.rows.map(teamCard);
}

/** Мои подписки — и те, где команда потом закрыла расписание. */
export async function listFollowing(userId: string) {
  const result = await query<TeamCardRow>(
    `${TEAM_CARD_SQL}
     WHERE EXISTS (SELECT 1 FROM team_followers f WHERE f.team_id = t.id AND f.user_id = $1)
     ORDER BY t.name ASC`,
    [userId]
  );
  return result.rows.map(teamCard);
}

export async function findTeam(ref: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  if (!isUuid) return null;
  const result = await query<{ id: string; name: string; logo: string | null; short_code: string }>(
    `SELECT id, name, logo, short_code FROM teams WHERE id = $1`,
    [ref]
  );
  return result.rows[0] ?? null;
}

export async function teamCardFor(userId: string, teamId: string) {
  const result = await query<TeamCardRow>(`${TEAM_CARD_SQL} WHERE t.id = $2`, [userId, teamId]);
  return result.rows[0] ? teamCard(result.rows[0]) : null;
}

// --- Лента подписчика ------------------------------------------------------

type OfferRow = {
  event_id: string;
  team_id: string;
  team_name: string;
  timezone: string | null;
  title: string;
  type: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  capacity: number;
  price: string;
  status: SlotStatus;
  booked: number;
  my_status: GuestStatus | null;
  my_paid: boolean | null;
  my_price: string | null;
};

const OFFER_SELECT = `
  SELECT s.event_id, s.team_id, t.name AS team_name, t.timezone, e.title, e.type::text AS type,
         e.start_at, e.end_at, e.location, s.capacity, s.price::text AS price, s.status,
         (SELECT COUNT(*)::int FROM event_slot_guests g WHERE g.event_id = s.event_id AND g.status = 'BOOKED') AS booked,
         mine.status AS my_status, mine.paid AS my_paid, mine.price::text AS my_price
  FROM event_slots s
  JOIN events e ON e.id = s.event_id AND e.is_cancelled = FALSE
  JOIN teams t ON t.id = s.team_id
  LEFT JOIN team_open_schedules os ON os.team_id = s.team_id
  LEFT JOIN event_slot_guests mine ON mine.event_id = s.event_id AND mine.user_id = $1`;

/** Карточка события для подписчика: только то, что разрешено решением 23. */
function offerCard(row: OfferRow) {
  const free = Math.max(0, row.capacity - row.booked);
  return {
    eventId: row.event_id,
    teamId: row.team_id,
    teamName: row.team_name,
    timezone: row.timezone,
    title: row.title,
    type: row.type,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    price: Number(row.price),
    capacity: row.capacity,
    free,
    open: row.status === "OPEN",
    booked: row.my_status === "BOOKED",
    myBooking:
      row.my_status === "BOOKED" ? { paid: Boolean(row.my_paid), price: Number(row.my_price ?? row.price) } : null,
  };
}

/**
 * Свободные слоты команд, на которые я подписан (без своих команд), и мои
 * записи гостем, пока событие не закончилось.
 */
export async function listFeed(userId: string) {
  const offers = await query<OfferRow>(
    `${OFFER_SELECT}
     WHERE s.status = 'OPEN'
       AND COALESCE(os.enabled, FALSE) = TRUE
       AND e.start_at > now()
       AND EXISTS (SELECT 1 FROM team_followers f WHERE f.team_id = s.team_id AND f.user_id = $1)
       AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = s.team_id AND tm.user_id = $1)
       AND (mine.status IS NULL OR mine.status <> 'BOOKED')
     ORDER BY e.start_at ASC
     LIMIT 100`,
    [userId]
  );
  const bookings = await query<OfferRow>(
    `${OFFER_SELECT}
     WHERE mine.status = 'BOOKED' AND now() < ${EVENT_END_SQL}
     ORDER BY e.start_at ASC`,
    [userId]
  );
  return { slots: offers.rows.map(offerCard), bookings: bookings.rows.map(offerCard) };
}

// --- Событие ---------------------------------------------------------------

type EventRow = {
  id: string;
  team_id: string;
  title: string;
  type: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  series_id: string | null;
  is_cancelled: boolean;
  ended: boolean;
  started: boolean;
};

export async function loadEvent(eventId: string): Promise<EventRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const result = await query<EventRow>(
    `SELECT e.id, e.team_id, e.title, e.type::text AS type, e.description, e.start_at, e.end_at, e.location,
            e.series_id::text AS series_id, e.is_cancelled,
            (now() >= ${EVENT_END_SQL}) AS ended,
            (now() >= e.start_at) AS started
     FROM events e WHERE e.id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

/**
 * Поставщик доступа «гость события» для `resolveEventAccess` (трек 3):
 * человек записан гостем и событие ещё не закончилось. Состав, казна и
 * другие события команды гостю закрыты — доступ только к этому событию.
 */
export async function hasGuestEventAccess(userId: string, eventId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
     FROM event_slot_guests g
     JOIN events e ON e.id = g.event_id AND e.is_cancelled = FALSE
     WHERE g.event_id = $1 AND g.user_id = $2 AND g.status = 'BOOKED' AND now() < ${EVENT_END_SQL}`,
    [eventId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

type SlotRow = { capacity: number; price: string; status: SlotStatus; round: number; booked: number };

export async function loadSlot(eventId: string): Promise<SlotRow | null> {
  const result = await query<SlotRow>(
    `SELECT s.capacity, s.price::text AS price, s.status, s.round,
            (SELECT COUNT(*)::int FROM event_slot_guests g WHERE g.event_id = s.event_id AND g.status = 'BOOKED') AS booked
     FROM event_slots s WHERE s.event_id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

function slotView(slot: SlotRow | null) {
  if (!slot) return null;
  return {
    status: slot.status,
    open: slot.status === "OPEN",
    capacity: slot.capacity,
    price: Number(slot.price),
    booked: slot.booked,
    free: Math.max(0, slot.capacity - slot.booked),
  };
}

export async function listGuests(eventId: string) {
  const result = await query<{
    user_id: string;
    name: string;
    nickname: string;
    avatar: string | null;
    paid: boolean;
    price: string;
    booked_at: string;
  }>(
    `SELECT g.user_id, u.name, u.nickname, u.avatar, g.paid, g.price::text AS price, g.booked_at
     FROM event_slot_guests g JOIN users u ON u.id = g.user_id
     WHERE g.event_id = $1 AND g.status = 'BOOKED'
     ORDER BY g.booked_at ASC`,
    [eventId]
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    nickname: row.nickname,
    avatar: row.avatar,
    paid: row.paid,
    price: Number(row.price),
    bookedAt: row.booked_at,
  }));
}

/** Блок «Свободные слоты» у капитана и тренера. */
export async function managerView(eventId: string, teamId: string) {
  const [slot, guests, enabled, followers] = await Promise.all([
    loadSlot(eventId),
    listGuests(eventId),
    isOpenScheduleEnabled(teamId),
    followerCount(teamId),
  ]);
  return { openSchedule: enabled, followers, slot: slotView(slot), guests };
}

async function teamInfo(teamId: string) {
  const result = await query<{ id: string; name: string; logo: string | null; timezone: string | null; enabled: boolean }>(
    `SELECT t.id, t.name, t.logo, t.timezone, COALESCE(os.enabled, FALSE) AS enabled
     FROM teams t LEFT JOIN team_open_schedules os ON os.team_id = t.id WHERE t.id = $1`,
    [teamId]
  );
  return result.rows[0];
}

async function locationUrl(teamId: string, location: string | null): Promise<string | null> {
  if (!location) return null;
  const result = await query<{ yandex_url: string | null }>(
    `SELECT sp.yandex_url FROM saved_places sp
     WHERE lower(sp.name) = lower($1) AND (sp.team_id = $2 OR sp.team_id IS NULL)
     ORDER BY (sp.team_id = $2) DESC NULLS LAST LIMIT 1`,
    [location, teamId]
  );
  const url = result.rows[0]?.yandex_url;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Кто идёт: участники с ответом «иду» (или согласием на серию) и гости. */
async function goingList(event: EventRow) {
  const members = await query<{ name: string; nickname: string; avatar: string | null }>(
    `SELECT u.name, u.nickname, u.avatar
     FROM team_memberships tm
     JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
     LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
     LEFT JOIN event_series_commitment c
       ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
     WHERE tm.team_id = $2
       AND (r.status = 'CONFIRMED' OR (r.status IS NULL AND c.user_id IS NOT NULL))
     ORDER BY u.name ASC`,
    [event.id, event.team_id, event.series_id]
  );
  const guests = await listGuests(event.id);
  return [
    ...members.rows.map((m) => ({ name: m.name, nickname: m.nickname, avatar: m.avatar, guest: false })),
    ...guests.map((g) => ({ name: g.name, nickname: g.nickname, avatar: g.avatar, guest: true })),
  ];
}

export type EventViewer = "MANAGER" | "MEMBER" | "GUEST" | "FOLLOWER";

/**
 * Событие глазами человека вне команды.
 *   GUEST    — записан гостем: событие целиком (время, место, игры, кто идёт);
 *   FOLLOWER — подписчик, слоты открыты: название, время, место, цена, места.
 * Остальным — null (ручка отвечает 404, чтобы не выдавать, что событие есть).
 * Участникам команды здесь отдаётся только сводка слотов.
 */
export async function eventForViewer(userId: string, eventId: string, managerRole: string | null) {
  const event = await loadEvent(eventId);
  if (!event || event.is_cancelled) return null;
  const team = await teamInfo(event.team_id);
  const slot = await loadSlot(eventId);
  const role = managerRole ?? (await membershipRole(userId, event.team_id));
  const mine = await query<{ status: GuestStatus; paid: boolean; price: string }>(
    `SELECT status, paid, price::text AS price FROM event_slot_guests WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId]
  );
  const myRow = mine.rows[0];
  const base = {
    eventId: event.id,
    teamId: team.id,
    teamName: team.name,
    teamLogo: team.logo,
    timezone: team.timezone,
    title: event.title,
    type: event.type,
    startAt: event.start_at,
    endAt: event.end_at,
    location: event.location,
    started: event.started,
    ended: event.ended,
  };

  if (role) {
    return { viewer: (role === "CAPTAIN" || role === "TRAINER" ? "MANAGER" : "MEMBER") as EventViewer, ...base, slot: slotView(slot), myBooking: null };
  }

  if (myRow?.status === "BOOKED" && !event.ended) {
    const [games, going, url] = await Promise.all([
      query<{ id: string; time_label: string; opponent: string; score: string | null }>(
        `SELECT id, time_label, opponent, score FROM event_games WHERE event_id = $1 ORDER BY time_label ASC, created_at ASC`,
        [eventId]
      ),
      goingList(event),
      locationUrl(event.team_id, event.location),
    ]);
    return {
      viewer: "GUEST" as EventViewer,
      ...base,
      description: event.description,
      locationUrl: url,
      slot: slotView(slot),
      myBooking: { paid: myRow.paid, price: Number(myRow.price) },
      schedule: games.rows.map((g) => ({ id: g.id, time: g.time_label, opponent: g.opponent, score: g.score })),
      going,
    };
  }

  const following = await isFollower(userId, event.team_id);
  if (following && team.enabled && slot?.status === "OPEN" && !event.started) {
    return { viewer: "FOLLOWER" as EventViewer, ...base, slot: slotView(slot), myBooking: null };
  }
  return null;
}

// --- Открыть и закрыть слоты ----------------------------------------------

export async function openSlots(params: {
  eventId: string;
  teamId: string;
  actorId: string;
  capacity: number;
  price: number;
}): Promise<{ notify: "OPEN" | "FREED" | null }> {
  const event = await loadEvent(params.eventId);
  if (!event || event.is_cancelled) throw new SlotError("SLOTS_EVENT_NOT_FOUND", 404, "Событие не найдено");
  if (event.started) throw new SlotError("SLOTS_EVENT_STARTED", 409, "Событие уже началось — слоты не открыть");
  if (!(await isOpenScheduleEnabled(params.teamId))) {
    throw new SlotError("SLOTS_SCHEDULE_CLOSED", 409, "Сначала включи открытое расписание команды");
  }

  const result = await withTransaction(async (client) => {
    const existing = await client.query<{ capacity: number; status: SlotStatus; round: number }>(
      `SELECT capacity, status, round FROM event_slots WHERE event_id = $1 FOR UPDATE`,
      [params.eventId]
    );
    const booked = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_slot_guests WHERE event_id = $1 AND status = 'BOOKED'`,
      [params.eventId]
    );
    const bookedCount = booked.rows[0]?.count ?? 0;
    if (params.capacity < bookedCount) {
      throw new SlotError("SLOTS_BELOW_BOOKED", 409, `Уже записано ${bookedCount} — меньше мест не поставить`);
    }
    const row = existing.rows[0];
    if (!row) {
      await client.query(
        `INSERT INTO event_slots (event_id, team_id, capacity, price, status, round, opened_by)
         VALUES ($1, $2, $3, $4, 'OPEN', 1, $5)`,
        [params.eventId, params.teamId, params.capacity, params.price, params.actorId]
      );
      return { notify: "OPEN" as const };
    }
    if (row.status === "CLOSED") {
      await client.query(
        `UPDATE event_slots
         SET capacity = $2, price = $3, status = 'OPEN', round = round + 1, free_seq = 0,
             opened_by = $4, opened_at = now(), updated_at = now()
         WHERE event_id = $1`,
        [params.eventId, params.capacity, params.price, params.actorId]
      );
      return { notify: "OPEN" as const };
    }
    // Открыты уже: меняем число мест и цену. Мест было «нет», стало больше —
    // это освобождение места, подписчикам уходит новое уведомление.
    const wasFull = bookedCount >= row.capacity;
    const nowFree = params.capacity > bookedCount;
    await client.query(
      `UPDATE event_slots
       SET capacity = $2, price = $3, free_seq = free_seq + $4, updated_at = now()
       WHERE event_id = $1`,
      [params.eventId, params.capacity, params.price, wasFull && nowFree ? 1 : 0]
    );
    return { notify: wasFull && nowFree ? ("FREED" as const) : null };
  });

  if (result.notify) {
    const kind = result.notify;
    runInBackground(`slots.${kind.toLowerCase()}`, () => notifySlotOffer({ eventId: params.eventId, kind }));
  }
  return result;
}

export async function closeSlots(eventId: string): Promise<void> {
  await query(`UPDATE event_slots SET status = 'CLOSED', updated_at = now() WHERE event_id = $1`, [eventId]);
}

// --- Запись гостя ----------------------------------------------------------

export type BookResult =
  | { ok: true; outcome: "BOOKED" | "ALREADY"; guestId: string }
  | { ok: false; outcome: "FULL" | "CLOSED" | "STARTED" | "MEMBER" | "NOT_FOLLOWER" | "NOT_FOUND" };

/**
 * Запись в слот. Строка слотов блокируется (`FOR UPDATE`) на всё время
 * подсчёта и вставки — второй запрос ждёт и видит уже занятое место.
 */
export async function book(userId: string, eventId: string): Promise<BookResult> {
  const result = await withTransaction<BookResult>(async (client) => {
    const slotResult = await client.query<{
      team_id: string;
      capacity: number;
      price: string;
      status: SlotStatus;
      start_at: string;
      is_cancelled: boolean;
      started: boolean;
      enabled: boolean;
    }>(
      `SELECT s.team_id, s.capacity, s.price::text AS price, s.status, e.start_at, e.is_cancelled,
              (now() >= e.start_at) AS started,
              COALESCE((SELECT enabled FROM team_open_schedules os WHERE os.team_id = s.team_id), FALSE) AS enabled
       FROM event_slots s JOIN events e ON e.id = s.event_id
       WHERE s.event_id = $1
       FOR UPDATE OF s`,
      [eventId]
    );
    const slot = slotResult.rows[0];
    if (!slot || slot.is_cancelled) return { ok: false, outcome: "NOT_FOUND" };

    const member = await client.query(`SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2`, [
      slot.team_id,
      userId,
    ]);
    if ((member.rowCount ?? 0) > 0) return { ok: false, outcome: "MEMBER" };

    const mine = await client.query<{ id: string; status: GuestStatus }>(
      `SELECT id, status FROM event_slot_guests WHERE event_id = $1 AND user_id = $2`,
      [eventId, userId]
    );
    if (mine.rows[0]?.status === "BOOKED") return { ok: true, outcome: "ALREADY", guestId: mine.rows[0].id };

    if (slot.started) return { ok: false, outcome: "STARTED" };
    if (slot.status !== "OPEN" || !slot.enabled) return { ok: false, outcome: "CLOSED" };

    const follower = await client.query(`SELECT 1 FROM team_followers WHERE team_id = $1 AND user_id = $2`, [
      slot.team_id,
      userId,
    ]);
    if ((follower.rowCount ?? 0) === 0) return { ok: false, outcome: "NOT_FOLLOWER" };

    const booked = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_slot_guests WHERE event_id = $1 AND status = 'BOOKED'`,
      [eventId]
    );
    if ((booked.rows[0]?.count ?? 0) >= slot.capacity) return { ok: false, outcome: "FULL" };

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO event_slot_guests (event_id, user_id, status, price, paid, booked_at)
       VALUES ($1, $2, 'BOOKED', $3, FALSE, now())
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET status = 'BOOKED', price = EXCLUDED.price, paid = FALSE, paid_by = NULL, paid_at = NULL,
             booked_at = now(), cancelled_at = NULL, cancelled_by = NULL
       RETURNING id`,
      [eventId, userId, slot.price]
    );
    return { ok: true, outcome: "BOOKED", guestId: inserted.rows[0].id };
  });

  if (result.ok && result.outcome === "BOOKED") {
    const guestId = result.guestId;
    runInBackground("slots.booked", () => notifySlotBooked({ guestId }));
  }
  return result;
}

/**
 * Снять запись: сам гость (`LEFT`) или капитан (`REMOVED`). Если до этого
 * мест не было, подписчикам уходит «место освободилось» — кроме того, кто
 * его освободил.
 */
export async function cancelBooking(params: {
  eventId: string;
  guestUserId: string;
  actorId: string;
  status: "LEFT" | "REMOVED";
}): Promise<"CANCELLED" | "NOT_BOOKED"> {
  const result = await withTransaction(async (client) => {
    const slot = await client.query<{ capacity: number; status: SlotStatus }>(
      `SELECT capacity, status FROM event_slots WHERE event_id = $1 FOR UPDATE`,
      [params.eventId]
    );
    if (!slot.rows[0]) return { outcome: "NOT_BOOKED" as const, freed: false };
    const before = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_slot_guests WHERE event_id = $1 AND status = 'BOOKED'`,
      [params.eventId]
    );
    const updated = await client.query(
      `UPDATE event_slot_guests
       SET status = $3, cancelled_at = now(), cancelled_by = $4
       WHERE event_id = $1 AND user_id = $2 AND status = 'BOOKED'`,
      [params.eventId, params.guestUserId, params.status, params.actorId]
    );
    if ((updated.rowCount ?? 0) === 0) return { outcome: "NOT_BOOKED" as const, freed: false };
    const wasFull = (before.rows[0]?.count ?? 0) >= slot.rows[0].capacity;
    const freed = wasFull && slot.rows[0].status === "OPEN";
    if (freed) {
      await client.query(`UPDATE event_slots SET free_seq = free_seq + 1, updated_at = now() WHERE event_id = $1`, [
        params.eventId,
      ]);
    }
    return { outcome: "CANCELLED" as const, freed };
  });

  if (result.freed) {
    const exclude = [params.guestUserId];
    runInBackground("slots.freed", () => notifySlotOffer({ eventId: params.eventId, kind: "FREED", exclude }));
  }
  return result.outcome;
}

export async function guestByRow(guestId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(guestId)) return null;
  const result = await query<{ event_id: string; user_id: string; status: GuestStatus; name: string; team_id: string }>(
    `SELECT g.event_id, g.user_id, g.status, u.name, s.team_id
     FROM event_slot_guests g
     JOIN users u ON u.id = g.user_id
     JOIN event_slots s ON s.event_id = g.event_id
     WHERE g.id = $1`,
    [guestId]
  );
  return result.rows[0] ?? null;
}

export async function setPaid(params: { eventId: string; guestUserId: string; paid: boolean; actorId: string }) {
  const result = await query(
    `UPDATE event_slot_guests
     SET paid = $3, paid_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END, paid_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE event_id = $1 AND user_id = $2 AND status = 'BOOKED'`,
    [params.eventId, params.guestUserId, params.paid, params.actorId]
  );
  return (result.rowCount ?? 0) > 0;
}
