#!/usr/bin/env bun

import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runtimeRoot = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const outputDir = option("--out") || join(runtimeRoot, "generated", "settings-row-alignment-evidence");
const phase = option("--phase") || "current";
if (!/^[a-z0-9-]+$/i.test(phase)) throw new Error(`Invalid --phase: ${phase}`);
await mkdir(outputDir, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/classic") {
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, { headers: { "content-type": "text/html" } });
    }
    if (!url.pathname.startsWith("/static/") || url.pathname.includes("..")) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(join(runtimeRoot, "web/static", url.pathname.slice("/static/".length)));
      return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream" } });
    } catch { return new Response("not found", { status: 404 }); }
  },
});

function round(value: number): number { return Math.round(value * 10) / 10; }

async function measure(page: import("playwright").Page, skin: "classic") {
  return page.evaluate((_kind) => {
    const rows = Array.from(document.querySelectorAll(".settings-section .settings-row")) as HTMLElement[];
    const rect = (element: HTMLElement | null) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right };
    };
    return rows.map((row, index) => {
      const label = row.querySelector(":scope > label") as HTMLElement | null;
      const control = row.querySelector(":scope > .settings-number-stepper, :scope > .settings-panel__stepper, :scope > select, :scope > input, :scope > .settings-panel__field-content > .settings-panel__stepper, :scope > .settings-panel__field-content > select, :scope > .settings-panel__field-content > input") as HTMLElement | null;
      const help = row.querySelector(":scope > .settings-hint, :scope > .settings-panel__description") as HTMLElement | null;
      return {
        index,
        labelText: label?.textContent?.trim() || "",
        row: rect(row),
        label: rect(label),
        control: rect(control),
        help: rect(help),
        classes: row.className,
      };
    }).filter((row) => row.labelText);
  }, skin);
}

const browser = await chromium.launch({ headless: true });
const captures: any[] = [];
try {
  for (const skin of ["classic"] as const) {
    for (const viewport of [{ width: 1366, height: 820, label: "desktop" }, { width: 820, height: 760, label: "tablet" }, { width: 520, height: 780, label: "phone-wide" }, { width: 390, height: 844, label: "phone" }]) {
      const page = await browser.newPage({ viewport, colorScheme: "dark" });

        const dialogWidth = Math.max(360, Math.min(viewport.width - 32, 1120));
        const dialogHeight = Math.max(420, Math.min(viewport.height - 32, 760));
        await page.goto(`http://127.0.0.1:${server.port}/classic?section=compaction&width=${dialogWidth}&height=${dialogHeight}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".settings-section .settings-row", { state: "visible" });
      await page.waitForTimeout(100);
      const root = page.locator(".settings-dialog");
      const screenshot = `${phase}-${skin}-${viewport.label}-${viewport.width}x${viewport.height}.png`;
      await root.screenshot({ path: join(outputDir, screenshot) });
      const rows = await measure(page, skin);
      const ordinary = rows.filter((row) => !row.classes.includes("compaction-model-picker"));
      const values = (key: "control" | "help") => ordinary.map((row) => row[key]?.x).filter((value): value is number => Number.isFinite(value));
      const spread = (items: number[]) => items.length ? Math.max(...items) - Math.min(...items) : 0;
      captures.push({
        phase, skin, ...viewport, screenshot, rows,
        controlStartSpread: round(spread(values("control"))),
        helpStartSpread: round(spread(values("help"))),
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
await writeFile(join(outputDir, `${phase}-metrics.json`), JSON.stringify({ phase, captures }, null, 2));
console.log(JSON.stringify(captures.map(({ phase, skin, label, width, controlStartSpread, helpStartSpread, screenshot }) => ({ phase, skin, label, width, controlStartSpread, helpStartSpread, screenshot })), null, 2));
