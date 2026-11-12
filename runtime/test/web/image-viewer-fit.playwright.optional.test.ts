import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, webkit, type Browser } from "playwright";
import { handleExtensionRoutes } from "../../src/channels/web/http/extension-routes";
import "../../src/channels/web/http/image-viewer-route";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1", browserTest = enabled ? test : test.skip;
const svg = (width: number, height: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#88aacc"/></svg>`;
const images: Record<string, string> = {
  "big.svg": svg(2400, 1200),
  "small.svg": svg(240, 120),
  "sizeless.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#88aacc"/></svg>',
};
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};
beforeAll(async () => {
  if (!enabled) return;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/image-viewer")) return (await handleExtensionRoutes(req, url.pathname)) || new Response(null, { status: 404 });
    if (url.pathname === "/workspace/raw") return new Response(images[url.searchParams.get("path") || ""] ?? "", { headers: { "Content-Type": "image/svg+xml" } });
    return new Response(null, { status: 404 });
  } });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
});
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });

const geometry = (page: import("playwright").Page) => page.evaluate(() => {
  const img = document.querySelector("img")!, stage = document.getElementById("stage")!;
  const rect = img.getBoundingClientRect();
  return { width: rect.width, height: rect.height, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight,
    scrolls: stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1,
    label: document.getElementById("zoomLabel")!.textContent, fit: document.getElementById("zoomFit")!.getAttribute("aria-pressed") };
});
const open = async (engine: string, name: string, viewport = { width: 800, height: 600 }) => {
  const page = await browsers[engine].newPage({ viewport });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.url}image-viewer/?path=${name}`);
  await page.waitForFunction(() => { const img = document.querySelector("img"); return Boolean(img?.complete && img.style.width); });
  return { page, errors };
};

for (const engine of ["chromium", "webkit"]) {
  browserTest(`${engine}: images open fitted to the viewer and refit when it resizes`, async () => {
    const { page, errors } = await open(engine, "big.svg");
    try {
      let g = await geometry(page);
      expect(g.fit).toBe("true");
      expect(g.width).toBeLessThanOrEqual(g.stageWidth - 48 + 1);
      expect(g.height).toBeLessThanOrEqual(g.stageHeight - 48 + 1);
      expect(Math.round(g.width / g.height)).toBe(2);
      expect(g.scrolls).toBe(false);
      expect(g.label).toBe(`${Math.round((g.width / 2400) * 100)}%`);
      await page.setViewportSize({ width: 400, height: 600 });
      await page.waitForTimeout(150);
      const narrower = await geometry(page);
      expect(narrower.width).toBeLessThan(g.width);
      expect(narrower.width).toBeLessThanOrEqual(narrower.stageWidth - 48 + 1);

      // Zooming leaves fit mode and scrolls; Fit returns to it.
      await page.locator("#zoomIn").click();
      await page.locator("#zoomIn").click();
      await page.locator("#zoomIn").click();
      g = await geometry(page);
      expect(g.fit).toBe("false");
      expect(g.width).toBeGreaterThan(narrower.width);
      await page.locator("#zoomReset").click();
      g = await geometry(page);
      expect([g.width, g.label, g.scrolls]).toEqual([2400, "100%", true]);
      await page.setViewportSize({ width: 800, height: 600 });
      await page.waitForTimeout(150);
      expect((await geometry(page)).width).toBe(2400);
      await page.locator("#zoomFit").click();
      g = await geometry(page);
      expect(g.fit).toBe("true");
      expect(g.scrolls).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  browserTest(`${engine}: small images stay at actual size and sizeless SVGs fill the viewer`, async () => {
    const small = await open(engine, "small.svg");
    try {
      const g = await geometry(small.page);
      expect([g.width, g.height, g.label, g.fit]).toEqual([240, 120, "100%", "true"]);
      expect(small.errors).toEqual([]);
    } finally { await small.page.close(); }
    const sizeless = await open(engine, "sizeless.svg");
    try {
      const g = await geometry(sizeless.page);
      expect(g.width).toBeGreaterThan(100);
      expect(g.width).toBeLessThanOrEqual(g.stageWidth - 48 + 1);
      expect(g.scrolls).toBe(false);
      expect(sizeless.errors).toEqual([]);
    } finally { await sizeless.page.close(); }
  });
}
