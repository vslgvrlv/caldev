import { Router, type Request } from "express";
import { loadInviteFacts } from "./invite-facts.js";
import { publicLinkReadLimiter } from "../../lib/public-link-rate-limit.js";
import { z } from "zod";
import { isPlatformOwner, resolveTeamAccess, TeamAccessError } from "../../lib/team-access.js";
import {
  assertCaptainChangeAllowed,
  loadMembershipByUserForUpdate,
  loadMembershipForUpdate,
  sendCaptainGuardError,
  withTransaction,
} from "../../lib/team-captains.js";
import { query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { canChooseAdminRole } from "../../lib/entry-role.js";
import { writeAudit } from "../../lib/audit.js";
import { sendError } from "../../lib/http-error.js";
import { appUrl, sendTrackError } from "../join-requests/delivery.js";
import { ensureActiveJoinLink, joinLinkUrl, rotateJoinLink } from "./join-link.js";
import { loadTeamLook, loadTeamLooks, teamLookPatchSchema, updateTeamLook } from "../../lib/team-look.js";

const createTeamSchema = z.object({
  name: z.string().min(2).max(120),
  shortCode: z.string().min(1).max(20),
  logo: z.string().url().optional(),
  timezone: z.string().min(2).max(80).default("Europe/Moscow"),
});

const createMembershipSchema = z.object({
  usernameOrId: z.string().min(1),
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]),
});

const updateMembershipSchema = z.object({
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]).optional(),
  status: z.enum(["ACTIVE", "INJURED", "RESERVE", "VACATION"]).optional(),
}).refine((value) => value.teamRole !== undefined || value.status !== undefined, {
  message: "At least one field (teamRole or status) is required",
});

const createInviteSchema = z.object({
  teamRole: z.enum(["CAPTAIN", "TRAINER", "PLAYER"]).default("PLAYER"),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  // Именное одноразовое приглашение (трек 1): срабатывает один раз, `note` —
  // кому оно («Для Ивана, капитан Дозора»), видно на экране приглашения.
  singleUse: z.boolean().default(false),
  note: z.string().trim().max(200).optional(),
});

// Права в команде из параметра ручки — через общий `resolveTeamAccess`.
// Владелец платформы без членства получает права капитана (`via: owner`) и
// при этом считается владельцем для правил про капитанов. Отказ доступа здесь
// не ошибка: ручки сами отвечают прежним текстом 403.
async function resolveTeamManager(req: Request, teamId: string) {
  // Владелец платформы — по `isPlatformOwner` (режима «админ или игрок» больше
  // нет, трек 3). Так владелец, который сам капитан команды, тоже может
  // назначить второго капитана и выдать приглашение капитана.
  const isRootAdmin = isPlatformOwner(req);
  let access: Awaited<ReturnType<typeof resolveTeamAccess>> = null;
  try {
    access = await resolveTeamAccess(req, { param: teamId });
  } catch (error) {
    if (!(error instanceof TeamAccessError)) throw error;
  }
  return {
    isRootAdmin,
    isCaptain: access?.role === "CAPTAIN",
    isTrainer: access?.role === "TRAINER",
    isOwner: isRootAdmin || access?.via === "owner",
  };
}

export const teamsRouter = Router();

teamsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ownTeams =
      isPlatformOwner(req)
        ? await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; role: string; timezone: string }>(
            `SELECT t.id, t.name, t.short_code, t.logo, t.budget::text, t.timezone, 'CAPTAIN'::text AS role
             FROM teams t
             ORDER BY t.name ASC`
          )
        : await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; role: string; timezone: string }>(
            `SELECT t.id, t.name, t.short_code, t.logo, t.budget::text, t.timezone, tm.role::text
             FROM team_memberships tm
             JOIN teams t ON t.id = tm.team_id
             WHERE tm.user_id = $1 AND tm.role = 'CAPTAIN'
             ORDER BY t.name ASC`,
            [req.authUser!.id]
          );
    const looks = await loadTeamLooks(ownTeams.rows.map((t) => t.id));
    return res.json({
      teams: ownTeams.rows.map((t) => ({
        id: t.id,
        name: t.name,
        shortCode: t.short_code,
        logo: t.logo,
        look: looks.get(t.id) ?? null,
        budget: Number(t.budget),
        timezone: t.timezone,
        role: t.role,
      })),
    });
  })
);

teamsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isPlatformOwner(req)) {
      return res.status(403).json({ detail: "Only the platform owner can create teams" });
    }

    const payload = createTeamSchema.parse(req.body);
    let created;
    try {
      created = await query<{ id: string; name: string; short_code: string; logo: string | null; budget: string; timezone: string }>(
        `INSERT INTO teams (name, short_code, logo, timezone)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, short_code, logo, budget::text, timezone`,
        [payload.name, payload.shortCode, payload.logo ?? null, payload.timezone]
      );
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ detail: "Team with this short code already exists" });
      }
      throw error;
    }

    await writeAudit(req.authUser!.id, "teams.create", { teamId: created.rows[0].id });
    return res.status(201).json({
      team: {
        id: created.rows[0].id,
        name: created.rows[0].name,
        shortCode: created.rows[0].short_code,
        logo: created.rows[0].logo,
        budget: Number(created.rows[0].budget),
        timezone: created.rows[0].timezone,
      },
    });
  })
);

// Вступление по одному ID команды закрыто: раньше любой вошедший мог стать
// игроком любой команды, зная её ID (а ID виден в старых ссылках
// /invite/<ID команды>). В команду попадают только по действующему
// приглашению — POST /teams/invites/:token/accept. Маршрут оставлен, чтобы
// старые клиенты получали понятный отказ, а не 404.
teamsRouter.post(
  "/:teamId/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    return sendError(
      req,
      res,
      410,
      "INVITE_REQUIRED",
      "Joining a team requires a valid invite from the captain"
    );
  })
);

teamsRouter.post(
  "/:teamId/invites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const payload = createInviteSchema.parse(req.body ?? {});
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }
    const { isOwner, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isOwner && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can create invites" });
    }
    if (!isOwner && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot issue captain invites" });
    }

    const expiresAt = new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000);
    const note = payload.note ? payload.note : null;
    const created = await query<{ token: string; expires_at: string; role: "CAPTAIN" | "TRAINER" | "PLAYER"; single_use: boolean; note: string | null }>(
      `INSERT INTO team_invites (team_id, role, created_by, expires_at, single_use, note)
       VALUES ($1, $2::membership_role, $3, $4, $5, $6)
       RETURNING token::text, expires_at, role::text, single_use, note`,
      [teamId, payload.teamRole, req.authUser!.id, expiresAt.toISOString(), payload.singleUse, note]
    );

    await writeAudit(req.authUser!.id, "teams.invite.create", {
      teamId,
      token: created.rows[0].token,
      role: payload.teamRole,
      expiresAt: created.rows[0].expires_at,
      singleUse: payload.singleUse,
    });

    return res.status(201).json({
      token: created.rows[0].token,
      role: created.rows[0].role,
      expiresAt: created.rows[0].expires_at,
      singleUse: created.rows[0].single_use,
      note: created.rows[0].note,
      url: appUrl(`/invite/${created.rows[0].token}`),
    });
  })
);

teamsRouter.get(
  "/invites/:token",
  publicLinkReadLimiter(),
  asyncHandler(async (req, res) => {
    const token = z.string().uuid().parse(req.params.token);
    const inviteResult = await query<{
      team_id: string;
      team_name: string;
      role: "CAPTAIN" | "TRAINER" | "PLAYER";
      expires_at: string;
      is_revoked: boolean;
      used_at: string | null;
      single_use: boolean;
      note: string | null;
    }>(
      `SELECT i.team_id, t.name AS team_name, i.role::text, i.expires_at, i.is_revoked, i.used_at, i.single_use, i.note
       FROM team_invites i
       JOIN teams t ON t.id = i.team_id
       WHERE i.token = $1`,
      [token]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      return sendError(req, res, 404, "INVITE_NOT_FOUND", "Invite not found");
    }
    const isExpired = new Date(invite.expires_at).getTime() < Date.now();
    const isUsed = invite.used_at !== null;
    if (invite.is_revoked) {
      return sendError(req, res, 409, "INVITE_REVOKED", "Invite is revoked");
    }
    if (isExpired) {
      return sendError(req, res, 409, "INVITE_EXPIRED", "Invite expired");
    }
    if (invite.single_use && isUsed) {
      return sendTrackError(req, res, 409, "INVITE_USED", "Invite has already been used");
    }
    const facts = await loadInviteFacts(invite.team_id);
    return res.json({
      teamId: invite.team_id,
      teamName: invite.team_name,
      // Только знак команды: краска, фигура и буквы.
      teamLook: await loadTeamLook(invite.team_id),
      role: invite.role,
      expiresAt: invite.expires_at,
      isValid: true,
      isExpired,
      isUsed,
      isRevoked: invite.is_revoked,
      singleUse: invite.single_use,
      note: invite.note,
      ...(facts ?? {}),
    });
  })
);

