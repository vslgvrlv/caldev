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
    const createImage = page.locator('img[src="img/event-create.webp"]');
    const summaryImage = page.locator('img[src="img/event-summary.webp"]');
    await expect(createImage).toBeVisible();
    await expect(summaryImage).toBeVisible();
    if (role === "captain") await expect(page.locator('img[src="img/captain-report.webp"]')).toBeVisible();
    const box = await summaryImage.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(288);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    await expect(summaryImage.locator("xpath=..")).toHaveAttribute("href", "img/event-summary.webp");
    await summaryImage.click();
    await expect(page).toHaveURL(/\/guide\/img\/event-summary\.webp$/);
    await expect(page.locator("img")).toBeVisible();
    expect(await page.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
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
