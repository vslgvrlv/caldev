import { Router } from "express";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { getUserMemberships } from "../../lib/permissions.js";
import {
  mergeTeamEventSchedule,
  selectImportedScheduleForTeam,
  selectRegistrationForTeam,
  type EventRegistrationProjection,
  type ImportedTeamScheduleProjection,
} from "../../lib/event-domain.js";

type RawEvent = {
  id: string;
  team_id: string;
  series_id: string | null;
  team_name: string;
  team_short_code: string;
  team_timezone: string;
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
  is_cancelled: boolean;
  viewer_role: "CAPTAIN" | "TRAINER" | "PLAYER";
  my_rsvp: "PENDING" | "CONFIRMED" | "DECLINED" | null;
  attendees_count: string;
};

type AttendeePreviewRow = {
  event_id: string;
  user_id: string;
  name: string;
  nickname: string;
  avatar: string | null;
};

export const initRouter = Router();

initRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.authUser!;
    const effectiveRole = getEffectiveEntryRole(req, user);
    if (effectiveRole === null) {
      return res.status(409).json({ detail: "ROLE_SELECTION_REQUIRED" });
    }

    const memberships = await getUserMemberships(user.id);

    if (effectiveRole === "ADMIN") {
      const managedTeams = await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; timezone: string }>(
        `SELECT t.id, t.name, t.short_code, t.logo, t.budget::text, t.timezone
         FROM teams t
         ORDER BY t.name ASC`
      );

      return res.json({
        admin: true,
        pendingUsersHint: true,
        teams: managedTeams.rows.map((t) => ({
          id: t.id,
          name: t.name,
          shortCode: t.short_code,
          logo: t.logo,
          budget: Number(t.budget),
          timezone: t.timezone,
        })),
      });
    }

    if (memberships.length === 0) {
      return res.json({
        noTeamYet: true,
        screen: "PROFILE_WAITING",
      });
    }

    if (!req.session.activeMembershipId || !req.session.activeTeamId) {
      req.session.activeMembershipId = memberships[0].id;
      req.session.activeTeamId = memberships[0].team_id;
    }

    let activeMembership = memberships.find((m) => m.id === req.session.activeMembershipId);
    if (!activeMembership) {
      req.session.activeMembershipId = memberships[0].id;
      req.session.activeTeamId = memberships[0].team_id;
      activeMembership = memberships[0];
    }

    const teamResult = await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; timezone: string }>(
      `SELECT id, name, short_code, logo, budget::text, timezone
       FROM teams WHERE id = $1`,
      [activeMembership.team_id]
    );
    const team = teamResult.rows[0];

    const membersResult = await query<{
      membership_id: string;
      id: string;
      name: string;
      nickname: string;
      avatar: string | null;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
      balance: string;
    }>(
      `SELECT tm.id AS membership_id, u.id, u.name, u.nickname, u.avatar, tm.role, tm.status, tm.balance::text
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1 AND u.is_active = TRUE
       ORDER BY u.name`,
      [activeMembership.team_id]
    );

    const teamIds = memberships.map((m) => m.team_id);

    const eventsResult = await query<RawEvent>(
      `SELECT e.id,
              e.team_id,
              e.series_id::text,
              t.name AS team_name,
              t.short_code AS team_short_code,
              t.timezone AS team_timezone,
              e.type,
              e.title,
              e.description,
              e.start_at,
              e.end_at,
              e.location,
              e.cost::text,
              e.cost_status::text,
              e.finance_state::text,
              e.owner_kind::text,
              e.owner_team_id,
              e.owner_name,
              e.source_kind::text,
              e.source_provider,
              e.source_external_event_id,
              e.is_cancelled,
              tm.role AS viewer_role,
              r.status AS my_rsvp,
              COALESCE((
                SELECT COUNT(*)
                FROM rsvps r2
                JOIN users u2 ON u2.id = r2.user_id AND u2.is_active = TRUE
                JOIN team_memberships tm2 ON tm2.user_id = r2.user_id AND tm2.team_id = e.team_id
                WHERE r2.event_id = e.id
                  AND r2.status = 'CONFIRMED'
              ), 0)::text AS attendees_count
       FROM events e
       JOIN teams t ON t.id = e.team_id
       JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $1
       JOIN rsvps r ON r.event_id = e.id AND r.user_id = $1
       WHERE e.team_id = ANY($2::uuid[])
         AND e.is_cancelled = FALSE
         AND r.status IN ('CONFIRMED', 'PENDING', 'DECLINED')
       ORDER BY e.start_at ASC`,
      [user.id, teamIds]
    );

    const actionRequiredResult = await query<RawEvent>(
      `SELECT e.id,
              e.team_id,
              e.series_id::text,
              t.name AS team_name,
              t.short_code AS team_short_code,
              t.timezone AS team_timezone,
              e.type,
              e.title,
              e.description,
              e.start_at,
              e.end_at,
              e.location,
              e.cost::text,
              e.cost_status::text,
              e.finance_state::text,
              e.owner_kind::text,
              e.owner_team_id,
              e.owner_name,
              e.source_kind::text,
              e.source_provider,
              e.source_external_event_id,
              e.is_cancelled,
              tm.role AS viewer_role,
              NULL::rsvp_status AS my_rsvp,
              COALESCE((
                SELECT COUNT(*)
                FROM rsvps r2
                JOIN users u2 ON u2.id = r2.user_id AND u2.is_active = TRUE
                JOIN team_memberships tm2 ON tm2.user_id = r2.user_id AND tm2.team_id = e.team_id
                WHERE r2.event_id = e.id
                  AND r2.status = 'CONFIRMED'
              ), 0)::text AS attendees_count
       FROM events e
       JOIN teams t ON t.id = e.team_id
       JOIN team_memberships tm ON tm.team_id = e.team_id AND tm.user_id = $1
       LEFT JOIN rsvps r ON r.event_id = e.id AND r.user_id = $1
       WHERE e.team_id = ANY($2::uuid[])
         AND e.is_cancelled = FALSE
         AND r.event_id IS NULL
       ORDER BY e.start_at ASC`,
      [user.id, teamIds]
    );

    const eventIds = Array.from(new Set([...eventsResult.rows.map((e) => e.id), ...actionRequiredResult.rows.map((e) => e.id)]));
    const gamesMap = new Map<
      string,
      Array<{ id: string; time: string; opponent: string; score?: string; pitZone?: "NEAR" | "FAR"; gamePair?: "FIRST" | "SECOND" }>
    >();
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
      for (const g of gamesResult.rows) {
        const list = gamesMap.get(g.event_id) || [];
        list.push({
          id: g.id,
          time: g.time_label,
          opponent: g.opponent,
          score: g.score ?? undefined,
          pitZone: g.pit_zone ?? undefined,
          gamePair: g.game_pair ?? undefined,
        });
        gamesMap.set(g.event_id, list);
      }
    }

    const registrationsMap = new Map<string, EventRegistrationProjection[]>();
    const importedTeamScheduleMap = new Map<string, ImportedTeamScheduleProjection[]>();
    if (eventIds.length > 0) {
      const registrationsResult = await query<{
        id: string;
        event_id: string;
        team_id: string;
        status: "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "REJECTED" | "CANCELLED";
        requested_at: string;
        confirmed_at: string | null;
        external_registration_id: string | null;
        confirmed_by_user_id: string | null;
      }>(
        `SELECT
           id,
           event_id,
           team_id,
           status::text,
           requested_at,
           confirmed_at,
           external_registration_id,
           confirmed_by_user_id
         FROM event_team_registrations
         WHERE event_id = ANY($1::uuid[])
           AND team_id = $2`,
        [eventIds, activeMembership.team_id]
      );
      for (const row of registrationsResult.rows) {
        const list = registrationsMap.get(row.event_id) || [];
        list.push({
          id: row.id,
          teamId: row.team_id,
          status: row.status,
          requestedAt: row.requested_at,
          confirmedAt: row.confirmed_at,
          externalRegistrationId: row.external_registration_id,
          confirmedByUserId: row.confirmed_by_user_id,
        });
        registrationsMap.set(row.event_id, list);
      }

      const importedScheduleResult = await query<{
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
      }>(
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
           AND team_id = $2
         ORDER BY COALESCE(starts_at, published_at) ASC, time_label ASC`,
        [eventIds, activeMembership.team_id]
      );
      for (const row of importedScheduleResult.rows) {
        const list = importedTeamScheduleMap.get(row.event_id) || [];
        list.push({
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
        });
        importedTeamScheduleMap.set(row.event_id, list);
      }
    }

    const attendeePreviewMap = new Map<
      string,
      Array<{ userId: string; name: string; nickname: string; avatar?: string }>
    >();
    if (eventIds.length > 0) {
      const attendeePreviewResult = await query<AttendeePreviewRow>(
        `SELECT r.event_id,
                u.id AS user_id,
                u.name,
                u.nickname,
                u.avatar
         FROM rsvps r
         JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ANY($1::uuid[])
           AND r.status = 'CONFIRMED'
         ORDER BY r.updated_at DESC`,
        [eventIds]
      );
      for (const row of attendeePreviewResult.rows) {
        const list = attendeePreviewMap.get(row.event_id) || [];
        if (list.length >= 50) continue;
        list.push({
          userId: row.user_id,
          name: row.name,
          nickname: row.nickname,
          avatar: row.avatar || undefined,
        });
        attendeePreviewMap.set(row.event_id, list);
      }
    }

    const transactionsResult = await query<{
      id: string;
      type: "DEPOSIT" | "EXPENSE" | "FEE";
      amount: string;
      title: string;
      date: string;
      user_id: string | null;
      user_name_snapshot: string | null;
      status: "PENDING" | "COMPLETED";
    }>(
      `SELECT id, type, amount::text, title, date, user_id, user_name_snapshot, status
       FROM transactions
       WHERE team_id = $1
       ORDER BY date DESC`,
      [activeMembership.team_id]
    );

    const activeTeamEventsCountResult = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM events
       WHERE team_id = $1 AND is_cancelled = FALSE`,
      [activeMembership.team_id]
    );
    const activeTeamEventsTotal = Number(activeTeamEventsCountResult.rows[0]?.total || "0");

    const memberStats = new Map<string, { total: number; attended: number }>();
    for (const member of membersResult.rows) {
      memberStats.set(member.id, { total: activeTeamEventsTotal, attended: 0 });
    }
    const attendanceStats = await query<{ user_id: string; attended: string }>(
      `SELECT user_id, COUNT(*)::text AS attended
       FROM rsvps r
       JOIN events e ON e.id = r.event_id
       WHERE e.team_id = $1 AND r.status = 'CONFIRMED'
       GROUP BY user_id`,
      [activeMembership.team_id]
    );
    for (const row of attendanceStats.rows) {
      const item = memberStats.get(row.user_id);
      if (item) {
        item.attended = Number(row.attended);
      }
    }

    const mapEventForFeed = (e: RawEvent, rsvpStatus: "UNANSWERED" | "PENDING" | "CONFIRMED" | "DECLINED") => {
      const registration = selectRegistrationForTeam(registrationsMap.get(e.id) || [], activeMembership.team_id);
      const importedSchedule = selectImportedScheduleForTeam(importedTeamScheduleMap.get(e.id) || [], activeMembership.team_id);
      const mergedSchedule = mergeTeamEventSchedule(gamesMap.get(e.id) || [], importedSchedule);
      return {
        id: e.id,
        teamId: e.team_id,
        seriesId: e.series_id || undefined,
        isRecurring: Boolean(e.series_id),
        viewerRole: e.viewer_role,
        teamName: e.team_name,
        teamShortCode: e.team_short_code,
        teamTimezone: e.team_timezone,
        type: e.type,
        title: e.title,
        description: e.description || undefined,
        startAt: e.start_at,
        endAt: e.end_at || undefined,
        startDate: e.start_at,
        endDate: e.end_at || undefined,
        location: e.location || undefined,
        cost: e.cost !== null ? Number(e.cost) : undefined,
        costStatus: e.cost_status,
        financeState: e.finance_state,
        ownerKind: e.owner_kind,
        ownerTeamId: e.owner_team_id || undefined,
        ownerName: e.owner_name || undefined,
        sourceKind: e.source_kind,
        sourceProvider: e.source_provider || undefined,
        sourceExternalEventId: e.source_external_event_id || undefined,
        registration: registration || undefined,
        importedSchedule: importedSchedule.length > 0 ? importedSchedule : undefined,
        rsvpStatus,
        attendeesCount: Number(e.attendees_count),
        attendeePreview: attendeePreviewMap.get(e.id) || [],
        isConflict: false,
        schedule: mergedSchedule.length > 0 ? mergedSchedule : undefined,
      };
    };

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        avatar: user.avatar,
      },
      team: {
        id: team.id,
        name: team.name,
        shortCode: team.short_code,
        logo: team.logo,
        role: activeMembership.role,
        budget: Number(team.budget),
        timezone: team.timezone,
      },
      members: membersResult.rows.map((m) => {
        const stats = memberStats.get(m.id) || { total: activeTeamEventsTotal, attended: 0 };
        const attendanceRate = stats.total > 0 ? Math.round((stats.attended / stats.total) * 100) : 0;
        return {
          membershipId: m.membership_id,
          id: m.id,
          name: m.name,
          nickname: m.nickname,
          avatar: m.avatar,
          role: m.role,
          status: m.status,
          balance: Number(m.balance),
          stats: {
            attendanceRate,
            eventsAttended: stats.attended,
            totalEvents: stats.total,
            mvpCount: 0,
            matchesPlayed: stats.total,
          },
        };
      }),
      teams: memberships.map((m) => ({
        teamId: m.team_id,
        teamName: m.team_name,
        shortCode: m.team_short_code,
        role: m.role,
        membershipId: m.id,
      })),
      events: eventsResult.rows.map((e) => mapEventForFeed(e, e.my_rsvp || "UNANSWERED")),
      actionRequiredEvents: actionRequiredResult.rows.map((e) => mapEventForFeed(e, "UNANSWERED")),
      transactions: transactionsResult.rows.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        title: t.title,
        date: t.date,
        userId: t.user_id,
        userName: t.user_name_snapshot || undefined,
        status: t.status,
      })),
    });
  })
);
