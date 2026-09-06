export type EventOwnerKind = "TEAM" | "VENUE" | "INTEGRATION";
export type EventSourceKind = "MANUAL" | "VENUE_API" | "INTEGRATION_API";
export type EventRegistrationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "REJECTED" | "CANCELLED";
export type RegistrationFlowStage =
  | "registration_requested"
  | "registration_confirmed"
  | "registration_waitlisted"
  | "registration_rejected"
  | "registration_cancelled"
  | "schedule_published";

export type EventRegistrationProjection = {
  id: string;
  teamId: string;
  status: EventRegistrationStatus;
  requestedAt?: string;
  confirmedAt?: string | null;
  externalRegistrationId?: string | null;
  confirmedByUserId?: string | null;
};

export type EventRegistrationSummary = {
  total: number;
  requested: number;
  confirmed: number;
  waitlisted: number;
  rejected: number;
  cancelled: number;
};

export type EventGameProjection = {
  id: string;
  time: string;
  opponent: string;
  score?: string;
  pitZone?: "NEAR" | "FAR";
  gamePair?: "FIRST" | "SECOND";
  stage?: "GROUP" | "R16" | "QF" | "SF" | "FINAL";
};

export type ImportedTeamScheduleProjection = EventGameProjection & {
  teamId: string;
  startAt?: string | null;
  sourceKind?: EventSourceKind;
  sourceProvider?: string | null;
  sourceExternalGameId?: string | null;
  publishedAt?: string;
};

export function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeEventDomainFields(params: {
  teamId: string;
  ownerKind?: EventOwnerKind;
  ownerTeamId?: string | null;
  ownerName?: string | null;
  sourceKind?: EventSourceKind;
  sourceProvider?: string | null;
  sourceExternalEventId?: string | null;
}) {
  const ownerKind = params.ownerKind ?? "TEAM";
  const sourceKind = params.sourceKind ?? "MANUAL";

  const ownerTeamId =
    ownerKind === "TEAM"
      ? params.ownerTeamId || params.teamId
      : null;

  return {
    ownerKind,
    ownerTeamId,
    ownerName: trimOrNull(params.ownerName),
    sourceKind,
    sourceProvider: trimOrNull(params.sourceProvider),
    sourceExternalEventId: trimOrNull(params.sourceExternalEventId),
  };
}

export function shouldIncludeRegistrationInTeamFeed(status: EventRegistrationStatus): boolean {
  return status === "REQUESTED" || status === "CONFIRMED" || status === "WAITLISTED";
}

export function isRegistrationConfirmed(status: EventRegistrationStatus): boolean {
  return status === "CONFIRMED";
}

export function summarizeRegistrationStatuses(
  rows: Array<{
    status: EventRegistrationStatus;
  }>
): EventRegistrationSummary {
  const summary: EventRegistrationSummary = {
    total: 0,
    requested: 0,
    confirmed: 0,
    waitlisted: 0,
    rejected: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    summary.total += 1;
    if (row.status === "REQUESTED") summary.requested += 1;
    if (row.status === "CONFIRMED") summary.confirmed += 1;
    if (row.status === "WAITLISTED") summary.waitlisted += 1;
    if (row.status === "REJECTED") summary.rejected += 1;
    if (row.status === "CANCELLED") summary.cancelled += 1;
  }

  return summary;
}

export function selectRegistrationForTeam(
  registrations: EventRegistrationProjection[],
  teamId: string
): EventRegistrationProjection | null {
  return registrations.find((row) => row.teamId === teamId) ?? null;
}

export function selectImportedScheduleForTeam(
  imported: ImportedTeamScheduleProjection[],
  teamId: string
): ImportedTeamScheduleProjection[] {
  return imported.filter((row) => row.teamId === teamId);
}

export function mergeTeamEventSchedule(
  eventSchedule: EventGameProjection[],
  importedSchedule: ImportedTeamScheduleProjection[]
): EventGameProjection[] {
  if (importedSchedule.length === 0) return eventSchedule;
  return importedSchedule.map((item) => ({
    id: item.id,
    time: item.time,
    opponent: item.opponent,
    score: item.score,
    pitZone: item.pitZone,
    gamePair: item.gamePair,
    stage: item.stage,
  }));
}

export function resolveRegistrationFlowStage(
  action: string,
  payload: Record<string, unknown>
): RegistrationFlowStage | null {
  if (action === "admin.v1.events.schedule.import") {
    return "schedule_published";
  }
  if (action !== "admin.v1.events.registration.upsert") {
    return null;
  }

  const registrationStatusRaw =
    payload.registrationStatus ??
    payload.status ??
    null;
  if (typeof registrationStatusRaw !== "string") return null;

  if (registrationStatusRaw === "REQUESTED") return "registration_requested";
  if (registrationStatusRaw === "CONFIRMED") return "registration_confirmed";
  if (registrationStatusRaw === "WAITLISTED") return "registration_waitlisted";
  if (registrationStatusRaw === "REJECTED") return "registration_rejected";
  if (registrationStatusRaw === "CANCELLED") return "registration_cancelled";
  return null;
}
