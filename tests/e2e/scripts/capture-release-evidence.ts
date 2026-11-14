#!/usr/bin/env bun
/**
 * Capture a deliberately small set of successful-release visual checkpoints.
 *
 * This runs after a Playwright shard has passed or failed. It is not a visual
 * snapshot suite: the E2E tests remain the behavioural gate. These captures
 * provide a human review trail for the generated PDF and release data archive.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { bootstrapE2eAuth } from "../support/auth.js";
import { requireDisposableTestTarget } from "../../../runtime/scripts/test-target.js";

const baseURL = requireDisposableTestTarget(process.env.PICLAW_E2E_URL);
const outputDir = resolve(process.cwd(), "reports", "evidence");
mkdirSync(outputDir, { recursive: true });

async function authenticate(page: import("playwright").Page): Promise<void> {
  const auth = await bootstrapE2eAuth(page.context().request, baseURL);
  if (auth.attempted && !auth.authenticated) {
    throw new Error(`E2E auth bootstrap failed${auth.status ? ` with HTTP ${auth.status}` : ""}${auth.error ? `: ${auth.error}` : ""}`);
  }
  const token = auth.cookieHeader?.match(/piclaw_session=([^;]+)/)?.[1];
  if (!token) return;
  const url = new URL(baseURL);
  await page.context().addCookies([{ name: "piclaw_session", value: token, domain: url.hostname, path: "/" }]);
}

async function waitForShell(page: import("playwright").Page, skin: "classic"): Promise<void> {
  const selector = ".compose-box, .compose-editor, [data-testid=compose-box]";
  await page.waitForSelector(selector, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function captureClassic(context: import("playwright").BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await waitForShell(page, "classic");
    await page.screenshot({ path: join(outputDir, "classic-timeline.png"), fullPage: false, animations: "disabled" });

    await page.keyboard.press("Control+Comma");
    await page.locator("[data-testid=settings-dialog], .settings-dialog").waitFor({ state: "visible", timeout: 10_000 });
    await page.screenshot({ path: join(outputDir, "classic-settings.png"), fullPage: false, animations: "disabled" });
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    try { await authenticate(page); } finally { await page.close(); }
    await captureClassic(context);
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`Representative release evidence written to ${outputDir}`);
