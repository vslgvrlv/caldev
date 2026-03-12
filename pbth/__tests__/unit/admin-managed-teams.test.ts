import { describe, expect, it } from "vitest";
import { resolveManagedTeamOptions } from "../../lib/admin-managed-teams";

describe("resolveManagedTeamOptions", () => {
  it("prefers explicit managedTeams labels", () => {
    const result = resolveManagedTeamOptions({
      managedTeamIds: ["team-1"],
      managedTeams: [{ id: "team-1", name: "Holy Guns" }],
      availableRoles: [],
    });
    expect(result).toEqual([{ id: "team-1", name: "Holy Guns" }]);
  });

  it("falls back to captain availableRoles labels when managedTeams are missing", () => {
    const result = resolveManagedTeamOptions({
      managedTeamIds: ["team-2"],
      managedTeams: [],
      availableRoles: [
        { role: "CAPTAIN", teamId: "team-2", teamName: "AKM Cup Team" },
        { role: "PLAYER", teamId: "team-3", teamName: "Ignored Team" },
      ],
    });
    expect(result).toEqual([{ id: "team-2", name: "AKM Cup Team" }]);
  });

  it("keeps id fallback for unknown team labels", () => {
    const result = resolveManagedTeamOptions({
      managedTeamIds: ["team-9"],
      managedTeams: [],
      availableRoles: [],
    });
    expect(result).toEqual([{ id: "team-9", name: "team-9" }]);
  });
});
