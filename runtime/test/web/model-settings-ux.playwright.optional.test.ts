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
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      const prefix = "/static/";
      if (!url.pathname.startsWith(prefix) || url.pathname.includes("..")) return new Response("Not found", { status: 404 });
      const path = join(import.meta.dir, "../../web/static", url.pathname.slice(prefix.length));
      try {
        const body = await readFile(path);
        const type = url.pathname.endsWith(".css") ? "text/css; charset=utf-8"
          : url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
        return new Response(body, { headers: { "Content-Type": type } });
      } catch {
        return new Response("Not found", { status: 404 });
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

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openModelsSettings(width: number, height: number): Promise<Page> {
  if (!browser) throw new Error("browser not started");
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${baseUrl}/?section=models&width=${Math.min(width - 40, 1200)}&height=${Math.min(height - 40, 900)}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".model-catalogue-settings__row", { state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".model-catalogue-settings__row").length >= 80);
  return page;
}

async function catalogueMetrics(page: Page) {
  return page.evaluate(() => {
    const rectOf = (selector: string) => {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        display: style.display,
      };
    };
    return {
      settings: rectOf(".model-catalogue-settings"),
      workspace: rectOf(".model-catalogue-settings__workspace"),
      list: rectOf(".model-catalogue-settings__list"),
      detail: rectOf(".model-catalogue-settings__detail"),
      columnsDisplay: getComputedStyle(document.querySelector(".model-catalogue-settings__columns") as HTMLElement).display,
      rowCount: document.querySelectorAll(".model-catalogue-settings__row").length,
      selectedId: (document.querySelector('.model-catalogue-settings__row[aria-selected="true"]') as HTMLElement | null)?.id ?? null,
    };
  });
}

optionalBrowserTest("desktop Settings catalogue uses side-by-side panes with a real scrollable model list", async () => {
  const page = await openModelsSettings(1348, 760);
  try {
    const metrics = await catalogueMetrics(page);
    expect(metrics.rowCount).toBeGreaterThanOrEqual(80);
    expect(metrics.workspace?.display).toBe("grid");
    expect(metrics.list?.overflowY).toBe("auto");
    expect(metrics.detail?.x ?? 0).toBeGreaterThan((metrics.list?.x ?? 0) + (metrics.list?.width ?? 0) - 2);
    expect(metrics.list?.scrollHeight ?? 0).toBeGreaterThan(metrics.list?.clientHeight ?? 0);
    const before = await page.locator(".model-catalogue-settings__list").evaluate((node) => node.scrollTop);
    await page.locator(".model-catalogue-settings__list").evaluate((node) => { node.scrollTop = 900; });
    const after = await page.locator(".model-catalogue-settings__list").evaluate((node) => node.scrollTop);
    expect(after).toBeGreaterThan(before);
  } finally {
    await page.close();
  }
});

optionalBrowserTest("collapsed Settings catalogue keeps headers outside the scroll owner and scrolls the model list", async () => {
  const page = await openModelsSettings(760, 680);
  try {
    const metrics = await catalogueMetrics(page);
    expect(metrics.workspace?.display).toBe("block");
    expect(metrics.workspace?.overflowY).toBe("auto");
    expect(metrics.list?.y ?? 0).toBeLessThan(metrics.detail?.y ?? 0);
    expect(metrics.list?.overflowY).toBe("visible");
    expect(metrics.workspace?.scrollHeight ?? 0).toBeGreaterThan(metrics.workspace?.clientHeight ?? 0);
    await page.locator(".model-catalogue-settings__workspace").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const after = await page.locator(".model-catalogue-settings__workspace").evaluate((node) => node.scrollTop);
    expect(after).toBeGreaterThan(100);
  } finally {
    await page.close();
  }
});

optionalBrowserTest("phone Settings catalogue hides wide columns, preserves scrolling, and row pins do not change selection", async () => {
  const page = await openModelsSettings(520, 680);
  try {
    const before = await catalogueMetrics(page);
    expect(before.columnsDisplay).toBe("none");
    expect(before.workspace?.overflowY).toBe("auto");
    expect(before.list?.overflowY).toBe("visible");
    expect(before.workspace?.scrollHeight ?? 0).toBeGreaterThan(before.workspace?.clientHeight ?? 0);
    const initialSelected = before.selectedId;
    const pinRowId = await page.locator(".model-catalogue-settings__row").nth(5).getAttribute("id");
    const pin = page.locator(`[id="${cssString(pinRowId ?? "")}"] .model-catalogue-settings__pin`);
    expect(await pin.isVisible()).toBe(true);
    const pinBox = await pin.boundingBox();
    expect(pinBox?.width ?? 0).toBeGreaterThanOrEqual(28);
    expect(pinBox?.height ?? 0).toBeGreaterThanOrEqual(28);
    await pin.click();
    expect(await page.locator(`[id="${cssString(pinRowId ?? "")}"] .model-catalogue-settings__pin`).getAttribute("aria-pressed")).toBe("true");
    const afterSelected = await page.locator('.model-catalogue-settings__row[aria-selected="true"]').getAttribute("id");
    expect(afterSelected).toBe(initialSelected);
  } finally {
    await page.close();
  }
});
