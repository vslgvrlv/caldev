import { Router, type Response } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";

const vendorRouter = Router();

const VENDOR_SOURCES = {
  tailwindcss: "https://cdn.tailwindcss.com",
  telegramWebApp: "https://telegram.org/js/telegram-web-app.js",
} as const;

type VendorName = keyof typeof VENDOR_SOURCES;

type CacheEntry = {
  body: string;
  fetchedAt: number;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<VendorName, CacheEntry>();

async function fetchVendor(name: VendorName): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(VENDOR_SOURCES[name], {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "pbth-backend/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`vendor fetch failed: ${name} status=${response.status}`);
    }
    const body = await response.text();
    if (!body.trim()) {
      throw new Error(`vendor fetch failed: ${name} empty body`);
    }
    // Sometimes upstream/CDN returns HTML/challenge page instead of JS; do not cache garbage.
    if (name === "tailwindcss") {
      const normalized = body.slice(0, 512).toLowerCase();
      if (normalized.includes("<html") || normalized.includes("<!doctype html")) {
        throw new Error(`vendor fetch failed: ${name} returned html`);
      }
      if (!body.includes("tailwind")) {
        throw new Error(`vendor fetch failed: ${name} unexpected body`);
      }
    }
    cache.set(name, { body, fetchedAt: Date.now() });
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function getVendor(name: VendorName): Promise<string> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }

  try {
    return await fetchVendor(name);
  } catch (error) {
    if (cached) {
      console.warn(`[vendor] using stale cache for ${name}`, error);
      return cached.body;
    }
    throw error;
  }
}

function sendJs(res: Response, body: string, options?: { cacheControl?: string; source?: string }) {
  res.setHeader("Cache-Control", options?.cacheControl || "public, max-age=3600, stale-while-revalidate=86400");
  if (options?.source) {
    res.setHeader("X-PBTH-Vendor-Source", options.source);
  }
  res.type("application/javascript; charset=utf-8").send(body);
}

function sendFallback(res: Response, name: string) {
  if (name === "tailwindcss") {
    // Client-side fallback: if backend cannot fetch/cached copy is absent, try direct CDN load from the browser.
    return sendJs(
      res,
      `(function(){try{var s=document.createElement('script');s.src='https://cdn.tailwindcss.com';s.defer=true;s.onerror=function(){console.warn('[vendor] tailwind direct fallback failed')};document.head.appendChild(s);}catch(e){console.warn('[vendor] tailwind fallback inject failed',e);}})();`,
      { cacheControl: "no-store", source: "fallback" }
    );
  }
  if (name === "telegram-web-app") {
    return sendJs(
      res,
      `(function(){try{var existing=document.querySelector('script[data-pbth-vendor="telegram-web-app"]');if(existing){return;}var s=document.createElement('script');s.src='https://telegram.org/js/telegram-web-app.js';s.defer=true;s.dataset.pbthVendor='telegram-web-app';s.onerror=function(){console.warn('[vendor] telegram-web-app direct fallback failed')};document.head.appendChild(s);}catch(e){console.warn('[vendor] telegram-web-app fallback inject failed',e);}})();`,
      { cacheControl: "no-store", source: "fallback" }
    );
  }
  sendJs(
    res,
    `console.warn("[vendor] failed to load ${name}, fallback script returned by backend");`,
    { cacheControl: "no-store", source: "fallback" }
  );
}

vendorRouter.get(
  "/tailwindcss.js",
  asyncHandler(async (_req, res) => {
    try {
      const body = await getVendor("tailwindcss");
      sendJs(res, body, { cacheControl: "no-store", source: "cache-or-upstream" });
    } catch (error) {
      console.error("[vendor] tailwindcss fetch error", error);
      sendFallback(res, "tailwindcss");
    }
  })
);

vendorRouter.get(
  "/telegram-web-app.js",
  asyncHandler(async (_req, res) => {
    try {
      const body = await getVendor("telegramWebApp");
      sendJs(res, body, { source: "cache-or-upstream" });
    } catch (error) {
      console.error("[vendor] telegram-web-app fetch error", error);
      sendFallback(res, "telegram-web-app");
    }
  })
);

export { vendorRouter };
