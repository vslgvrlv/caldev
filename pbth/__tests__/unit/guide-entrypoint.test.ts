import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideEntrypoint } from "../../components/GuideEntrypoint";
import { GUIDE_PATHS, guidePathForRole } from "../../lib/guide-access";
import { Role } from "../../types";

describe("guidePathForRole", () => {
  it.each([
    [Role.PLAYER, "/guide/player.html"],
    [Role.TRAINER, "/guide/trainer.html"],
    [Role.CAPTAIN, "/guide/captain.html"],
    [Role.ADMIN, "/guide/captain.html"],
    ["UNKNOWN_ROLE", "/guide/player.html"],
    ["../../admin", "/guide/player.html"],
    ["https://evil.example", "/guide/player.html"],
    [null, "/guide/player.html"],
    [undefined, "/guide/player.html"],
  ])("maps %s to an allowlisted guide", (role, expected) => {
    const path = guidePathForRole(role);
    expect(path).toBe(expected);
    expect(Object.values(GUIDE_PATHS)).toContain(path);
  });

  it("exposes only the three same-origin guide paths", () => {
    expect(new Set(Object.values(GUIDE_PATHS))).toEqual(
      new Set([
        "/guide/player.html",
        "/guide/trainer.html",
        "/guide/captain.html",
      ]),
    );
  });
});

describe("GuideEntrypoint", () => {
  it("stays hidden until a role exists, then renders the matching safe link", () => {
    expect(renderToStaticMarkup(React.createElement(GuideEntrypoint, { role: null }))).toBe("");
    expect(renderToStaticMarkup(React.createElement(GuideEntrypoint, { role: undefined }))).toBe("");

    const trainer = renderToStaticMarkup(React.createElement(GuideEntrypoint, { role: Role.TRAINER }));
    expect(trainer).toContain('href="/guide/trainer.html"');
    expect(trainer).not.toContain('/guide/player.html');
    expect(trainer).toContain("Как пользоваться");
    expect(trainer).toContain("Пошаговая инструкция для вашей роли");
    expect(trainer).toContain('aria-label="Открыть инструкцию по работе с PaintBall Team Hub"');
    expect(trainer).toContain('target="_blank"');
    expect(trainer).toContain('rel="noopener noreferrer"');
    expect(trainer.match(/<a\b/g)).toHaveLength(1);

    const captain = renderToStaticMarkup(React.createElement(GuideEntrypoint, { role: Role.CAPTAIN }));
    expect(captain).toContain('href="/guide/captain.html"');
  });
});
