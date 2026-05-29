import { describe, it, expect } from "vitest";
import { resolveEffectiveRsvp, resolveFeedRsvpStatus } from "../../lib/series-commitment.js";

describe("resolveEffectiveRsvp", () => {
  it("uses explicit answer when present (override wins over series default)", () => {
    expect(resolveEffectiveRsvp({ explicit: "DECLINED", hasSeries: true, committedToSeries: true })).toBe("DECLINED");
    expect(resolveEffectiveRsvp({ explicit: "CONFIRMED", hasSeries: false, committedToSeries: false })).toBe("CONFIRMED");
  });

  it("defaults to CONFIRMED when committed to a series and no explicit answer", () => {
    expect(resolveEffectiveRsvp({ explicit: null, hasSeries: true, committedToSeries: true })).toBe("CONFIRMED");
  });

  it("is UNANSWERED when part of a series but not committed", () => {
    expect(resolveEffectiveRsvp({ explicit: null, hasSeries: true, committedToSeries: false })).toBe("UNANSWERED");
  });

  it("is UNANSWERED for a standalone event with no answer", () => {
    expect(resolveEffectiveRsvp({ explicit: null, hasSeries: false, committedToSeries: false })).toBe("UNANSWERED");
  });
});

describe("resolveFeedRsvpStatus", () => {
  // Регрессия: после согласия на серию (#60) occurrences показывались как
  // "требует ответа" в календаре/дашборде, потому что фид смотрел только на rsvps.
  it("derives CONFIRMED for a committed-series occurrence with no explicit answer", () => {
    expect(resolveFeedRsvpStatus({ explicit: null, seriesCommitted: true })).toBe("CONFIRMED");
  });

  it("keeps explicit answer as override over the series default", () => {
    expect(resolveFeedRsvpStatus({ explicit: "DECLINED", seriesCommitted: true })).toBe("DECLINED");
    expect(resolveFeedRsvpStatus({ explicit: "PENDING", seriesCommitted: true })).toBe("PENDING");
    expect(resolveFeedRsvpStatus({ explicit: "CONFIRMED", seriesCommitted: false })).toBe("CONFIRMED");
  });

  it("is UNANSWERED for an occurrence without commitment and without an answer", () => {
    expect(resolveFeedRsvpStatus({ explicit: null, seriesCommitted: false })).toBe("UNANSWERED");
  });
});
