import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { canChooseAdminRole, getEffectiveEntryRole } from "../../lib/entry-role.js";
import { writeAudit } from "../../lib/audit.js";
import { getUserMemberships } from "../../lib/permissions.js";
import { env } from "../../config/env.js";
import { type AdminAccess, resolveRequestedTeams } from "../../lib/admin-access.js";
import {
  mergeTeamEventSchedule,
  normalizeEventDomainFields,
  resolveRegistrationFlowStage,
  selectImportedScheduleForTeam,
  selectRegistrationForTeam,
  summarizeRegistrationStatuses,
  type EventRegistrationProjection,
  type EventRegistrationStatus,
  type ImportedTeamScheduleProjection,
} from "../../lib/event-domain.js";

export const adminRouter = Router();

const eventTypeSchema = z.enum([
  "TRAINING",
  "TOURNAMENT",
  "CHAMPIONSHIP",
  "FRIENDLY_MATCH",
  "MEETING",
  "MAINTENANCE",
  "OTHER",
]);
const eventCostStatusSchema = z.enum(["UNKNOWN", "ESTIMATED", "FINAL"]);
const eventOwnerKindSchema = z.enum(["TEAM", "VENUE", "INTEGRATION"]);
const eventSourceKindSchema = z.enum(["MANUAL", "VENUE_API", "INTEGRATION_API"]);
const eventRegistrationStatusSchema = z.enum(["REQUESTED", "CONFIRMED", "WAITLISTED", "REJECTED", "CANCELLED"]);

const adminEventRegistrationSchema = z.object({
  teamId: z.string().uuid().optional(),
  status: eventRegistrationStatusSchema,
  externalRegistrationId: z.string().max(240).optional(),
  confirmedAt: z.string().datetime().optional(),
});

const adminImportedScheduleSchema = z.object({
  time: z.string().min(1).max(40),
  startAt: z.string().datetime().optional(),
  opponent: z.string().min(1).max(200),
  score: z.string().max(40).optional(),
  pitZone: z.enum(["NEAR", "FAR"]).optional(),
  gamePair: z.enum(["FIRST", "SECOND"]).optional(),
  sourceKind: eventSourceKindSchema.optional(),
  sourceProvider: z.string().max(240).optional(),
  sourceExternalGameId: z.string().max(240).optional(),
  publishedAt: z.string().datetime().optional(),
});

const adminEventCreateSchema = z.object({
  teamId: z.string().uuid().optional(),
  type: eventTypeSchema,
  title: z.string().min(1).max(240),
  description: z.string().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  location: z.string().max(240).optional(),
  cost: z.number().nonnegative().optional(),
  costStatus: eventCostStatusSchema.optional(),
  ownerKind: eventOwnerKindSchema.optional(),
  ownerTeamId: z.string().uuid().optional(),
  ownerName: z.string().max(240).optional(),
  sourceKind: eventSourceKindSchema.optional(),
  sourceProvider: z.string().max(240).optional(),
  sourceExternalEventId: z.string().max(240).optional(),
  registration: adminEventRegistrationSchema.optional(),
  importedSchedule: z.array(adminImportedScheduleSchema).optional(),
  schedule: z
    .array(
      z.object({
        time: z.string().min(1).max(40),
        opponent: z.string().min(1).max(200),
        score: z.string().max(40).optional(),
        pitZone: z.enum(["NEAR", "FAR"]).optional(),
        gamePair: z.enum(["FIRST", "SECOND"]).optional(),
      })
    )
    .optional(),
});

const adminEventPatchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  description: z.string().max(2000).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
  location: z.string().max(240).nullable().optional(),
  isCancelled: z.boolean().optional(),
  cost: z.number().nonnegative().nullable().optional(),
  costStatus: eventCostStatusSchema.optional(),
  registrationStatus: eventRegistrationStatusSchema.optional(),
  externalRegistrationId: z.string().max(240).nullable().optional(),
  importedSchedule: z.array(adminImportedScheduleSchema).optional(),
  schedule: z
    .array(
      z.object({
        time: z.string().min(1).max(40),
        opponent: z.string().min(1).max(200),
        score: z.string().max(40).optional(),
        pitZone: z.enum(["NEAR", "FAR"]).optional(),
        gamePair: z.enum(["FIRST", "SECOND"]).optional(),
      })
    )
    .optional(),
});

