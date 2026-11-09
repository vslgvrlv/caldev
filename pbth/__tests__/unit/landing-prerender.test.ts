// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injectLanding, rewriteRootToLanding } from "../../prerender/inject";
import { renderLanding } from "../../prerender/landing";

// personal-os#1438: главная приходит готовой разметкой, фон — со своего сервера.
const indexHtml = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

describe("landing prerender", () => {
  it("рисует главную с фоном из /assets/hero, без Unsplash", () => {
    const markup = renderLanding();
    expect(markup).toContain("PaintBall");
    expect(markup).toContain('type="image/avif"');
    expect(markup).toContain("/assets/hero/hero-v1-1080.webp");
    expect(markup).not.toContain("unsplash");
  });

  it("вставляет разметку в #root оболочки и только туда", () => {
    const html = injectLanding(indexHtml, "<main>ok</main>");
    expect(html).toContain('<div id="root"><main>ok</main></div>');
    expect(html).not.toContain('<div id="root"></div>');
    expect(indexHtml).not.toContain("unsplash");
  });

  it("падает, если корня нет или разметка пустая", () => {
    expect(() => injectLanding("<body></body>", "<main/>")).toThrow();
    expect(() => injectLanding(indexHtml, "  ")).toThrow();
  });

  it("на landing.html уходят только / и /?…", () => {
    expect(rewriteRootToLanding("/")).toBe("/landing.html");
    expect(rewriteRootToLanding("/?utm_source=x")).toBe("/landing.html?utm_source=x");
    expect(rewriteRootToLanding("/app")).toBe("/app");
    expect(rewriteRootToLanding("/login?next=/app")).toBe("/login?next=/app");
    expect(rewriteRootToLanding("/assets/x.js")).toBe("/assets/x.js");
  });
});
