#!/usr/bin/env bun
import { chromium } from 'playwright';
import { bootstrapE2EStorageState } from './web-auth-bootstrap.ts';

function readDebug(page: any) {
  return page.evaluate(() => {
    const host = document.querySelector('.terminal-live-host');
    const term = host && (host as any).__terminal;
    if (!term) return null;
    return {
      sessionMeta: term.__piclawSessionMeta || null,
      lines: Array.from({ length: 8 }, (_, row) => {
        const line = term.wasmTerm?.getLine?.(row);
        if (!line) return null;
        return line.map((cell: any) => (!cell || cell.width === 0) ? '' : String.fromCodePoint(cell.codepoint || 32)).join('').replace(/\s+$/g, '');
      }),
      activeTag: document.activeElement?.tagName || null,
      activeAria: document.activeElement?.getAttribute?.('aria-label') || null,
    };
  });
}

const cycles = Number(process.env.PICLAW_MULTICYCLE_COUNT || '5');
const storageState = await bootstrapE2EStorageState({
  baseUrl: 'http://127.0.0.1:8080',
  internalSecret: process.env.PICLAW_INTERNAL_SECRET || process.env.PICLAW_WEB_INTERNAL_SECRET,
});
const browser = await chromium.launch({ headless: true, executablePath: process.env.PICLAW_PLAYWRIGHT_EXECUTABLE_PATH });
const context = await browser.newContext({ storageState });
const page = await context.newPage();
await page.goto('http://127.0.0.1:8080', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

for (let cycle = 1; cycle <= cycles; cycle += 1) {
  await page.keyboard.press('Control+`');
  await page.locator('.terminal-live-host').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(700);
  await page.locator('.terminal-live-host').first().click({ position: { x: 24, y: 24 } });
  await page.keyboard.type(`printf "__CYCLE_${cycle}__\\n"\n`, { delay: 10 });
  await page.waitForTimeout(1500);
  const afterType = await readDebug(page);
  console.log(JSON.stringify({ cycle, phase: 'afterType', state: afterType }));
  if (cycle < cycles) {
    await page.locator('button[aria-label="Hide terminal"]').first().click();
    await page.waitForTimeout(350);
  }
}

await context.close();
await browser.close();
