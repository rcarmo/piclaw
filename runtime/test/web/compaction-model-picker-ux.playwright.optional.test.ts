import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      }
      if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const body = await readFile(join(import.meta.dir, "../../web/static", url.pathname.slice("/static/".length)));
        return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await browser?.close();
  browser = null;
  server?.stop(true);
  server = null;
});

async function openCompaction(width: number, height: number, configuredModel = ""): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height } });
  const query = new URLSearchParams({ section: "compaction", width: String(Math.min(width - 40, 1100)), height: String(Math.min(height - 40, 850)), compaction_model: configuredModel });
  await page.goto(`${baseUrl}/?${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector("#compactionModel", { state: "visible" });
  await page.waitForFunction(() => ((document.querySelector("#compactionModel") as HTMLSelectElement | null)?.options.length ?? 0) >= 100);
  return page;
}

optionalBrowserTest("desktop compaction model selector is constrained, keyboard-operable, and probes without changing selection", async () => {
  const page = await openCompaction(1200, 760);
  try {
    const selector = page.locator("#compactionModel");
    expect(await selector.evaluate((node: HTMLSelectElement) => node.tagName)).toBe("SELECT");
    expect(await selector.locator("option").count()).toBeGreaterThanOrEqual(100);
    expect(await selector.locator("option").first().textContent()).toContain("Use active model");
    expect(await page.locator(".compaction-latency-estimate").textContent()).toContain("5 recent comparable samples");
    const box = await selector.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(28);

    await selector.focus();
    await page.keyboard.press("ArrowDown");
    const selected = await selector.inputValue();
    expect(selected.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Test compaction model" }).click();
    await page.waitForSelector(".compaction-model-probe-result.success");
    expect(await page.locator(".compaction-model-probe-result").textContent()).toContain("TTFT 42ms");
    expect(await page.locator(".compaction-model-probe-result").textContent()).toContain("p90 290s");
    expect(await selector.inputValue()).toBe(selected);
  } finally {
    await page.close();
  }
});

optionalBrowserTest("invalid configured model remains visible and explicitly repairable", async () => {
  const page = await openCompaction(900, 700, "missing/retired-model");
  try {
    const selector = page.locator("#compactionModel");
    expect(await selector.inputValue()).toBe("missing/retired-model");
    expect(await selector.locator('option[value="missing/retired-model"]').textContent()).toContain("Unavailable");
    expect(await page.getByText("Configured model is not currently available.", { exact: false }).textContent()).toContain("not currently available");
    await selector.selectOption("");
    expect(await selector.inputValue()).toBe("");
  } finally {
    await page.close();
  }
});

optionalBrowserTest("phone compaction selector and probe stay inside the viewport with touch-sized controls", async () => {
  const page = await openCompaction(520, 720);
  try {
    const metrics = await page.evaluate(() => {
      const selector = document.querySelector("#compactionModel") as HTMLElement;
      const button = Array.from(document.querySelectorAll("button")).find((node) => node.textContent?.includes("Test compaction model")) as HTMLElement;
      const s = selector.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const advisory = document.querySelector(".compaction-latency-estimate") as HTMLElement;
      const a = advisory.getBoundingClientRect();
      return { viewport: innerWidth, selector: { left: s.left, right: s.right, height: s.height }, button: { left: b.left, right: b.right, height: b.height }, advisory: { left: a.left, right: a.right, height: a.height }, bodyScrollWidth: document.body.scrollWidth };
    });
    expect(metrics.selector.left).toBeGreaterThanOrEqual(0);
    expect(metrics.selector.right).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.button.left).toBeGreaterThanOrEqual(0);
    expect(metrics.button.right).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.selector.height).toBeGreaterThanOrEqual(28);
    expect(metrics.button.height).toBeGreaterThanOrEqual(28);
    expect(metrics.advisory.left).toBeGreaterThanOrEqual(0);
    expect(metrics.advisory.right).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.advisory.height).toBeGreaterThan(0);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport);
  } finally {
    await page.close();
  }
});
