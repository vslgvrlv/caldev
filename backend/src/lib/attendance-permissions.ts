// #62: кто может отмечать фактическую явку (был/не был) на событии.
// Зеркалит правило управления событием: платформенный админ и капитан — всегда;
// тренер — только тренировки и собрания; игрок — нет.

const TRAINER_MANAGEABLE_EVENT_TYPES = new Set(["TRAINING", "MEETING"]);

export type EventTeamRole = "CAPTAIN" | "TRAINER" | "PLAYER" | null;

export function canMarkAttendance(input: {
  isPlatformAdmin: boolean;
  teamRole: EventTeamRole;
  eventType: string;
}): boolean {
  if (input.isPlatformAdmin) return true;
  if (input.teamRole === "CAPTAIN") return true;
  if (input.teamRole === "TRAINER") return TRAINER_MANAGEABLE_EVENT_TYPES.has(input.eventType);
  return false;
}
