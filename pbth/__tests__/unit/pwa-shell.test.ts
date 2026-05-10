// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { existsSync, readFileSync } from "node:fs";
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const indexHtmlPath = fileURLToPath(new URL("../../index.html", import.meta.url));
const indexCssPath = fileURLToPath(new URL("../../index.css", import.meta.url));
const manifestPath = fileURLToPath(new URL("../../public/manifest.webmanifest", import.meta.url));
const iconSvgPath = fileURLToPath(new URL("../../public/icons/icon.svg", import.meta.url));
const icon192Path = fileURLToPath(new URL("../../public/icons/icon-192.png", import.meta.url));
const icon512Path = fileURLToPath(new URL("../../public/icons/icon-512.png", import.meta.url));
const appleTouchIconPath = fileURLToPath(new URL("../../public/icons/apple-touch-icon.png", import.meta.url));

describe("pwa shell", () => {
  it("ships a web manifest with installable icon assets", () => {
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(iconSvgPath)).toBe(true);
    expect(existsSync(icon192Path)).toBe(true);
    expect(existsSync(icon512Path)).toBe(true);
    expect(existsSync(appleTouchIconPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.name).toBe("PaintBall Team Hub");
    expect(manifest.start_url).toBe("/app");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon.svg", type: "image/svg+xml" }),
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }),
      ])
    );
  });

  it("uses a full-bleed launcher icon without padded shadow filters", () => {
    const svg = readFileSync(iconSvgPath, "utf8");
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('<rect x="0" y="0" width="512" height="512" fill="url(#pbthHubGradient)"');
    expect(svg).not.toContain("<filter");
    expect(svg).not.toContain("feGaussianBlur");
  });

  it("links manifest and branded icons from the app shell", () => {
    const html = readFileSync(indexHtmlPath, "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('apple-touch-icon');
  });

  it("ships safe-area helpers in the bundled stylesheet", () => {
    const css = readFileSync(indexCssPath, "utf8");
    expect(css).toContain("safe-area-inset-top");
    expect(css).toContain(".pb-safe-top");
    expect(css).toContain(".pb-safe");
  });

  it("does not load Tailwind from a runtime CDN", () => {
    const html = readFileSync(indexHtmlPath, "utf8");
    expect(html).not.toContain("/api/v1/vendor/tailwindcss.js");
    expect(html).not.toContain("tailwind.runtime.config.js");
  });

  it("loads the Telegram WebApp SDK via the vendor proxy without a static src tag", () => {
    const html = readFileSync(indexHtmlPath, "utf8");
    expect(html).not.toContain('<script src="/api/v1/vendor/telegram-web-app.js');
    expect(html).toContain("data-pbth-vendor");
    expect(html).toContain("/api/v1/vendor/telegram-web-app.js");
  });
});
