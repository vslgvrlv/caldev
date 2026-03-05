import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../../db/pool.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { getActiveContext } from "../teams/context.js";
import { writeAudit } from "../../lib/audit.js";
import { getEffectiveEntryRole } from "../../lib/entry-role.js";

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

const financeQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
});

const generateChargesSchema = z.object({
  mode: z.enum(["CONFIRMED_ONLY", "CONFIRMED_AND_PENDING"]).default("CONFIRMED_ONLY"),
  amountType: z.enum(["FIXED_PER_PERSON", "TOTAL_SPLIT", "CUSTOM"]).default("FIXED_PER_PERSON"),
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

async function resolveFinanceAccess(req: Parameters<typeof requireAuth>[0], explicitTeamId?: string): Promise<FinanceAccess> {
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
      userId: (req as any).authUser.id,
      teamId: requestedTeamId,
      actorRole: "ADMIN",
      canWrite: true,
    };
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
  if (access.actorRole === "PLAYER") {
    const err = new Error("Finance access is not allowed for this role");
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
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.team_id = $1
           GROUP BY c.id
         )
         SELECT
           COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0)::text AS outstanding_total,
           COALESCE(SUM(amount_due), 0)::text AS open_charges_total,
           COALESCE(SUM(CASE WHEN amount_due > amount_paid THEN 1 ELSE 0 END), 0)::text AS overdue_count
         FROM charge_paid`,
        [access.teamId]
      );

      const pendingDepositsResult = await query<{ total: string }>(
        `SELECT COALESCE(SUM(amount),0)::text AS total
         FROM transactions
         WHERE team_id = $1 AND type = 'DEPOSIT' AND status = 'PENDING'`,
        [access.teamId]
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
         ORDER BY date DESC
         LIMIT 20`,
        [access.teamId]
      );

      const topDebtorsResult = await query<{
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

      const summary = summaryResult.rows[0] || {
        outstanding_total: "0",
        open_charges_total: "0",
        overdue_count: "0",
      };

      return res.json({
        team: { id: team.id, name: team.name, budget: Number(team.budget) },
        summary: {
          balance: Number(team.budget),
          totalOutstanding: Number(summary.outstanding_total),
          totalEventChargesOpen: Number(summary.open_charges_total),
          overdueCount: Number(summary.overdue_count),
          pendingDeposits: Number(pendingDepositsResult.rows[0]?.total || "0"),
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
           LEFT JOIN event_payment_allocations a ON a.event_member_charge_id = c.id
           WHERE c.team_id = $1
           GROUP BY c.id, c.event_id
         )
         SELECT e.id AS event_id,
                e.title,
                e.type::text,
                e.start_at,
                e.cost::text,
                e.cost_status::text,
                e.finance_state::text,
                COALESCE(SUM(cp.amount_due), 0)::text AS charged_total,
                COALESCE(SUM(cp.amount_paid), 0)::text AS paid_total,
                COALESCE(SUM(GREATEST(cp.amount_due - cp.amount_paid, 0)), 0)::text AS outstanding_total,
                COALESCE(COUNT(cp.id), 0)::text AS members_charged,
                COALESCE(SUM(CASE WHEN cp.amount_paid >= cp.amount_due AND cp.id IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS members_paid
         FROM events e
         LEFT JOIN charge_paid cp ON cp.event_id = e.id
         WHERE e.team_id = $1 AND e.is_cancelled = FALSE
         GROUP BY e.id, e.title, e.type, e.start_at, e.cost, e.cost_status, e.finance_state
         ORDER BY e.start_at DESC`,
        [access.teamId]
      );

      return res.json({
        items: rows.rows.map((row) => {
          const chargedTotal = Number(row.charged_total);
          const paidTotal = Number(row.paid_total);
          const outstandingTotal = Number(row.outstanding_total);
          return {
            eventId: row.event_id,
            title: row.title,
            type: row.type,
            startDate: row.start_at,
            costStatus: row.cost_status,
            plannedTotal: row.cost !== null ? Number(row.cost) : undefined,
            chargedTotal,
            paidTotal,
            outstandingTotal,
            membersCharged: Number(row.members_charged),
            membersPaid: Number(row.members_paid),
            state: row.finance_state,
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
      assertCanReadFinance(access);

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

      const summary = participantsResult.rows.reduce(
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
        amount: string;
        payer_user_id: string | null;
        payer_name: string | null;
        status: "PENDING" | "COMPLETED";
        allocation_user_id: string | null;
        allocation_amount: string | null;
      }>(
        `SELECT t.id AS transaction_id,
                t.date,
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
        participants: participantsResult.rows.map((row) => {
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

      const participantRows =
        hasExplicitSelection
          ? await query<{ user_id: string }>(
              `SELECT tm.user_id
               FROM team_memberships tm
               WHERE tm.team_id = $1
                 AND tm.user_id = ANY($2::uuid[])`,
              [event.team_id, Array.from(customMap.keys())]
            )
          : await query<{ user_id: string }>(
              `SELECT tm.user_id
               FROM team_memberships tm
               LEFT JOIN rsvps r ON r.event_id = $1 AND r.user_id = tm.user_id
               WHERE tm.team_id = $2
                 AND (
                   ($3 = 'CONFIRMED_ONLY' AND r.status = 'CONFIRMED')
                   OR
                   ($3 = 'CONFIRMED_AND_PENDING' AND r.status IN ('CONFIRMED','PENDING'))
                 )`,
              [eventId, event.team_id, payload.mode]
            );

      if (hasExplicitSelection) {
        const found = new Set(participantRows.rows.map((row) => row.user_id));
        const missing = Array.from(customMap.keys()).filter((id) => !found.has(id));
        if (missing.length > 0) {
          return res.status(400).json({ detail: "Some selected users are not in team", missingUserIds: missing });
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let affected = 0;
        let splitAmountsByUser = new Map<string, number>();
        if (payload.amountType === "TOTAL_SPLIT") {
          const userIds = participantRows.rows.map((row) => row.user_id);
          if (userIds.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ detail: "No participants selected for charge generation" });
          }
          const totalCents = Math.round(Number(payload.totalAmount || 0) * 100);
          const base = Math.floor(totalCents / userIds.length);
          let remainder = totalCents - base * userIds.length;
          for (const userId of userIds) {
            const cents = base + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder -= 1;
            splitAmountsByUser.set(userId, cents / 100);
          }
        }

        for (const row of participantRows.rows) {
          const amountDue =
            payload.amountType === "FIXED_PER_PERSON"
              ? Number(payload.fixedAmount || 0)
              : payload.amountType === "TOTAL_SPLIT"
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
         GROUP BY u.id, u.name, u.nickname, u.avatar, tm.role, tm.status
         ORDER BY u.name ASC`,
        [access.teamId]
      );

      return res.json({
        items: rows.rows.map((row) => ({
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
