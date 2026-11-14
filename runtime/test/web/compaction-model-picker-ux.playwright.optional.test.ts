import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, webkit, type Browser, type Page } from "playwright";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
const browsers = new Map<string, Browser>();
let server: ReturnType<typeof Bun.serve> | undefined, baseUrl = "";
const fixtures = new Map<string, string>();

beforeAll(async () => {
  if (!enabled) return;
  // Build current source in memory: the tracked dev bundle may still contain
  // the retired separate-model picker. Never update shipped assets in this test.
  const classic = await Bun.build({ entrypoints: [join(runtimeRoot, "web/src/dev/settings-widget-fixture.ts")],
    target: "browser", format: "esm", external: ["#editor-vendor/codemirror"], write: false });
  if (!classic.success) throw Error(JSON.stringify(classic.logs));
  fixtures.set("classic", await classic.outputs[0]!.text());

  server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url), skin = "classic";
    if (url.pathname === "/classic") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"></head><body><div id="${"settings-widget"}-fixture-root"></div><script type="module" src="/${skin}.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/classic.js") return new Response(fixtures.get(url.pathname.slice(1, -3)), { headers: { "content-type": "text/javascript" } });
    if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
    try { return new Response(await readFile(join(runtimeRoot, "web/static", url.pathname.slice(8))), { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } }); }
    catch { return new Response("not found", { status: 404 }); }
  } });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

beforeAll(async () => { if (enabled) browsers.set("chromium", await chromium.launch({ headless: true })); });
beforeAll(async () => { if (enabled) browsers.set("webkit", await webkit.launch({ headless: true })); });
afterAll(async () => { for (const browser of browsers.values()) await browser.close(); browsers.clear(); server?.stop(true); });

async function open(engine: "chromium" | "webkit", skin: "classic", width: number, legacyModel = ""): Promise<Page> {
  const page = await browsers.get(engine)!.newPage({ viewport: { width, height: 760 }, hasTouch: width <= 520, colorScheme: "dark" });
  await page.goto(`${baseUrl}/${skin}?section=compaction&width=${Math.min(width - 32, 1100)}&height=700&compaction_model=${encodeURIComponent(legacyModel)}`, { waitUntil: "networkidle" });
  const root = ".settings-content";
  await page.locator(root).waitFor({ state: "visible" });
  await page.evaluate(() => {
    const prior = window.fetch.bind(window); (window as any).__compactionRequests = [];
    window.fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : String(input), location.href).pathname;
      (window as any).__compactionRequests.push({ path, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return prior(input, init);
    };
  });
  return page;
}

function controls(page: Page, _skin) {
  const root = page.locator(".settings-content");
  const row = root.locator(".settings-row").filter({ has: page.locator("label", { hasText: "Enable automatic compaction" }) });
  return { root, row, toggle: row.locator('input[type="checkbox"]') };
}
async function waitSaves(page: Page, count: number) {
  await page.waitForFunction(n => (window as any).__compactionRequests.filter((r: any) => r.path === "/agent/settings/compaction" && r.method === "POST").length === n, count);
}
async function assertNativeOnly(page: Page, skin: "classic") {
  const { root } = controls(page, skin);
  expect(await root.locator("select").count()).toBe(0);
  expect(await root.locator("#compactionModel,.compaction-model-probe-result,.compaction-latency-estimate").count()).toBe(0);
  expect(await root.innerText()).toContain("active conversation model and SDK thresholds");
  expect(await root.innerText()).toContain("already accepted maintenance is not cancelled");
  const requests = await page.evaluate(() => (window as any).__compactionRequests);
  expect(requests.some((r: any) => r.path.endsWith("/compaction/probe"))).toBe(false);
  for (const request of requests.filter((r: any) => r.path === "/agent/settings/compaction" && r.method === "POST")) {
    for (const field of ["compactionModel", "smartCompactionMethod", "compactionLatencyEstimate", "remoteCompactionEnabled", "compactionTimeoutSec"]) expect(request.body).not.toHaveProperty(field);
  }
}

for (const engine of ["chromium", "webkit"] as const) for (const skin of ["classic"] as const) {
  browserTest(`${engine}/${skin}: desktop compaction is keyboard-operable and never offers a provider probe`, async () => {
    const page = await open(engine, skin, 1200);
    try {
      const { toggle } = controls(page, skin); expect(await toggle.isChecked()).toBe(true);
      await toggle.press("Space"); await waitSaves(page, 1); expect(await toggle.isChecked()).toBe(false);
      await toggle.press("Space"); await waitSaves(page, 2); expect(await toggle.isChecked()).toBe(true);
      const saves = await page.evaluate(() => (window as any).__compactionRequests.filter((r: any) => r.path === "/agent/settings/compaction" && r.method === "POST"));
      expect(saves.map((r: any) => r.body.autoCompactionEnabled)).toEqual([false, true]);
      await assertNativeOnly(page, skin);
    } finally { await page.close(); }
  });

  browserTest(`${engine}/${skin}: an obsolete separate-model query cannot revive the retired selector`, async () => {
    const page = await open(engine, skin, 900, "missing/retired-model");
    try {
      const { toggle } = controls(page, skin); expect(await toggle.isChecked()).toBe(true);
      await assertNativeOnly(page, skin);
      expect(await page.evaluate(() => (window as any).__compactionRequests.filter((r: any) => r.path === "/agent/settings/compaction").length)).toBe(0);
    } finally { await page.close(); }
  });

  browserTest(`${engine}/${skin}: phone native compaction controls stay in the viewport and accept touch`, async () => {
    const page = await open(engine, skin, 520);
    try {
      const { row, toggle } = controls(page, skin), box = await row.boundingBox();
      expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(521); expect(box!.height).toBeGreaterThanOrEqual(28);
      await toggle.tap(); await waitSaves(page, 1); expect(await toggle.isChecked()).toBe(false);
      await toggle.tap(); await waitSaves(page, 2); expect(await toggle.isChecked()).toBe(true);
      await assertNativeOnly(page, skin);
    } finally { await page.close(); }
  });
}
