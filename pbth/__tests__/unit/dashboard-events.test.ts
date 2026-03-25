import { describe, expect, it } from "vitest";
import { buildDashboardEventSections } from "../../lib/events";
import type { Event } from "../../types";
import { EventType, RSVPStatus } from "../../types";

function makeEvent(
  id: string,
  startIso: string,
  endIso: string,
  rsvpStatus: RSVPStatus
): Event {
  return {
    id,
    teamId: "team-1",
    type: EventType.TRAINING,
    title: id,
    startDate: new Date(startIso),
    endDate: new Date(endIso),
    rsvpStatus,
    attendeesCount: 0,
  };
}

describe("dashboard event sections", () => {
  it("keeps the hero unique across lower sections", () => {
    const now = Date.parse("2026-03-01T10:30:00.000Z");
    const sections = buildDashboardEventSections(
      [
        makeEvent("hero", "2026-03-01T10:00:00.000Z", "2026-03-01T10:40:00.000Z", RSVPStatus.PENDING),
        makeEvent("pending", "2026-03-01T11:00:00.000Z", "2026-03-01T12:00:00.000Z", RSVPStatus.UNANSWERED),
        makeEvent("upcoming", "2026-03-01T12:00:00.000Z", "2026-03-01T13:00:00.000Z", RSVPStatus.CONFIRMED),
      ],
      now
    );

    expect(sections.heroEvent?.id).toBe("hero");
    expect(sections.pendingEvents.map((event) => event.id)).toEqual(["pending"]);
    expect(sections.upcomingEvents.map((event) => event.id)).toEqual(["upcoming"]);
  });
});
