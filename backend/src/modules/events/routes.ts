import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { getActiveContext } from "../teams/context.js";
import { resolveEffectiveRsvp } from "../../lib/series-commitment.js";
import { canMarkAttendance } from "../../lib/attendance-permissions.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_CREATE_HORIZON_DAYS = 365;

const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

const recurrenceSchema = z.object({
  enabled: z.boolean(),
  weekdays: z.array(weekdaySchema).min(1),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const eventCostStatusSchema = z.enum(["UNKNOWN", "ESTIMATED", "FINAL"]);
const eventFinanceStateSchema = z.enum(["NOT_CALCULATED", "COLLECTING", "CLOSED"]);

const createEventSchema = z.object({
  id: z.string().optional(),
  teamId: z.string().optional(),
  type: z.enum(["TRAINING", "TOURNAMENT", "CHAMPIONSHIP", "FRIENDLY_MATCH", "MEETING", "MAINTENANCE", "OTHER"]),
  title: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().optional(),
  startAt: z.string().optional(),
  endDate: z.string().optional(),
  endAt: z.string().optional(),
  location: z.string().optional(),
  cost: z.number().optional(),
  costStatus: eventCostStatusSchema.optional(),
  schedule: z
    .array(
      z.object({
        time: z.string(),
        opponent: z.string(),
        score: z.string().optional(),
        pitZone: z.enum(["NEAR", "FAR"]).optional(),
        gamePair: z.enum(["FIRST", "SECOND"]).optional(),
      })
    )
    .optional(),
  recurrence: recurrenceSchema.optional(),
});

const updateEventSchema = z.object({
  scope: z.enum(["single", "future"]).default("single"),
  type: z.enum(["TRAINING", "TOURNAMENT", "CHAMPIONSHIP", "FRIENDLY_MATCH", "MEETING", "MAINTENANCE", "OTHER"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  startDate: z.string().datetime().optional(),
  startAt: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  location: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  costStatus: eventCostStatusSchema.optional(),
  schedule: z
    .array(
      z.object({
        time: z.string(),
        opponent: z.string(),
        score: z.string().optional(),
        pitZone: z.enum(["NEAR", "FAR"]).optional(),
        gamePair: z.enum(["FIRST", "SECOND"]).optional(),
      })
    )
    .optional(),
});

const deleteEventSchema = z.object({
  scope: z.enum(["single", "future"]).default("single"),
});

// #62: фактическая явка (был/не был). Капитан/штаб отмечает участников.
const attendanceSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().uuid(),
        present: z.boolean(),
      })
    )
    .min(1),
});

const WEEKDAY_TO_ISO: Record<z.infer<typeof weekdaySchema>, number> = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  SUN: 7,
};

const TRAINER_ALLOWED_EVENT_TYPES = new Set(["TRAINING", "MEETING"]);

function parseDateOnlyUtc(dateValue: string): Date {
  const [yearStr, monthStr, dayStr] = dateValue.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function differenceUtcCalendarDays(a: Date, b: Date): number {
  const aStart = startOfUtcDay(a).getTime();
  const bStart = startOfUtcDay(b).getTime();
  return Math.round((aStart - bStart) / DAY_MS);
}

function withUtcTime(date: Date, source: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      0
    )
  );
}

function toOccurrenceDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertCreateHorizon(date: Date) {
  const maxAllowed = new Date(Date.now() + MAX_CREATE_HORIZON_DAYS * DAY_MS);
  if (date.getTime() > maxAllowed.getTime()) {
    throw new Error("MAX_CREATE_HORIZON_EXCEEDED");
  }
}

