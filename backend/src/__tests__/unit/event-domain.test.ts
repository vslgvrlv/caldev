import { describe, expect, it } from "vitest";
import {
  mergeTeamEventSchedule,
  resolveRegistrationFlowStage,
  isRegistrationConfirmed,
  normalizeEventDomainFields,
  selectImportedScheduleForTeam,
  selectRegistrationForTeam,
  shouldIncludeRegistrationInTeamFeed,
  summarizeRegistrationStatuses,
} from "../../lib/event-domain.js";

describe("event-domain normalization", () => {
  it("defaults to TEAM ownership with team id", () => {
    const normalized = normalizeEventDomainFields({ teamId: "team-1" });
    expect(normalized.ownerKind).toBe("TEAM");
    expect(normalized.ownerTeamId).toBe("team-1");
    expect(normalized.sourceKind).toBe("MANUAL");
  });

  it("drops ownerTeamId for non-team owners", () => {
    const normalized = normalizeEventDomainFields({
      teamId: "team-1",
      ownerKind: "VENUE",
      ownerTeamId: "team-2",
      ownerName: " AKM Arena ",
      sourceKind: "VENUE_API",
      sourceProvider: " akm ",
      sourceExternalEventId: " cup-42 ",
    });

    expect(normalized.ownerTeamId).toBeNull();
    expect(normalized.ownerName).toBe("AKM Arena");
    expect(normalized.sourceProvider).toBe("akm");
    expect(normalized.sourceExternalEventId).toBe("cup-42");
  });
});

describe("registration feed semantics", () => {
  it("includes requested/confirmed/waitlisted statuses", () => {
    expect(shouldIncludeRegistrationInTeamFeed("REQUESTED")).toBe(true);
    expect(shouldIncludeRegistrationInTeamFeed("CONFIRMED")).toBe(true);
    expect(shouldIncludeRegistrationInTeamFeed("WAITLISTED")).toBe(true);
  });

  it("excludes rejected/cancelled statuses", () => {
    expect(shouldIncludeRegistrationInTeamFeed("REJECTED")).toBe(false);
    expect(shouldIncludeRegistrationInTeamFeed("CANCELLED")).toBe(false);
  });

  it("marks only confirmed status as confirmed", () => {
    expect(isRegistrationConfirmed("CONFIRMED")).toBe(true);
    expect(isRegistrationConfirmed("REQUESTED")).toBe(false);
  });
});

describe("registration projections", () => {
  it("summarizes registration statuses", () => {
    const summary = summarizeRegistrationStatuses([
      { status: "REQUESTED" },
      { status: "CONFIRMED" },
      { status: "CONFIRMED" },
      { status: "WAITLISTED" },
      { status: "REJECTED" },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.requested).toBe(1);
    expect(summary.confirmed).toBe(2);
    expect(summary.waitlisted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.cancelled).toBe(0);
  });

  it("selects team registration by team id", () => {
    const registration = selectRegistrationForTeam(
      [
        { id: "r-1", teamId: "team-1", status: "REQUESTED" },
        { id: "r-2", teamId: "team-2", status: "CONFIRMED" },
      ],
      "team-2"
    );

    expect(registration?.id).toBe("r-2");
    expect(registration?.status).toBe("CONFIRMED");
  });
});

describe("team schedule projections", () => {
  it("prefers imported team schedule over event games", () => {
    const schedule = mergeTeamEventSchedule(
      [
        { id: "g-1", time: "10:00", opponent: "Legacy Opponent" },
      ],
      [
        {
          id: "i-1",
          teamId: "team-1",
          time: "11:00",
          opponent: "AKM",
          sourceKind: "VENUE_API",
        },
      ]
    );

    expect(schedule).toEqual([{ id: "i-1", time: "11:00", opponent: "AKM" }]);
  });

  it("returns only imported schedule for selected team", () => {
    const imported = selectImportedScheduleForTeam(
      [
        { id: "i-1", teamId: "team-1", time: "10:00", opponent: "A" },
        { id: "i-2", teamId: "team-2", time: "11:00", opponent: "B" },
      ],
      "team-2"
    );

    expect(imported).toEqual([{ id: "i-2", teamId: "team-2", time: "11:00", opponent: "B" }]);
  });
});

describe("registration flow tracing", () => {
  it("marks confirmed registration flow stage", () => {
    const stage = resolveRegistrationFlowStage("admin.v1.events.registration.upsert", {
      registrationStatus: "CONFIRMED",
    });
    expect(stage).toBe("registration_confirmed");
  });

  it("marks schedule publication stage", () => {
    const stage = resolveRegistrationFlowStage("admin.v1.events.schedule.import", {});
    expect(stage).toBe("schedule_published");
  });
});
