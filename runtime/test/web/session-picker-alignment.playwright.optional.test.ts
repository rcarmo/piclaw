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
      if (url.pathname === "/") return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script></head><body><div id="session-picker-fixture-root"></div><script type="module" src="/static/classic/dist/session-picker-fixture.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
      if (url.pathname.includes("..")) return new Response("not found", { status: 404 });
      try {
        const path = url.pathname === "/editor-vendor/codemirror.js"
          ? join(import.meta.dir, "../../extensions/viewers/editor/vendor/codemirror.js")
          : join(import.meta.dir, "../../web/static", url.pathname.slice("/static/".length));
        const body = await readFile(path);
        return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" } });
      } catch { return new Response("not found", { status: 404 }); }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => { await browser?.close(); server?.stop(true); browser = null; server = null; });

async function openPicker(width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByTestId("session-switcher").click();
  await page.waitForSelector(".compose-session-popup", { state: "visible" });
  return page;
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => { const el = document.querySelector(selector) as HTMLElement; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }; };
    return { viewport: { width: innerWidth, height: innerHeight }, popup: box(".compose-session-popup"), results: box(".compose-session-popup-results"), search: box(".compose-session-search"), headings: Array.from(document.querySelectorAll(".compose-session-section-heading")).map(node => node.textContent) };
  });
}

optionalBrowserTest("desktop session picker has stable geometry, one-line header, persistent pins, search, and keyboard selection", async () => {
  const page = await openPicker(1280, 800);
  try {
    const before = await metrics(page);
    expect(before.results.height).toBeGreaterThanOrEqual(180);
    expect(before.results.height).toBeLessThanOrEqual(430);
    expect(before.results.scrollHeight).toBeGreaterThan(before.results.clientHeight);
    expect(before.headings).toEqual(["Current", "Active", "This session tree", "Other sessions", "Archived"]);
    expect(await page.locator(".compose-session-popup-header .compose-session-search-heading").allTextContents()).toEqual(["Search sessions"]);
    expect(await page.locator(".compose-session-popup-count, .compose-session-search-label").count()).toBe(0);
    const fontStacks = await page.locator(".compose-session-search").evaluate(node => ({
      actual: getComputedStyle(node).fontFamily.replace(/\s+/g, ""),
      expected: getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").replace(/\s+/g, ""),
    }));
    expect(fontStacks.actual).toBe(fontStacks.expected);
    expect(await page.locator(".compose-model-popup-item-popout").count()).toBe(30);
    expect(await page.locator(".compose-session-row-pin").count()).toBe(25);
    const pin = page.getByRole("button", { name: "Pin @session-08" });
    const row = pin.locator("..");
    const option = row.locator('[role="option"]');
    const [pinBox, optionBox] = await Promise.all([pin.boundingBox(), option.boundingBox()]);
    expect(pinBox?.x ?? Infinity).toBeLessThan(optionBox?.x ?? -Infinity);
    expect(await row.locator(".compose-session-row-label").textContent()).toBe("@session-08");
    expect(await row.locator(".compose-session-row-jid").textContent()).toBe("web:root-1:branch:8");
    expect(await row.locator(".compose-session-row-metrics").textContent()).toBe(" · anthropic/claude · 42K / 128K (33% context)");
    expect((await row.textContent())?.match(/web:root-1:branch:8/g)).toHaveLength(1);
    await pin.click();
    expect(await page.locator("#session-picker-action").textContent()).toBe("none");
    expect(await page.locator(".compose-session-section-heading").allTextContents()).toContain("Pinned");
    expect(await page.getByRole("button", { name: "Unpin @session-08" }).getAttribute("aria-pressed")).toBe("true");
    await page.waitForFunction((expected) => document.querySelector('[role="listbox"]')?.getAttribute("aria-activedescendant")?.includes(expected), encodeURIComponent("web:root-1:branch:8"));
    expect(await page.evaluate(() => localStorage.getItem("piclaw:session-picker-preferences:v1"))).toContain("web:root-1:branch:8");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("session-switcher").click();
    expect(await page.getByRole("button", { name: "Unpin @session-08" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "New branch" }).count()).toBe(1);
    expect(await page.locator('.compose-model-popup-actions button[title="Rename the current session"]').count()).toBe(1);
    const search = page.locator(".compose-session-search");
    expect(await search.evaluate(node => document.activeElement === node)).toBe(true);
    await search.fill("session-09");
    await page.keyboard.press("Alt+Enter");
    expect(await page.locator("#session-picker-action").textContent()).toBe("none");
    expect(await page.evaluate(() => localStorage.getItem("piclaw:session-picker-preferences:v1"))).toContain("web:root-1:branch:9");
    await page.waitForFunction((expected) => document.querySelector('[role="listbox"]')?.getAttribute("aria-activedescendant")?.includes(expected), encodeURIComponent("web:root-1:branch:9"));
    await search.fill("duplicate");
    expect(await page.locator('[role="option"]').count()).toBe(3);
    expect(await page.getByRole("button", { name: "New branch" }).count()).toBe(0);
    expect(await page.locator('[role="option"]').nth(0).getAttribute("aria-label")).toContain("chat web:root-0");
    const activeId = await page.locator('[role="listbox"]').getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await page.keyboard.press("Enter");
    expect(await page.locator("#session-picker-action").textContent()).toContain("switch:");
  } finally { await page.close(); }
});

