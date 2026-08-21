import { Role } from "../types";

export const GUIDE_PATHS = {
  player: "/guide/player.html",
  trainer: "/guide/trainer.html",
  captain: "/guide/captain.html",
} as const;

export type GuidePath = (typeof GUIDE_PATHS)[keyof typeof GUIDE_PATHS];

export function guidePathForRole(role: unknown): GuidePath {
  if (role === Role.TRAINER) return GUIDE_PATHS.trainer;
  if (role === Role.CAPTAIN || role === Role.ADMIN) return GUIDE_PATHS.captain;
  return GUIDE_PATHS.player;
}
