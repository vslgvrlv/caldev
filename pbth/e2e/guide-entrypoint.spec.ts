import { expect, test, type Page } from "@playwright/test";

const roleCases = [
  ["PLAYER", "/guide/player.html"],
  ["TRAINER", "/guide/trainer.html"],
  ["CAPTAIN", "/guide/captain.html"],
  ["ADMIN", "/guide/captain.html"],
] as const;

async function openProfile(page: Page, role: string) {
  await page.addInitScript((activeRole) => {
    const user = { id: "guide-user", name: "Guide User", nickname: "guide_user" };
    const team = {
      id: "guide-team",
      name: "Guide Team",
      shortCode: "GUIDE",
      timezone: "Europe/Moscow",
      role: activeRole,
      budget: 0,
    };
    const teams = [{
      membershipId: "guide-membership",
      teamId: team.id,
      teamName: team.name,
      shortCode: team.shortCode,
      role: activeRole,
    }];
    // The session profile only enables local-dev auth; state.team.role remains
    // authoritative so every runtime role exercises the real App wiring.
    localStorage.setItem("pbth:local-dev-session:v1", JSON.stringify({ profile: "captain" }));
    localStorage.setItem("pbth:local-dev-state:v1", JSON.stringify({
      profile: "captain",
      user,
      team,
      teams,
      members: [],
      events: [],
      transactions: [],
    }));
  }, role);
  await page.goto("/app");
  await page.getByRole("button", { name: "Профиль" }).click();
}

for (const [role, path] of roleCases) {
  test(`${role} opens its role guide without leaving the app`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openProfile(page, role);
    const link = page.getByRole("link", {
      name: "Открыть инструкцию по работе с PaintBall Team Hub",
      exact: true,
    });
    await expect(link).toHaveAttribute("href", path);
    await expect(link).toHaveAttribute("target", "_blank");
    expect(new Set((await link.getAttribute("rel"))?.split(/\s+/).filter(Boolean))).toEqual(
      new Set(["noopener", "noreferrer"]),
    );
    const [guide] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await guide.waitForLoadState("domcontentloaded");
    expect(new URL(guide.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(guide.url()).pathname).toBe(path);
    expect(await guide.evaluate(() => window.opener)).toBeNull();
    await expect(page).toHaveURL(/\/app$/);
    await guide.close();
  });
}

test("profile guide card fits 320 px, is keyboard-visible, and keeps five-item navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await openProfile(page, "TRAINER");
  const link = page.getByRole("link", {
    name: "Открыть инструкцию по работе с PaintBall Team Hub",
    exact: true,
  });
  await expect(link).toBeVisible();
  await expect(link.getByText("Как пользоваться", { exact: true })).toBeVisible();
  await expect(link.getByText("Пошаговая инструкция для вашей роли", { exact: true })).toBeVisible();
  expect(await link.locator("button, a").count()).toBe(0);

  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator("div.fixed.bottom-0 button").count()).toBe(5);
  for (const label of ["Главная", "Календарь", "Казна", "Команда", "Профиль"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  const widths = await page.evaluate(() => ({
    viewport: innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.viewport).toBe(320);
  expect(widths.html).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);

  const unfocusedShadow = await link.evaluate((element) => getComputedStyle(element).boxShadow);
  for (let attempts = 0; attempts < 20 && !(await link.evaluate((element) => document.activeElement === element)); attempts += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  const focusedShadow = await link.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(focusedShadow).not.toBe(unfocusedShadow);
  expect(focusedShadow).toContain("rgb(0, 230, 118)");

  const [guide] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("Enter")]);
  await guide.waitForLoadState("domcontentloaded");
  expect(new URL(guide.url()).pathname).toBe("/guide/trainer.html");
  await expect(page).toHaveURL(/\/app$/);
  await guide.close();
});
