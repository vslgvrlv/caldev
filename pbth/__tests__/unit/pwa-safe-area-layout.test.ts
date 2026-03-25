// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eventDetailViewPath = fileURLToPath(new URL("../../views/EventDetailView.tsx", import.meta.url));
const createEventViewPath = fileURLToPath(new URL("../../views/CreateEventView.tsx", import.meta.url));
const playerProfileViewPath = fileURLToPath(new URL("../../views/PlayerProfileView.tsx", import.meta.url));
const loginViewPath = fileURLToPath(new URL("../../views/LoginView.tsx", import.meta.url));
const inviteViewPath = fileURLToPath(new URL("../../views/InviteView.tsx", import.meta.url));
const adminLoginViewPath = fileURLToPath(new URL("../../views/admin/AdminLoginView.tsx", import.meta.url));
const privacyViewPath = fileURLToPath(new URL("../../views/PrivacyView.tsx", import.meta.url));
const supportViewPath = fileURLToPath(new URL("../../views/SupportView.tsx", import.meta.url));
const termsViewPath = fileURLToPath(new URL("../../views/TermsView.tsx", import.meta.url));

describe("pwa safe-area layouts", () => {
  it("uses explicit top inset math for sticky in-app headers", () => {
    [eventDetailViewPath, createEventViewPath, playerProfileViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("calc(var(--pb-safe-top)");
      expect(source).not.toContain(" pb-safe-top");
    });
  });

  it("keeps auth entry screens safe-area aware in standalone mode", () => {
    [loginViewPath, inviteViewPath, adminLoginViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("var(--pb-safe-top)");
      expect(source).toContain("var(--pb-safe-bottom)");
    });
  });

  it("pads static public pages with safe-area insets", () => {
    [privacyViewPath, supportViewPath, termsViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("var(--pb-safe-top)");
      expect(source).toContain("var(--pb-safe-bottom)");
    });
  });
});
