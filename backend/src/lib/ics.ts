import crypto from "node:crypto";
import { createEvents, type EventAttributes } from "ics";
import { env } from "../config/env.js";

export function createRawIcsToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashIcsToken(token: string) {
  return crypto.createHmac("sha256", env.ics.secret).update(token).digest("hex");
}

export function buildIcsFeed(events: Array<{
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
}>): string {
  const mapped: EventAttributes[] = events.map((event) => {
    const start = new Date(event.start_at);
    const end = event.end_at ? new Date(event.end_at) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
      uid: event.id,
      title: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: [start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()],
      end: [end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), end.getUTCHours(), end.getUTCMinutes()],
      startInputType: "utc",
      startOutputType: "utc",
      endInputType: "utc",
      endOutputType: "utc",
      productId: "pbth/backend",
      calName: "Paintball Team Hub",
    };
  });

  const { error, value } = createEvents(mapped);
  if (error || !value) {
    throw error || new Error("Failed to build ICS");
  }
  return value;
}
