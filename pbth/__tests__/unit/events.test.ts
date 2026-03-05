import { describe, expect, it } from "vitest";
import {
  filterFutureEvents,
  filterUpcomingAndOngoingEvents,
  getCountdownParts,
  getEventEndTimestamp,
  isEventOngoing,
  sortEventsByStart,
} from "../../lib/events";
import type { Event } from "../../types";
import { EventType, RSVPStatus } from "../../types";

function makeEvent(id: string, iso: string, endIso?: string): Event {
  const date = new Date(iso);
  return {
    id,
    teamId: "team-1",
    type: EventType.TRAINING,
    title: `event-${id}`,
    startDate: date,
    endDate: endIso ? new Date(endIso) : undefined,
    rsvpStatus: RSVPStatus.PENDING,
    attendeesCount: 0,
  };
}

describe("events helpers", () => {
  it("sorts events by start date", () => {
    const sorted = sortEventsByStart([
      makeEvent("2", "2026-03-01T10:00:00.000Z"),
      makeEvent("1", "2026-02-28T10:00:00.000Z"),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("filters only future events", () => {
    const now = Date.parse("2026-03-01T00:00:00.000Z");
    const future = filterFutureEvents(
      [
        makeEvent("old", "2026-02-20T10:00:00.000Z"),
        makeEvent("new", "2026-03-02T10:00:00.000Z"),
      ],
      now
    );
    expect(future.map((e) => e.id)).toEqual(["new"]);
  });

  it("keeps ongoing and upcoming events, drops finished", () => {
    const now = Date.parse("2026-03-01T10:30:00.000Z");
    const visible = filterUpcomingAndOngoingEvents(
      [
        makeEvent("finished", "2026-03-01T07:00:00.000Z", "2026-03-01T08:00:00.000Z"),
        makeEvent("ongoing", "2026-03-01T10:00:00.000Z", "2026-03-01T11:00:00.000Z"),
        makeEvent("upcoming", "2026-03-01T12:00:00.000Z", "2026-03-01T13:00:00.000Z"),
      ],
      now
    );
    expect(visible.map((e) => e.id)).toEqual(["ongoing", "upcoming"]);
  });

  it("detects ongoing event by end timestamp", () => {
    const now = Date.parse("2026-03-01T10:30:00.000Z");
    const ongoing = makeEvent("ongoing", "2026-03-01T10:00:00.000Z", "2026-03-01T11:00:00.000Z");
    const finished = makeEvent("finished", "2026-03-01T09:00:00.000Z", "2026-03-01T10:00:00.000Z");
    expect(isEventOngoing(ongoing, now)).toBe(true);
    expect(isEventOngoing(finished, now)).toBe(false);
    expect(getEventEndTimestamp(ongoing)).toBe(Date.parse("2026-03-01T11:00:00.000Z"));
  });

  it("builds countdown parts", () => {
    const now = Date.parse("2026-03-01T00:00:00.000Z");
    const countdown = getCountdownParts(new Date("2026-03-02T02:05:00.000Z"), now);
    expect(countdown).toEqual({ days: "01", hours: "02", mins: "05" });
  });
});
