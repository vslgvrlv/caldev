import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { randomUUID } from "node:crypto";
import { classifyDelivery, type DeliveryStatus } from "../../lib/notification-delivery.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { resolveTeamAccess } from "../../lib/team-access.js";
import { resolveEventAccess, teamRoleOf } from "../../lib/event-access.js";
import { isNotificationsQueueEnabled } from "../../lib/notification-queue.js";
import {
  classifyTelegramSendError,
  deliveryReasonText,
  dispatchNotification,
  eventUrlFor,
  moneyUrlFor,
  resolvePushSubscriptionsByUsers,
  type OutgoingMessage,
  type PushSubscriptionRow,
} from "../../lib/notification-dispatch.js";
import {
  buildDebtMessage,
  buildEventRsvpMessage,
  escapeHtml,
  htmlToPlain,
  linkKeyboard,
  type DebtItem,
  type RsvpState,
} from "../../lib/notification-messages.js";
import { resolveEffectiveRsvp } from "../../lib/series-commitment.js";

type ActorRole = "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER";
type EventKind = "TRAINING" | "TOURNAMENT" | "CHAMPIONSHIP" | "FRIENDLY_MATCH" | "MEETING" | "MAINTENANCE" | "OTHER";
// SILENT — «молчат», как на карте явки: нет ответа или «думаю». Ответом
// считается и согласие на серию занятий (как в списке участников).
type EventReminderAudience = "ALL" | "RESPONDED" | "UNANSWERED" | "SILENT" | "CONFIRMED" | "PENDING" | "DECLINED";
type EventReminderTemplate =
  | "EVENT_REMINDER"
  | "WARMUP_REMINDER"
  | "ROLE_REMINDER"
  | "GAME_GATHERING"
  | "GAME_WARMUP";

const eventReminderSchema = z.object({
  audience: z.enum(["ALL", "RESPONDED", "UNANSWERED", "SILENT", "CONFIRMED", "PENDING", "DECLINED"]).default("UNANSWERED"),
  template: z.enum(["EVENT_REMINDER", "WARMUP_REMINDER", "ROLE_REMINDER", "GAME_GATHERING", "GAME_WARMUP"]).default("EVENT_REMINDER"),
  gameId: z.string().uuid().optional(),
  customText: z.string().trim().max(2000).optional(),
});

const debtReminderSchema = z.object({
  userIds: z.array(z.string().uuid()).optional(),
  customText: z.string().trim().max(2000).optional(),
});

const teamDebtReminderSchema = z.object({
  userIds: z.array(z.string().uuid()).optional(),
  customText: z.string().trim().max(2000).optional(),
});

type NotificationsAccess = {
  userId: string;
  actorRole: ActorRole;
};

async function resolveNotificationsAccess(req: Parameters<typeof requireAuth>[0]): Promise<NotificationsAccess> {
  const effectiveRole = getEffectiveEntryRole(req as any, (req as any).authUser);
  if (effectiveRole === "ADMIN") {
    return { userId: (req as any).authUser.id, actorRole: "ADMIN" };
  }
  const ctx = await resolveTeamAccess(req as any);
  if (!ctx) {
    const err = new Error("Active team context required");
    (err as any).status = 403;
    throw err;
  }
  return { userId: (req as any).authUser.id, actorRole: ctx.role as ActorRole };
}


function assertCanSendEventReminder(actorRole: ActorRole, eventType: EventKind) {
  if (actorRole === "ADMIN" || actorRole === "CAPTAIN") return;
  if (actorRole === "TRAINER" && (eventType === "TRAINING" || eventType === "MEETING")) return;
  const err = new Error("Only captain/admin or trainer (training/meeting) can send event reminders");
  (err as any).status = 403;
  throw err;
}

function assertCanSendDebtReminder(actorRole: ActorRole) {
  if (actorRole === "ADMIN" || actorRole === "CAPTAIN") return;
  const err = new Error("Only captain or root admin can send debt reminders");
  (err as any).status = 403;
  throw err;
}


// Все напоминания отправляются с parse_mode=HTML, поэтому любые пользовательские
// значения (название, команда, соперник, произвольный текст) обязательно экранируем,
// а место оформляем кликабельной ссылкой на Яндекс.Карты.
const TELEGRAM_PARSE_MODE = "HTML" as const;
type ReminderMessage = { text: string; parseMode: "HTML" };

