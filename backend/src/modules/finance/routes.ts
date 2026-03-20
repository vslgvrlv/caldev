import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getActiveContext } from "../teams/context.js";
import { writeAudit } from "../../lib/audit.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";
import { getUserMemberships } from "../../lib/permissions.js";
import { buildEventCollectionProjection, buildEventCollectionProjectionForAudience } from "../../lib/event-collection.js";
import {
  filterAutoEventChargeMembers,
  filterFinanceMembersForActor,
  isTransferScreenshotDataUrl,
  planTransferConfirmationAllocations,
  resolveFinanceAccessFromMemberships,
  validateEventChargeGeneration,
} from "../../lib/finance-confirmations.js";

const transactionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["DEPOSIT", "EXPENSE", "FEE"]),
  amount: z.number().positive(),
  title: z.string().min(1),
  date: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  userName: z.string().optional(),
  status: z.enum(["PENDING", "COMPLETED"]).optional(),
  eventId: z.string().uuid().optional(),
});

const updateTransactionSchema = z.object({
  title: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  eventId: z.string().uuid().nullable().optional(),
});

const financeQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
});

const generateChargesSchema = z.object({
  mode: z.enum(["CONFIRMED_ONLY", "CONFIRMED_AND_PENDING"]).default("CONFIRMED_ONLY"),
  amountType: z.enum(["FIXED_PER_PERSON", "TOTAL_SPLIT", "UNDISTRIBUTED_SPLIT", "CUSTOM"]).default("FIXED_PER_PERSON"),
  fixedAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().nonnegative().optional(),
  custom: z.array(z.object({ userId: z.string().uuid(), amount: z.number().nonnegative() })).optional(),
  overwriteExisting: z.boolean().default(false),
});

const createPaymentSchema = z.object({
  teamId: z.string().uuid().optional(),
  amount: z.number().positive(),
  title: z.string().min(1),
  date: z.string().datetime().optional(),
  payerUserId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  allocations: z
    .array(
      z.object({
        eventId: z.string().uuid(),
        userId: z.string().uuid(),
        amount: z.number().positive(),
      })
    )
    .optional(),
  status: z.enum(["PENDING", "COMPLETED"]).optional(),
});

const createTransferConfirmationSchema = z.object({
  teamId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  amount: z.number().positive(),
  screenshotDataUrl: z.string().min(32).max(5_000_000),
  note: z.string().max(2_000).optional(),
  submittedAt: z.string().datetime().optional(),
});

const reviewTransferConfirmationSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reviewNote: z.string().max(2_000).optional(),
  preferredEventId: z.string().uuid().optional(),
});

type FinanceAccess = {
  userId: string;
  teamId: string;
  actorRole: "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER";
  canWrite: boolean;
};

const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const IDEMPOTENCY_SCOPE_PAYMENT_CREATE = "FINANCE_PAYMENT_CREATE";
const IDEMPOTENCY_SCOPE_LEGACY_TRANSACTION_CREATE = "LEGACY_FINANCE_TRANSACTION_CREATE";
const EVENT_FINANCE_STATE_NOT_CALCULATED = "NOT_CALCULATED" as const;
const EVENT_FINANCE_STATE_COLLECTING = "COLLECTING" as const;
const EVENT_FINANCE_STATE_CLOSED = "CLOSED" as const;

type EventFinanceState =
  | typeof EVENT_FINANCE_STATE_NOT_CALCULATED
  | typeof EVENT_FINANCE_STATE_COLLECTING
  | typeof EVENT_FINANCE_STATE_CLOSED;

type PaymentConfirmationStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

type TransactionRow = {
  id: string;
  team_id: string;
  type: "DEPOSIT" | "EXPENSE" | "FEE";
  amount: string;
  title: string;
  date: string;
  user_id: string | null;
  user_name_snapshot: string | null;
  status: "PENDING" | "COMPLETED";
};

type TransferConfirmationRow = {
  id: string;
  team_id: string;
  user_id: string;
  user_name: string;
  user_nickname: string;
  amount: string;
  screenshot_data_url: string;
  note: string | null;
  review_note: string | null;
  status: PaymentConfirmationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  submitted_by_user_id: string;
  submitted_by_name: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  transaction_id: string | null;
};

async function resolveFinanceAccess(req: Parameters<typeof requireAuth>[0], explicitTeamId?: string): Promise<FinanceAccess> {
  const userId = (req as any).authUser.id as string;
  const effectiveRole = getEffectiveEntryRole(req as any, (req as any).authUser);
  const ctx = await getActiveContext(req as any);
  const requestedTeamId = explicitTeamId ?? ctx?.teamId;

  if (!requestedTeamId) {
    const err = new Error("Active team context required");
    (err as any).status = 403;
    throw err;
  }

  if (effectiveRole === "ADMIN") {
    const teamExists = await query(`SELECT 1 FROM teams WHERE id = $1`, [requestedTeamId]);
    if (!teamExists.rowCount) {
      const err = new Error("Team not found");
      (err as any).status = 404;
      throw err;
    }
    return {
      userId,
      teamId: requestedTeamId,
      actorRole: "ADMIN",
      canWrite: true,
    };
  }

  const resolvedFromMemberships =
    requestedTeamId && (!ctx || requestedTeamId !== ctx.teamId)
      ? resolveFinanceAccessFromMemberships({
          accountRole: "USER",
          userId,
          requestedTeamId,
          activeContext: ctx,
          memberships: (await getUserMemberships(userId)).map((item) => ({
            teamId: item.team_id,
            role: item.role,
            userId: item.user_id,
          })),
        })
      : null;

  if (resolvedFromMemberships) {
    return resolvedFromMemberships;
  }

  if (!ctx) {
    const err = new Error("Active team context required");
    (err as any).status = 403;
    throw err;
  }
  if (explicitTeamId && explicitTeamId !== ctx.teamId) {
    const err = new Error("Active team context mismatch");
    (err as any).status = 403;
    throw err;
  }

  return {
    userId: ctx.userId,
    teamId: ctx.teamId,
    actorRole: ctx.role,
    canWrite: ctx.role === "CAPTAIN",
  };
}

function assertCanReadFinance(access: FinanceAccess) {
  return access;
}

function assertCanReadTeamFinance(access: FinanceAccess) {
  if (access.actorRole === "PLAYER") {
    const err = new Error("Team finance access is not allowed for this role");
    (err as any).status = 403;
    throw err;
  }
}

function assertCanReadMemberFinance(access: FinanceAccess, userId: string) {
  if (access.actorRole === "PLAYER" && access.userId !== userId) {
    const err = new Error("Players can read only their own finance profile");
    (err as any).status = 403;
    throw err;
  }
}

function assertCanWriteFinance(access: FinanceAccess) {
  if (!access.canWrite && access.actorRole !== "ADMIN") {
    const err = new Error("Only captain or root admin can manage finance");
    (err as any).status = 403;
    throw err;
  }
}

function assertCanSubmitTransferConfirmation(access: FinanceAccess, targetUserId: string) {
  if (access.actorRole === "PLAYER" && access.userId !== targetUserId) {
    const err = new Error("Players can submit transfer confirmations only for themselves");
    (err as any).status = 403;
    throw err;
  }
  if (access.actorRole === "TRAINER") {
    const err = new Error("Trainer role cannot submit transfer confirmations");
    (err as any).status = 403;
    throw err;
  }
}

function assertCanReviewTransferConfirmation(access: FinanceAccess) {
  if (access.actorRole !== "ADMIN" && access.actorRole !== "CAPTAIN") {
    const err = new Error("Only captain or root admin can review transfer confirmations");
    (err as any).status = 403;
    throw err;
  }
}

function parseIdempotencyKey(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = raw.trim();
  if (!value) {
    const err = new Error("Idempotency-Key header must not be empty");
    (err as any).status = 400;
    throw err;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    const err = new Error("Idempotency-Key must be 8-128 chars: letters, digits, . _ : -");
    (err as any).status = 400;
    throw err;
  }
  return value;
}

function isPgUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as any).code === "23505");
}

function mapTransaction(row: TransactionRow) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    title: row.title,
    date: row.date,
    userId: row.user_id,
    userName: row.user_name_snapshot,
    status: row.status,
  };
}

function mapTransferConfirmation(row: TransferConfirmationRow) {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    userName: row.user_name,
    userNickname: row.user_nickname,
    amount: Number(row.amount),
    screenshotDataUrl: row.screenshot_data_url,
    note: row.note ?? undefined,
    reviewNote: row.review_note ?? undefined,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? undefined,
    submittedBy: {
      userId: row.submitted_by_user_id,
      name: row.submitted_by_name ?? undefined,
    },
    reviewedBy: row.reviewed_by_user_id
      ? {
          userId: row.reviewed_by_user_id,
          name: row.reviewed_by_name ?? undefined,
        }
      : undefined,
    transactionId: row.transaction_id ?? undefined,
  };
}

async function findIdempotentTransaction(params: {
  queryFn: (text: string, values?: unknown[]) => Promise<{ rows: TransactionRow[] }>;
  teamId: string;
  scope: string;
  key: string;
}): Promise<TransactionRow | null> {
  const existing = await params.queryFn(
    `SELECT id,
            team_id,
            type,
            amount::text,
            title,
            date,
            user_id,
            user_name_snapshot,
            status
     FROM transactions
     WHERE team_id = $1
       AND idempotency_scope = $2
       AND idempotency_key = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.teamId, params.scope, params.key]
  );
  return existing.rows[0] || null;
}

async function syncEventFinanceState(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ finance_state: EventFinanceState }> }> },
  eventId: string
): Promise<EventFinanceState> {
  const stateResult = await client.query(
     `WITH charge_paid AS (
       SELECT c.id,
              c.amount_due,
              COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
       FROM event_member_charges c
       JOIN team_memberships tm ON tm.team_id = c.team_id AND tm.user_id = c.user_id AND tm.role IN ('PLAYER','TRAINER')
       LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
       WHERE c.event_id = $1
       GROUP BY c.id, c.amount_due
     )
     UPDATE events e
     SET finance_state = (
       CASE
         WHEN totals.charged_total <= 0 THEN 'NOT_CALCULATED'::event_finance_state
         WHEN totals.outstanding_total > 0 THEN 'COLLECTING'::event_finance_state
         ELSE 'CLOSED'::event_finance_state
       END
     )
     FROM (
       SELECT COALESCE(SUM(amount_due), 0)::numeric AS charged_total,
              COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0)::numeric AS outstanding_total
       FROM charge_paid
     ) totals
     WHERE e.id = $1
     RETURNING e.finance_state::text`,
    [eventId]
  );
  return (stateResult.rows[0]?.finance_state || EVENT_FINANCE_STATE_NOT_CALCULATED) as EventFinanceState;
}

async function getPendingTransferConfirmationCount(teamId: string, userId?: string): Promise<number> {
  const result = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM finance_payment_confirmations
     WHERE team_id = $1
       AND status = 'PENDING_REVIEW'
       AND ($2::uuid IS NULL OR user_id = $2)`,
    [teamId, userId ?? null]
  );
  return Number(result.rows[0]?.total || "0");
}

async function loadOutstandingChargeCandidates(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ charge_id: string; event_id: string; outstanding: string; start_at: string }> }> },
  teamId: string,
  userId: string
) {
  const result = await client.query(
    `WITH charge_paid AS (
       SELECT c.id AS charge_id,
              c.event_id,
              e.start_at,
              c.amount_due,
              COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
       FROM event_member_charges c
       JOIN events e ON e.id = c.event_id
       JOIN team_memberships tm ON tm.team_id = c.team_id AND tm.user_id = c.user_id AND tm.role IN ('PLAYER','TRAINER')
       LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
       WHERE c.team_id = $1 AND c.user_id = $2
       GROUP BY c.id, c.event_id, e.start_at, c.amount_due
     )
     SELECT charge_id,
            event_id,
            GREATEST(amount_due - amount_paid, 0)::text AS outstanding,
            start_at::text
     FROM charge_paid
     WHERE GREATEST(amount_due - amount_paid, 0) > 0
     ORDER BY start_at ASC, charge_id ASC`,
    [teamId, userId]
  );

  return result.rows.map((row) => ({
    chargeId: row.charge_id,
    eventId: row.event_id,
    outstanding: Number(row.outstanding),
    startAt: row.start_at,
  }));
}

async function loadTransferConfirmationRow(
  queryFn: (text: string, values?: unknown[]) => Promise<{ rows: TransferConfirmationRow[] }>,
  confirmationId: string,
  options?: { forUpdate?: boolean }
): Promise<TransferConfirmationRow | null> {
  const result = await queryFn(
    `SELECT c.id,
            c.team_id,
            c.user_id,
            u.name AS user_name,
            u.nickname AS user_nickname,
            c.amount::text,
            c.screenshot_data_url,
            c.note,
            c.review_note,
            c.status::text,
            c.submitted_at::text,
            c.reviewed_at::text,
            c.submitted_by_user_id,
            submitter.name AS submitted_by_name,
            c.reviewed_by_user_id,
            reviewer.name AS reviewed_by_name,
            c.transaction_id
     FROM finance_payment_confirmations c
     JOIN users u ON u.id = c.user_id
     JOIN users submitter ON submitter.id = c.submitted_by_user_id
     LEFT JOIN users reviewer ON reviewer.id = c.reviewed_by_user_id
     WHERE c.id = $1
     ${options?.forUpdate ? "FOR UPDATE" : ""}`,
    [confirmationId]
  );

  return result.rows[0] || null;
}

function handleKnownFinanceError(err: unknown, res: any): boolean {
  if (err && typeof err === "object" && "status" in err) {
    res.status((err as any).status).json({ detail: (err as any).message || "Finance access error" });
    return true;
  }
  return false;
}

export const financeRouter = Router();

