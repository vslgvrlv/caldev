import { describe, it, expect } from "vitest";
import { canMarkAttendance } from "../../lib/attendance-permissions.js";

describe("canMarkAttendance", () => {
  it("allows platform admin for any event type", () => {
    expect(canMarkAttendance({ isPlatformAdmin: true, teamRole: null, eventType: "TOURNAMENT" })).toBe(true);
    expect(canMarkAttendance({ isPlatformAdmin: true, teamRole: "PLAYER", eventType: "TRAINING" })).toBe(true);
  });

  it("allows captain for any event type", () => {
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "CAPTAIN", eventType: "TOURNAMENT" })).toBe(true);
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "CAPTAIN", eventType: "TRAINING" })).toBe(true);
  });

  it("allows trainer only for training and meeting", () => {
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "TRAINER", eventType: "TRAINING" })).toBe(true);
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "TRAINER", eventType: "MEETING" })).toBe(true);
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "TRAINER", eventType: "TOURNAMENT" })).toBe(false);
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "TRAINER", eventType: "CHAMPIONSHIP" })).toBe(false);
  });

  it("denies players and non-members", () => {
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: "PLAYER", eventType: "TRAINING" })).toBe(false);
    expect(canMarkAttendance({ isPlatformAdmin: false, teamRole: null, eventType: "TRAINING" })).toBe(false);
  });
});
