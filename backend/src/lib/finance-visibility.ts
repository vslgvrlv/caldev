import { query } from "../db/pool.js";

// Кто что видит в деньгах команды (решение Василия 10.11.2026, п. 9):
// игрок видит свой долг и общий список должников с суммами; баланс команды
// и историю операций — только капитан. Владелец платформы действует как капитан.
//
// Долг здесь — тот же, что капитан видит в «Казне»: начисления по событиям
// минус оплаты по ним (`event_member_charges` / `event_payment_allocations`).

export type FinanceScope = "FULL" | "DEBTS_ONLY";

export function financeScopeForRole(role: string | null | undefined): FinanceScope {
  return role === "CAPTAIN" || role === "ADMIN" ? "FULL" : "DEBTS_ONLY";
}

export type MemberChargeTotals = {
  totalDue: number;
  totalPaid: number;
  outstanding: number;
  overpaid: number;
};

export async function loadMemberChargeTotals(teamId: string): Promise<Map<string, MemberChargeTotals>> {
  const result = await query<{
    user_id: string;
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
     SELECT user_id,
            COALESCE(SUM(amount_due), 0)::text AS total_due,
            COALESCE(SUM(amount_paid), 0)::text AS total_paid,
            COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0)::text AS outstanding,
            COALESCE(SUM(GREATEST(amount_paid - amount_due, 0)), 0)::text AS overpaid
     FROM charge_paid
     GROUP BY user_id`,
    [teamId]
  );
  const map = new Map<string, MemberChargeTotals>();
  for (const row of result.rows) {
    map.set(row.user_id, {
      totalDue: Number(row.total_due),
      totalPaid: Number(row.total_paid),
      outstanding: Number(row.outstanding),
      overpaid: Number(row.overpaid),
    });
  }
  return map;
}

/**
 * Чистый долг чужого участника: долг по начислениям минус переплата по другим
 * событиям, не ниже нуля. Капитан на экране видит тот же чистый баланс, поэтому
 * список должников у игрока с ним совпадает, а переплата сверх долга не видна.
 */
export function netDebt(totals: MemberChargeTotals | undefined): number {
  if (!totals) return 0;
  return Math.max(totals.outstanding - totals.overpaid, 0);
}

/**
 * Баланс участника для того, кто не видит книгу команды.
 * Свой — как у капитана на экране (переплата минус долг), чужой — только чистый
 * долг (отрицательное число или 0). Переплаты и взносы других не раскрываются.
 */
export function debtsOnlyBalance(totals: MemberChargeTotals | undefined, isSelf: boolean): number {
  if (!totals) return 0;
  if (isSelf) return totals.overpaid - totals.outstanding;
  const debt = netDebt(totals);
  return debt > 0 ? -debt : 0;
}
