import { expect, test } from "@playwright/test";

for (const role of ["captain", "trainer"] as const) {
  test(`${role} guide is readable at desktop and 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/guide/${role}.html`);

    await expect(page.locator("main h2").first()).toBeVisible();
    await expect(page.locator("nav.toc a").first()).toHaveCSS("min-height", "44px");

    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("h1")).toHaveCSS("font-size", "27px");
  });
}

test("captain guide TOC follows keyboard order and reaches its target", async ({ page }) => {
  await page.goto("/guide/captain.html");
  await page.keyboard.press("Tab");
  await expect(page.locator("nav.toc a").first()).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#s1$/);
  await expect(page.locator("#s1 h2")).toBeInViewport();
});
