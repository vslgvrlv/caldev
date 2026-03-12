export type AdminRole = "CAPTAIN" | "TRAINER" | "PLAYER";

export type ManagedTeamOption = {
  id: string;
  name: string;
};

type ManagedTeamInput = {
  managedTeamIds?: string[];
  managedTeams?: Array<{ id: string; name: string }>;
  availableRoles?: Array<{
    teamId: string;
    teamName: string;
    role: AdminRole;
  }>;
};

function normalizeTeamLabel(name: string | undefined | null, fallback: string): string {
  const trimmed = String(name || "").trim();
  return trimmed || fallback;
}

export function resolveManagedTeamOptions(input: ManagedTeamInput): ManagedTeamOption[] {
  const optionsById = new Map<string, ManagedTeamOption>();

  for (const team of input.managedTeams || []) {
    if (!team?.id) continue;
    optionsById.set(team.id, {
      id: team.id,
      name: normalizeTeamLabel(team.name, team.id),
    });
  }

  for (const role of input.availableRoles || []) {
    if (role.role !== "CAPTAIN" || !role.teamId) continue;
    if (optionsById.has(role.teamId)) continue;
    optionsById.set(role.teamId, {
      id: role.teamId,
      name: normalizeTeamLabel(role.teamName, role.teamId),
    });
  }

  for (const teamId of input.managedTeamIds || []) {
    if (!teamId || optionsById.has(teamId)) continue;
    optionsById.set(teamId, {
      id: teamId,
      name: teamId,
    });
  }

  return Array.from(optionsById.values());
}
