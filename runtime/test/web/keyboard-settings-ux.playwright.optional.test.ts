import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";

import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

let fixtureDir = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/classic") {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div class="settings-row settings-keyboard-fixture__classic-reference" aria-hidden="true" style="position:fixed;left:-9999px"><input type="text" tabindex="-1"></div><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      }
      if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const body = await readFile(join(runtimeRoot, "web/static", url.pathname.slice("/static/".length)));
        const contentType = url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream";
        return new Response(body, { headers: { "content-type": contentType } });
      } catch { return new Response("not found", { status: 404 }); }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  browser = null;
  server = null;
});

async function openKeyboard(skin: "classic", width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: "dark" });
  {
    await page.goto(`${baseUrl}/classic?section=keyboard&width=${Math.max(360, Math.min(width - 32, 1120))}&height=${Math.max(420, Math.min(height - 32, 760))}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".settings-shortcut-card", { state: "visible" });
  }
  return page;
}

async function keyboardMetrics(page: Page, _skin) {
  const selectors = {
    root: ".settings-content", card: ".settings-shortcut-card", input: ".settings-shortcut-input", actions: ".settings-shortcut-actions button", reference: ".settings-keyboard-fixture__classic-reference input",
  };
  return page.evaluate((s) => {
    const root = document.querySelector(s.root) as HTMLElement;
    const rootRect = root.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll(`${s.input}, ${s.actions}`)) as HTMLElement[];
    const input = document.querySelector(s.input) as HTMLElement;
    const reference = document.querySelector(s.reference) as HTMLElement | null;
    const style = (node: HTMLElement | null) => node ? getComputedStyle(node) : null;
    return {
      root: { left: rootRect.left, right: rootRect.right, width: rootRect.width, scrollWidth: root.scrollWidth },
      cardCount: document.querySelectorAll(s.card).length,
      outside: nodes.map((node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }).filter((rect) => rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1),
      input: input ? { height: input.getBoundingClientRect().height, padding: style(input)?.padding, borderRadius: style(input)?.borderRadius, background: style(input)?.backgroundColor, border: style(input)?.border } : null,
      reference: reference ? { height: reference.getBoundingClientRect().height, padding: style(reference)?.padding, borderRadius: style(reference)?.borderRadius, background: style(reference)?.backgroundColor, border: style(reference)?.border } : null,
      labelled: Array.from(document.querySelectorAll(s.input)).every((node) => (node as HTMLInputElement).labels?.length === 1),
    };
  }, selectors);
}

for (const width of [1366, 820, 520, 390]) {
  optionalBrowserTest(`classic Keyboard matches Classic controls and stays inside ${width}px`, async () => {
    const page = await openKeyboard("classic", width, width === 390 ? 844 : 760);
    try {
      const metrics = await keyboardMetrics(page, "classic");
      expect(metrics.cardCount).toBe(8);
      expect(metrics.outside).toEqual([]);
      expect(metrics.labelled).toBe(true);
      expect(metrics.reference).not.toBeNull();
      expect(metrics.input).toMatchObject({
        padding: metrics.reference?.padding,
        borderRadius: metrics.reference?.borderRadius,
        background: metrics.reference?.background,
        border: metrics.reference?.border,
      });
      expect(Math.abs((metrics.input?.height || 0) - (metrics.reference?.height || 0))).toBeLessThanOrEqual(2);
    } finally { await page.close(); }
  });

}