function formatLocationHtml(location?: string | null, locationUrl?: string | null): string | null {
  const name = (location ?? "").trim();
  if (!name) return null;
  const url = (locationUrl ?? "").trim();
  const escapedName = escapeHtml(name);
  if (url && /^https?:\/\//i.test(url)) {
    return `<a href="${escapeHtml(url)}">${escapedName}</a>`;
  }
  return escapedName;
}

// Дефолтная таймзона на случай, если у команды не проставлена (в приложении время
// показывается в таймзоне команды, поэтому напоминание обязано считать так же).
const DEFAULT_TEAM_TIMEZONE = "Europe/Moscow";

function formatDateTime(
  dateIso: string,
  timeZone?: string | null,
  location?: string | null,
  locationUrl?: string | null
) {
  const dt = new Date(dateIso);
  const tz = (timeZone ?? "").trim() || DEFAULT_TEAM_TIMEZONE;
  let date: string;
  try {
    // start_at хранится в UTC; рендерим в таймзоне команды, чтобы совпадало с UI.
    date = dt.toLocaleString("ru-RU", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    // Некорректная таймзона в БД — не роняем напоминание, откатываемся на дефолт.
    date = dt.toLocaleString("ru-RU", {
      timeZone: DEFAULT_TEAM_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const locationHtml = formatLocationHtml(location, locationUrl);
  return locationHtml ? `${date} • ${locationHtml}` : date;
}

function buildEventReminderText(params: {
  template: EventReminderTemplate;
  event: { title: string; start_at: string; location: string | null; location_url: string | null; team_name: string; team_timezone: string | null };
  game?: {
    id: string;
    time_label: string;
    opponent: string;
    pit_zone: "NEAR" | "FAR" | null;
    game_pair: "FIRST" | "SECOND" | null;
  } | null;
  customText?: string;
}): ReminderMessage {
  if (params.customText) {
    // Название команды — в каждом сообщении (решение Василия 10.11.2026, п. 8).
    return {
      text: `<b>${escapeHtml(params.event.team_name)}</b>\n${escapeHtml(params.customText)}`,
      parseMode: TELEGRAM_PARSE_MODE,
    };
  }
  const whenWhere = formatDateTime(params.event.start_at, params.event.team_timezone, params.event.location, params.event.location_url);
  const title = escapeHtml(params.event.title);
  const teamName = escapeHtml(params.event.team_name);
  const game = params.game;
  const gamePairLabel = game?.game_pair === "FIRST" ? "Первая пара" : game?.game_pair === "SECOND" ? "Вторая пара" : "Пара не указана";
  const pitLabel = game?.pit_zone === "NEAR" ? "Ближняя пит-зона" : game?.pit_zone === "FAR" ? "Дальняя пит-зона" : "Пит-зона не указана";
  let text: string;
  if (params.template === "GAME_GATHERING" || params.template === "GAME_WARMUP") {
    const header = params.template === "GAME_GATHERING" ? "Сбор перед игрой" : "Начало разминки перед игрой";
    text = [
      header,
      title,
      teamName,
      whenWhere,
      "",
      `Соперник: ${escapeHtml(game?.opponent || "не указан")}`,
      `Время игры: ${escapeHtml(game?.time_label || "не указано")}`,
      `База/пит: ${pitLabel}`,
      `Пара: ${gamePairLabel}`,
    ].join("\n");
  } else if (params.template === "WARMUP_REMINDER") {
    text = [
      `Разминка перед событием`,
      title,
      teamName,
      whenWhere,
      ``,
      `Проверь экипировку и выезжай заранее.`,
    ].join("\n");
  } else if (params.template === "ROLE_REMINDER") {
    text = [
      `Напоминание по роли/задаче на событии`,
      title,
      teamName,
      whenWhere,
      ``,
      `Проверь свою роль/задачу в событии и подготовься заранее.`,
    ].join("\n");
  } else {
    text = [
      `Напоминание о командном событии`,
      title,
      teamName,
      whenWhere,
      ``,
      `Ответь в приложении, идёшь ли.`,
    ].join("\n");
  }
  return { text, parseMode: TELEGRAM_PARSE_MODE };
}

function isGameReminderTemplate(template: EventReminderTemplate): boolean {
  return template === "GAME_GATHERING" || template === "GAME_WARMUP";
}

/**
 * Роль в команде события — `resolveEventAccess` (трек 3): участник — по
 * составу, владелец платформы — как капитан. Гостю события (только чтение)
 * рассылать и читать журнал нельзя. Владельцу самому напоминания команды не
 * уходят: получатели — только состав.
 */
async function eventActor(req: any, eventId: string): Promise<{ userId: string; role: ActorRole; teamId: string } | null> {
  const access = await resolveEventAccess(req, eventId);
  const role = teamRoleOf(access);
  if (!access || !role) return null;
  return { userId: req.authUser.id, role: role as ActorRole, teamId: access.teamId };
}

type OutcomeStatus = "SENT" | "QUEUED" | "FAILED" | "NO_CHANNEL";

type RecipientOutcome = {
  userId: string;
  name: string;
  nickname: string;
  username: string | null;
  status: OutcomeStatus;
  channel: "TELEGRAM" | "WEBPUSH" | null;
  code?: string;
  reason?: string;
};

type DeliveryTotals = {
  /** Ушло сразу любым каналом: Telegram или пуш. Так «Отправлено: N» не врёт, когда ушли только пуши. */
  sent: number;
  /** Из них пушем. */
  pushed: number;
  /** Из них в Telegram. */
  telegram: number;
  queued: number;
  skippedNoTelegram: number;
};

function totalsOf(outcomes: RecipientOutcome[]): DeliveryTotals {
  const pushed = outcomes.filter((o) => o.status === "SENT" && o.channel === "WEBPUSH").length;
  const telegram = outcomes.filter((o) => o.status === "SENT" && o.channel === "TELEGRAM").length;
  return {
    sent: pushed + telegram,
    pushed,
    telegram,
    queued: outcomes.filter((o) => o.status === "QUEUED").length,
    skippedNoTelegram: outcomes.filter((o) => o.status === "NO_CHANNEL").length,
  };
}

type Recipient = { userId: string; name: string; nickname: string; username: string | null; telegramId: string | null };

/** Отправка одному человеку с итогом для ответа и журнала; ошибки не бросает. */
async function deliverTo(
  recipient: Recipient,
  pushSubscriptions: PushSubscriptionRow[],
  message: OutgoingMessage,
  context: {
    type: "EVENT_REMINDER" | "EVENT_DEBT_REMINDER" | "TEAM_DEBT_REMINDER" | "MEMBER_DEBT_REMINDER";
    actorUserId: string;
    teamId: string;
    eventId?: string;
    eventStartAt?: string | null;
    correlationId?: string;
  }
): Promise<RecipientOutcome> {
  const base = { userId: recipient.userId, name: recipient.name, nickname: recipient.nickname, username: recipient.username };
  if (!recipient.telegramId && pushSubscriptions.length === 0) {
    return { ...base, status: "NO_CHANNEL", channel: null, code: "NO_CHANNEL", reason: deliveryReasonText("NO_CHANNEL") };
  }
  try {
    const { mode } = await dispatchNotification({
      chatId: recipient.telegramId,
      pushSubscriptions,
      message,
      type: context.type,
      actorUserId: context.actorUserId,
      recipientUserId: recipient.userId,
      teamId: context.teamId,
      eventId: context.eventId,
      eventStartAt: context.eventStartAt ?? null,
      correlationId: context.correlationId,
    });
    return {
      ...base,
      status: mode === "QUEUE" ? "QUEUED" : "SENT",
      channel: mode === "PUSH" ? "WEBPUSH" : "TELEGRAM",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Send failed";
    const code = classifyTelegramSendError(detail);
    return { ...base, status: "FAILED", channel: "TELEGRAM", code, reason: deliveryReasonText(code) };
  }
}

/** Ответ клиенту: прежние поля (старый фронтенд) и подробный список получателей. */
function deliveryResponse(outcomes: RecipientOutcome[], extra: Record<string, unknown> = {}) {
  const totals = totalsOf(outcomes);
  return {
    success: true,
    deliveryMode: isNotificationsQueueEnabled() ? "QUEUE" : "SYNC",
    attempted: outcomes.length,
    ...totals,
    failed: outcomes
      .filter((o) => o.status === "FAILED")
      .map((o) => ({ userId: o.userId, name: o.name, nickname: o.nickname, username: o.username, reason: o.reason, code: o.code })),
    recipients: outcomes.map((o) => ({
      userId: o.userId,
      name: o.name,
      nickname: o.nickname,
      status: o.status,
      channel: o.channel,
      reason: o.reason ?? null,
    })),
    ...extra,
  };
}

export const notificationsRouter = Router();

type DebtRow = {
  user_id: string;
  name: string;
  nickname: string;
  username: string | null;
  telegram_id: string | null;
  event_id: string;
  event_title: string;
  event_start_at: Date;
  outstanding: string;
};

type Debtor = Recipient & { total: number; items: DebtItem[] };

/** Долги по событиям: кто, за что и сколько осталось (только положительные остатки). */
async function getDebtItems(teamId: string, eventId?: string): Promise<Debtor[]> {
  const result = await query<DebtRow>(
    `WITH charge_paid AS (
       SELECT c.id,
              c.user_id,
              c.event_id,
              c.amount_due,
              COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
       FROM event_member_charges c
       LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
       WHERE c.team_id = $1 AND ($2::uuid IS NULL OR c.event_id = $2::uuid)
       GROUP BY c.id, c.user_id, c.event_id, c.amount_due
     )
     SELECT u.id AS user_id,
            u.name,
            u.nickname,
            u.username,
            u.telegram_id::text AS telegram_id,
            e.id AS event_id,
            e.title AS event_title,
            e.start_at AS event_start_at,
            GREATEST(cp.amount_due - cp.amount_paid, 0)::text AS outstanding
     FROM charge_paid cp
     JOIN users u ON u.id = cp.user_id AND u.is_active = TRUE
     JOIN events e ON e.id = cp.event_id
     WHERE cp.amount_due - cp.amount_paid > 0
     ORDER BY u.id, e.start_at ASC`,
    [teamId, eventId ?? null]
  );
  const byUser = new Map<string, Debtor>();
  for (const row of result.rows) {
    const amount = Number(row.outstanding);
    const entry: Debtor = byUser.get(row.user_id) ?? {
      userId: row.user_id,
      name: row.name,
      nickname: row.nickname,
      username: row.username,
      telegramId: row.telegram_id,
      total: 0,
      items: [],
    };
    entry.total += amount;
    entry.items.push({ title: row.event_title, startAt: row.event_start_at, amount });
    byUser.set(row.user_id, entry);
  }
  return [...byUser.values()];
}

type TeamRow = { id: string; name: string; short_code: string | null; timezone: string | null };

async function loadTeam(teamId: string): Promise<TeamRow | null> {
  const result = await query<TeamRow>(`SELECT id, name, short_code, timezone FROM teams WHERE id = $1`, [teamId]);
  return result.rows[0] ?? null;
}

async function sendDebtReminders(params: {
  team: TeamRow;
  debtors: Debtor[];
  customText?: string;
  type: "EVENT_DEBT_REMINDER" | "TEAM_DEBT_REMINDER" | "MEMBER_DEBT_REMINDER";
  actorUserId: string;
  eventId?: string;
  correlationId?: string;
}): Promise<RecipientOutcome[]> {
  const moneyUrl = moneyUrlFor({ shortCode: params.team.short_code, teamId: params.team.id });
  const pushByUser = await resolvePushSubscriptionsByUsers(params.debtors.map((d) => d.userId));
  const outcomes: RecipientOutcome[] = [];
  for (const debtor of params.debtors) {
    const message = buildDebtMessage({
      teamName: params.team.name,
      total: debtor.total,
      items: debtor.items,
      timezone: params.team.timezone,
      moneyUrl,
      customText: params.customText,
      tag: params.eventId ? `debt-${params.eventId}` : `debt-${params.team.id}`,
    });
    outcomes.push(
      await deliverTo(debtor, pushByUser.get(debtor.userId) ?? [], message, {
        type: params.type,
        actorUserId: params.actorUserId,
        teamId: params.team.id,
        eventId: params.eventId,
        correlationId: params.correlationId,
      })
    );
  }
  return outcomes;
}

notificationsRouter.post(
  "/finance/remind-debtors",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = teamDebtReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);
    assertCanSendDebtReminder(access.actorRole);

    const ctx = await resolveTeamAccess(req as any);
    const teamId = ctx?.teamId;
    if (!teamId) return res.status(403).json({ detail: "Active team context required" });

    const team = await loadTeam(teamId);
    if (!team) return res.status(404).json({ detail: "Team not found" });

    const selectedIds = new Set(payload.userIds || []);
    const debtors = (await getDebtItems(teamId)).filter((d) => selectedIds.size === 0 || selectedIds.has(d.userId));
    const outcomes = await sendDebtReminders({
      team,
      debtors,
      customText: payload.customText,
      type: "TEAM_DEBT_REMINDER",
      actorUserId: access.userId,
      correlationId: req.correlationId,
    });
    const totals = totalsOf(outcomes);

    await writeAudit(access.userId, "notifications.team_debt_reminder.send", {
      teamId,
      attempted: outcomes.length,
      ...totals,
      failed: outcomes.filter((o) => o.status === "FAILED").length,
    });

    return res.json(deliveryResponse(outcomes));
  })
);

notificationsRouter.post(
  "/events/:eventId/remind",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = eventReminderSchema.parse(req.body ?? {});

    const eventResult = await query<{
      id: string;
      team_id: string;
      title: string;
      start_at: string;
      start_at_iso: Date;
      location: string | null;
      location_url: string | null;
      type: EventKind;
      series_id: string | null;
      team_name: string;
      team_short_code: string | null;
      team_timezone: string | null;
    }>(
      `SELECT e.id,
              e.team_id,
              e.title,
              e.start_at::text,
              e.start_at AS start_at_iso,
              e.location,
              (SELECT sp.yandex_url FROM saved_places sp
                 WHERE lower(sp.name) = lower(e.location)
                   AND (sp.team_id = e.team_id OR sp.team_id IS NULL)
                 ORDER BY (sp.team_id = e.team_id) DESC NULLS LAST
                 LIMIT 1) AS location_url,
              e.type,
              e.series_id::text AS series_id,
              t.name AS team_name,
              t.short_code AS team_short_code,
              t.timezone AS team_timezone
       FROM events e
       JOIN teams t ON t.id = e.team_id
       WHERE e.id = $1 AND e.is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ detail: "Event not found" });

    const actor = await eventActor(req, eventId);
    if (!actor) return res.status(403).json({ detail: "No access to this team event" });
    const actorRole = actor.role;
    assertCanSendEventReminder(actorRole, event.type);

    const recipients = await query<{
      user_id: string;
      name: string;
      nickname: string;
      username: string | null;
      telegram_id: string | null;
      rsvp_status: "CONFIRMED" | "PENDING" | "DECLINED" | null;
      committed: boolean;
    }>(
      `SELECT tm.user_id,
              u.name,
              u.nickname,
              u.username,
              u.telegram_id::text AS telegram_id,
              r.status AS rsvp_status,
              (c.id IS NOT NULL) AS committed
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
       LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
       LEFT JOIN event_series_commitment c
         ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
       WHERE tm.team_id = $2`,
      [eventId, event.team_id, event.series_id]
    );

    // Ответ человека — как в списке участников: явный ответ, иначе согласие
    // на серию считается «иду». Так «Напомнить (5)» шлёт ровно тем пятерым,
    // кого капитан видит в «Молчат».
    const hasSeries = Boolean(event.series_id);
    const withState = recipients.rows.map((row) => ({
      ...row,
      state: resolveEffectiveRsvp({ explicit: row.rsvp_status, hasSeries, committedToSeries: row.committed }) as RsvpState,
    }));
    const filtered = withState.filter((row) => {
      switch (payload.audience as EventReminderAudience) {
        case "ALL":
          return true;
        case "RESPONDED":
          return row.state !== "UNANSWERED";
        case "UNANSWERED":
          return row.state === "UNANSWERED";
        case "SILENT":
          return row.state === "UNANSWERED" || row.state === "PENDING";
        case "CONFIRMED":
          return row.state === "CONFIRMED";
        case "PENDING":
          return row.state === "PENDING";
        case "DECLINED":
          return row.state === "DECLINED";
        default:
          return false;
      }
    });

    let gameContext: {
      id: string;
      time_label: string;
      opponent: string;
      pit_zone: "NEAR" | "FAR" | null;
      game_pair: "FIRST" | "SECOND" | null;
    } | null = null;
    if (payload.gameId || isGameReminderTemplate(payload.template as EventReminderTemplate)) {
      const games = await query<{
        id: string;
        time_label: string;
        opponent: string;
        pit_zone: "NEAR" | "FAR" | null;
        game_pair: "FIRST" | "SECOND" | null;
      }>(
        `SELECT id, time_label, opponent, pit_zone::text, game_pair::text
         FROM event_games
         WHERE event_id = $1
         ORDER BY lpad(time_label, 5, '0') ASC`,
        [eventId]
      );
      if (!games.rowCount) {
        return res.status(400).json({ detail: "No games found for this event. Add event schedule first." });
      }
      if (payload.gameId) {
        gameContext = games.rows.find((row) => row.id === payload.gameId) || null;
        if (!gameContext) {
          return res.status(400).json({ detail: "Selected game not found in this event schedule" });
        }
      } else {
        gameContext = games.rows[0];
      }
    }

    const eventUrl = eventUrlFor({ shortCode: event.team_short_code, teamId: event.team_id }, eventId);
    const startIso = new Date(event.start_at_iso).toISOString();
    const card = {
      eventId,
      title: event.title,
      startAt: startIso,
      location: event.location,
      locationUrl: event.location_url,
      teamName: event.team_name,
      timezone: event.team_timezone,
    };
    // «Обычное напоминание» — карточка с кнопками «Иду / Не иду», у каждого
    // своя строка ответа. Остальные шаблоны — сообщение со ссылкой на событие.
    let plainMessage: OutgoingMessage | null = null;
    if (payload.template !== "EVENT_REMINDER") {
      const built = buildEventReminderText({
        template: payload.template as EventReminderTemplate,
        event,
        game: gameContext,
        customText: payload.customText,
      });
      plainMessage = {
        text: built.text,
        parseMode: built.parseMode,
        replyMarkup: linkKeyboard("Открыть событие", eventUrl),
        push: {
          title: `${event.team_name}: ${event.title}`,
          body: htmlToPlain(built.text),
          url: eventUrl,
          tag: `event-${eventId}`,
        },
      };
    }

    const pushByUser = await resolvePushSubscriptionsByUsers(filtered.map((row) => row.user_id));
    const outcomes: RecipientOutcome[] = [];
    for (const row of filtered) {
      const message: OutgoingMessage =
        plainMessage ?? buildEventRsvpMessage({ card, kind: "MANUAL", state: row.state, eventUrl, customText: payload.customText });
      outcomes.push(
        await deliverTo(
          { userId: row.user_id, name: row.name, nickname: row.nickname, username: row.username, telegramId: row.telegram_id },
          pushByUser.get(row.user_id) ?? [],
          message,
          {
            type: "EVENT_REMINDER",
            actorUserId: actor.userId,
            teamId: event.team_id,
            eventId,
            eventStartAt: startIso,
            correlationId: req.correlationId,
          }
        )
      );
    }

    // #46: журнал доставки по каждому получателю, одним номером рассылки —
    // по нему экран «кому дошло» показывает последнюю рассылку целиком.
    // «Нет канала» — неудача с кодом NO_CHANNEL (статусы журнала прежние).
    const batchId = randomUUID();
    try {
      for (const o of outcomes) {
        const classified: { status: DeliveryStatus; errorDetail?: string } =
          o.status === "NO_CHANNEL" || o.status === "FAILED"
            ? { status: "FAILED", errorDetail: o.reason }
            : classifyDelivery({ mode: o.status === "QUEUED" ? "QUEUE" : o.channel === "WEBPUSH" ? "PUSH" : "SYNC" });
        await query(
          `INSERT INTO notification_deliveries (team_id, event_id, user_id, kind, channel, status, error_code, error_detail, batch_id)
           VALUES ($1, $2, $3, 'EVENT_REMINDER', $4, $5, $6, $7, $8)`,
          [event.team_id, eventId, o.userId, o.channel ?? "NONE", classified.status, o.code ?? null, classified.errorDetail ?? null, batchId]
        );
      }
    } catch (err) {
      console.error("notification_deliveries insert failed", err);
    }

    const totals = totalsOf(outcomes);
    await writeAudit(actor.userId, "notifications.event_reminder.send", {
      eventId,
      teamId: event.team_id,
      actorRole,
      audience: payload.audience as EventReminderAudience,
      template: payload.template as EventReminderTemplate,
      gameId: gameContext?.id || null,
      attempted: outcomes.length,
      ...totals,
      failed: outcomes.filter((o) => o.status === "FAILED").length,
    });

    return res.json(
      deliveryResponse(outcomes, {
        batchId,
        skippedNoTelegramUsers: outcomes
          .filter((o) => o.status === "NO_CHANNEL")
          .map((o) => ({
            userId: o.userId,
            name: o.name,
            nickname: o.nickname,
            username: o.username,
            rsvpStatus: withState.find((row) => row.user_id === o.userId)?.rsvp_status ?? null,
          })),
      })
    );
  })
);

notificationsRouter.get(
  "/events/:eventId/deliveries",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const ev = await query<{ team_id: string }>(`SELECT team_id FROM events WHERE id = $1`, [eventId]);
    const teamId = ev.rows[0]?.team_id;
    if (!teamId) return res.status(404).json({ detail: "Event not found" });

    const actor = await eventActor(req, eventId);
    if (!actor) return res.status(403).json({ detail: "Team access denied" });
    const role = actor.role;
    // Кому из команды не дошло и почему — дело капитана и тренера (находка ревью №16).
    if (role === "PLAYER") return res.status(403).json({ detail: "Журнал доставки видят капитан и тренер" });

    // Последний статус доставки по каждому получателю (#46).
    const rows = await query<{ user_id: string; status: string; error_detail: string | null; created_at: string }>(
      `SELECT DISTINCT ON (user_id) user_id, status, error_detail, created_at
       FROM notification_deliveries
       WHERE event_id = $1
       ORDER BY user_id, created_at DESC`,
      [eventId]
    );

    return res.json({
      items: rows.rows.map((r) => ({
        userId: r.user_id,
        status: r.status,
        errorDetail: r.error_detail,
        at: r.created_at,
      })),
    });
  })
);

notificationsRouter.post(
  "/finance/members/:userId/remind-debt",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    const payload = debtReminderSchema.parse(req.body ?? {});
    const access = await resolveNotificationsAccess(req as any);
    assertCanSendDebtReminder(access.actorRole);

    const ctx = await resolveTeamAccess(req as any);
    const teamId = ctx?.teamId;
    if (!teamId) return res.status(403).json({ detail: "Active team context required" });

    const team = await loadTeam(teamId);
    if (!team) return res.status(404).json({ detail: "Team not found" });

    const debtor = (await getDebtItems(teamId)).find((d) => d.userId === userId);
    if (!debtor) return res.status(400).json({ detail: "Selected user has no debt in current team" });

    const pushSubscriptions = (await resolvePushSubscriptionsByUsers([debtor.userId])).get(debtor.userId) ?? [];
    if (!debtor.telegramId && pushSubscriptions.length === 0) {
      return res.status(400).json({ detail: "User has no Telegram linked and no push subscription" });
    }

    const outcomes = await sendDebtReminders({
      team,
      debtors: [debtor],
      customText: payload.customText,
      type: "MEMBER_DEBT_REMINDER",
      actorUserId: access.userId,
      correlationId: req.correlationId,
    });
    const totals = totalsOf(outcomes);

    await writeAudit(access.userId, "notifications.member_debt_reminder.send", {
      teamId,
      userId,
      ...totals,
      failed: outcomes.filter((o) => o.status === "FAILED").length,
    });
    return res.json(deliveryResponse(outcomes));
  })
);

notificationsRouter.post(
  "/finance/events/:eventId/remind-debtors",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = debtReminderSchema.parse(req.body ?? {});

    const eventResult = await query<{ id: string; team_id: string }>(
      `SELECT e.id, e.team_id FROM events e WHERE e.id = $1 AND e.is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) return res.status(404).json({ detail: "Event not found" });

    const actor = await eventActor(req, eventId);
    if (!actor) return res.status(403).json({ detail: "No access to this team event" });
    const actorRole = actor.role;
    assertCanSendDebtReminder(actorRole);

    const team = await loadTeam(event.team_id);
    if (!team) return res.status(404).json({ detail: "Team not found" });

    const selectedIds = new Set(payload.userIds || []);
    const debtors = (await getDebtItems(event.team_id, eventId)).filter(
      (d) => selectedIds.size === 0 || selectedIds.has(d.userId)
    );
    const outcomes = await sendDebtReminders({
      team,
      debtors,
      customText: payload.customText,
      type: "EVENT_DEBT_REMINDER",
      actorUserId: actor.userId,
      eventId,
      correlationId: req.correlationId,
    });
    const totals = totalsOf(outcomes);

    await writeAudit(actor.userId, "notifications.debt_reminder.send", {
      eventId,
      teamId: event.team_id,
      actorRole,
      attempted: outcomes.length,
      ...totals,
      failed: outcomes.filter((o) => o.status === "FAILED").length,
    });

    return res.json(deliveryResponse(outcomes));
  })
);
