export function formatNotificationDateTime(dateIso: string, timezone?: string | null, location?: string | null) {
  const dt = new Date(dateIso);
  const date = dt.toLocaleString("ru-RU", {
    timeZone: timezone || "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return location ? `${date} • ${location}` : date;
}
