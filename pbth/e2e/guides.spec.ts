import { expect, test } from "@playwright/test";

const roles = [
  { role: "player", image: "img/event-series.webp" },
  { role: "trainer", image: "img/summary.webp" },
  { role: "captain", image: "img/summary.webp" },
] as const;

for (const { role, image } of roles) {
  test(`${role} guide is readable at desktop and 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/guide/${role}.html`);

    await expect(page.locator("main h2").first()).toBeVisible();
    await expect(page.locator("nav.toc a").first()).toHaveCSS("min-height", "44px");

    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("h1")).toHaveCSS("font-size", "28px");
    const shot = page.locator(`img[src="${image}"]`);
    await shot.scrollIntoViewIfNeeded();
    await expect(shot).toBeVisible();
    const box = await shot.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(260);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    await expect(shot.locator("xpath=..")).toHaveAttribute("href", image);
    await shot.click();
    await expect(page).toHaveURL(new RegExp(`/guide/${image.replace(".", "\\.")}$`));
    await expect(page.locator("img")).toBeVisible();
    expect(await page.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  test(`${role} guide takes its look from ui-kit without signing in`, async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`/guide/${role}.html`);
    await page.evaluate(() => document.fonts.ready);

    // Страница открыта без входа и осталась на своём адресе.
    await expect(page).toHaveURL(new RegExp(`/guide/${role}\\.html$`));
    // Шрифт Manrope из vendor, тёмный фон темы, стеклянная панель ui-kit.
    expect(await page.locator("body > .pbth-ui").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Manrope");
    expect(await page.evaluate(() => document.fonts.check("16px Manrope", "Привет"))).toBe(true);
    expect(await page.locator(".guide-hero").evaluate((el) => getComputedStyle(el).backdropFilter)).not.toBe("none");
    expect(await page.locator("body > .pbth-ui").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(7, 11, 9)");
    // Знак продукта из спрайта значков и переход между ролями.
    expect(await page.locator(".guide-mark use").getAttribute("href")).toBe("ui-kit/icons.svg#ui-i-hexagon");
    expect((await page.request.get("/guide/ui-kit/icons.svg")).ok()).toBe(true);
    await expect(page.locator(".guide-brand")).toContainText("Paintball TeamHub");
    await expect(page.locator(".guide-roles a")).toHaveCount(3);
    await expect(page.locator('.guide-roles a[aria-current="page"]')).toHaveAttribute("href", `${role}.html`);
    expect(failed).toEqual([]);
  });
}

test("role switcher moves between the guides", async ({ page }) => {
  await page.goto("/guide/player.html");
  await page.locator('.guide-roles a[href="captain.html"]').click();
  await expect(page).toHaveURL(/\/guide\/captain\.html$/);
  await expect(page.locator(".badge")).toHaveText("Инструкция · Капитан");
  await page.locator('.guide-roles a[href="trainer.html"]').click();
  await expect(page.locator(".badge")).toHaveText("Инструкция · Тренер");
});

test("captain guide TOC follows keyboard order and reaches its target", async ({ page }) => {
  await page.goto("/guide/captain.html");
  // Первыми в порядке табуляции идут знак продукта и ссылки ролей, затем оглавление.
  for (let attempts = 0; attempts < 8; attempts += 1) {
    await page.keyboard.press("Tab");
    if (await page.locator("nav.toc a").first().evaluate((a) => document.activeElement === a)) break;
  }
  await expect(page.locator("nav.toc a").first()).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#s0$/);
  await expect(page.locator("#s0 h2")).toBeInViewport();
});
