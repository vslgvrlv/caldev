export type FinanceActorRole = "ADMIN" | "CAPTAIN" | "TRAINER" | "PLAYER";

export type FinanceResolvedAccess = {
  userId: string;
  teamId: string;
  actorRole: FinanceActorRole;
  canWrite: boolean;
};

export type FinanceMembershipCandidate = {
  teamId: string;
  role: Exclude<FinanceActorRole, "ADMIN">;
  userId: string;
};

export type FinanceActiveContextCandidate = {
  membershipId: string;
  teamId: string;
  role: Exclude<FinanceActorRole, "ADMIN">;
  userId: string;
};

export type FinanceMemberSummary = {
  userId: string;
  outstanding: number;
  overpaid: number;
};

export type TransferAllocationCandidate = {
  chargeId: string;
  eventId: string;
  outstanding: number;
  startAt: string;
};

export type TransferAllocationPlan = {
  chargeId: string;
  eventId: string;
  amount: number;
};

export type EventChargeGenerationCandidate = {
  userId: string;
  role: FinanceActorRole;
  existingAmountDue?: number;
};

export type EventChargeGenerationValidationResult =
  | {
      ok: true;
      existingChargeCount: number;
      missingChargeCount: number;
      suggestedFixedAmount?: number;
    }
  | {
      ok: false;
      code: "UNSAFE_TOTAL_SPLIT_REGENERATION" | "FIXED_AMOUNT_MISMATCH" | "NO_NEW_PARTICIPANTS";
      detail: string;
      existingChargeCount: number;
      missingChargeCount: number;
      suggestedFixedAmount?: number;
    };

const SCREENSHOT_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i;

export function isTransferScreenshotDataUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return SCREENSHOT_DATA_URL_PATTERN.test(value.trim());
}

export function planTransferConfirmationAllocations(
  candidates: TransferAllocationCandidate[],
  amount: number,
  preferredEventId?: string
): TransferAllocationPlan[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];

  let remaining = amount;
  const ordered = [...candidates].sort((a, b) => {
    const aPreferred = preferredEventId && a.eventId === preferredEventId ? 1 : 0;
    const bPreferred = preferredEventId && b.eventId === preferredEventId ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    return Date.parse(a.startAt) - Date.parse(b.startAt);
  });
  const allocations: TransferAllocationPlan[] = [];

  for (const candidate of ordered) {
    if (remaining <= 0) break;
    if (!Number.isFinite(candidate.outstanding) || candidate.outstanding <= 0) continue;

    const allocationAmount = Math.min(candidate.outstanding, remaining);
    if (allocationAmount <= 0) continue;

    allocations.push({
      chargeId: candidate.chargeId,
      eventId: candidate.eventId,
      amount: Number(allocationAmount.toFixed(2)),
    });
    remaining = Number((remaining - allocationAmount).toFixed(2));
  }

  return allocations;
}

export function filterFinanceMembersForActor<T extends FinanceMemberSummary>(
  rows: T[],
  actor: { actorRole: FinanceActorRole; actorUserId: string }
): T[] {
  if (actor.actorRole === "PLAYER") {
    return rows.filter((row) => row.userId === actor.actorUserId);
  }
  return rows;
}

export function filterAutoEventChargeMembers<T extends { role: FinanceActorRole }>(rows: T[]): T[] {
  return rows.filter((row) => row.role !== "CAPTAIN" && row.role !== "ADMIN");
}

export function validateEventChargeGeneration(params: {
  candidates: EventChargeGenerationCandidate[];
  amountType: "FIXED_PER_PERSON" | "TOTAL_SPLIT" | "UNDISTRIBUTED_SPLIT" | "CUSTOM";
  overwriteExisting: boolean;
  fixedAmount?: number;
}): EventChargeGenerationValidationResult {
  const existingAmounts = params.candidates
    .map((candidate) => Number(candidate.existingAmountDue || 0))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const existingChargeCount = existingAmounts.length;
  const missingChargeCount = Math.max(0, params.candidates.length - existingChargeCount);
  const suggestedFixedAmount = getUniformPositiveAmount(existingAmounts);

  if (params.overwriteExisting) {
    return { ok: true, existingChargeCount, missingChargeCount, suggestedFixedAmount };
  }

  if (params.amountType === "UNDISTRIBUTED_SPLIT") {
    return {
      ok: true,
      existingChargeCount,
      missingChargeCount,
      suggestedFixedAmount,
    };
  }

  if (existingChargeCount > 0 && missingChargeCount === 0) {
    return {
      ok: false,
      code: "NO_NEW_PARTICIPANTS",
      detail: "Для выбранной аудитории начисления уже созданы. Измените сумму через корректировку, а не через повторный запуск.",
      existingChargeCount,
      missingChargeCount,
      suggestedFixedAmount,
    };
  }

  if (params.amountType === "TOTAL_SPLIT" && existingChargeCount > 0) {
    return {
      ok: false,
      code: "UNSAFE_TOTAL_SPLIT_REGENERATION",
      detail:
        "По событию уже есть начисления. Повторное распределение общей суммы исказит сбор. Используйте фиксированную сумму для новых участников или корректировку.",
      existingChargeCount,
      missingChargeCount,
      suggestedFixedAmount,
    };
  }

  if (
    params.amountType === "FIXED_PER_PERSON" &&
    existingChargeCount > 0 &&
    missingChargeCount > 0 &&
    suggestedFixedAmount !== undefined &&
    params.fixedAmount !== undefined &&
    Math.abs(params.fixedAmount - suggestedFixedAmount) > 0.0001
  ) {
    return {
      ok: false,
      code: "FIXED_AMOUNT_MISMATCH",
      detail: `По событию уже есть начисления по ${formatRub(
        suggestedFixedAmount
      )}. Для новых участников используйте ту же сумму или создайте корректировку.`,
      existingChargeCount,
      missingChargeCount,
      suggestedFixedAmount,
    };
  }

  return {
    ok: true,
    existingChargeCount,
    missingChargeCount,
    suggestedFixedAmount,
  };
}

export function resolveFinanceAccessFromMemberships(params: {
  accountRole: "ADMIN" | "USER";
  userId: string;
  requestedTeamId?: string;
  activeContext?: FinanceActiveContextCandidate | null;
  memberships: FinanceMembershipCandidate[];
}): FinanceResolvedAccess | null {
  if (params.accountRole === "ADMIN") {
    if (!params.requestedTeamId) return null;
    return {
      userId: params.userId,
      teamId: params.requestedTeamId,
      actorRole: "ADMIN",
      canWrite: true,
    };
  }

  if (params.requestedTeamId) {
    const membership = params.memberships.find(
      (item) => item.teamId === params.requestedTeamId && item.userId === params.userId
    );
    if (!membership) return null;
    return {
      userId: params.userId,
      teamId: membership.teamId,
      actorRole: membership.role,
      canWrite: membership.role === "CAPTAIN",
    };
  }

  if (!params.activeContext || params.activeContext.userId !== params.userId) {
    return null;
  }

  return {
    userId: params.userId,
    teamId: params.activeContext.teamId,
    actorRole: params.activeContext.role,
    canWrite: params.activeContext.role === "CAPTAIN",
  };
}

function getUniformPositiveAmount(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const [first] = values;
  if (!values.every((value) => Math.abs(value - first) < 0.0001)) return undefined;
  return Number(first.toFixed(2));
}

function formatRub(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU").replace(/\u00A0/g, " ")} ₽`;
}