const patchUserSchema = z
  .object({
    accountRole: z.enum(["ADMIN", "USER"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.accountRole !== undefined || v.isActive !== undefined, {
    message: "Nothing to update",
  });

const patchMembershipSchema = z
  .object({
    teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]).optional(),
    status: z.enum(["ACTIVE", "INJURED", "RESERVE", "VACATION"]).optional(),
  })
  .refine((v) => v.teamRole !== undefined || v.status !== undefined, {
    message: "Nothing to update",
  });

function parseOptionalUuid(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const parsed = z.string().uuid().safeParse(input);
  return parsed.success ? parsed.data : null;
}

function ensureDuration(startAt: Date, endAt: Date | null | undefined): Date {
  if (!endAt) return new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
  return endAt;
}

async function resolveAdminAccess(req: Parameters<typeof requireAuth>[0]): Promise<AdminAccess | null> {
  const user = req.authUser!;
  const effectiveRole = getEffectiveEntryRole(req, user);
  const memberships = await getUserMemberships(user.id);
  const captainedTeamIds = Array.from(new Set(memberships.filter((m) => m.role === "CAPTAIN").map((m) => m.team_id)));

  const oidcReady = !env.telegramOidc.adminRequired || req.session.authMethod === "OIDC";
  if (!oidcReady) return null;

  if (effectiveRole === "ADMIN" && canChooseAdminRole(user)) {
    const teams = await query<{ id: string }>(`SELECT id FROM teams ORDER BY name ASC`);
    return {
      scope: "PLATFORM",
      managedTeamIds: teams.rows.map((t) => t.id),
      userId: user.id,
    };
  }

  if (captainedTeamIds.length > 0) {
    return {
      scope: "TEAM",
      managedTeamIds: captainedTeamIds,
      userId: user.id,
    };
  }

  return null;
}

async function requireAdminAccess(req: Parameters<typeof requireAuth>[0], res: any): Promise<AdminAccess | null> {
  const access = await resolveAdminAccess(req);
  if (!access) {
    res.status(403).json({ detail: "Admin access required", code: "FORBIDDEN" });
    return null;
  }
  return access;
}

type RegistrationRow = {
  id: string;
  event_id: string;
  team_id: string;
  status: EventRegistrationStatus;
  requested_at: string;
  confirmed_at: string | null;
  external_registration_id: string | null;
  confirmed_by_user_id: string | null;
};

type ImportedScheduleRow = {
  id: string;
  event_id: string;
  team_id: string;
  time_label: string;
  starts_at: string | null;
  opponent: string;
  score: string | null;
  pit_zone: "NEAR" | "FAR" | null;
  game_pair: "FIRST" | "SECOND" | null;
  source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
  source_provider: string | null;
  source_external_game_id: string | null;
  published_at: string;
};

function mapRegistrationRow(row: RegistrationRow): EventRegistrationProjection {
  return {
    id: row.id,
    teamId: row.team_id,
    status: row.status,
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at,
    externalRegistrationId: row.external_registration_id,
    confirmedByUserId: row.confirmed_by_user_id,
  };
}

function mapImportedScheduleRow(row: ImportedScheduleRow): ImportedTeamScheduleProjection {
  return {
    id: row.id,
    teamId: row.team_id,
    time: row.time_label,
    startAt: row.starts_at,
    opponent: row.opponent,
    score: row.score ?? undefined,
    pitZone: row.pit_zone ?? undefined,
    gamePair: row.game_pair ?? undefined,
    sourceKind: row.source_kind,
    sourceProvider: row.source_provider,
    sourceExternalGameId: row.source_external_game_id,
    publishedAt: row.published_at,
  };
}

async function upsertEventRegistration(
  client: Pick<PoolClient, "query">,
  params: {
    eventId: string;
    teamId: string;
    status: EventRegistrationStatus;
    externalRegistrationId?: string | null;
    externalRegistrationIdProvided: boolean;
    confirmedAt?: string;
    confirmedByUserId: string;
  }
): Promise<EventRegistrationProjection> {
  const confirmedAt = params.status === "CONFIRMED" ? params.confirmedAt ?? new Date().toISOString() : null;
  const confirmedByUserId = params.status === "CONFIRMED" ? params.confirmedByUserId : null;
  const result = await client.query<RegistrationRow>(
    `INSERT INTO event_team_registrations (
       event_id,
       team_id,
       status,
       external_registration_id,
       confirmed_at,
       confirmed_by_user_id
     )
     VALUES ($1, $2, $3::event_registration_status, $4, $5::timestamptz, $6)
     ON CONFLICT (event_id, team_id) DO UPDATE
       SET status = EXCLUDED.status,
           external_registration_id = CASE
             WHEN $7::boolean THEN $4
             ELSE event_team_registrations.external_registration_id
           END,
           confirmed_at = CASE
             WHEN EXCLUDED.status = 'CONFIRMED'::event_registration_status THEN EXCLUDED.confirmed_at
             ELSE NULL
           END,
           confirmed_by_user_id = CASE
             WHEN EXCLUDED.status = 'CONFIRMED'::event_registration_status THEN EXCLUDED.confirmed_by_user_id
             ELSE NULL
           END,
           updated_at = NOW()
     RETURNING id, event_id, team_id, status::text, requested_at, confirmed_at, external_registration_id, confirmed_by_user_id`,
    [
      params.eventId,
      params.teamId,
      params.status,
      params.externalRegistrationId ?? null,
      confirmedAt,
      confirmedByUserId,
      params.externalRegistrationIdProvided,
    ]
  );

  return mapRegistrationRow(result.rows[0]);
}

async function replaceImportedSchedule(
  client: Pick<PoolClient, "query">,
  params: {
    eventId: string;
    teamId: string;
    registrationId: string | null;
    defaultSourceKind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
    defaultSourceProvider?: string | null;
    items: Array<z.infer<typeof adminImportedScheduleSchema>>;
  }
): Promise<ImportedTeamScheduleProjection[]> {
  await client.query(`DELETE FROM event_team_schedule_items WHERE event_id = $1 AND team_id = $2`, [
    params.eventId,
    params.teamId,
  ]);

  if (params.items.length === 0) {
    return [];
  }

  const inserted: ImportedTeamScheduleProjection[] = [];
  for (const item of params.items) {
    const row = await client.query<ImportedScheduleRow>(
      `INSERT INTO event_team_schedule_items (
         event_id,
         team_id,
         registration_id,
         time_label,
         starts_at,
         opponent,
         score,
         pit_zone,
         game_pair,
         source_kind,
         source_provider,
         source_external_game_id,
         published_at
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5::timestamptz,
         $6,
         $7,
         $8,
         $9,
         $10::event_source_kind,
         $11,
         $12,
         $13::timestamptz
       )
       RETURNING
         id,
         event_id,
         team_id,
         time_label,
         starts_at,
         opponent,
         score,
         pit_zone::text,
         game_pair::text,
         source_kind::text,
         source_provider,
         source_external_game_id,
         published_at`,
      [
        params.eventId,
        params.teamId,
        params.registrationId,
        item.time,
        item.startAt ?? null,
        item.opponent,
        item.score ?? null,
        item.pitZone ?? null,
        item.gamePair ?? null,
        item.sourceKind ?? params.defaultSourceKind,
        item.sourceProvider ?? params.defaultSourceProvider ?? null,
        item.sourceExternalGameId ?? null,
        item.publishedAt ?? new Date().toISOString(),
      ]
    );
    inserted.push(mapImportedScheduleRow(row.rows[0]));
  }

  return inserted;
}

// --- Legacy admin routes (compat) ---

function ensureOwnerAdmin(req: Parameters<typeof requireAuth>[0]) {
  const user = req.authUser!;
  const effectiveRole = getEffectiveEntryRole(req, user);
  if (effectiveRole !== "ADMIN" || !canChooseAdminRole(user)) {
    return false;
  }
  return true;
}

adminRouter.get(
  "/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }

    const users = await query<{
      id: string;
      username: string | null;
      name: string;
      nickname: string;
      account_role: "ADMIN" | "USER" | null;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT id, username, name, nickname, account_role, is_active, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const teams = await query<{
      id: string;
      name: string;
      short_code: string;
      budget: string;
      created_at: string;
      members_count: string;
      captains_count: string;
    }>(
      `SELECT t.id, t.name, t.short_code, t.budget::text, t.created_at,
              COUNT(tm.id)::text AS members_count,
              COUNT(*) FILTER (WHERE tm.role = 'CAPTAIN')::text AS captains_count
       FROM teams t
       LEFT JOIN team_memberships tm ON tm.team_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT 200`
    );

    const memberships = await query<{
      id: string;
      team_id: string;
      team_name: string;
      user_id: string;
      username: string | null;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
      created_at: string;
    }>(
      `SELECT tm.id, tm.team_id, t.name AS team_name, tm.user_id, u.username, tm.role::text, tm.status::text, tm.created_at
       FROM team_memberships tm
       JOIN teams t ON t.id = tm.team_id
       JOIN users u ON u.id = tm.user_id
       ORDER BY tm.created_at DESC
       LIMIT 400`
    );

    const invites = await query<{
      id: string;
      token: string;
      team_id: string;
      team_name: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      expires_at: string;
      used_at: string | null;
      is_revoked: boolean;
      created_at: string;
    }>(
      `SELECT i.id, i.token::text, i.team_id, t.name AS team_name, i.role::text, i.expires_at, i.used_at, i.is_revoked, i.created_at
       FROM team_invites i
       JOIN teams t ON t.id = i.team_id
       ORDER BY i.created_at DESC
       LIMIT 400`
    );

    return res.json({
      users: users.rows,
      teams: teams.rows.map((t) => ({
        ...t,
        budget: Number(t.budget),
        members_count: Number(t.members_count),
        captains_count: Number(t.captains_count),
      })),
      memberships: memberships.rows,
      invites: invites.rows,
    });
  })
);

