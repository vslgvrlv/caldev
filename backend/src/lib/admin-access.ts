export type AdminScope = "PLATFORM" | "TEAM";

export type AdminAccess = {
  scope: AdminScope;
  managedTeamIds: string[];
  userId: string;
};

export function resolveRequestedTeams(access: AdminAccess, requestedTeamId: string | null): string[] {
  if (!requestedTeamId) return access.managedTeamIds;
  if (access.scope === "PLATFORM") return [requestedTeamId];
  return access.managedTeamIds.includes(requestedTeamId) ? [requestedTeamId] : [];
}

export function hasTeamAccess(access: AdminAccess, teamId: string): boolean {
  if (access.scope === "PLATFORM") return true;
  return access.managedTeamIds.includes(teamId);
}
