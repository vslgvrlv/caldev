import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Role } from "../../types";
import { ProfileView } from "../../views/ProfileView";

vi.mock("../../components/ProfileIdentities", () => ({ ProfileIdentities: () => null }));

const GUIDE_ARIA_LABEL = "Открыть инструкцию по работе с PaintBall Team Hub";
const ProfileViewWithRuntimeRole = ProfileView as unknown as React.ComponentType<Record<string, unknown>>;

function renderProfile(role: Role | null | undefined) {
  return renderToStaticMarkup(
    React.createElement(ProfileViewWithRuntimeRole, {
      user: { id: "guide-user", name: "Guide User", nickname: "guide_user" },
      onUpdateUser: () => undefined,
      onLogout: () => undefined,
      calendarLink: "https://example.test/calendar.ics",
      onCopyLink: () => undefined,
      onShareLink: () => undefined,
      onDownloadICS: () => undefined,
      role,
      canEnterAdmin: true,
      onEnterAdmin: () => undefined,
    }),
  );
}

describe("ProfileView guide entrypoint wiring", () => {
  it("renders the active trainer guide before the optional admin and calendar cards", () => {
    const html = renderProfile(Role.TRAINER);
    const guideIndex = html.indexOf(`aria-label="${GUIDE_ARIA_LABEL}"`);

    expect(guideIndex).toBeGreaterThan(-1);
    expect(html).toContain('href="/guide/trainer.html"');
    expect(guideIndex).toBeLessThan(html.indexOf("Платформа админа"));
    expect(guideIndex).toBeLessThan(html.indexOf("Интеграция календаря"));
  });

  it.each([null, undefined])("leaves no guide card or spacing hook when role is %s", (role) => {
    const html = renderProfile(role);

    expect(html).not.toContain(GUIDE_ARIA_LABEL);
    expect(html).not.toContain("/guide/player.html");
  });
});