function parseFlexibleDateTime(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseOptionalUuid(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function resolveCreateCostStatus(payload: { cost?: number; costStatus?: z.infer<typeof eventCostStatusSchema> }) {
  if (payload.cost === undefined) {
    return "UNKNOWN" as const;
  }
  return payload.costStatus ?? "ESTIMATED";
}

function resolveUpdateCostState(params: {
  payloadCost: number | null | undefined;
  payloadCostStatus?: z.infer<typeof eventCostStatusSchema>;
  baseCost: string | null;
  baseCostStatus: z.infer<typeof eventCostStatusSchema>;
}) {
  const nextCost =
    params.payloadCost === undefined ? (params.baseCost !== null ? Number(params.baseCost) : null) : params.payloadCost;

  if (nextCost === null) {
    return { nextCost, nextCostStatus: "UNKNOWN" as const };
  }

  if (params.payloadCostStatus) {
    return { nextCost, nextCostStatus: params.payloadCostStatus };
  }

  if (params.payloadCost !== undefined) {
    return {
      nextCost,
      nextCostStatus: params.baseCostStatus === "UNKNOWN" ? ("ESTIMATED" as const) : params.baseCostStatus,
    };
  }

  return { nextCost, nextCostStatus: params.baseCostStatus };
}

function buildWeeklyOccurrences(params: {
  startDate: Date;
  endDate: Date;
  untilDate: Date;
  weekdays: z.infer<typeof weekdaySchema>[];
}): Array<{ start: Date; end: Date; occurrenceDate: string }> {
  const durationMs = params.endDate.getTime() - params.startDate.getTime();
  const daySet = new Set(params.weekdays.map((day) => WEEKDAY_TO_ISO[day]));
  const firstDay = startOfUtcDay(params.startDate);
  const lastDay = startOfUtcDay(params.untilDate);
  const occurrences: Array<{ start: Date; end: Date; occurrenceDate: string }> = [];

  for (let cursor = firstDay; cursor.getTime() <= lastDay.getTime(); cursor = addUtcDays(cursor, 1)) {
    const isoWeekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (!daySet.has(isoWeekday)) {
      continue;
    }
    const start = withUtcTime(cursor, params.startDate);
    if (start.getTime() < params.startDate.getTime()) {
      continue;
    }
    occurrences.push({
      start,
      end: new Date(start.getTime() + durationMs),
      occurrenceDate: toOccurrenceDate(start),
    });
  }
  return occurrences;
}

async function getMembershipRole(userId: string, teamId: string): Promise<"CAPTAIN" | "TRAINER" | "PLAYER" | null> {
  const membership = await query<{ role: "CAPTAIN" | "TRAINER" | "PLAYER" }>(
    `SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2`,
    [userId, teamId]
  );
  return membership.rows[0]?.role ?? null;
}

export const eventsRouter = Router();

eventsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = createEventSchema.parse(req.body);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    const ctx = await getActiveContext(req);

    const parsedPayloadTeamId = parseOptionalUuid(payload.teamId);
    const teamId = effectiveRole === "ADMIN" ? parsedPayloadTeamId : ctx?.teamId;
    if (effectiveRole === "ADMIN" && !parsedPayloadTeamId) {
      return res.status(400).json({ detail: "Admin must provide valid teamId (uuid)" });
    }
    if (!teamId) {
      return res.status(403).json({ detail: "Active team context required" });
    }

    if (effectiveRole !== "ADMIN" && !ctx) {
      return res.status(403).json({ detail: "Active team context required" });
    }
    if (effectiveRole !== "ADMIN" && ctx?.role === "PLAYER") {
      return res.status(403).json({ detail: "Player cannot create events" });
    }
    if (effectiveRole !== "ADMIN" && ctx?.role === "TRAINER" && !TRAINER_ALLOWED_EVENT_TYPES.has(payload.type)) {
      return res.status(403).json({ detail: "Trainer can manage only training and meeting events" });
    }

    const startAtRaw = payload.startAt ?? payload.startDate;
    if (!startAtRaw) {
      return res.status(400).json({ detail: "Event start time is required" });
    }
    const endAtRaw = payload.endAt ?? payload.endDate;
    const startDate = parseFlexibleDateTime(startAtRaw);
    if (!startDate) {
      return res.status(400).json({ detail: "Invalid event start time" });
    }
    const parsedEndDate = parseFlexibleDateTime(endAtRaw);
    const endDate = parsedEndDate ?? new Date(startDate.getTime() + DEFAULT_EVENT_DURATION_MS);
    if (endDate.getTime() <= startDate.getTime()) {
      return res.status(400).json({ detail: "Event end time must be after start time" });
    }

    try {
      assertCreateHorizon(startDate);
    } catch (_error) {
      return res.status(400).json({ detail: "Events can be created only up to one year ahead" });
    }

    if (payload.recurrence?.enabled && payload.schedule?.length) {
      return res.status(400).json({ detail: "Tournament schedule is not supported for recurring events" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (payload.recurrence?.enabled) {
        const untilDate = parseDateOnlyUtc(payload.recurrence.untilDate);
        if (untilDate.getTime() < startOfUtcDay(startDate).getTime()) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "Repeat-until date must be on or after event date" });
        }
        try {
          assertCreateHorizon(untilDate);
        } catch (_error) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "Repeat-until date cannot exceed one year ahead" });
        }

        const occurrences = buildWeeklyOccurrences({
          startDate,
          endDate,
          untilDate,
          weekdays: payload.recurrence.weekdays,
        });
        if (occurrences.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "No occurrences generated for selected recurrence settings" });
        }

        const seriesInsert = await client.query<{ id: string }>(
          `INSERT INTO event_series (
             team_id, type, title, description, location, cost, cost_status, finance_state,
             start_time_utc, end_time_utc, weekdays, until_date, created_by
           )
           VALUES ($1, $2::event_type, $3, $4, $5, $6, $7::event_cost_status, $8::event_finance_state, $9::time, $10::time, $11::smallint[], $12::date, $13)
           RETURNING id`,
          [
            teamId,
            payload.type,
            payload.title,
            payload.description?.trim() ? payload.description.trim() : null,
            payload.location?.trim() ? payload.location.trim() : null,
            payload.cost ?? null,
            resolveCreateCostStatus(payload),
            "NOT_CALCULATED",
            startDate.toISOString().slice(11, 19),
            endDate.toISOString().slice(11, 19),
            payload.recurrence.weekdays.map((day) => WEEKDAY_TO_ISO[day]),
            payload.recurrence.untilDate,
            req.authUser!.id,
          ]
        );
        const seriesId = seriesInsert.rows[0].id;

        for (const occurrence of occurrences) {
          const created = await client.query<{ id: string }>(
            `INSERT INTO events (team_id, series_id, occurrence_date, type, title, description, start_at, end_at, location, cost, cost_status, finance_state)
             VALUES ($1, $2, $3::date, $4::event_type, $5, $6, $7, $8, $9, $10, $11::event_cost_status, $12::event_finance_state)
             RETURNING id`,
            [
              teamId,
              seriesId,
              occurrence.occurrenceDate,
              payload.type,
              payload.title,
              payload.description?.trim() ? payload.description.trim() : null,
              occurrence.start.toISOString(),
              occurrence.end.toISOString(),
              payload.location?.trim() ? payload.location.trim() : null,
              payload.cost ?? null,
              resolveCreateCostStatus(payload),
              "NOT_CALCULATED",
            ]
          );

        }

        await client.query("COMMIT");
        await writeAudit(req.authUser!.id, "events.create.recurrence", {
          teamId,
          seriesId,
          occurrences: occurrences.length,
          actorTeamRole: effectiveRole === "ADMIN" ? "ADMIN" : ctx?.role || null,
        });
        return res.status(201).json({
          success: true,
          recurring: true,
          occurrences: occurrences.length,
          seriesId,
        });
      }

      const insertEvent = await client.query<{
        id: string;
        team_id: string;
        type: string;
        title: string;
        description: string | null;
        start_at: string;
        end_at: string | null;
        location: string | null;
        cost: string | null;
        cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
        finance_state: z.infer<typeof eventFinanceStateSchema>;
      }>(
        `INSERT INTO events (id, team_id, occurrence_date, type, title, description, start_at, end_at, location, cost, cost_status, finance_state)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::date, $4::event_type, $5, $6, $7, $8, $9, $10, $11::event_cost_status, $12::event_finance_state)
         RETURNING id, team_id, type, title, description, start_at, end_at, location, cost::text, cost_status::text, finance_state::text`,
        [
          parseOptionalUuid(payload.id),
          teamId,
          toOccurrenceDate(startDate),
          payload.type,
          payload.title,
          payload.description?.trim() ? payload.description.trim() : null,
          startDate.toISOString(),
          endDate.toISOString(),
          payload.location?.trim() ? payload.location.trim() : null,
          payload.cost ?? null,
          resolveCreateCostStatus(payload),
          "NOT_CALCULATED",
        ]
      );

      const event = insertEvent.rows[0];

      if (payload.schedule?.length) {
        for (const game of payload.schedule) {
          await client.query(
            `INSERT INTO event_games (event_id, time_label, opponent, score, pit_zone, game_pair)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [event.id, game.time, game.opponent, game.score ?? null, game.pitZone ?? null, game.gamePair ?? null]
          );
        }
      }

      await client.query("COMMIT");

      await writeAudit(req.authUser!.id, "events.create", {
        eventId: event.id,
        teamId,
        actorTeamRole: effectiveRole === "ADMIN" ? "ADMIN" : ctx?.role || null,
      });

      const teamMeta = await query<{ timezone: string }>(`SELECT timezone FROM teams WHERE id = $1`, [teamId]);
      const teamTimezone = teamMeta.rows[0]?.timezone || "Europe/Moscow";

      return res.status(201).json({
        success: true,
        event: {
          id: event.id,
          teamId: event.team_id,
          type: event.type,
          title: event.title,
          description: event.description,
          startAt: event.start_at,
          endAt: event.end_at,
          startDate: event.start_at,
          endDate: event.end_at,
          location: event.location,
          teamTimezone,
          cost: event.cost !== null ? Number(event.cost) : null,
          costStatus: event.cost_status,
          financeState: event.finance_state,
          rsvpStatus: "UNANSWERED",
          attendeesCount: 0,
          isRecurring: false,
          seriesId: null,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

eventsRouter.patch(
  "/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = updateEventSchema.parse(req.body ?? {});
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);

    const baseEventResult = await query<{
      id: string;
      team_id: string;
      series_id: string | null;
      type: string;
      title: string;
      description: string | null;
      start_at: string;
      end_at: string | null;
      location: string | null;
      cost: string | null;
      cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
      finance_state: z.infer<typeof eventFinanceStateSchema>;
    }>(
      `SELECT id, team_id, series_id::text, type::text, title, description, start_at, end_at, location, cost::text, cost_status::text, finance_state::text
       FROM events
       WHERE id = $1 AND is_cancelled = FALSE`,
      [eventId]
    );
    if (!baseEventResult.rowCount) {
      return res.status(404).json({ detail: "Event not found" });
    }

    const baseEvent = baseEventResult.rows[0];
    let actorTeamRole: "CAPTAIN" | "TRAINER" | "PLAYER" | "ADMIN" | null = null;
    if (effectiveRole === "ADMIN") {
      actorTeamRole = "ADMIN";
    } else {
      const role = await getMembershipRole(req.authUser!.id, baseEvent.team_id);
      if (!role) {
        return res.status(403).json({ detail: "You do not have access to this event" });
      }
      actorTeamRole = role;
      if (role === "PLAYER") {
        return res.status(403).json({ detail: "Player cannot edit events" });
      }
    }

    const nextType = payload.type ?? baseEvent.type;
    if (effectiveRole !== "ADMIN" && actorTeamRole === "TRAINER" && !TRAINER_ALLOWED_EVENT_TYPES.has(nextType)) {
      return res.status(403).json({ detail: "Trainer can manage only training and meeting events" });
    }

    const wantsFinancialEdit = payload.cost !== undefined || payload.costStatus !== undefined;
    if (wantsFinancialEdit) {
      if (payload.scope === "future" && baseEvent.series_id) {
        const blockedFuture = await query<{ id: string }>(
          `SELECT id
           FROM events
           WHERE series_id = $1
             AND start_at >= $2
             AND is_cancelled = FALSE
             AND finance_state <> 'NOT_CALCULATED'
           LIMIT 1`,
          [baseEvent.series_id, baseEvent.start_at]
        );
        if (blockedFuture.rowCount) {
          return res.status(409).json({
            detail: "Financial params cannot be edited after collection starts. Create correction transaction instead.",
          });
        }
      } else if (baseEvent.finance_state !== "NOT_CALCULATED") {
        return res.status(409).json({
          detail: "Financial params cannot be edited after collection starts. Create correction transaction instead.",
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (payload.scope === "future" && baseEvent.series_id) {
        if (payload.schedule !== undefined) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "Tournament schedule update is supported only for a single event" });
        }
        const futureRows = await client.query<{
          id: string;
          start_at: string;
          end_at: string | null;
        }>(
          `SELECT id, start_at, end_at
           FROM events
           WHERE series_id = $1 AND start_at >= $2
           ORDER BY start_at ASC`,
          [baseEvent.series_id, baseEvent.start_at]
        );

        const requestedStartRaw = payload.startAt ?? payload.startDate;
        const requestedEndRaw = payload.endAt ?? payload.endDate;
        const requestedStart = requestedStartRaw ? new Date(requestedStartRaw) : null;
        const requestedEnd = requestedEndRaw ? new Date(requestedEndRaw) : null;
        const anchorStart = new Date(baseEvent.start_at);
        const dayShift = requestedStart ? differenceUtcCalendarDays(requestedStart, anchorStart) : 0;
        const explicitDurationMs =
          requestedStart && requestedEnd ? requestedEnd.getTime() - requestedStart.getTime() : null;
        if (explicitDurationMs !== null && explicitDurationMs <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "Event end time must be after start time" });
        }

        const { nextCost, nextCostStatus } = resolveUpdateCostState({
          payloadCost: payload.cost,
          payloadCostStatus: payload.costStatus,
          baseCost: baseEvent.cost,
          baseCostStatus: baseEvent.cost_status,
        });

        for (const row of futureRows.rows) {
          const rowStart = new Date(row.start_at);
          const rowEnd = row.end_at ? new Date(row.end_at) : null;

          let nextStart = rowStart;
          if (requestedStart) {
            const shiftedDay = addUtcDays(startOfUtcDay(rowStart), dayShift);
            nextStart = withUtcTime(shiftedDay, requestedStart);
          }

          let nextEnd: Date;
          if (requestedStart && explicitDurationMs !== null) {
            nextEnd = new Date(nextStart.getTime() + explicitDurationMs);
          } else if (requestedStart && explicitDurationMs === null) {
            const rowDurationMs = rowEnd ? rowEnd.getTime() - rowStart.getTime() : DEFAULT_EVENT_DURATION_MS;
            nextEnd = new Date(nextStart.getTime() + rowDurationMs);
          } else if (!requestedStart && requestedEnd) {
            nextEnd = withUtcTime(nextStart, requestedEnd);
          } else {
            nextEnd = rowEnd ?? new Date(nextStart.getTime() + DEFAULT_EVENT_DURATION_MS);
          }

          if (nextEnd.getTime() <= nextStart.getTime()) {
            await client.query("ROLLBACK");
            return res.status(400).json({ detail: "Event end time must be after start time" });
          }

          await client.query(
            `UPDATE events
             SET type = $2::event_type,
                 title = $3,
                 description = $4,
                 start_at = $5,
                 end_at = $6,
                 occurrence_date = $7::date,
                 location = $8,
                 cost = $9,
                 cost_status = $10::event_cost_status
             WHERE id = $1`,
            [
              row.id,
              nextType,
              payload.title ?? baseEvent.title,
              payload.description === undefined ? baseEvent.description : payload.description,
              nextStart.toISOString(),
              nextEnd.toISOString(),
              toOccurrenceDate(nextStart),
              payload.location === undefined ? baseEvent.location : payload.location,
              nextCost,
              nextCostStatus,
            ]
          );
        }

        await client.query("COMMIT");
        await writeAudit(req.authUser!.id, "events.update.future", {
          eventId,
          seriesId: baseEvent.series_id,
          affectedCount: futureRows.rowCount,
          actorTeamRole,
        });
        return res.json({ success: true, updated: futureRows.rowCount, scope: "future" });
      }

      const singleStartRaw = payload.startAt ?? payload.startDate;
      const singleEndRaw = payload.endAt ?? payload.endDate;
      const nextStart = singleStartRaw ? new Date(singleStartRaw) : new Date(baseEvent.start_at);
      let nextEnd: Date;
      if (singleStartRaw && singleEndRaw) {
        nextEnd = new Date(singleEndRaw);
      } else if (singleStartRaw && !singleEndRaw) {
        const baseDuration = baseEvent.end_at
          ? new Date(baseEvent.end_at).getTime() - new Date(baseEvent.start_at).getTime()
          : DEFAULT_EVENT_DURATION_MS;
        nextEnd = new Date(nextStart.getTime() + baseDuration);
      } else if (!singleStartRaw && singleEndRaw) {
        nextEnd = new Date(singleEndRaw);
      } else {
        nextEnd = baseEvent.end_at ? new Date(baseEvent.end_at) : new Date(nextStart.getTime() + DEFAULT_EVENT_DURATION_MS);
      }

      if (nextEnd.getTime() <= nextStart.getTime()) {
        await client.query("ROLLBACK");
        return res.status(400).json({ detail: "Event end time must be after start time" });
      }

      const { nextCost, nextCostStatus } = resolveUpdateCostState({
        payloadCost: payload.cost,
        payloadCostStatus: payload.costStatus,
        baseCost: baseEvent.cost,
        baseCostStatus: baseEvent.cost_status,
      });

      await client.query(
        `UPDATE events
         SET type = $2::event_type,
             title = $3,
             description = $4,
             start_at = $5,
             end_at = $6,
             occurrence_date = $7::date,
             location = $8,
             cost = $9,
             cost_status = $10::event_cost_status
         WHERE id = $1`,
        [
          eventId,
          nextType,
          payload.title ?? baseEvent.title,
          payload.description === undefined ? baseEvent.description : payload.description,
          nextStart.toISOString(),
          nextEnd.toISOString(),
          toOccurrenceDate(nextStart),
          payload.location === undefined ? baseEvent.location : payload.location,
          nextCost,
          nextCostStatus,
        ]
      );

      if (payload.schedule !== undefined) {
        await client.query(`DELETE FROM event_games WHERE event_id = $1`, [eventId]);
        for (const game of payload.schedule) {
          await client.query(
            `INSERT INTO event_games (event_id, time_label, opponent, score, pit_zone, game_pair)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [eventId, game.time, game.opponent, game.score ?? null, game.pitZone ?? null, game.gamePair ?? null]
          );
        }
      }

      await client.query("COMMIT");
      await writeAudit(req.authUser!.id, "events.update.single", {
        eventId,
        actorTeamRole,
      });
      return res.json({ success: true, updated: 1, scope: "single" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

eventsRouter.get(
  "/:eventId/attendees",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);

    const eventResult = await query<{ id: string; team_id: string; series_id: string | null }>(
      `SELECT id, team_id, series_id::text
       FROM events
       WHERE id = $1 AND is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ detail: "Event not found" });
    }

    if (effectiveRole !== "ADMIN") {
      const membershipRole = await getMembershipRole(req.authUser!.id, event.team_id);
      if (!membershipRole) {
        return res.status(403).json({ detail: "You do not have access to this event" });
      }
    }

    const attendeesResult = await query<{
      user_id: string;
      name: string;
      nickname: string;
      avatar: string | null;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      member_status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
      rsvp_status: "PENDING" | "CONFIRMED" | "DECLINED" | null;
      committed: boolean;
    }>(
      `SELECT u.id AS user_id,
              u.name,
              u.nickname,
              u.avatar,
              tm.role::text AS role,
              tm.status::text AS member_status,
              r.status::text AS rsvp_status,
              (c.id IS NOT NULL) AS committed
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
       LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
       LEFT JOIN event_series_commitment c
         ON c.series_id = $3::uuid AND c.user_id = tm.user_id AND c.status = 'COMMITTED'
       WHERE tm.team_id = $2 AND u.is_active = TRUE`,
      [eventId, event.team_id, event.series_id]
    );

    // #60: эффективный статус = явный ответ на занятие, иначе дефолт от согласия на серию.
    const hasSeries = Boolean(event.series_id);
    const STATUS_ORDER: Record<string, number> = { CONFIRMED: 1, PENDING: 2, UNANSWERED: 3, DECLINED: 4 };
    const attendees = attendeesResult.rows
      .map((row) => ({
        userId: row.user_id,
        name: row.name,
        nickname: row.nickname,
        avatar: row.avatar,
        role: row.role,
        memberStatus: row.member_status,
        rsvpStatus: resolveEffectiveRsvp({
          explicit: row.rsvp_status,
          hasSeries,
          committedToSeries: row.committed,
        }),
      }))
      .sort((a, b) => (STATUS_ORDER[a.rsvpStatus] - STATUS_ORDER[b.rsvpStatus]) || a.name.localeCompare(b.name));

    return res.json({ eventId, attendees });
  })
);

// #60: согласие игрока на серию (generic — любой тип события).
eventsRouter.post(
  "/series/:seriesId/commit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const seriesId = z.string().uuid().parse(req.params.seriesId);
    const seriesResult = await query<{ team_id: string }>(`SELECT team_id FROM event_series WHERE id = $1`, [seriesId]);
    const series = seriesResult.rows[0];
    if (!series) return res.status(404).json({ detail: "Series not found" });

    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);
    if (effectiveRole !== "ADMIN") {
      const role = await getMembershipRole(req.authUser!.id, series.team_id);
      if (!role) return res.status(403).json({ detail: "You are not a member of this team" });
    }

    await query(
      `INSERT INTO event_series_commitment (series_id, user_id, status)
       VALUES ($1, $2, 'COMMITTED')
       ON CONFLICT (series_id, user_id) DO UPDATE SET status = 'COMMITTED', updated_at = now()`,
      [seriesId, req.authUser!.id]
    );
    await writeAudit(req.authUser!.id, "events.series.commit", { seriesId });
    return res.json({ ok: true, committed: true });
  })
);

eventsRouter.delete(
  "/series/:seriesId/commit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const seriesId = z.string().uuid().parse(req.params.seriesId);
    await query(
      `UPDATE event_series_commitment SET status = 'LEFT', updated_at = now()
       WHERE series_id = $1 AND user_id = $2`,
      [seriesId, req.authUser!.id]
    );
    await writeAudit(req.authUser!.id, "events.series.leave", { seriesId });
    return res.json({ ok: true, committed: false });
  })
);

eventsRouter.get(
  "/series/:seriesId/context",
  requireAuth,
  asyncHandler(async (req, res) => {
    const seriesId = z.string().uuid().parse(req.params.seriesId);
    const seriesResult = await query<{ id: string; title: string; type: string }>(
      `SELECT id, title, type::text AS type FROM event_series WHERE id = $1`,
      [seriesId]
    );
    const series = seriesResult.rows[0];
    if (!series) return res.status(404).json({ detail: "Series not found" });

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM events
       WHERE series_id = $1 AND is_cancelled = FALSE AND start_at >= now()`,
      [seriesId]
    );
    const commitResult = await query<{ status: string }>(
      `SELECT status FROM event_series_commitment WHERE series_id = $1 AND user_id = $2`,
      [seriesId, req.authUser!.id]
    );
    return res.json({
      seriesId: series.id,
      title: series.title,
      type: series.type,
      upcomingCount: Number(countResult.rows[0]?.count || 0),
      committed: commitResult.rows[0]?.status === "COMMITTED",
    });
  })
);

