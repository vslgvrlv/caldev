import { Role } from "../types";

export const ALL_TEAMS_FINANCE_FILTER = "ALL_TEAMS";

export type FinanceTeamContext = {
  membershipId: string;
  teamId: string;
  teamName: string;
  shortCode?: string;
  role: Role;
};

export type FinanceFilterOption = {
  value: string;
  label: string;
  badge: string;
  role?: Role;
  isActive: boolean;
};

export type FinanceConfirmationPreview = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  amount: number;
  userName: string;
};

export type PlayerFinanceSnapshot = {
  teamId: string;
  teamName: string;
  summary: {
    totalDue: number;
    totalPaid: number;
    outstanding: number;
    eventsWithDebt: number;
  };
  eventDebts: Array<{
    eventId: string;
    title: string;
    date: string;
    amountDue: number;
    amountPaid: number;
    outstanding: number;
    chargeStatus: "PENDING" | "PARTIAL" | "PAID";
  }>;
  confirmations: Array<{
    id: string;
    teamId: string;
    userId: string;
    userName: string;
    amount: number;
    screenshotDataUrl: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    submittedAt: string;
    submittedBy: {
      userId: string;
    };
  }>;
};

export function buildFinanceFilterOptions(params: {
  teams: FinanceTeamContext[];
  currentUserRole: Role;
  selectedTeamId: string;
}): FinanceFilterOption[] {
  const orderedTeams = [...params.teams].sort((a, b) => a.teamName.localeCompare(b.teamName, "ru"));
  const options = orderedTeams.map((team) => ({
    value: team.teamId,
    label: team.teamName,
    badge: team.shortCode || team.teamName.slice(0, 3).toUpperCase(),
    role: team.role,
    isActive: team.teamId === params.selectedTeamId,
  }));

  if (params.currentUserRole === Role.PLAYER && orderedTeams.length > 1) {
    return [
      {
        value: ALL_TEAMS_FINANCE_FILTER,
        label: "Все команды",
        badge: "ALL",
        isActive: params.selectedTeamId === ALL_TEAMS_FINANCE_FILTER,
      },
      ...options,
    ];
  }

  return options;
}

type FinanceSummary = {
  balance?: number;
  totalOutstanding: number;
  overdueCount: number;
  pendingConfirmations: number;
};

type BuildFinanceViewModelParams = {
  currentUserRole: Role;
  activeTeamName: string;
  summary: FinanceSummary;
  debtors: Array<{ userId: string; name: string; debt: number }>;
  confirmations: FinanceConfirmationPreview[];
};

type FinanceHeroCard = {
  label: string;
  value: string;
};

export function buildFinanceTeamOptions(teams: FinanceTeamContext[], activeTeamId: string) {
  return [...teams]
    .sort((a, b) => {
      if (a.teamId === activeTeamId) return -1;
      if (b.teamId === activeTeamId) return 1;
      return a.teamName.localeCompare(b.teamName, "ru");
    })
    .map((team) => ({
      membershipId: team.membershipId,
      teamId: team.teamId,
      label: team.teamName,
      badge: team.shortCode || team.teamName.slice(0, 3).toUpperCase(),
      role: team.role,
      isActive: team.teamId === activeTeamId,
    }));
}

export function mergePlayerFinanceSnapshots(snapshots: PlayerFinanceSnapshot[]) {
  return {
    summary: snapshots.reduce(
      (acc, snapshot) => {
        acc.totalDue += Number(snapshot.summary.totalDue || 0);
        acc.totalPaid += Number(snapshot.summary.totalPaid || 0);
        acc.outstanding += Number(snapshot.summary.outstanding || 0);
        acc.eventsWithDebt += Number(snapshot.summary.eventsWithDebt || 0);
        acc.pendingConfirmations += snapshot.confirmations.filter((item) => item.status === "PENDING_REVIEW").length;
        return acc;
      },
      { totalDue: 0, totalPaid: 0, outstanding: 0, eventsWithDebt: 0, pendingConfirmations: 0 }
    ),
    eventDebts: snapshots
      .flatMap((snapshot) =>
        snapshot.eventDebts.map((item) => ({
          ...item,
          teamId: snapshot.teamId,
          teamName: snapshot.teamName,
        }))
      )
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    confirmations: snapshots
      .flatMap((snapshot) =>
        snapshot.confirmations.map((item) => ({
          ...item,
          teamName: snapshot.teamName,
        }))
      )
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
  };
}

export function buildFinanceViewModel(params: BuildFinanceViewModelParams): {
  mode: "CAPTAIN" | "PLAYER";
  heroCards: FinanceHeroCard[];
  attentionItems: string[];
  pendingReview: FinanceConfirmationPreview[];
} {
  const pendingReview = params.confirmations.filter((item) => item.status === "PENDING_REVIEW");
  const mode = params.currentUserRole === Role.CAPTAIN || params.currentUserRole === Role.ADMIN ? "CAPTAIN" : "PLAYER";

  if (mode === "CAPTAIN") {
    return {
      mode,
      heroCards: [
        { label: "Общий долг", value: formatRub(params.summary.totalOutstanding) },
        { label: "Просрочено", value: String(params.summary.overdueCount) },
        { label: "На проверке", value: String(params.summary.pendingConfirmations) },
      ],
      attentionItems: [
        `На проверке ${params.summary.pendingConfirmations} подтвержд. перевода`,
        ...params.debtors.slice(0, 2).map((debtor) => `${debtor.name}: ${formatRub(debtor.debt)}`),
      ],
      pendingReview,
    };
  }

  return {
    mode,
    heroCards: [
      { label: "Мой долг", value: formatRub(params.summary.totalOutstanding) },
      { label: "Просрочено", value: String(params.summary.overdueCount) },
      { label: "На проверке", value: String(params.summary.pendingConfirmations) },
    ],
    attentionItems: [`В ${params.activeTeamName} ждут проверки ${params.summary.pendingConfirmations} подтвержд. перевода`],
    pendingReview,
  };
}

function formatRub(value: number): string {
  return `${Number(value || 0).toLocaleString("ru-RU").replace(/\u00A0/g, " ")} ₽`;
}