type InviteRow = {
  id: string;
  team_id: string;
  role: "CAPTAIN" | "TRAINER" | "PLAYER";
  expires_at: string;
  is_revoked: boolean;
  used_at: string | null;
  single_use: boolean;
};

class InviteAcceptError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

teamsRouter.post(
  "/invites/:token/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = z.string().uuid().parse(req.params.token);
    // Режима «админ или игрок» больше нет (трек 3): приглашение принимает
    // любой вошедший, в том числе владелец платформы.
    console.info("[teams] invite.accept attempt", { userId: req.authUser!.id });

    // Проверка и расход приглашения — в одной транзакции под блокировкой
    // строки: одноразовое приглашение (капитана) не сработает дважды, даже
    // если два человека откроют ссылку одновременно.
    let outcome: { membershipId: string; teamId: string; inviteId: string; role: InviteRow["role"]; upgraded: boolean };
    try {
      outcome = await withTransaction(async (client) => {
        const inviteResult = await client.query<InviteRow>(
          `SELECT id, team_id, role::text, expires_at, is_revoked, used_at, single_use
           FROM team_invites
           WHERE token = $1
           FOR UPDATE`,
          [token]
        );
        const invite = inviteResult.rows[0];
        if (!invite) throw new InviteAcceptError(404, "INVITE_NOT_FOUND", "Invite not found");
        if (invite.is_revoked) throw new InviteAcceptError(409, "INVITE_REVOKED", "Invite is revoked");
        if (new Date(invite.expires_at).getTime() < Date.now()) {
          throw new InviteAcceptError(409, "INVITE_EXPIRED", "Invite expired");
        }
        if (invite.single_use && invite.used_at !== null) {
          throw new InviteAcceptError(409, "INVITE_USED", "Invite has already been used");
        }

        const existing = await loadMembershipByUserForUpdate(client, invite.team_id, req.authUser!.id);
        let membershipId: string;
        let upgraded = false;
        if (existing) {
          // Приглашение капитана человеку, который уже в составе, делает его
          // капитаном. Остальные приглашения участнику не нужны.
          if (invite.role !== "CAPTAIN" || existing.role === "CAPTAIN") {
            throw new InviteAcceptError(409, "ALREADY_MEMBER", "User is already a team member", {
              membershipId: existing.id,
              teamId: invite.team_id,
            });
          }
          await client.query(`UPDATE team_memberships SET role = 'CAPTAIN', updated_at = NOW() WHERE id = $1`, [existing.id]);
          membershipId = existing.id;
          upgraded = true;
        } else {
          const membership = await client.query<{ id: string }>(
            `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
             VALUES ($1, $2, $3::membership_role, 'ACTIVE', 0)
             RETURNING id`,
            [req.authUser!.id, invite.team_id, invite.role]
          );
          membershipId = membership.rows[0].id;
        }

        await client.query(
          `UPDATE team_invites
           SET used_by = COALESCE(used_by, $2), used_at = COALESCE(used_at, NOW()), updated_at = NOW()
           WHERE id = $1`,
          [invite.id, req.authUser!.id]
        );
        return { membershipId, teamId: invite.team_id, inviteId: invite.id, role: invite.role, upgraded };
      });
    } catch (error) {
      if (error instanceof InviteAcceptError) {
        console.warn("[teams] invite.accept failed", { userId: req.authUser!.id, code: error.code });
        return sendTrackError(req, res, error.status, error.code, error.message, error.extra);
      }
      throw error;
    }

    req.session.activeMembershipId = outcome.membershipId;
    req.session.activeTeamId = outcome.teamId;

    await writeAudit(req.authUser!.id, "teams.invite.accept", {
      teamId: outcome.teamId,
      membershipId: outcome.membershipId,
      inviteId: outcome.inviteId,
      role: outcome.role,
      upgraded: outcome.upgraded,
    });

    console.info("[teams] invite.accept success", {
      userId: req.authUser!.id,
      membershipId: outcome.membershipId,
      teamId: outcome.teamId,
      role: outcome.role,
    });

    return res.json({ ok: true, membershipId: outcome.membershipId, teamId: outcome.teamId });
  })
);

