import { describe, expect, it } from "vitest";
import { formatNotificationDateTime } from "../../lib/notification-timezone.js";

describe("notification timezone formatting", () => {
  it("formats event time in team timezone instead of server default", () => {
    const formatted = formatNotificationDateTime("2026-03-01T02:00:00.000Z", "Europe/Moscow", "AKM");

    expect(formatted).toBe("01.03.2026, 05:00 • AKM");
  });

  it("falls back to Europe/Moscow when timezone is missing", () => {
    const formatted = formatNotificationDateTime("2026-03-01T02:00:00.000Z", undefined, null);

    expect(formatted).toBe("01.03.2026, 05:00");
  });
});
