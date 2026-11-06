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

  it("lists every answered event, not just the first three", () => {
    const now = Date.parse("2026-03-01T09:00:00.000Z");
    const events = Array.from({ length: 6 }, (_, index) =>
      makeEvent(
        `event-${index}`,
        `2026-03-0${index + 2}T10:00:00.000Z`,
        `2026-03-0${index + 2}T12:00:00.000Z`,
        RSVPStatus.CONFIRMED
      )
    );

    const sections = buildDashboardEventSections(events, now);

    expect(sections.heroEvent?.id).toBe("event-0");
    expect(sections.upcomingEvents.map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
    ]);
  });
});