optionalBrowserTest("tablet picker pages through results and Escape restores trigger focus", async () => {
  const page = await openPicker(820, 700);
  try {
    const listbox = page.locator('[role="listbox"]');
    const first = await listbox.getAttribute("aria-activedescendant");
    await page.keyboard.press("PageDown");
    const paged = await listbox.getAttribute("aria-activedescendant");
    expect(paged).not.toBe(first);
    await page.keyboard.press("Escape");
    expect(await page.locator(".compose-session-popup").count()).toBe(0);
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="session-switcher"]'));
    expect(await page.getByTestId("session-switcher").evaluate(node => document.activeElement === node)).toBe(true);
  } finally { await page.close(); }
});

optionalBrowserTest("phone picker uses safe-area sheet geometry and can reveal archived matches", async () => {
  const page = await openPicker(412, 915);
  try {
    const measured = await metrics(page);
    expect(measured.popup.x).toBeGreaterThanOrEqual(8);
    expect(measured.popup.right).toBeLessThanOrEqual(404);
    expect(measured.popup.y).toBeGreaterThanOrEqual(8);
    expect(measured.popup.bottom).toBeLessThanOrEqual(907);
    expect(measured.search.height).toBeGreaterThanOrEqual(44);
    const pin = page.getByRole("button", { name: "Pin @session-03" });
    const row = pin.locator("..");
    const [pinBox, optionBox] = await Promise.all([pin.boundingBox(), row.locator('[role="option"]').boundingBox()]);
    expect(pinBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(pinBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(pinBox?.x ?? Infinity).toBeLessThan(optionBox?.x ?? -Infinity);
    expect(await row.locator(".compose-session-row-label").textContent()).toBe("@session-03");
    expect((await row.textContent())?.match(/web:root-0:branch:3/g)).toHaveLength(1);
    await page.locator(".compose-session-search").fill("archived");
    expect(await page.locator('[role="option"]').count()).toBe(5);
    expect(await page.locator(".compose-session-section-heading").allTextContents()).toEqual(["Archived"]);
    const archivedRow = page.locator(".compose-model-popup-item-row.archived").first();
    expect(await archivedRow.locator(".compose-session-row-pin-spacer").count()).toBe(1);
    expect(await archivedRow.locator(".compose-session-row-pin").count()).toBe(0);
    const [archivedSpacerBox, archivedOptionBox] = await Promise.all([
      archivedRow.locator(".compose-session-row-pin-spacer").boundingBox(),
      archivedRow.locator('[role="option"]').boundingBox(),
    ]);
    expect(archivedSpacerBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(archivedSpacerBox?.x ?? Infinity).toBeLessThan(archivedOptionBox?.x ?? -Infinity);
    await page.locator('[role="option"]').first().click();
    expect(await page.locator("#session-picker-action").textContent()).toContain("restore:");
  } finally { await page.close(); }
});