// Ссылка команды `/join/<код>` (трек 1). Видят капитан и тренер — заявки
// Оформление команды: краска, фигура знака и буквы. Меняет капитан (владелец
// платформы — как капитан); тренер и игрок видят знак, но не правят его.
// Присланное поле записывается, `null` возвращает расчёт по умолчанию.
teamsRouter.patch(
  "/:teamId/look",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) return res.status(404).json({ detail: "Team not found" });
    const { isOwner, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isOwner && !isCaptain) {
      return res.status(403).json({ detail: "Only the team captain can change the team look" });
    }
    const patch = teamLookPatchSchema.parse(req.body);
    const look = await updateTeamLook(teamId, patch);
    if (look === undefined) return res.status(404).json({ detail: "Team not found" });
    await writeAudit(req.authUser!.id, "teams.look.update", { teamId, ...patch });
    return res.json({ look });
  })
);

// одобряют оба (решение Василия); отзывает и выпускает новую только капитан
// (владелец платформы — как капитан). Ссылка не впускает сразу: она создаёт
// заявку, которую одобряет капитан или тренер.
teamsRouter.get(
  "/:teamId/join-link",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) return res.status(404).json({ detail: "Team not found" });
    const { isOwner, isCaptain, isTrainer } = await resolveTeamManager(req, teamId);
    if (!isOwner && !isCaptain && !isTrainer) {
      return res.status(403).json({ detail: "Only the team captain or trainer can see the team link" });
    }
    const link = await ensureActiveJoinLink(teamId, req.authUser!.id);
    return res.json({ code: link.code, url: joinLinkUrl(link.code), createdAt: link.createdAt });
  })
);

teamsRouter.post(
  "/:teamId/join-link/rotate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) return res.status(404).json({ detail: "Team not found" });
    const { isOwner, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isOwner && !isCaptain) {
      return res.status(403).json({ detail: "Only the team captain can replace the team link" });
    }
    const link = await rotateJoinLink(teamId, req.authUser!.id);
    await writeAudit(req.authUser!.id, "teams.join_link.rotate", { teamId, linkId: link.id });
    return res.json({ code: link.code, url: joinLinkUrl(link.code), createdAt: link.createdAt });
  })
);

teamsRouter.post(
  "/:teamId/memberships",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const payload = createMembershipSchema.parse(req.body);
    const { isOwner: isRootAdmin, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }
    if (!isRootAdmin && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot assign captain role" });
    }

    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [teamId]);
    if (!teamExists.rowCount) {
      return res.status(404).json({ detail: "Team not found" });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.usernameOrId);
    const userResult = await query<{ id: string; username: string | null; telegram_id: string; account_role: "ADMIN" | "USER" | null }>(
      isUuid
        ? `SELECT id, username, telegram_id::text, account_role FROM users WHERE id = $1 AND is_active = TRUE`
        : `SELECT id, username, telegram_id::text, account_role FROM users WHERE lower(username) = lower($1) AND is_active = TRUE`,
      [payload.usernameOrId]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ detail: "User not found" });
    }

    // Добавление в команду не трогает режим учётной записи человека
    // (`account_role`). Раньше владельца платформы, которого добавляли в
    // состав, молча переводили в режим игрока.
    if (user.account_role === "ADMIN") {
      const eligibleForDualMode = canChooseAdminRole({ telegram_id: user.telegram_id, username: user.username });
      if (!eligibleForDualMode) {
        return res.status(409).json({ detail: "Target user has admin account role and cannot be a team member" });
      }
    }

    let inserted: { rows: Array<{ id: string }> };
    try {
      inserted = await withTransaction(async (client) => {
        // Повторное добавление уже состоящего человека меняет ему роль —
        // те же правила про капитанов, что и у PATCH.
        const existing = await loadMembershipByUserForUpdate(client, teamId, user.id);
        await assertCaptainChangeAllowed(client, {
          teamId,
          target: existing,
          change: { kind: "update", role: payload.teamRole },
          actor: { userId: req.authUser!.id, isOwner: isRootAdmin },
        });
        return client.query<{ id: string }>(
          `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
           VALUES ($1, $2, $3::membership_role, 'ACTIVE', 0)
           ON CONFLICT (user_id, team_id)
           DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
           RETURNING id`,
          [user.id, teamId, payload.teamRole]
        );
      });
    } catch (error: any) {
      if (sendCaptainGuardError(res, error)) return;
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("admin account cannot")) {
        return res.status(409).json({ detail: "Target user has admin account role and cannot be a team member" });
      }
      throw error;
    }

    await writeAudit(req.authUser!.id, "teams.membership.upsert", {
      membershipId: inserted.rows[0].id,
      teamId,
      userId: user.id,
      role: payload.teamRole,
    });

    return res.status(201).json({ membershipId: inserted.rows[0].id });
  })
);

