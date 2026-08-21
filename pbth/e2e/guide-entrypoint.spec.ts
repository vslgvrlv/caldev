import { expect, test, type Page } from "@playwright/test";

const GUIDE_ARIA_LABEL = "Открыть инструкцию по работе с PaintBall Team Hub";
const BOTTOM_NAV_LABELS = ["Главная", "Календарь", "Казна", "Команда", "Профиль"];

const roleCases = [
  ["PLAYER", "/guide/player.html", "Инструкция · Игрок"],
  ["TRAINER", "/guide/trainer.html", "Инструкция · Тренер"],
  ["CAPTAIN", "/guide/captain.html", "Инструкция · Капитан"],
  ["ADMIN", "/guide/captain.html", "Инструкция · Капитан"],
] as const;

const viewports = [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 320, height: 740 }],
] as const;

test.use({ serviceWorkers: "block" });

type RuntimeRole = string | null | undefined;

async function installApiMocks(page: Page, auth: "local" | "anonymous" = "local") {
  const unexpectedRequests: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET" && url.pathname === "/api/v1/vendor/telegram-web-app.js") {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      return;
    }
    if (auth === "anonymous" && request.method() === "GET" && url.pathname === "/api/v1/auth/me") {
      await route.fulfill({ status: 200, json: { authenticated: false } });
      return;
    }
    if (
      auth === "local" &&
      request.method() === "GET" &&
      url.pathname === "/api/v1/finance/overview" &&
      url.searchParams.get("teamId") === "guide-team"
    ) {
      await route.fulfill({
        status: 200,
        json: { summary: { balance: 0 }, recentTransactions: [] },
      });
      return;
    }
    if (
      auth === "local" &&
      request.method() === "GET" &&
      url.pathname === "/api/v1/finance/members" &&
      url.searchParams.get("teamId") === "guide-team"
    ) {
      await route.fulfill({ status: 200, json: { items: [] } });
      return;
    }
    if (auth === "local" && request.method() === "GET" && url.pathname === "/api/v1/auth/identities") {
      await route.fulfill({ status: 200, json: { identities: [] } });
      return;
    }

    unexpectedRequests.push(`${request.method()} ${url.pathname}${url.search}`);
    await route.abort("failed");
  });

  return unexpectedRequests;
}

async function openProfile(page: Page, role: RuntimeRole) {
  const unexpectedRequests = await installApiMocks(page);
  await page.addInitScript((seed: { role?: RuntimeRole; omitRole: boolean }) => {
    const user = {
      id: "guide-user",
      name: "Guide User",
      nickname: "guide_user",
      avatar: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    };
    const team: Record<string, unknown> = {
      id: "guide-team",
      name: "Guide Team",
      shortCode: "GUIDE",
      timezone: "Europe/Moscow",
      budget: 0,
    };
    const membership: Record<string, unknown> = {
      membershipId: "guide-membership",
      teamId: team.id,
      teamName: "Guide Team",
      shortCode: "GUIDE",
    };
    if (!seed.omitRole) {
      team.role = seed.role;
      membership.role = seed.role;
    }
    // The session profile only enables local-dev auth; state.team.role remains
    // authoritative so every runtime role exercises the real App wiring.
    localStorage.setItem("pbth:local-dev-session:v1", JSON.stringify({ profile: "captain" }));
    localStorage.setItem("pbth:local-dev-state:v1", JSON.stringify({
      profile: "captain",
      user,
      team,
      teams: [membership],
      members: [],
      events: [],
      transactions: [],
    }));
  }, { role, omitRole: role === undefined });
  await page.goto("/app");
  await page.getByRole("button", { name: "Профиль" }).click();
  await expect(page.getByText("Способы входа", { exact: true })).toBeVisible();

  return unexpectedRequests;
}

for (const [viewportName, viewport] of viewports) {
  for (const [role, path, guideBadge] of roleCases) {
    test(`${role} opens its role guide at ${viewportName} without leaving the app`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const unexpectedRequests = await openProfile(page, role);
      const link = page.getByRole("link", { name: GUIDE_ARIA_LABEL, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", path);
      await expect(link).toHaveAttribute("target", "_blank");
      expect(new Set((await link.getAttribute("rel"))?.split(/\s+/).filter(Boolean))).toEqual(
        new Set(["noopener", "noreferrer"]),
      );

      const navButtons = page.locator("div.fixed.bottom-0").getByRole("button");
      await expect(navButtons).toHaveCount(5);
      await expect(navButtons).toHaveText(BOTTOM_NAV_LABELS);
      expect(await page.evaluate(() => (
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth
      ))).toBe(true);

      const [guide] = await Promise.all([page.waitForEvent("popup"), link.click()]);
      await guide.waitForLoadState("domcontentloaded");
      expect(new URL(guide.url()).origin).toBe(new URL(page.url()).origin);
      expect(new URL(guide.url()).pathname).toBe(path);
      await expect(guide.locator(".badge")).toHaveText(guideBadge);
      expect(await guide.evaluate(() => window.opener)).toBeNull();
      await expect(page).toHaveURL(/\/app$/);
      expect(unexpectedRequests).toEqual([]);
      await guide.close();
    });
  }
}

test("anonymous /app entry stays behind the authenticated gate", async ({ page }) => {
  const unexpectedRequests = await installApiMocks(page, "anonymous");

  await page.goto("/app");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: GUIDE_ARIA_LABEL, exact: true })).toHaveCount(0);
  expect(unexpectedRequests).toEqual([]);
});

for (const missingRole of [null, undefined] as const) {
  test(`authenticated profile hides the guide when role is ${String(missingRole)}`, async ({ page }) => {
    const unexpectedRequests = await openProfile(page, missingRole);

    await expect(page.getByRole("link", { name: GUIDE_ARIA_LABEL, exact: true })).toHaveCount(0);
    await expect(page.getByText("Интеграция календаря", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
    expect(unexpectedRequests).toEqual([]);
  });
}

test("profile guide card fits 320 px and opens from a visible keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const unexpectedRequests = await openProfile(page, "TRAINER");
  const link = page.getByRole("link", { name: GUIDE_ARIA_LABEL, exact: true });
  await expect(link).toBeVisible();
  await expect(link.getByText("Как пользоваться", { exact: true })).toBeVisible();
  await expect(link.getByText("Пошаговая инструкция для вашей роли", { exact: true })).toBeVisible();
  expect(await link.locator("button, a").count()).toBe(0);

  const box = await link.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("div.fixed.bottom-0").getByRole("button")).toHaveText(BOTTOM_NAV_LABELS);
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
  await expect(guide.locator(".badge")).toHaveText("Инструкция · Тренер");
  await expect(page).toHaveURL(/\/app$/);
  expect(unexpectedRequests).toEqual([]);
  await guide.close();
});
