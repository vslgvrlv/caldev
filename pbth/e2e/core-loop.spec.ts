import { expect, test } from "@playwright/test";

test("landing is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/PaintBall Team Hub/i);
});