adminRouter.patch(
  "/users/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const userId = z.string().uuid().parse(req.params.userId);
    const payload = patchUserSchema.parse(req.body);

    const updated = await query(
      `UPDATE users
       SET account_role = COALESCE($2::account_role, account_role),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [userId, payload.accountRole ?? null, payload.isActive ?? null]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "User not found" });
    }

    await writeAudit(req.authUser!.id, "admin.user.patch", { userId, payload });
    return res.json({ ok: true });
  })
);

adminRouter.delete(
  "/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const deleted = await query(`DELETE FROM team_memberships WHERE id = $1 RETURNING id`, [membershipId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }
    await writeAudit(req.authUser!.id, "admin.membership.delete", { membershipId });
    return res.json({ ok: true });
  })
);

adminRouter.patch(
  "/invites/:inviteId/revoke",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const inviteId = z.string().uuid().parse(req.params.inviteId);
    const updated = await query(
      `UPDATE team_invites
       SET is_revoked = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [inviteId]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "Invite not found" });
    }
    await writeAudit(req.authUser!.id, "admin.invite.revoke", { inviteId });
    return res.json({ ok: true });
  })
);

adminRouter.delete(
  "/teams/:teamId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureOwnerAdmin(req)) {
      return res.status(403).json({ detail: "Owner admin access required" });
    }
    const teamId = z.string().uuid().parse(req.params.teamId);
    const deleted = await query(`DELETE FROM teams WHERE id = $1 RETURNING id`, [teamId]);
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }
    await writeAudit(req.authUser!.id, "admin.team.delete", { teamId });
    return res.json({ ok: true });
  })
);

// --- Admin v1 routes ---

