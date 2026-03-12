import { describe, expect, it } from "vitest";
import { hasTeamAccess, resolveRequestedTeams, type AdminAccess } from "../../lib/admin-access.js";

describe("admin access helpers", () => {
  const teamAccess: AdminAccess = {
    scope: "TEAM",
    managedTeamIds: ["team-1", "team-2"],
    userId: "user-1",
  };

  const platformAccess: AdminAccess = {
    scope: "PLATFORM",
    managedTeamIds: ["team-1", "team-2", "team-3"],
    userId: "user-2",
  };

  it("returns requested team for platform scope", () => {
    expect(resolveRequestedTeams(platformAccess, "team-3")).toEqual(["team-3"]);
  });

  it("returns requested team only when team scope has access", () => {
    expect(resolveRequestedTeams(teamAccess, "team-2")).toEqual(["team-2"]);
    expect(resolveRequestedTeams(teamAccess, "team-9")).toEqual([]);
  });

  it("returns all managed teams when no specific team requested", () => {
    expect(resolveRequestedTeams(teamAccess, null)).toEqual(["team-1", "team-2"]);
  });

  it("checks team access by managed list", () => {
    expect(hasTeamAccess(teamAccess, "team-1")).toBe(true);
    expect(hasTeamAccess(teamAccess, "team-x")).toBe(false);
  });
});