financeRouter.get(
  "/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const parsed = financeQuerySchema.parse(req.query ?? {});
      const access = await resolveFinanceAccess(req as any, parsed.teamId);
      assertCanReadFinance(access);

      const teamResult = await query<{ id: string; name: string; budget: string }>(
        `SELECT id, name, budget::text FROM teams WHERE id = $1`,
        [access.teamId]
      );
      const team = teamResult.rows[0];
      if (!team) return res.status(404).json({ detail: "Team not found" });

      const scopedUserId = access.actorRole === "PLAYER" ? access.userId : null;
      const summaryResult = await query<{
        outstanding_total: string;
        open_charges_total: string;
        overdue_count: string;
      }>(
        `WITH charge_paid AS (
           SELECT c.id,
                  c.amount_due,
                  COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
           FROM event_member_charges c
           JOIN team_memberships tm ON tm.team_id = c.team_id AND tm.user_id = c.user_id AND tm.role IN ('PLAYER','TRAINER')
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.team_id = $1
             AND ($2::uuid IS NULL OR c.user_id = $2)
           GROUP BY c.id
         )
         SELECT
           COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0)::text AS outstanding_total,
           COALESCE(SUM(amount_due), 0)::text AS open_charges_total,
           COALESCE(SUM(CASE WHEN amount_due > amount_paid THEN 1 ELSE 0 END), 0)::text AS overdue_count
         FROM charge_paid`,
        [access.teamId, scopedUserId]
      );

      const pendingDepositsResult = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount),0)::text AS total
         FROM transactions
         WHERE team_id = $1
           AND type = 'DEPOSIT'
           AND status = 'PENDING'
           AND ($2::uuid IS NULL OR user_id = $2)`,
        [access.teamId, scopedUserId]
      );

      const recentTransactionsResult = await query<{
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
           AND ($2::uuid IS NULL OR user_id = $2)
         ORDER BY date DESC
         LIMIT 20`,
        [access.teamId, scopedUserId]
      );

      const topDebtorsResult =
        access.actorRole === "PLAYER"
          ? { rows: [] as Array<{ user_id: string; name: string; nickname: string; avatar: string | null; debt: string }> }
          : await query<{
              user_id: string;
              name: string;
              nickname: string;
              avatar: string | null;
              debt: string;
            }>(
              `WITH charge_paid AS (
                 SELECT c.user_id,
                        c.amount_due,
                        COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
                 FROM event_member_charges c
                 JOIN team_memberships tm ON tm.team_id = c.team_id AND tm.user_id = c.user_id AND tm.role IN ('PLAYER','TRAINER')
                 LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
                 WHERE c.team_id = $1
                 GROUP BY c.id, c.user_id
               )
               SELECT u.id AS user_id, u.name, u.nickname, u.avatar,
                      COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)),0)::text AS debt
               FROM charge_paid cp
               JOIN users u ON u.id = cp.user_id
               GROUP BY u.id, u.name, u.nickname, u.avatar
               HAVING COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)),0) > 0
               ORDER BY SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)) DESC
               LIMIT 10`,
              [access.teamId]
            );
      const pendingConfirmations = await getPendingTransferConfirmationCount(access.teamId, scopedUserId ?? undefined);

      const summary = summaryResult.rows[0] || {
        outstanding_total: "0",
        open_charges_total: "0",
        overdue_count: "0",
      };

      return res.json({
        team: {
          id: team.id,
          name: team.name,
          budget: access.actorRole === "PLAYER" ? undefined : Number(team.budget),
        },
        summary: {
          balance: access.actorRole === "PLAYER" ? undefined : Number(team.budget),
          totalOutstanding: Number(summary.outstanding_total),
          totalEventChargesOpen: Number(summary.open_charges_total),
          overdueCount: Number(summary.overdue_count),
          pendingDeposits: Number(pendingDepositsResult.rows[0]?.total || "0"),
          pendingConfirmations,
        },
        recentTransactions: recentTransactionsResult.rows.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          title: t.title,
          date: t.date,
          userId: t.user_id,
          userName: t.user_name_snapshot,
          status: t.status,
        })),
        topDebtors: topDebtorsResult.rows.map((row) => ({
          userId: row.user_id,
          name: row.name,
          nickname: row.nickname,
          avatar: row.avatar,
          debt: Number(row.debt),
        })),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.get(
  "/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const parsed = financeQuerySchema.parse(req.query ?? {});
      const access = await resolveFinanceAccess(req as any, parsed.teamId);
      assertCanReadFinance(access);

      const rows = await query<{
        event_id: string;
        title: string;
        type: string;
        start_at: string;
        cost: string | null;
        cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
        finance_state: EventFinanceState;
        expense_total: string;
        charged_total: string;
        paid_total: string;
        outstanding_total: string;
        members_charged: string;
        members_paid: string;
      }>(
        `WITH charge_paid AS (
           SELECT c.id,
                  c.event_id,
                  c.amount_due,
                  COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
           FROM event_member_charges c
           JOIN team_memberships tm ON tm.team_id = c.team_id AND tm.user_id = c.user_id AND tm.role IN ('PLAYER','TRAINER')
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.team_id = $1
           GROUP BY c.id, c.event_id
         )
         , event_expenses AS (
           SELECT t.event_id,
                  COALESCE(SUM(t.amount), 0)::numeric AS expense_total
           FROM transactions t
           WHERE t.team_id = $1
             AND t.type = 'EXPENSE'
             AND t.status = 'COMPLETED'
             AND t.event_id IS NOT NULL
           GROUP BY t.event_id
         )
         SELECT e.id AS event_id,
                e.title,
                e.type::text,
                e.start_at,
                e.cost::text,
                e.cost_status::text,
                e.finance_state::text,
                COALESCE(ex.expense_total, 0)::text AS expense_total,
                COALESCE(SUM(cp.amount_due), 0)::text AS charged_total,
                COALESCE(SUM(cp.amount_paid), 0)::text AS paid_total,
                COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::text AS outstanding_total,
                COALESCE(COUNT(cp.id), 0)::text AS members_charged,
                COALESCE(SUM(CASE WHEN cp.amount_paid >= cp.amount_due AND cp.id IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS members_paid
         FROM events e
         LEFT JOIN charge_paid cp ON cp.event_id = e.id
         LEFT JOIN event_expenses ex ON ex.event_id = e.id
         WHERE e.team_id = $1 AND e.is_cancelled = FALSE
         GROUP BY e.id, e.title, e.type, e.start_at, e.cost, e.cost_status, e.finance_state, ex.expense_total
         ORDER BY e.start_at DESC`,
        [access.teamId]
      );

      return res.json({
        items: rows.rows.map((row) => {
          const chargedTotal = Number(row.charged_total);
          const paidTotal = Number(row.paid_total);
          const outstandingTotal = Number(row.outstanding_total);
          const collection = {
            ...buildEventCollectionProjection({
              expenseTotal: Number(row.expense_total),
              charges: [{ amountDue: chargedTotal, amountPaid: paidTotal }],
            }),
            membersCharged: Number(row.members_charged),
            membersPaid: Number(row.members_paid),
          };
          return {
            eventId: row.event_id,
            title: row.title,
            type: row.type,
            startDate: row.start_at,
            costStatus: row.cost_status,
            plannedTotal: row.cost !== null ? Number(row.cost) : undefined,
            expenseTotal: collection.expenseTotal,
            collectionTargetTotal: collection.collectionTargetTotal,
            chargedTotal,
            paidTotal,
            outstandingTotal,
            undistributedTotal: collection.undistributedTotal,
            remainingToCollect: collection.remainingToCollect,
            overpaidTotal: collection.overpaidTotal,
            membersCharged: Number(row.members_charged),
            membersPaid: Number(row.members_paid),
            state: row.finance_state,
            collectionState: collection.state,
          };
        }),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.get(
  "/events/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const eventId = z.string().uuid().parse(req.params.eventId);
      const eventResult = await query<{
        id: string;
        team_id: string;
        title: string;
        type: string;
        start_at: string;
        location: string | null;
        cost: string | null;
        cost_status: "UNKNOWN" | "ESTIMATED" | "FINAL";
        finance_state: EventFinanceState;
      }>(
        `SELECT id, team_id, title, type::text, start_at, location, cost::text, cost_status::text, finance_state::text
         FROM events
         WHERE id = $1`,
        [eventId]
      );
      const event = eventResult.rows[0];
      if (!event) return res.status(404).json({ detail: "Event not found" });

      const access = await resolveFinanceAccess(req as any, event.team_id);
      assertCanReadTeamFinance(access);

      const participantsResult = await query<{
        user_id: string;
        name: string;
        nickname: string;
        avatar: string | null;
        role: "CAPTAIN" | "TRAINER" | "PLAYER";
        member_status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
        rsvp_status: "PENDING" | "CONFIRMED" | "DECLINED" | null;
        amount_due: string | null;
        amount_paid: string | null;
      }>(
        `WITH paid AS (
           SELECT c.id AS charge_id, COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
           FROM event_member_charges c
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.event_id = $1
           GROUP BY c.id
         )
         SELECT u.id AS user_id,
                u.name,
                u.nickname,
                u.avatar,
                tm.role::text AS role,
                tm.status::text AS member_status,
                r.status::text AS rsvp_status,
                c.amount_due::text,
                p.amount_paid::text
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id
         LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
         LEFT JOIN event_member_charges c ON c.event_id = $1 AND c.user_id = tm.user_id
         LEFT JOIN paid p ON p.charge_id = c.id
         WHERE tm.team_id = $2 AND u.is_active = TRUE
         ORDER BY u.name ASC`,
        [eventId, event.team_id]
      );

      const financeParticipants = participantsResult.rows.filter((row) => row.role !== "CAPTAIN");

      const summary = financeParticipants.reduce(
        (acc, row) => {
          const due = Number(row.amount_due || 0);
          const paid = Number(row.amount_paid || 0);
          acc.chargedTotal += due;
          acc.paidTotal += paid;
          acc.outstandingTotal += Math.max(0, due - paid);
          return acc;
        },
        { chargedTotal: 0, paidTotal: 0, outstandingTotal: 0 }
      );

      const paymentsResult = await query<{
        transaction_id: string;
        date: string;
        type: "DEPOSIT" | "EXPENSE" | "FEE";
        title: string;
        amount: string;
        payer_user_id: string | null;
        payer_name: string | null;
        status: "PENDING" | "COMPLETED";
        allocation_user_id: string | null;
        allocation_amount: string | null;
      }>(
        `SELECT t.id AS transaction_id,
                t.date,
                t.type,
                t.title,
                t.amount::text,
                t.user_id AS payer_user_id,
                t.user_name_snapshot AS payer_name,
                t.status,
                c.user_id AS allocation_user_id,
                a.amount::text AS allocation_amount
         FROM transactions t
         LEFT JOIN event_payment_allocations a ON a.transaction_id = t.id
         LEFT JOIN event_member_charges c ON c.id = a.event_member_charge_id
         WHERE t.team_id = $1
           AND (
             t.event_id = $2
             OR a.id IS NOT NULL AND c.event_id = $2
           )
         ORDER BY t.date DESC, t.id`,
        [event.team_id, eventId]
      );

      const paymentsMap = new Map<
        string,
        {
          transactionId: string;
          date: string;
          type: "DEPOSIT" | "EXPENSE" | "FEE";
          title: string;
          amount: number;
          payerUserId?: string;
          payerName?: string;
          status: "PENDING" | "COMPLETED";
          allocations: Array<{ userId: string; amount: number }>;
        }
      >();
      for (const row of paymentsResult.rows) {
        const base =
          paymentsMap.get(row.transaction_id) ||
          {
            transactionId: row.transaction_id,
            date: row.date,
            type: row.type,
            title: row.title,
            amount: Number(row.amount),
            payerUserId: row.payer_user_id ?? undefined,
            payerName: row.payer_name ?? undefined,
            status: row.status,
            allocations: [],
          };
        if (row.allocation_user_id && row.allocation_amount) {
          base.allocations.push({ userId: row.allocation_user_id, amount: Number(row.allocation_amount) });
        }
        paymentsMap.set(row.transaction_id, base);
      }

      const collection = buildEventCollectionProjection({
        expenseTotal: Array.from(paymentsMap.values())
          .filter((item) => item.type === "EXPENSE" && item.status === "COMPLETED")
          .reduce((sum, item) => sum + Number(item.amount || 0), 0),
        charges: financeParticipants.map((row) => ({
          amountDue: Number(row.amount_due || 0),
          amountPaid: Number(row.amount_paid || 0),
        })),
      });

      return res.json({
        event: {
          id: event.id,
          title: event.title,
          type: event.type,
          startDate: event.start_at,
          location: event.location,
          cost: event.cost !== null ? Number(event.cost) : undefined,
          costStatus: event.cost_status,
          financeState: event.finance_state,
        },
        summary: {
          chargedTotal: summary.chargedTotal,
          paidTotal: summary.paidTotal,
          outstandingTotal: summary.outstandingTotal,
          collectionRatePct: summary.chargedTotal > 0 ? Math.round((summary.paidTotal / summary.chargedTotal) * 100) : 0,
        },
        collection: {
          expenseTotal: collection.expenseTotal,
          targetTotal: collection.collectionTargetTotal,
          chargedTotal: collection.chargedTotal,
          paidTotal: collection.paidTotal,
          undistributedTotal: collection.undistributedTotal,
          remainingToCollect: collection.remainingToCollect,
          overpaidTotal: collection.overpaidTotal,
          membersCharged: collection.membersCharged,
          membersPaid: collection.membersPaid,
          state: collection.state,
        },
        participants: financeParticipants.map((row) => {
          const amountDue = Number(row.amount_due || 0);
          const amountPaid = Number(row.amount_paid || 0);
          const amountOutstanding = Math.max(0, amountDue - amountPaid);
          const chargeStatus =
            amountDue <= 0 ? "PENDING" : amountOutstanding <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "PENDING";
          return {
            userId: row.user_id,
            name: row.name,
            nickname: row.nickname,
            avatar: row.avatar,
            role: row.role,
            memberStatus: row.member_status,
            rsvpStatus: row.rsvp_status ?? "UNANSWERED",
            amountDue,
            amountPaid,
            amountOutstanding,
            chargeStatus,
          };
        }),
        payments: Array.from(paymentsMap.values()),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.post(
  "/events/:eventId/charges/generate",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const eventId = z.string().uuid().parse(req.params.eventId);
      const payload = generateChargesSchema.parse(req.body ?? {});
      const idempotencyKey = parseIdempotencyKey(req.header(IDEMPOTENCY_HEADER));
      const eventResult = await query<{ id: string; team_id: string; finance_state: EventFinanceState }>(
        `SELECT id, team_id, finance_state::text FROM events WHERE id = $1 AND is_cancelled = FALSE`,
        [eventId]
      );
      const event = eventResult.rows[0];
      if (!event) return res.status(404).json({ detail: "Event not found" });

      const access = await resolveFinanceAccess(req as any, event.team_id);
      assertCanWriteFinance(access);
      if (event.finance_state === EVENT_FINANCE_STATE_CLOSED) {
        return res.status(409).json({ detail: "Event finance is CLOSED. Use correction transaction instead." });
      }
      if (payload.overwriteExisting && event.finance_state !== EVENT_FINANCE_STATE_NOT_CALCULATED) {
        return res.status(409).json({ detail: "Cannot overwrite charges after collection has started." });
      }

      const hasExplicitSelection = Array.isArray(payload.custom) && payload.custom.length > 0;
      let customMap = new Map<string, number>();
      if (payload.amountType === "CUSTOM" || hasExplicitSelection) {
        customMap = new Map((payload.custom || []).map((item) => [item.userId, item.amount]));
      }
      if (payload.amountType === "CUSTOM" && customMap.size === 0) {
        return res.status(400).json({ detail: "custom list is required for CUSTOM amountType" });
      }
      if (payload.amountType === "FIXED_PER_PERSON" && payload.fixedAmount === undefined) {
        return res.status(400).json({ detail: "fixedAmount is required for FIXED_PER_PERSON" });
      }
      if (payload.amountType === "TOTAL_SPLIT" && payload.totalAmount === undefined) {
        return res.status(400).json({ detail: "totalAmount is required for TOTAL_SPLIT" });
      }

      let undistributedAmount = 0;
      if (payload.amountType === "UNDISTRIBUTED_SPLIT") {
        const [expenseResult, chargesResult] = await Promise.all([
          query<{ total: string }>(
            `SELECT COALESCE(SUM(amount), 0)::text AS total
             FROM transactions
             WHERE event_id = $1
               AND team_id = $2
               AND type = 'EXPENSE'
               AND status = 'COMPLETED'`,
            [eventId, event.team_id]
          ),
          query<{ role: "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER"; amount_due: string; amount_paid: string }>(
            `SELECT tm.role::text AS role,
                    c.amount_due::text AS amount_due,
                    COALESCE(SUM(a.amount), 0)::text AS amount_paid
             FROM event_member_charges c
             JOIN team_memberships tm
               ON tm.team_id = c.team_id
              AND tm.user_id = c.user_id
             LEFT JOIN event_payment_allocations a
               ON a.event_member_charge_id = c.id
             WHERE c.event_id = $1
               AND c.team_id = $2
             GROUP BY c.id, tm.role, c.amount_due`,
            [eventId, event.team_id]
          ),
        ]);

        const collection = buildEventCollectionProjectionForAudience({
          expenseTotal: Number(expenseResult.rows[0]?.total || 0),
          charges: chargesResult.rows.map((row) => ({
            role: row.role,
            amountDue: Number(row.amount_due || 0),
            amountPaid: Number(row.amount_paid || 0),
          })),
        });

        undistributedAmount = Number(collection.undistributedTotal || 0);
        if (!Number.isFinite(undistributedAmount) || undistributedAmount <= 0) {
          return res.status(409).json({
            detail: "По событию нет нераспределенных расходов. Используйте доначисление или корректировку.",
            code: "NO_UNDISTRIBUTED_AMOUNT",
          });
        }
      }

      const participantRows =
        hasExplicitSelection
          ? await query<{ user_id: string; role: "CAPTAIN" | "TRAINER" | "PLAYER"; existing_amount_due: string | null }>(
              `SELECT tm.user_id,
                      tm.role::text AS role,
                      c.amount_due::text AS existing_amount_due
               FROM team_memberships tm
               LEFT JOIN event_member_charges c ON c.event_id = $1 AND c.user_id = tm.user_id
               WHERE tm.team_id = $2
                 AND tm.user_id = ANY($3::uuid[])`,
              [eventId, event.team_id, Array.from(customMap.keys())]
            )
          : await query<{ user_id: string; role: "CAPTAIN" | "TRAINER" | "PLAYER"; existing_amount_due: string | null }>(
              `SELECT tm.user_id,
                      tm.role::text AS role,
                      c.amount_due::text AS existing_amount_due
               FROM team_memberships tm
               LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
               LEFT JOIN event_member_charges c ON c.event_id = $1 AND c.user_id = tm.user_id
               WHERE tm.team_id = $2
                 AND (
                   ($3 = 'CONFIRMED_ONLY' AND r.status = 'CONFIRMED')
                   OR
                   ($3 = 'CONFIRMED_AND_PENDING' AND r.status IN ('CONFIRMED','PENDING'))
                 )`,
              [eventId, event.team_id, payload.mode]
            );

      const selectedParticipants = hasExplicitSelection
        ? participantRows.rows
        : filterAutoEventChargeMembers(participantRows.rows);

      if (hasExplicitSelection) {
        const found = new Set(participantRows.rows.map((row) => row.user_id));
        const missing = Array.from(customMap.keys()).filter((id) => !found.has(id));
        if (missing.length > 0) {
          return res.status(400).json({ detail: "Some selected users are not in team", missingUserIds: missing });
        }
      }

      const generationValidation = validateEventChargeGeneration({
        candidates: selectedParticipants.map((row) => ({
          userId: row.user_id,
          role: row.role,
          existingAmountDue: Number(row.existing_amount_due || 0),
        })),
        amountType: payload.amountType,
        overwriteExisting: payload.overwriteExisting,
        fixedAmount: payload.fixedAmount,
      });
      if (!generationValidation.ok) {
        return res.status(409).json({
          detail: generationValidation.detail,
          code: generationValidation.code,
          existingChargeCount: generationValidation.existingChargeCount,
          missingChargeCount: generationValidation.missingChargeCount,
          suggestedFixedAmount: generationValidation.suggestedFixedAmount,
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let affected = 0;
        let splitAmountsByUser = new Map<string, number>();
        if (payload.amountType === "TOTAL_SPLIT" || payload.amountType === "UNDISTRIBUTED_SPLIT") {
          const userIds = selectedParticipants.map((row) => row.user_id);
          if (userIds.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ detail: "No participants selected for charge generation" });
          }
          const splitSourceAmount =
            payload.amountType === "UNDISTRIBUTED_SPLIT" ? undistributedAmount : Number(payload.totalAmount || 0);
          const totalCents = Math.round(splitSourceAmount * 100);
          const base = Math.floor(totalCents / userIds.length);
          let remainder = totalCents - base * userIds.length;
          for (const userId of userIds) {
            const cents = base + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder -= 1;
            splitAmountsByUser.set(userId, cents / 100);
          }
        }

        for (const row of selectedParticipants) {
          const amountDue =
            payload.amountType === "FIXED_PER_PERSON"
              ? Number(payload.fixedAmount || 0)
              : payload.amountType === "TOTAL_SPLIT" || payload.amountType === "UNDISTRIBUTED_SPLIT"
              ? Number(splitAmountsByUser.get(row.user_id) || 0)
              : Number(customMap.get(row.user_id) || 0);
          if (amountDue < 0) continue;
          if (payload.overwriteExisting) {
            await client.query(
              `INSERT INTO event_member_charges (event_id, user_id, team_id, amount_due, created_by, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (event_id, user_id)
               DO UPDATE SET amount_due = EXCLUDED.amount_due, idempotency_key = EXCLUDED.idempotency_key, updated_at = NOW()
               `,
              [eventId, row.user_id, event.team_id, amountDue, access.userId, idempotencyKey ?? null]
            );
            affected += 1;
          } else if (payload.amountType === "UNDISTRIBUTED_SPLIT") {
            const values = [eventId, row.user_id, event.team_id, amountDue, access.userId, idempotencyKey ?? null];
            const incrementQuery = idempotencyKey
              ? `INSERT INTO event_member_charges (event_id, user_id, team_id, amount_due, created_by, idempotency_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (event_id, user_id)
                 DO UPDATE SET
                   amount_due = event_member_charges.amount_due + EXCLUDED.amount_due,
                   idempotency_key = EXCLUDED.idempotency_key,
                   updated_at = NOW()
                 WHERE event_member_charges.idempotency_key IS DISTINCT FROM EXCLUDED.idempotency_key`
              : `INSERT INTO event_member_charges (event_id, user_id, team_id, amount_due, created_by, idempotency_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (event_id, user_id)
                 DO UPDATE SET
                   amount_due = event_member_charges.amount_due + EXCLUDED.amount_due,
                   updated_at = NOW()`;
            const upserted = await client.query(incrementQuery, values);
            affected += upserted.rowCount || 0;
          } else {
            const inserted = await client.query(
              `INSERT INTO event_member_charges (event_id, user_id, team_id, amount_due, created_by, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (event_id, user_id) DO NOTHING`,
              [eventId, row.user_id, event.team_id, amountDue, access.userId, idempotencyKey ?? null]
            );
            affected += inserted.rowCount || 0;
          }
        }
        const nextState = await syncEventFinanceState(
          { query: (text, values) => client.query<{ finance_state: EventFinanceState }>(text, values) },
          eventId
        );
        await client.query("COMMIT");
        await writeAudit(access.userId, "finance.event_charges.generate", {
          teamId: event.team_id,
          eventId,
          mode: payload.mode,
          amountType: payload.amountType,
          overwriteExisting: payload.overwriteExisting,
          idempotencyKey: idempotencyKey ?? null,
          nextFinanceState: nextState,
          affected,
        });
        return res.status(201).json({ success: true, affected, financeState: nextState });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.post(
  "/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const payload = createPaymentSchema.parse(req.body ?? {});
      const access = await resolveFinanceAccess(req as any, payload.teamId);
      assertCanWriteFinance(access);
      const idempotencyKey = parseIdempotencyKey(req.header(IDEMPOTENCY_HEADER));

      if (idempotencyKey) {
        const replay = await findIdempotentTransaction({
          queryFn: (text, values) => query<TransactionRow>(text, values),
          teamId: access.teamId,
          scope: IDEMPOTENCY_SCOPE_PAYMENT_CREATE,
          key: idempotencyKey,
        });
        if (replay) {
          return res.status(200).json({
            success: true,
            idempotentReplay: true,
            transaction: mapTransaction(replay),
          });
        }
      }

      if (payload.allocations?.length) {
        const allocationTotal = payload.allocations.reduce((sum, a) => sum + a.amount, 0);
        if (allocationTotal - payload.amount > 0.0001) {
          return res.status(400).json({ detail: "Allocations total cannot exceed payment amount" });
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        let payerNameSnapshot: string | null = null;
        if (payload.payerUserId) {
          const payer = await client.query<{ name: string }>(
            `SELECT u.name
             FROM team_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.team_id = $1 AND tm.user_id = $2`,
            [access.teamId, payload.payerUserId]
          );
          if (!payer.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ detail: "Payer is not in team" });
          }
          payerNameSnapshot = payer.rows[0].name;
        }

        const tx = await client.query<TransactionRow>(
          `INSERT INTO transactions (
             team_id,
             type,
             amount,
             title,
             date,
             user_id,
             user_name_snapshot,
             status,
             created_by,
             event_id,
             idempotency_key,
             idempotency_scope
           )
           VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, $6, $7::transaction_status, $8, $9, $10, $11)
           RETURNING id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status`,
          [
            access.teamId,
            payload.amount,
            payload.title,
            payload.date ? new Date(payload.date).toISOString() : new Date().toISOString(),
            payload.payerUserId ?? null,
            payerNameSnapshot,
            payload.status ?? "COMPLETED",
            access.userId,
            payload.eventId ?? null,
            idempotencyKey ?? null,
            IDEMPOTENCY_SCOPE_PAYMENT_CREATE,
          ]
        );

        if ((payload.status ?? "COMPLETED") === "COMPLETED") {
          await client.query(`UPDATE teams SET budget = budget + $1 WHERE id = $2`, [payload.amount, access.teamId]);
          if (payload.payerUserId) {
            await client.query(`UPDATE team_memberships SET balance = balance + $1 WHERE team_id = $2 AND user_id = $3`, [
              payload.amount,
              access.teamId,
              payload.payerUserId,
            ]);
          }
        }

        if (payload.allocations?.length) {
          for (const allocation of payload.allocations) {
            const chargeRow = await client.query<{ id: string }>(
              `SELECT c.id
               FROM event_member_charges c
               WHERE c.event_id = $1 AND c.user_id = $2 AND c.team_id = $3`,
              [allocation.eventId, allocation.userId, access.teamId]
            );
            if (!chargeRow.rowCount) {
              await client.query("ROLLBACK");
              return res.status(400).json({ detail: "Charge not found for allocation" });
            }
            await client.query(
              `INSERT INTO event_payment_allocations (transaction_id, event_member_charge_id, amount, created_by, idempotency_key)
               VALUES ($1, $2, $3, $4, $5)`,
              [tx.rows[0].id, chargeRow.rows[0].id, allocation.amount, access.userId, idempotencyKey ?? null]
            );
          }
        }

        const affectedEventIds = new Set<string>();
        if (payload.eventId) affectedEventIds.add(payload.eventId);
        for (const allocation of payload.allocations || []) {
          affectedEventIds.add(allocation.eventId);
        }
        for (const affectedEventId of affectedEventIds) {
          await syncEventFinanceState(
            { query: (text, values) => client.query<{ finance_state: EventFinanceState }>(text, values) },
            affectedEventId
          );
        }

        await client.query("COMMIT");
        await writeAudit(access.userId, "finance.payment.create", {
          transactionId: tx.rows[0].id,
          teamId: access.teamId,
          amount: payload.amount,
          allocations: payload.allocations?.length || 0,
        });
        return res.status(201).json({
          success: true,
          idempotentReplay: false,
          transaction: {
            ...mapTransaction(tx.rows[0]),
          },
        });
      } catch (e) {
        await client.query("ROLLBACK");
        if (idempotencyKey && isPgUniqueViolation(e)) {
          const replay = await findIdempotentTransaction({
            queryFn: (text, values) => client.query<TransactionRow>(text, values),
            teamId: access.teamId,
            scope: IDEMPOTENCY_SCOPE_PAYMENT_CREATE,
            key: idempotencyKey,
          });
          if (replay) {
            return res.status(200).json({
              success: true,
              idempotentReplay: true,
              transaction: mapTransaction(replay),
            });
          }
        }
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.get(
  "/confirmations",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const parsed = financeQuerySchema.parse(req.query ?? {});
      const access = await resolveFinanceAccess(req as any, parsed.teamId);
      assertCanReadFinance(access);

      const scopedUserId = access.actorRole === "PLAYER" ? access.userId : null;
      const rows = await query<TransferConfirmationRow>(
        `SELECT c.id,
                c.team_id,
                c.user_id,
                u.name AS user_name,
                u.nickname AS user_nickname,
                c.amount::text,
                c.screenshot_data_url,
                c.note,
                c.review_note,
                c.status::text,
                c.submitted_at::text,
                c.reviewed_at::text,
                c.submitted_by_user_id,
                submitter.name AS submitted_by_name,
                c.reviewed_by_user_id,
                reviewer.name AS reviewed_by_name,
                c.transaction_id
         FROM finance_payment_confirmations c
         JOIN users u ON u.id = c.user_id
         JOIN users submitter ON submitter.id = c.submitted_by_user_id
         LEFT JOIN users reviewer ON reviewer.id = c.reviewed_by_user_id
         WHERE c.team_id = $1
           AND ($2::uuid IS NULL OR c.user_id = $2)
         ORDER BY CASE WHEN c.status = 'PENDING_REVIEW' THEN 0 ELSE 1 END, c.created_at DESC
         LIMIT 50`,
        [access.teamId, scopedUserId]
      );

      return res.json({
        items: rows.rows.map(mapTransferConfirmation),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.post(
  "/confirmations",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const payload = createTransferConfirmationSchema.parse(req.body ?? {});
      const access = await resolveFinanceAccess(req as any, payload.teamId);
      assertCanReadFinance(access);

      const targetUserId = payload.userId ?? access.userId;
      assertCanSubmitTransferConfirmation(access, targetUserId);
      if (!isTransferScreenshotDataUrl(payload.screenshotDataUrl)) {
        return res.status(400).json({ detail: "Screenshot must be a PNG, JPEG, or WEBP data URL" });
      }

      const membershipResult = await query<{ user_id: string }>(
        `SELECT user_id
         FROM team_memberships
         WHERE team_id = $1 AND user_id = $2`,
        [access.teamId, targetUserId]
      );
      if (!membershipResult.rowCount) {
        return res.status(400).json({ detail: "Target user is not in active team" });
      }

      const inserted = await query<{ id: string }>(
        `INSERT INTO finance_payment_confirmations (
           team_id,
           user_id,
           submitted_by_user_id,
           amount,
           screenshot_data_url,
           note,
           submitted_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          access.teamId,
          targetUserId,
          access.userId,
          payload.amount,
          payload.screenshotDataUrl,
          payload.note ?? null,
          payload.submittedAt ? new Date(payload.submittedAt).toISOString() : new Date().toISOString(),
        ]
      );

      const confirmation = await loadTransferConfirmationRow(
        (text, values) => query<TransferConfirmationRow>(text, values),
        inserted.rows[0].id
      );

      await writeAudit(access.userId, "finance.transfer_confirmation.create", {
        confirmationId: inserted.rows[0].id,
        teamId: access.teamId,
        userId: targetUserId,
        amount: payload.amount,
      });

      return res.status(201).json({
        success: true,
        confirmation: confirmation ? mapTransferConfirmation(confirmation) : null,
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.post(
  "/confirmations/:confirmationId/review",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const confirmationId = z.string().uuid().parse(req.params.confirmationId);
      const payload = reviewTransferConfirmationSchema.parse(req.body ?? {});

      const current = await loadTransferConfirmationRow(
        (text, values) => query<TransferConfirmationRow>(text, values),
        confirmationId
      );
      if (!current) return res.status(404).json({ detail: "Transfer confirmation not found" });

      const access = await resolveFinanceAccess(req as any, current.team_id);
      assertCanReviewTransferConfirmation(access);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await loadTransferConfirmationRow(
          (text, values) => client.query<TransferConfirmationRow>(text, values),
          confirmationId,
          { forUpdate: true }
        );
        if (!locked) {
          await client.query("ROLLBACK");
          return res.status(404).json({ detail: "Transfer confirmation not found" });
        }
        if (locked.status !== "PENDING_REVIEW") {
          await client.query("ROLLBACK");
          return res.status(409).json({ detail: "Transfer confirmation already reviewed" });
        }

        let transactionId: string | null = null;
        if (payload.decision === "APPROVE") {
          const payer = await client.query<{ name: string }>(
            `SELECT u.name
             FROM team_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.team_id = $1 AND tm.user_id = $2`,
            [locked.team_id, locked.user_id]
          );
          if (!payer.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ detail: "Payer is not in team" });
          }

          const tx = await client.query<TransactionRow>(
            `INSERT INTO transactions (
               team_id,
               type,
               amount,
               title,
               date,
               user_id,
               user_name_snapshot,
               status,
               created_by,
               idempotency_scope
             )
             VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, $6, 'COMPLETED', $7, $8)
             RETURNING id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status`,
            [
              locked.team_id,
              Number(locked.amount),
              "Подтверждение перевода",
              locked.submitted_at,
              locked.user_id,
              payer.rows[0].name,
              access.userId,
              "FINANCE_TRANSFER_CONFIRMATION_APPROVAL",
            ]
          );
          transactionId = tx.rows[0].id;

          await client.query(`UPDATE teams SET budget = budget + $1 WHERE id = $2`, [Number(locked.amount), locked.team_id]);
          await client.query(`UPDATE team_memberships SET balance = balance + $1 WHERE team_id = $2 AND user_id = $3`, [
            Number(locked.amount),
            locked.team_id,
            locked.user_id,
          ]);

          const candidates = await loadOutstandingChargeCandidates(
            { query: (text, values) => client.query(text, values) },
            locked.team_id,
            locked.user_id
          );
          const allocationPlan = planTransferConfirmationAllocations(
            candidates,
            Number(locked.amount),
            payload.preferredEventId
          );
          const affectedEventIds = new Set<string>();
          for (const allocation of allocationPlan) {
            await client.query(
              `INSERT INTO event_payment_allocations (transaction_id, event_member_charge_id, amount, created_by)
               VALUES ($1, $2, $3, $4)`,
              [transactionId, allocation.chargeId, allocation.amount, access.userId]
            );
            affectedEventIds.add(allocation.eventId);
          }
          for (const eventId of affectedEventIds) {
            await syncEventFinanceState(
              { query: (text, values) => client.query<{ finance_state: EventFinanceState }>(text, values) },
              eventId
            );
          }
        }

        await client.query(
          `UPDATE finance_payment_confirmations
           SET status = $2::finance_payment_confirmation_status,
               review_note = $3,
               reviewed_by_user_id = $4,
               reviewed_at = NOW(),
               transaction_id = $5
           WHERE id = $1`,
          [
            confirmationId,
            payload.decision === "APPROVE" ? "APPROVED" : "REJECTED",
            payload.reviewNote ?? null,
            access.userId,
            transactionId,
          ]
        );

        await client.query("COMMIT");

        const updated = await loadTransferConfirmationRow(
          (text, values) => query<TransferConfirmationRow>(text, values),
          confirmationId
        );
        await writeAudit(access.userId, "finance.transfer_confirmation.review", {
          confirmationId,
          teamId: locked.team_id,
          decision: payload.decision,
          transactionId,
        });

        return res.json({
          success: true,
          confirmation: updated ? mapTransferConfirmation(updated) : null,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.get(
  "/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const parsed = financeQuerySchema.parse(req.query ?? {});
      const access = await resolveFinanceAccess(req as any, parsed.teamId);
      assertCanReadFinance(access);

      const rows = await query<{
        user_id: string;
        name: string;
        nickname: string;
        avatar: string | null;
        role: "CAPTAIN" | "TRAINER" | "PLAYER";
        member_status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
        total_due: string;
        total_paid: string;
        outstanding: string;
        overpaid: string;
      }>(
        `WITH charge_paid AS (
           SELECT c.id,
                  c.user_id,
                  c.amount_due,
                  COALESCE(SUM(a.amount), 0)::numeric AS amount_paid
           FROM event_member_charges c
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.team_id = $1
           GROUP BY c.id, c.user_id, c.amount_due
         )
         SELECT u.id AS user_id,
                u.name,
                u.nickname,
                u.avatar,
                tm.role::text AS role,
                tm.status::text AS member_status,
                COALESCE(SUM(cp.amount_due), 0)::text AS total_due,
                COALESCE(SUM(cp.amount_paid), 0)::text AS total_paid,
                COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::text AS outstanding,
                COALESCE(SUM(GREATEST(cp.amount_paid - cp.amount_due, 0)), 0)::text AS overpaid
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id AND u.is_active = TRUE
         LEFT JOIN charge_paid cp ON cp.user_id = tm.user_id
         WHERE tm.team_id = $1
           AND tm.role IN ('PLAYER','TRAINER')
         GROUP BY u.id, u.name, u.nickname, u.avatar, tm.role, tm.status
         ORDER BY u.name ASC`,
        [access.teamId]
      );

      return res.json({
        items: filterFinanceMembersForActor(
          rows.rows.map((row) => ({
            userId: row.user_id,
            name: row.name,
            nickname: row.nickname,
            avatar: row.avatar,
            role: row.role,
            memberStatus: row.member_status,
            totalDue: Number(row.total_due),
            totalPaid: Number(row.total_paid),
            outstanding: Number(row.outstanding),
            overpaid: Number(row.overpaid),
          })),
          { actorRole: access.actorRole, actorUserId: access.userId }
        ),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

financeRouter.get(
  "/members/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const parsed = financeQuerySchema.parse(req.query ?? {});
      const access = await resolveFinanceAccess(req as any, parsed.teamId);
      assertCanReadFinance(access);
      assertCanReadMemberFinance(access, userId);

      const memberResult = await query<{
        user_id: string;
        name: string;
        nickname: string;
        avatar: string | null;
        role: "CAPTAIN" | "TRAINER" | "PLAYER";
        status: "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
        balance: string;
      }>(
        `SELECT u.id AS user_id, u.name, u.nickname, u.avatar, tm.role::text, tm.status::text, tm.balance::text
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = $1 AND tm.user_id = $2`,
        [access.teamId, userId]
      );
      const member = memberResult.rows[0];
      if (!member) return res.status(404).json({ detail: "Member not found" });

      const eventDebtsResult = await query<{
        event_id: string;
        title: string;
        date: string;
        amount_due: string;
        amount_paid: string;
      }>(
        `SELECT e.id AS event_id,
                e.title,
                e.start_at AS date,
                c.amount_due::text,
                COALESCE(SUM(a.amount),0)::text AS amount_paid
         FROM event_member_charges c
         JOIN events e ON e.id = c.event_id
         LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
         WHERE c.team_id = $1 AND c.user_id = $2
         GROUP BY e.id, e.title, e.start_at, c.amount_due
         ORDER BY e.start_at DESC`,
        [access.teamId, userId]
      );

      const paymentsResult = await query<{
        transaction_id: string;
        date: string;
        amount: string;
        title: string;
        allocated_amount: string;
      }>(
        `SELECT t.id AS transaction_id,
                t.date,
                t.amount::text,
                t.title,
                COALESCE(SUM(CASE WHEN c.user_id = $2 THEN a.amount ELSE 0 END),0)::text AS allocated_amount
         FROM transactions t
         LEFT JOIN event_payment_allocations a ON a.transaction_id = t.id
         LEFT JOIN event_member_charges c ON c.id = a.event_member_charge_id
         WHERE t.team_id = $1 AND (t.user_id = $2 OR c.user_id = $2)
         GROUP BY t.id, t.date, t.amount, t.title
         ORDER BY t.date DESC`,
        [access.teamId, userId]
      );

      const summary = eventDebtsResult.rows.reduce(
        (acc, row) => {
          const due = Number(row.amount_due);
          const paid = Number(row.amount_paid);
          acc.totalDue += due;
          acc.totalPaid += paid;
          if (Math.max(0, due - paid) > 0) acc.eventsWithDebt += 1;
          return acc;
        },
        { totalDue: 0, totalPaid: 0, eventsWithDebt: 0 }
      );

      return res.json({
        member: {
          userId: member.user_id,
          name: member.name,
          nickname: member.nickname,
          avatar: member.avatar,
          role: member.role,
          status: member.status,
          balance: Number(member.balance),
        },
        summary: {
          totalDue: summary.totalDue,
          totalPaid: summary.totalPaid,
          outstanding: Math.max(0, summary.totalDue - summary.totalPaid),
          eventsWithDebt: summary.eventsWithDebt,
        },
        eventDebts: eventDebtsResult.rows.map((row) => {
          const amountDue = Number(row.amount_due);
          const amountPaid = Number(row.amount_paid);
          const outstanding = Math.max(0, amountDue - amountPaid);
          return {
            eventId: row.event_id,
            title: row.title,
            date: row.date,
            amountDue,
            amountPaid,
            outstanding,
            chargeStatus: outstanding <= 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "PENDING",
          };
        }),
        payments: paymentsResult.rows.map((row) => ({
          transactionId: row.transaction_id,
          date: row.date,
          amount: Number(row.amount),
          title: row.title,
          allocatedAmount: Number(row.allocated_amount),
          unallocatedAmount: Math.max(0, Number(row.amount) - Number(row.allocated_amount)),
        })),
      });
    } catch (err) {
      if (handleKnownFinanceError(err, res)) return;
      throw err;
    }
  })
);

// Legacy endpoint kept for backward compatibility. Mounted under /api/transactions and /api/finance.
financeRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsedQuery = financeQuerySchema.parse(req.query ?? {});
    const access = await resolveFinanceAccess(req as any, parsedQuery.teamId);
    assertCanWriteFinance(access);
    const idempotencyKey = parseIdempotencyKey(req.header(IDEMPOTENCY_HEADER));

    const payload = transactionSchema.parse(req.body);
    if (idempotencyKey) {
      const replay = await findIdempotentTransaction({
        queryFn: (text, values) => query<TransactionRow>(text, values),
        teamId: access.teamId,
        scope: IDEMPOTENCY_SCOPE_LEGACY_TRANSACTION_CREATE,
        key: idempotencyKey,
      });
      if (replay) {
        return res.status(200).json({
          success: true,
          idempotentReplay: true,
          transaction: mapTransaction(replay),
        });
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let userNameSnapshot: string | null = payload.userName ?? null;
      if (payload.userId) {
        const userInTeam = await client.query<{ name: string }>(
          `SELECT u.name
           FROM team_memberships tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = $1 AND tm.user_id = $2`,
          [access.teamId, payload.userId]
        );
        if (!userInTeam.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "Target user is not in active team" });
        }
        userNameSnapshot = userInTeam.rows[0].name;
      }

      const date = payload.date ? new Date(payload.date) : new Date();
      const inserted = await client.query<TransactionRow>(
        `INSERT INTO transactions (
           team_id,
           type,
           amount,
           title,
           date,
           user_id,
           user_name_snapshot,
           status,
           created_by,
           event_id,
           idempotency_key,
           idempotency_scope
         )
         VALUES ($1, $2::transaction_type, $3, $4, $5, $6, $7, $8::transaction_status, $9, $10, $11, $12)
         RETURNING id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status`,
        [
          access.teamId,
          payload.type,
          payload.amount,
          payload.title,
          date.toISOString(),
          payload.userId ?? null,
          userNameSnapshot,
          payload.status ?? "COMPLETED",
          access.userId,
          payload.eventId ?? null,
          idempotencyKey ?? null,
          IDEMPOTENCY_SCOPE_LEGACY_TRANSACTION_CREATE,
        ]
      );

      if (payload.type === "EXPENSE") {
        await client.query(`UPDATE teams SET budget = budget - $1 WHERE id = $2`, [payload.amount, access.teamId]);
      } else if (payload.type === "DEPOSIT") {
        await client.query(`UPDATE teams SET budget = budget + $1 WHERE id = $2`, [payload.amount, access.teamId]);
        if (payload.userId) {
          await client.query(`UPDATE team_memberships SET balance = balance + $1 WHERE team_id = $2 AND user_id = $3`, [
            payload.amount,
            access.teamId,
            payload.userId,
          ]);
        }
      } else if (payload.type === "FEE") {
        if (!payload.userId) {
          await client.query("ROLLBACK");
          return res.status(400).json({ detail: "FEE transaction requires userId" });
        }
        await client.query(`UPDATE team_memberships SET balance = balance - $1 WHERE team_id = $2 AND user_id = $3`, [
          payload.amount,
          access.teamId,
          payload.userId,
        ]);
      }

      await client.query("COMMIT");

      await writeAudit(access.userId, "finance.transaction.create", {
        transactionId: inserted.rows[0].id,
        type: payload.type,
        amount: payload.amount,
      });

      return res.status(201).json({
        success: true,
        idempotentReplay: false,
        transaction: {
          ...mapTransaction(inserted.rows[0]),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      if (idempotencyKey && isPgUniqueViolation(err)) {
        const replay = await findIdempotentTransaction({
          queryFn: (text, values) => client.query<TransactionRow>(text, values),
          teamId: access.teamId,
          scope: IDEMPOTENCY_SCOPE_LEGACY_TRANSACTION_CREATE,
          key: idempotencyKey,
        });
        if (replay) {
          return res.status(200).json({
            success: true,
            idempotentReplay: true,
            transaction: mapTransaction(replay),
          });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

financeRouter.patch(
  "/:transactionId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const transactionId = z.string().uuid().parse(req.params.transactionId);
    const payload = updateTransactionSchema.parse(req.body ?? {});

    const currentResult = await query<{
      id: string;
      team_id: string;
      type: "DEPOSIT" | "EXPENSE" | "FEE";
      amount: string;
      title: string;
      date: string;
      user_id: string | null;
      user_name_snapshot: string | null;
      status: "PENDING" | "COMPLETED";
      event_id: string | null;
    }>(
      `SELECT id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status, event_id
       FROM transactions
       WHERE id = $1`,
      [transactionId]
    );
    const current = currentResult.rows[0];
    if (!current) return res.status(404).json({ detail: "Transaction not found" });

    const access = await resolveFinanceAccess(req as any, current.team_id);
    assertCanWriteFinance(access);

    if (current.type !== "EXPENSE") {
      return res.status(400).json({ detail: "Only EXPENSE transactions can be edited in this flow" });
    }

    const nextTitle = payload.title?.trim() || current.title;
    const nextAmount = payload.amount ?? Number(current.amount);
    const nextEventId = payload.eventId === undefined ? current.event_id : payload.eventId;

    if (nextEventId) {
      const eventResult = await query<{ id: string }>(
        `SELECT id
         FROM events
         WHERE id = $1 AND team_id = $2`,
        [nextEventId, current.team_id]
      );
      if (!eventResult.rowCount) {
        return res.status(400).json({ detail: "Event is not in active team" });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const locked = await client.query<{
        id: string;
        team_id: string;
        type: "DEPOSIT" | "EXPENSE" | "FEE";
        amount: string;
        title: string;
        date: string;
        user_id: string | null;
        user_name_snapshot: string | null;
        status: "PENDING" | "COMPLETED";
      }>(
        `SELECT id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status
         FROM transactions
         WHERE id = $1
         FOR UPDATE`,
        [transactionId]
      );

      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ detail: "Transaction not found" });
      }

      const currentAmount = Number(current.amount);
      const amountDelta = Number((nextAmount - currentAmount).toFixed(2));
      if (Math.abs(amountDelta) > 0.0001) {
        await client.query(`UPDATE teams SET budget = budget - $1 WHERE id = $2`, [amountDelta, current.team_id]);
      }

      const updated = await client.query<TransactionRow>(
        `UPDATE transactions
         SET title = $2,
             amount = $3,
             event_id = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, team_id, type, amount::text, title, date, user_id, user_name_snapshot, status`,
        [transactionId, nextTitle, nextAmount, nextEventId]
      );

      await client.query("COMMIT");

      await writeAudit(access.userId, "finance.transaction.update", {
        transactionId,
        previousAmount: currentAmount,
        nextAmount,
        previousTitle: current.title,
        nextTitle,
        previousEventId: current.event_id,
        nextEventId,
      });

      return res.json({
        success: true,
        transaction: mapTransaction(updated.rows[0]),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);