// #62: фактическая явка (факт vs намерение). Кто реально был на занятии.
eventsRouter.get(
  "/:eventId/attendance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);

    const eventResult = await query<{ id: string; team_id: string; type: string }>(
      `SELECT id, team_id, type::text AS type FROM events WHERE id = $1 AND is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ detail: "Event not found" });
    }

    const teamRole = effectiveRole === "ADMIN" ? null : await getMembershipRole(req.authUser!.id, event.team_id);
    if (
      !canMarkAttendance({
        isPlatformAdmin: effectiveRole === "ADMIN",
        teamRole,
        eventType: event.type,
      })
    ) {
      return res.status(403).json({ detail: "You cannot view attendance for this event" });
    }

    const result = await query<{ user_id: string; present: boolean; marked_at: string }>(
      `SELECT user_id, present, marked_at FROM event_attendance WHERE event_id = $1`,
      [eventId]
    );
    return res.json({
      eventId,
      attendance: result.rows.map((row) => ({
        userId: row.user_id,
        present: row.present,
        markedAt: row.marked_at,
      })),
    });
  })
);

eventsRouter.post(
  "/:eventId/attendance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = attendanceSchema.parse(req.body ?? {});
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);

    const eventResult = await query<{ id: string; team_id: string; type: string }>(
      `SELECT id, team_id, type::text AS type FROM events WHERE id = $1 AND is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ detail: "Event not found" });
    }

    const teamRole = effectiveRole === "ADMIN" ? null : await getMembershipRole(req.authUser!.id, event.team_id);
    if (
      !canMarkAttendance({
        isPlatformAdmin: effectiveRole === "ADMIN",
        teamRole,
        eventType: event.type,
      })
    ) {
      return res.status(403).json({ detail: "You cannot mark attendance for this event" });
    }

    // Помечаем только тех, кто реально в команде события — защита от чужих userId.
    const memberResult = await query<{ user_id: string }>(
      `SELECT user_id FROM team_memberships WHERE team_id = $1`,
      [event.team_id]
    );
    const teamMemberIds = new Set(memberResult.rows.map((row) => row.user_id));
    const validEntries = payload.entries.filter((entry) => teamMemberIds.has(entry.userId));
    if (validEntries.length === 0) {
      return res.status(400).json({ detail: "No valid team members in attendance entries" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of validEntries) {
        await client.query(
          `INSERT INTO event_attendance (event_id, user_id, present, marked_by, marked_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (event_id, user_id)
           DO UPDATE SET present = EXCLUDED.present, marked_by = EXCLUDED.marked_by, marked_at = now()`,
          [eventId, entry.userId, entry.present, req.authUser!.id]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await writeAudit(req.authUser!.id, "events.attendance.mark", {
      eventId,
      marked: validEntries.length,
    });

    const result = await query<{ user_id: string; present: boolean; marked_at: string }>(
      `SELECT user_id, present, marked_at FROM event_attendance WHERE event_id = $1`,
      [eventId]
    );
    return res.json({
      eventId,
      marked: validEntries.length,
      attendance: result.rows.map((row) => ({
        userId: row.user_id,
        present: row.present,
        markedAt: row.marked_at,
      })),
    });
  })
);

eventsRouter.delete(
  "/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = deleteEventSchema.parse(req.body ?? {});
    const effectiveRole = getEffectiveEntryRole(req, req.authUser!);

    const eventResult = await query<{
      id: string;
      team_id: string;
      series_id: string | null;
      type: string;
      start_at: string;
    }>(
      `SELECT id, team_id, series_id::text, type::text, start_at
       FROM events
       WHERE id = $1 AND is_cancelled = FALSE`,
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) {
      return res.status(404).json({ detail: "Event not found" });
    }

    let actorTeamRole: "CAPTAIN" | "TRAINER" | "PLAYER" | "ADMIN" | null = null;
    if (effectiveRole === "ADMIN") {
      actorTeamRole = "ADMIN";
    } else {
      const role = await getMembershipRole(req.authUser!.id, event.team_id);
      if (!role) {
        return res.status(403).json({ detail: "You do not have access to this event" });
      }
      actorTeamRole = role;
      if (role === "PLAYER") {
        return res.status(403).json({ detail: "Player cannot delete events" });
      }
      if (role === "TRAINER" && !TRAINER_ALLOWED_EVENT_TYPES.has(event.type)) {
        return res.status(403).json({ detail: "Trainer can manage only training and meeting events" });
      }
    }

    if (payload.scope === "future" && event.series_id) {
      const result = await query<{ id: string }>(
        `UPDATE events
         SET is_cancelled = TRUE, updated_at = NOW()
         WHERE series_id = $1
           AND start_at >= $2
           AND is_cancelled = FALSE
         RETURNING id`,
        [event.series_id, event.start_at]
      );

      await writeAudit(req.authUser!.id, "events.delete.future", {
        eventId,
        seriesId: event.series_id,
        affectedCount: result.rowCount,
        actorTeamRole,
      });
      return res.json({ success: true, deleted: result.rowCount, scope: "future" });
    }

    const result = await query<{ id: string }>(
      `UPDATE events
       SET is_cancelled = TRUE, updated_at = NOW()
       WHERE id = $1 AND is_cancelled = FALSE
       RETURNING id`,
      [eventId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ detail: "Event not found" });
    }

    await writeAudit(req.authUser!.id, "events.delete.single", {
      eventId,
      actorTeamRole,
    });
    return res.json({ success: true, deleted: 1, scope: "single" });
  })
);
