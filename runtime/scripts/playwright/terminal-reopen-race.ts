#!/usr/bin/env bun
import { chromium } from 'playwright';
import { bootstrapE2EStorageState } from './web-auth-bootstrap.ts';

const cycles = Number(process.env.PICLAW_RACE_CYCLES || '12');
const reopenWaitMs = Number(process.env.PICLAW_RACE_REOPEN_WAIT_MS || '40');
const typeDelayMs = Number(process.env.PICLAW_RACE_TYPE_DELAY_MS || '8');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readState(page: any) {
  return page.evaluate(() => {
    const host = document.querySelector('.terminal-live-host');
    const term = host && (host as any).__terminal;
    const lines = [];
    if (term?.wasmTerm?.getLine) {
      for (let row = 0; row < 8; row += 1) {
        const line = term.wasmTerm.getLine(row);
        if (!line) {
          lines.push(null);
          continue;
        }
        lines.push(line.map((cell: any) => (!cell || cell.width === 0) ? '' : String.fromCodePoint(cell.codepoint || 32)).join('').replace(/\s+$/g, ''));
      }
    }
    return {
      activeTag: document.activeElement?.tagName || null,
      activeAria: document.activeElement?.getAttribute?.('aria-label') || null,
      status: document.querySelector('.terminal-pane-content')?.getAttribute('data-connection-status') || null,
      sessionMeta: term?.__piclawSessionMeta || null,
      hasBlankSnapshot: term?.hasSnapshot?.() ?? null,
      isResizing: term?._isResizing ?? null,
      writeQueueLength: term?._writeQueue?.length ?? null,
      cols: term?.cols ?? null,
      rows: term?.rows ?? null,
      lines,
    };
  });
}

const storageState = await bootstrapE2EStorageState({
  baseUrl: 'http://127.0.0.1:8080',
  internalSecret: process.env.PICLAW_INTERNAL_SECRET || process.env.PICLAW_WEB_INTERNAL_SECRET,
});
const browser = await chromium.launch({ headless: true, executablePath: process.env.PICLAW_PLAYWRIGHT_EXECUTABLE_PATH });
const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const events: any[] = [];
page.on('console', (msg) => events.push({ kind: 'console', type: msg.type(), text: msg.text(), ts: Date.now() }));
page.on('pageerror', (err) => events.push({ kind: 'pageerror', text: String(err), ts: Date.now() }));

await page.goto('http://127.0.0.1:8080', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

for (let cycle = 1; cycle <= cycles; cycle += 1) {
  if (cycle === 1) {
    await page.keyboard.press('Control+`');
    await page.locator('.terminal-live-host').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(200);
  } else {
    await page.locator('button[aria-label="Hide terminal"]').first().click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Control+`');
    await page.locator('.terminal-live-host').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(reopenWaitMs);
  }

  await page.locator('.terminal-live-host').first().click({ position: { x: 30, y: 30 } });
  const before = await readState(page);
  const cmd = `printf "__RACE_${cycle}__\\n"`;
  await page.keyboard.type(cmd, { delay: typeDelayMs });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  const after450 = await readState(page);
  await page.waitForTimeout(1500);
  const after1950 = await readState(page);
  const joined = JSON.stringify(after1950.lines || []);
  const ok = joined.includes(`__RACE_${cycle}__`);
  console.log(JSON.stringify({ cycle, before, after450, after1950, ok }));
}

console.log('EVENTS=' + JSON.stringify(events));
await context.close();
await browser.close();
