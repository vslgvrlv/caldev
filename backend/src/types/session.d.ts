import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    entryRole?: "ADMIN" | "USER";
    activeMembershipId?: string;
    activeTeamId?: string;
    authMethod?: "WEBAPP" | "OIDC" | "LEGACY_WIDGET" | "DEV";
  }
}