teamsRouter.patch(
  "/:teamId/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const payload = updateMembershipSchema.parse(req.body);
    const { isOwner: isRootAdmin, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }
    if (!isRootAdmin && payload.teamRole === "CAPTAIN") {
      return res.status(403).json({ detail: "Captain cannot assign captain role" });
    }

    let updated: { rowCount: number | null };
    try {
      updated = await withTransaction(async (client) => {
        const target = await loadMembershipForUpdate(client, teamId, membershipId);
        if (!target) return { rowCount: 0 };
        await assertCaptainChangeAllowed(client, {
          teamId,
          target,
          change: { kind: "update", role: payload.teamRole ?? null },
          actor: { userId: req.authUser!.id, isOwner: isRootAdmin },
        });
        return client.query<{ id: string }>(
          `UPDATE team_memberships
           SET role = COALESCE($3::membership_role, role),
               status = COALESCE($4::player_status, status),
               updated_at = NOW()
           WHERE id = $1 AND team_id = $2
           RETURNING id`,
          [membershipId, teamId, payload.teamRole ?? null, payload.status ?? null]
        );
      });
    } catch (error) {
      if (sendCaptainGuardError(res, error)) return;
      throw error;
    }
    if (!updated.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }

    await writeAudit(req.authUser!.id, "teams.membership.update", {
      teamId,
      membershipId,
      role: payload.teamRole ?? null,
      status: payload.status ?? null,
    });
    return res.json({ ok: true });
  })
);

teamsRouter.delete(
  "/:teamId/memberships/:membershipId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const teamId = z.string().uuid().parse(req.params.teamId);
    const membershipId = z.string().uuid().parse(req.params.membershipId);
    const { isOwner: isRootAdmin, isCaptain } = await resolveTeamManager(req, teamId);
    if (!isRootAdmin && !isCaptain) {
      return res.status(403).json({ detail: "Only root admin or team captain can manage members" });
    }

    let deleted: { rowCount: number | null };
    try {
      deleted = await withTransaction(async (client) => {
        const target = await loadMembershipForUpdate(client, teamId, membershipId);
        if (!target) return { rowCount: 0 };
        await assertCaptainChangeAllowed(client, {
          teamId,
          target,
          change: { kind: "delete" },
          actor: { userId: req.authUser!.id, isOwner: isRootAdmin },
        });
        return client.query<{ id: string }>(
          `DELETE FROM team_memberships
           WHERE id = $1 AND team_id = $2
           RETURNING id`,
          [membershipId, teamId]
        );
      });
    } catch (error) {
      if (sendCaptainGuardError(res, error)) return;
      throw error;
    }
    if (!deleted.rowCount) {
      return res.status(404).json({ detail: "Membership not found" });
    }

    // teamId — чтобы запись попала в журнал команды (трек 3).
    await writeAudit(req.authUser!.id, "teams.membership.delete", { teamId, membershipId });
    return res.json({ ok: true });
  })
);
