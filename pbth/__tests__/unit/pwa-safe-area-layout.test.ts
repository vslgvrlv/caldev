// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eventDetailViewPath = fileURLToPath(new URL("../../views/EventDetailView.tsx", import.meta.url));
const createEventViewPath = fileURLToPath(new URL("../../views/CreateEventView.tsx", import.meta.url));
const playerProfileViewPath = fileURLToPath(new URL("../../views/PlayerProfileView.tsx", import.meta.url));
const eventExpensesSheetPath = fileURLToPath(new URL("../../components/EventExpensesSheet.tsx", import.meta.url));
const eventCollectionSheetPath = fileURLToPath(new URL("../../components/EventCollectionSheet.tsx", import.meta.url));
// Главная живёт в <Screen>: верхний отступ под статус-бар задаёт его раскладка.
const dashboardViewPath = fileURLToPath(new URL("../../ui/pbth-ui.css", import.meta.url));
const calendarViewPath = fileURLToPath(new URL("../../views/CalendarView.tsx", import.meta.url));
const financeViewPath = fileURLToPath(new URL("../../views/FinanceView.tsx", import.meta.url));
const teamViewPath = fileURLToPath(new URL("../../views/TeamView.tsx", import.meta.url));
const profileViewPath = fileURLToPath(new URL("../../views/ProfileView.tsx", import.meta.url));
const loginViewPath = fileURLToPath(new URL("../../views/login/login.css", import.meta.url));
const inviteFrameCssPath = fileURLToPath(new URL("../../components/track1/invite-frame.css", import.meta.url));
const screenCssPath = fileURLToPath(new URL("../../ui/pbth-ui.css", import.meta.url));
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

  it("keeps event finance sheet headers below the standalone status bar", () => {
    [eventExpensesSheetPath, eventCollectionSheetPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("calc(var(--pb-safe-top)");
    });
  });

  it("pads primary app tabs below the standalone status bar", () => {
    [calendarViewPath, teamViewPath, profileViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("calc(var(--pb-safe-top)");
    });
    expect(readFileSync(dashboardViewPath, "utf8")).toContain("calc(var(--pb-safe-top, 0px)");
  });

  it("keeps the treasury screen inside Screen, which owns the safe-area padding", () => {
    expect(readFileSync(financeViewPath, "utf8")).toContain("<Screen");
    expect(readFileSync(screenCssPath, "utf8")).toContain("var(--pb-safe-top");
  });

  it("keeps auth entry screens safe-area aware in standalone mode", () => {
    [loginViewPath, adminLoginViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("var(--pb-safe-top)");
      expect(source).toContain("var(--pb-safe-bottom)");
    });
  });

  it("keeps invite screens safe-area aware: Screen pads the top, the frame pads the bottom", () => {
    expect(readFileSync(screenCssPath, "utf8")).toContain("var(--pb-safe-top");
    expect(readFileSync(inviteFrameCssPath, "utf8")).toContain("var(--pb-safe-bottom");
  });

  it("pads static public pages with safe-area insets", () => {
    [privacyViewPath, supportViewPath, termsViewPath].forEach((path) => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("var(--pb-safe-top)");
      expect(source).toContain("var(--pb-safe-bottom)");
    });
  });
});
