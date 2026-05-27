import { describe, it, expect } from "vitest";
import { resolveEffectiveRsvp } from "../../lib/series-commitment.js";

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