adminRouter.get(
  "/v1/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;

    const requestedTeamId = parseOptionalUuid(req.query.teamId);
    const teamIds = resolveRequestedTeams(access, requestedTeamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const teamsCountResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM teams WHERE id = ANY($1::uuid[])`,
      [teamIds]
    );
    const membersCountResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM team_memberships WHERE team_id = ANY($1::uuid[])`,
      [teamIds]
    );
    const upcomingEventsResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE team_id = ANY($1::uuid[])
         AND is_cancelled = FALSE
         AND start_at >= NOW()
         AND start_at < NOW() + INTERVAL '30 days'`,
      [teamIds]
    );
    const rsvpCompletionResult = await query<{ completion: string }>(
      `SELECT COALESCE(AVG(per_event.completion_ratio), 0)::text AS completion
       FROM (
         SELECT e.id,
                CASE
                  WHEN tm.members_count = 0 THEN 0
                  ELSE COALESCE(r.answered_count, 0)::numeric / tm.members_count
                END AS completion_ratio
         FROM events e
         JOIN (
           SELECT team_id, COUNT(*)::numeric AS members_count
           FROM team_memberships
           WHERE team_id = ANY($1::uuid[])
           GROUP BY team_id
         ) tm ON tm.team_id = e.team_id
         LEFT JOIN (
           SELECT event_id, COUNT(*)::numeric AS answered_count
           FROM rsvps
           WHERE status IN ('CONFIRMED', 'PENDING', 'DECLINED')
           GROUP BY event_id
         ) r ON r.event_id = e.id
         WHERE e.team_id = ANY($1::uuid[])
           AND e.is_cancelled = FALSE
           AND e.start_at >= NOW() - INTERVAL '30 days'
       ) per_event`,
      [teamIds]
    );

    const remindersResult = await query<{ attempted: string; sent: string; queued: string; failed: string }>(
      `SELECT
         COALESCE(SUM((payload->>'attempted')::int), 0)::text AS attempted,
         COALESCE(SUM((payload->>'sent')::int), 0)::text AS sent,
         COALESCE(SUM((payload->>'queued')::int), 0)::text AS queued,
         COALESCE(SUM((payload->>'failed')::int), 0)::text AS failed
       FROM audit_logs
       WHERE action = 'notifications.event_reminder.send'
         AND created_at >= NOW() - INTERVAL '30 days'
         AND (
           payload->>'teamId' IS NOT NULL
           AND payload->>'teamId' = ANY($1::text[])
         )`,
      [teamIds]
    );

    const attempted = Number(remindersResult.rows[0]?.attempted || 0);
    const sent = Number(remindersResult.rows[0]?.sent || 0);
    const queued = Number(remindersResult.rows[0]?.queued || 0);
    const failed = Number(remindersResult.rows[0]?.failed || 0);
    const reminderSuccessRate = attempted > 0 ? sent / attempted : 1;

    return res.json({
      scope: access.scope,
      teamIds,
      summary: {
        teamsCount: Number(teamsCountResult.rows[0]?.count || 0),
        membersCount: Number(membersCountResult.rows[0]?.count || 0),
        upcomingEventsCount: Number(upcomingEventsResult.rows[0]?.count || 0),
        rsvpCompletionRate: Number(rsvpCompletionResult.rows[0]?.completion || 0),
        reminderDelivery: {
          attempted,
          sent,
          queued,
          failed,
          successRate: reminderSuccessRate,
        },
      },
    });
  })
);

adminRouter.get(
  "/v1/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;

    const requestedTeamId = parseOptionalUuid(req.query.teamId);
    const teamIds = resolveRequestedTeams(access, requestedTeamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";

    const eventsResult = await query<{
      id: string;
      team_id: string;
      type: string;
      title: string;
      description: string | null;
      start_at: string;
      end_at: string | null;
      location: string | null;
      is_cancelled: boolean;
      cost: string | null;
      cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
      finance_state: "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
      owner_kind: "TEAM" | "VENUE" | "INTEGRATION";
      owner_team_id: string | null;
      owner_name: string | null;
      source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
      source_provider: string | null;
      source_external_event_id: string | null;
      created_at: string;
      total_count: string;
    }>(
      `SELECT
         e.id,
         e.team_id,
         e.type::text,
         e.title,
         e.description,
         e.start_at,
         e.end_at,
         e.location,
         e.is_cancelled,
         e.cost::text,
         e.cost_status::text,
         e.finance_state::text,
         e.owner_kind::text,
         e.owner_team_id,
         e.owner_name,
         e.source_kind::text,
         e.source_provider,
         e.source_external_event_id,
         e.created_at,
         COUNT(*) OVER()::text AS total_count
       FROM events e
       WHERE e.team_id = ANY($1::uuid[])
         AND ($2::text = '' OR e.title ILIKE '%' || $2 || '%' OR COALESCE(e.description, '') ILIKE '%' || $2 || '%')
         AND ($3::text = '' OR e.start_at >= $3::timestamptz)
         AND ($4::text = '' OR e.start_at <= $4::timestamptz)
       ORDER BY e.start_at DESC
       LIMIT $5 OFFSET $6`,
      [teamIds, q, from, to, limit, offset]
    );

    const eventIds = eventsResult.rows.map((e) => e.id);
    const gamesMap = new Map<
      string,
      Array<{ id: string; time: string; opponent: string; score?: string; pitZone?: "NEAR" | "FAR"; gamePair?: "FIRST" | "SECOND" }>
    >();
    const registrationsByEvent = new Map<string, EventRegistrationProjection[]>();
    const importedByEvent = new Map<string, ImportedTeamScheduleProjection[]>();
    if (eventIds.length > 0) {
      const gamesResult = await query<{
        id: string;
        event_id: string;
        time_label: string;
        opponent: string;
        score: string | null;
        pit_zone: "NEAR" | "FAR" | null;
        game_pair: "FIRST" | "SECOND" | null;
      }>(
        `SELECT id, event_id, time_label, opponent, score, pit_zone::text, game_pair::text
         FROM event_games
         WHERE event_id = ANY($1::uuid[])
         ORDER BY time_label ASC`,
        [eventIds]
      );
      for (const row of gamesResult.rows) {
        const list = gamesMap.get(row.event_id) || [];
        list.push({
          id: row.id,
          time: row.time_label,
          opponent: row.opponent,
          score: row.score || undefined,
          pitZone: row.pit_zone || undefined,
          gamePair: row.game_pair || undefined,
        });
        gamesMap.set(row.event_id, list);
      }

      const registrationsResult = await query<RegistrationRow>(
        `SELECT id, event_id, team_id, status::text, requested_at, confirmed_at, external_registration_id, confirmed_by_user_id
         FROM event_team_registrations
         WHERE event_id = ANY($1::uuid[])`,
        [eventIds]
      );
      for (const row of registrationsResult.rows) {
        const list = registrationsByEvent.get(row.event_id) || [];
        list.push(mapRegistrationRow(row));
        registrationsByEvent.set(row.event_id, list);
      }

      const importedScheduleResult = await query<ImportedScheduleRow>(
        `SELECT
           id,
           event_id,
           team_id,
           time_label,
           starts_at,
           opponent,
           score,
           pit_zone::text,
           game_pair::text,
           source_kind::text,
           source_provider,
           source_external_game_id,
           published_at
         FROM event_team_schedule_items
         WHERE event_id = ANY($1::uuid[])
           AND team_id = ANY($2::uuid[])
         ORDER BY COALESCE(starts_at, published_at) ASC, time_label ASC`,
        [eventIds, teamIds]
      );
      for (const row of importedScheduleResult.rows) {
        const list = importedByEvent.get(row.event_id) || [];
        list.push(mapImportedScheduleRow(row));
        importedByEvent.set(row.event_id, list);
      }
    }

    return res.json({
      items: eventsResult.rows.map((e) => {
        const eventRegistrations = registrationsByEvent.get(e.id) || [];
        const selectedRegistration = selectRegistrationForTeam(eventRegistrations, e.team_id);
        const registrationSummary = summarizeRegistrationStatuses(eventRegistrations);
        const importedSchedule = selectImportedScheduleForTeam(importedByEvent.get(e.id) || [], e.team_id);
        const schedule = mergeTeamEventSchedule(gamesMap.get(e.id) || [], importedSchedule);

        return {
          id: e.id,
          teamId: e.team_id,
          type: e.type,
          title: e.title,
          description: e.description,
          startAt: e.start_at,
          endAt: e.end_at,
          location: e.location,
          isCancelled: e.is_cancelled,
          cost: e.cost === null ? null : Number(e.cost),
          costStatus: e.cost_status,
          financeState: e.finance_state,
          ownerKind: e.owner_kind,
          ownerTeamId: e.owner_team_id,
          ownerName: e.owner_name,
          sourceKind: e.source_kind,
          sourceProvider: e.source_provider,
          sourceExternalEventId: e.source_external_event_id,
          registration: selectedRegistration,
          registrationSummary,
          importedSchedule,
          createdAt: e.created_at,
          schedule,
        };
      }),
      total: Number(eventsResult.rows[0]?.total_count || 0),
      limit,
      offset,
    });
  })
);

adminRouter.post(
  "/v1/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;

    const payload = adminEventCreateSchema.parse(req.body ?? {});
    const requestedTeamId = payload.teamId || null;
    const teamIds = resolveRequestedTeams(access, requestedTeamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }
    const teamId = teamIds[0];

    const domainFields = normalizeEventDomainFields({
      teamId,
      ownerKind: payload.ownerKind,
      ownerTeamId: payload.ownerTeamId ?? null,
      ownerName: payload.ownerName ?? null,
      sourceKind: payload.sourceKind,
      sourceProvider: payload.sourceProvider ?? null,
      sourceExternalEventId: payload.sourceExternalEventId ?? null,
    });
    if (domainFields.ownerKind === "TEAM" && domainFields.ownerTeamId) {
      const ownerTeamAccess = resolveRequestedTeams(access, domainFields.ownerTeamId);
      if (ownerTeamAccess.length === 0) {
        return res.status(403).json({ detail: "Owner team access denied" });
      }
    }

    const startAt = new Date(payload.startAt);
    const endAt = ensureDuration(startAt, payload.endAt ? new Date(payload.endAt) : null);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      return res.status(400).json({ detail: "Invalid event date range" });
    }
    if (payload.registration?.teamId && payload.registration.teamId !== teamId) {
      return res.status(400).json({ detail: "registration.teamId must match event teamId in v1" });
    }

    const client = await pool.connect();
    let registrationProjection: EventRegistrationProjection | null = null;
    let importedScheduleProjection: ImportedTeamScheduleProjection[] = [];
    try {
      await client.query("BEGIN");
      const eventInsert = await client.query<{
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
        finance_state: "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
        owner_kind: "TEAM" | "VENUE" | "INTEGRATION";
        owner_team_id: string | null;
        owner_name: string | null;
        source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
        source_provider: string | null;
        source_external_event_id: string | null;
      }>(
        `INSERT INTO events (
           team_id,
           type,
           title,
           description,
           start_at,
           end_at,
           location,
           cost,
           cost_status,
           owner_kind,
           owner_team_id,
           owner_name,
           source_kind,
           source_provider,
           source_external_event_id
         )
         VALUES (
           $1,
           $2::event_type,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9::event_cost_status,
           $10::event_owner_kind,
           $11,
           $12,
           $13::event_source_kind,
           $14,
           $15
         )
         RETURNING
           id,
           team_id,
           type::text,
           title,
           description,
           start_at,
           end_at,
           location,
           cost::text,
           cost_status::text,
           finance_state::text,
           owner_kind::text,
           owner_team_id,
           owner_name,
           source_kind::text,
           source_provider,
           source_external_event_id`,
        [
          teamId,
          payload.type,
          payload.title,
          payload.description ?? null,
          startAt.toISOString(),
          endAt.toISOString(),
          payload.location ?? null,
          payload.cost ?? null,
          payload.cost === undefined ? "UNKNOWN" : payload.costStatus ?? "ESTIMATED",
          domainFields.ownerKind,
          domainFields.ownerTeamId,
          domainFields.ownerName,
          domainFields.sourceKind,
          domainFields.sourceProvider,
          domainFields.sourceExternalEventId,
        ]
      );
      const created = eventInsert.rows[0];

      await client.query(
        `INSERT INTO rsvps (event_id, user_id, status)
         SELECT $1, tm.user_id, 'PENDING'::rsvp_status
         FROM team_memberships tm
         WHERE tm.team_id = $2
         ON CONFLICT (event_id, user_id) DO NOTHING`,
        [created.id, teamId]
      );

      if (payload.schedule?.length) {
        for (const game of payload.schedule) {
          await client.query(
            `INSERT INTO event_games (event_id, time_label, opponent, score, pit_zone, game_pair)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [created.id, game.time, game.opponent, game.score ?? null, game.pitZone ?? null, game.gamePair ?? null]
          );
        }
      }

      const registrationStatus = payload.registration?.status ?? (domainFields.ownerKind === "TEAM" ? "CONFIRMED" : "REQUESTED");
      registrationProjection = await upsertEventRegistration(client, {
        eventId: created.id,
        teamId,
        status: registrationStatus,
        externalRegistrationId: payload.registration?.externalRegistrationId ?? null,
        externalRegistrationIdProvided: payload.registration?.externalRegistrationId !== undefined,
        confirmedAt: payload.registration?.confirmedAt,
        confirmedByUserId: req.authUser!.id,
      });

      if (payload.importedSchedule) {
        importedScheduleProjection = await replaceImportedSchedule(client, {
          eventId: created.id,
          teamId,
          registrationId: registrationProjection.id,
          defaultSourceKind: domainFields.sourceKind,
          defaultSourceProvider: domainFields.sourceProvider,
          items: payload.importedSchedule,
        });
      }

      await client.query("COMMIT");
      await writeAudit(req.authUser!.id, "admin.v1.events.create", {
        eventId: created.id,
        teamId,
        ownerKind: created.owner_kind,
        sourceKind: created.source_kind,
        scheduleSize: payload.schedule?.length || 0,
      });
      await writeAudit(req.authUser!.id, "admin.v1.events.registration.upsert", {
        eventId: created.id,
        teamId,
        registrationId: registrationProjection.id,
        registrationStatus: registrationProjection.status,
        externalRegistrationId: registrationProjection.externalRegistrationId ?? null,
        flowStage: resolveRegistrationFlowStage("admin.v1.events.registration.upsert", {
          registrationStatus: registrationProjection.status,
        }),
      });
      if (payload.importedSchedule) {
        await writeAudit(req.authUser!.id, "admin.v1.events.schedule.import", {
          eventId: created.id,
          teamId,
          registrationId: registrationProjection.id,
          importedItems: importedScheduleProjection.length,
          flowStage: resolveRegistrationFlowStage("admin.v1.events.schedule.import", {}),
        });
      }

      return res.status(201).json({
        event: {
          id: created.id,
          teamId: created.team_id,
          type: created.type,
          title: created.title,
          description: created.description,
          startAt: created.start_at,
          endAt: created.end_at,
          location: created.location,
          cost: created.cost === null ? null : Number(created.cost),
          costStatus: created.cost_status,
          financeState: created.finance_state,
          ownerKind: created.owner_kind,
          ownerTeamId: created.owner_team_id,
          ownerName: created.owner_name,
          sourceKind: created.source_kind,
          sourceProvider: created.source_provider,
          sourceExternalEventId: created.source_external_event_id,
          registration: registrationProjection,
          registrationSummary: summarizeRegistrationStatuses([{ status: registrationProjection.status }]),
          importedSchedule: importedScheduleProjection,
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

adminRouter.patch(
  "/v1/events/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;
    const eventId = z.string().uuid().parse(req.params.eventId);
    const payload = adminEventPatchSchema.parse(req.body ?? {});

    const existingResult = await query<{
      id: string;
      team_id: string;
      cost: string | null;
      cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
      source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
      source_provider: string | null;
    }>(
      `SELECT id, team_id, cost::text, cost_status::text, source_kind::text, source_provider
       FROM events
       WHERE id = $1`,
      [eventId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ detail: "Event not found" });
    }
    const teamIds = resolveRequestedTeams(access, existing.team_id);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const nextCost =
      payload.cost === undefined ? (existing.cost === null ? null : Number(existing.cost)) : payload.cost;
    const nextCostStatus =
      nextCost === null ? "UNKNOWN" : payload.costStatus ?? (existing.cost_status === "UNKNOWN" ? "ESTIMATED" : existing.cost_status);
    const existingRegistrationResult = await query<RegistrationRow>(
      `SELECT id, event_id, team_id, status::text, requested_at, confirmed_at, external_registration_id, confirmed_by_user_id
       FROM event_team_registrations
       WHERE event_id = $1 AND team_id = $2`,
      [eventId, existing.team_id]
    );
    let registrationProjection = existingRegistrationResult.rows[0]
      ? mapRegistrationRow(existingRegistrationResult.rows[0])
      : null;

    const client = await pool.connect();
    let importedScheduleProjection: ImportedTeamScheduleProjection[] = [];
    try {
      await client.query("BEGIN");
      const updated = await client.query<{
        id: string;
        team_id: string;
        type: string;
        title: string;
        description: string | null;
        start_at: string;
        end_at: string | null;
        location: string | null;
        is_cancelled: boolean;
        cost: string | null;
        cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
        finance_state: "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
        owner_kind: "TEAM" | "VENUE" | "INTEGRATION";
        owner_team_id: string | null;
        owner_name: string | null;
        source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
        source_provider: string | null;
        source_external_event_id: string | null;
      }>(
        `UPDATE events
         SET title = COALESCE($2, title),
             description = COALESCE($3, description),
             start_at = COALESCE($4::timestamptz, start_at),
             end_at = COALESCE($5::timestamptz, end_at),
             location = COALESCE($6, location),
             is_cancelled = COALESCE($7, is_cancelled),
             cost = $8,
             cost_status = $9::event_cost_status,
             updated_at = NOW()
         WHERE id = $1
         RETURNING
           id,
           team_id,
           type::text,
           title,
           description,
           start_at,
           end_at,
           location,
           is_cancelled,
           cost::text,
           cost_status::text,
           finance_state::text,
           owner_kind::text,
           owner_team_id,
           owner_name,
           source_kind::text,
           source_provider,
           source_external_event_id`,
        [
          eventId,
          payload.title ?? null,
          payload.description ?? null,
          payload.startAt ?? null,
          payload.endAt ?? null,
          payload.location ?? null,
          payload.isCancelled ?? null,
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

      const shouldUpsertRegistration =
        payload.registrationStatus !== undefined || payload.externalRegistrationId !== undefined;
      if (shouldUpsertRegistration) {
        const status = payload.registrationStatus ?? registrationProjection?.status ?? "REQUESTED";
        registrationProjection = await upsertEventRegistration(client, {
          eventId,
          teamId: existing.team_id,
          status,
          externalRegistrationId: payload.externalRegistrationId ?? null,
          externalRegistrationIdProvided: payload.externalRegistrationId !== undefined,
          confirmedByUserId: req.authUser!.id,
        });
      }

      if (payload.importedSchedule !== undefined) {
        if (!registrationProjection) {
          registrationProjection = await upsertEventRegistration(client, {
            eventId,
            teamId: existing.team_id,
            status: payload.registrationStatus ?? "REQUESTED",
            externalRegistrationIdProvided: false,
            confirmedByUserId: req.authUser!.id,
          });
        }
        importedScheduleProjection = await replaceImportedSchedule(client, {
          eventId,
          teamId: existing.team_id,
          registrationId: registrationProjection.id,
          defaultSourceKind: updated.rows[0].source_kind,
          defaultSourceProvider: updated.rows[0].source_provider,
          items: payload.importedSchedule,
        });
      }

      await client.query("COMMIT");

      await writeAudit(req.authUser!.id, "admin.v1.events.patch", {
        eventId,
        teamId: existing.team_id,
        fields: Object.keys(payload),
      });
      if (shouldUpsertRegistration && registrationProjection) {
        await writeAudit(req.authUser!.id, "admin.v1.events.registration.upsert", {
          eventId,
          teamId: existing.team_id,
          registrationId: registrationProjection.id,
          registrationStatus: registrationProjection.status,
          externalRegistrationId: registrationProjection.externalRegistrationId ?? null,
          flowStage: resolveRegistrationFlowStage("admin.v1.events.registration.upsert", {
            registrationStatus: registrationProjection.status,
          }),
        });
      }
      if (payload.importedSchedule !== undefined) {
        await writeAudit(req.authUser!.id, "admin.v1.events.schedule.import", {
          eventId,
          teamId: existing.team_id,
          registrationId: registrationProjection?.id ?? null,
          importedItems: importedScheduleProjection.length,
          flowStage: resolveRegistrationFlowStage("admin.v1.events.schedule.import", {}),
        });
      }

      return res.json({
        event: {
          id: updated.rows[0].id,
          teamId: updated.rows[0].team_id,
          type: updated.rows[0].type,
          title: updated.rows[0].title,
          description: updated.rows[0].description,
          startAt: updated.rows[0].start_at,
          endAt: updated.rows[0].end_at,
          location: updated.rows[0].location,
          isCancelled: updated.rows[0].is_cancelled,
          cost: updated.rows[0].cost === null ? null : Number(updated.rows[0].cost),
          costStatus: updated.rows[0].cost_status,
          financeState: updated.rows[0].finance_state,
          ownerKind: updated.rows[0].owner_kind,
          ownerTeamId: updated.rows[0].owner_team_id,
          ownerName: updated.rows[0].owner_name,
          sourceKind: updated.rows[0].source_kind,
          sourceProvider: updated.rows[0].source_provider,
          sourceExternalEventId: updated.rows[0].source_external_event_id,
          registration: registrationProjection,
          importedSchedule: payload.importedSchedule !== undefined ? importedScheduleProjection : undefined,
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

adminRouter.get(
  "/v1/team/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;

    const teamId = parseOptionalUuid(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ detail: "teamId query param is required" });
    }

    const teamIds = resolveRequestedTeams(access, teamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const teamMeta = await query<{
      id: string;
      name: string;
      short_code: string;
      timezone: string;
      owner_events_count: string;
    }>(
      `SELECT
         t.id,
         t.name,
         t.short_code,
         t.timezone,
         COUNT(e.id)::text AS owner_events_count
       FROM teams t
       LEFT JOIN events e
         ON e.owner_kind = 'TEAM'::event_owner_kind
        AND e.owner_team_id = t.id
       WHERE t.id = $1
       GROUP BY t.id`,
      [teamId]
    );
    const team = teamMeta.rows[0];
    if (!team) {
      return res.status(404).json({ detail: "Team not found" });
    }

    const registrationSummaryRows = await query<{ status: EventRegistrationStatus; count: string }>(
      `SELECT status::text, COUNT(*)::text AS count
       FROM event_team_registrations
       WHERE team_id = $1
       GROUP BY status`,
      [teamId]
    );
    const registrationSummary = summarizeRegistrationStatuses([]);
    for (const row of registrationSummaryRows.rows) {
      const count = Number(row.count);
      registrationSummary.total += count;
      if (row.status === "REQUESTED") registrationSummary.requested += count;
      if (row.status === "CONFIRMED") registrationSummary.confirmed += count;
      if (row.status === "WAITLISTED") registrationSummary.waitlisted += count;
      if (row.status === "REJECTED") registrationSummary.rejected += count;
      if (row.status === "CANCELLED") registrationSummary.cancelled += count;
    }

    const registrationLinks = await query<{
      registration_id: string;
      event_id: string;
      event_title: string;
      status: EventRegistrationStatus;
      requested_at: string;
      confirmed_at: string | null;
      owner_kind: "TEAM" | "VENUE" | "INTEGRATION";
      owner_name: string | null;
      source_kind: "MANUAL" | "VENUE_API" | "INTEGRATION_API";
      source_provider: string | null;
      imported_items_count: string;
      last_published_at: string | null;
    }>(
      `SELECT
         r.id AS registration_id,
         r.event_id,
         e.title AS event_title,
         r.status::text,
         r.requested_at,
         r.confirmed_at,
         e.owner_kind::text,
         e.owner_name,
         e.source_kind::text,
         e.source_provider,
         COALESCE(s.imported_items_count, 0)::text AS imported_items_count,
         s.last_published_at
       FROM event_team_registrations r
       JOIN events e ON e.id = r.event_id
       LEFT JOIN (
         SELECT event_id, team_id, COUNT(*)::int AS imported_items_count, MAX(published_at) AS last_published_at
         FROM event_team_schedule_items
         WHERE team_id = $1
         GROUP BY event_id, team_id
       ) s ON s.event_id = r.event_id AND s.team_id = r.team_id
       WHERE r.team_id = $1
       ORDER BY COALESCE(r.confirmed_at, r.requested_at) DESC
       LIMIT 80`,
      [teamId]
    );

    const members = await query<{
      membership_id: string;
      team_id: string;
      user_id: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
      balance: string;
      username: string | null;
      name: string;
      nickname: string;
      avatar: string | null;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT
         tm.id AS membership_id,
         tm.team_id,
         tm.user_id,
         tm.role::text,
         tm.status::text,
         tm.balance::text,
         u.username,
         u.name,
         u.nickname,
         u.avatar,
         u.is_active,
         tm.created_at
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY tm.role ASC, u.name ASC`,
      [teamId]
    );

    return res.json({
      teamId,
      team: {
        id: team.id,
        name: team.name,
        shortCode: team.short_code,
        timezone: team.timezone,
        ownerEventsCount: Number(team.owner_events_count),
        registrationSummary,
      },
      registrationLinks: registrationLinks.rows.map((row) => ({
        registrationId: row.registration_id,
        eventId: row.event_id,
        eventTitle: row.event_title,
        status: row.status,
        requestedAt: row.requested_at,
        confirmedAt: row.confirmed_at,
        ownerKind: row.owner_kind,
        ownerName: row.owner_name,
        sourceKind: row.source_kind,
        sourceProvider: row.source_provider,
        importedItemsCount: Number(row.imported_items_count),
        lastPublishedAt: row.last_published_at,
      })),
      items: members.rows.map((m) => ({
        membershipId: m.membership_id,
        teamId: m.team_id,
        userId: m.user_id,
        role: m.role,
        status: m.status,
        balance: Number(m.balance),
        user: {
          username: m.username,
          name: m.name,
          nickname: m.nickname,
          avatar: m.avatar,
          isActive: m.is_active,
        },
        createdAt: m.created_at,
      })),
    });
  })
);

adminRouter.patch(
  "/v1/team/members/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const teamId = parseOptionalUuid(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ detail: "teamId query param is required" });
    }
    const payload = patchMembershipSchema.parse(req.body ?? {});

    const teamIds = resolveRequestedTeams(access, teamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const updated = await query(
      `UPDATE team_memberships
       SET role = COALESCE($3::membership_role, role),
           status = COALESCE($4::player_status, status),
           updated_at = NOW()
       WHERE id = $1 AND team_id = $2
       RETURNING id`,
      [membershipId, teamId, payload.teamRole ?? null, payload.status ?? null]
    );
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }

    await writeAudit(req.authUser!.id, "admin.v1.team.members.patch", {
      membershipId,
      teamId,
      payload,
    });

    return res.json({ ok: true });
  })
);

adminRouter.get(
  "/v1/audit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await requireAdminAccess(req, res);
    if (!access) return;

    const requestedTeamId = parseOptionalUuid(req.query.teamId);
    const teamIds = resolveRequestedTeams(access, requestedTeamId);
    if (teamIds.length === 0) {
      return res.status(403).json({ detail: "Team access denied" });
    }

    const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
    const limit = Math.min(300, Math.max(1, Number(req.query.limit || 100)));

    const logs = await query<{
      id: string;
      action: string;
      payload: Record<string, unknown>;
      created_at: string;
      user_id: string | null;
      actor_name: string | null;
      actor_username: string | null;
    }>(
      `SELECT
         l.id,
         l.action,
         l.payload,
         l.created_at,
         l.user_id,
         u.name AS actor_name,
         u.username AS actor_username
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE ($1::text = '' OR l.action ILIKE '%' || $1 || '%')
         AND (l.payload->>'teamId') = ANY($2::text[])
       ORDER BY l.created_at DESC
       LIMIT $3`,
      [action, teamIds, limit]
    );

    return res.json({
      items: logs.rows.map((row) => {
        const flowStage = resolveRegistrationFlowStage(row.action, row.payload || {});
        const teamId = typeof row.payload?.teamId === "string" ? row.payload.teamId : null;
        const eventId = typeof row.payload?.eventId === "string" ? row.payload.eventId : null;
        const flowKey = teamId && eventId ? `${teamId}:${eventId}` : null;
        return {
          id: row.id,
          action: row.action,
          payload: row.payload,
          createdAt: row.created_at,
          actor: row.user_id
            ? {
                userId: row.user_id,
                name: row.actor_name,
                username: row.actor_username,
              }
            : null,
          flow: flowStage
            ? {
                key: flowKey,
                stage: flowStage,
                eventId,
                teamId,
              }
            : null,
        };
      }),
      limit,
    });
  })
);
