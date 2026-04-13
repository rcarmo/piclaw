#!/usr/bin/env bun
// @ts-nocheck

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

import { bootstrapE2EStorageState } from './web-auth-bootstrap.ts';

const DEFAULT_BASE_URL = process.env.PICLAW_E2E_BASE_URL || 'http://127.0.0.1:8080';
const DEFAULT_HEADLESS = process.env.PICLAW_E2E_HEADLESS !== '0';
const DEFAULT_SLOW_MO = Number(process.env.PICLAW_E2E_SLOW_MO || 0);
const DEFAULT_WAIT_MS = Number(process.env.PICLAW_E2E_WAIT_MS || 250);
const DEFAULT_EXECUTABLE_PATH = process.env.PICLAW_PLAYWRIGHT_EXECUTABLE_PATH || '';

function parseArgs(argv: string[]) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    headless: DEFAULT_HEADLESS,
    slowMo: DEFAULT_SLOW_MO,
    waitMs: DEFAULT_WAIT_MS,
    internalSecret: process.env.PICLAW_INTERNAL_SECRET || process.env.PICLAW_WEB_INTERNAL_SECRET || '',
    executablePath: DEFAULT_EXECUTABLE_PATH,
    label: 'terminal-reopen',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : '';
    if (value === '--base-url' && next) {
      args.baseUrl = next;
      i += 1;
      continue;
    }
    if (value === '--internal-secret' && next) {
      args.internalSecret = next;
      i += 1;
      continue;
    }
    if (value === '--label' && next) {
      args.label = next;
      i += 1;
      continue;
    }
    if (value === '--executable-path' && next) {
      args.executablePath = next;
      i += 1;
      continue;
    }
    if (value === '--wait-ms' && next) {
      args.waitMs = Number(next);
      i += 1;
      continue;
    }
    if (value === '--headed') {
      args.headless = false;
      continue;
    }
    if (value === '--slow-mo' && next) {
      args.slowMo = Number(next);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.waitMs) || args.waitMs < 0) throw new Error(`Invalid --wait-ms value: ${args.waitMs}`);
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) throw new Error(`Invalid --slow-mo value: ${args.slowMo}`);
  return args;
}

function stampNow() {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

function log(message: string, ...rest: unknown[]) {
  console.log(`[terminal-reopen] ${message}`, ...rest);
}

async function wait(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function installPageInstrumentation(page) {
  await page.addInitScript(() => {
    const target = (window.__PICLAW_E2E__ = window.__PICLAW_E2E__ || { events: [] });
    const push = (type, extra = {}) => {
      try {
        target.events.push({ t: Number(performance.now().toFixed(1)), type, ...extra });
      } catch {}
    };

    const summarize = (node) => ({
      tag: node?.tagName || null,
      className: typeof node?.className === 'string' ? node.className : null,
      text: typeof node?.textContent === 'string' ? node.textContent.slice(0, 120) : null,
    });

    const install = () => {
      push('instrumentation-ready', { readyState: document.readyState });
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            if (!(node instanceof Element)) continue;
            if (node.matches('.dock-panel, .terminal-pane-content, .terminal-live-host, canvas')) {
              push('node-added', summarize(node));
            }
            for (const child of node.querySelectorAll?.('.dock-panel, .terminal-pane-content, .terminal-live-host, canvas') || []) {
              push('node-added', summarize(child));
            }
          }
          for (const node of mutation.removedNodes || []) {
            if (!(node instanceof Element)) continue;
            if (node.matches('.dock-panel, .terminal-pane-content, .terminal-live-host, canvas')) {
              push('node-removed', summarize(node));
            }
            for (const child of node.querySelectorAll?.('.dock-panel, .terminal-pane-content, .terminal-live-host, canvas') || []) {
              push('node-removed', summarize(child));
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      target.snapshot = () => {
        const dockPanel = document.querySelector('.dock-panel');
        const terminalPane = document.querySelector('.terminal-pane-content');
        const host = document.querySelector('.terminal-live-host');
        const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => ({
          width: canvas.width,
          height: canvas.height,
          className: canvas.className || '',
          parentClassName: canvas.parentElement?.className || '',
        }));
        const liveHost = document.querySelector('.terminal-live-host');
        const terminalDebug = liveHost && liveHost.__terminal ? (() => {
          try {
            const term = liveHost.__terminal;
            const lines = [];
            const count = Math.min(8, term.rows || 0);
            for (let row = 0; row < count; row += 1) {
              const line = term.wasmTerm?.getLine?.(row);
              if (!line) {
                lines.push(null);
                continue;
              }
              const text = line.map((cell) => {
                if (!cell || cell.width === 0) return '';
                return String.fromCodePoint(cell.codepoint || 32);
              }).join('');
              lines.push(text.replace(/\s+$/g, ''));
            }
            return {
              cols: term.cols,
              rows: term.rows,
              viewportY: term.viewportY,
              title: term.currentTitle,
              sessionMeta: term.__piclawSessionMeta || null,
              lines,
            };
          } catch (error) {
            return { error: String(error) };
          }
        })() : null;
        return {
          url: window.location.href,
          title: document.title,
          activeElement: document.activeElement ? {
            tag: document.activeElement.tagName,
            className: document.activeElement.className || '',
            ariaLabel: document.activeElement.getAttribute?.('aria-label') || null,
          } : null,
          dockPanelClass: dockPanel?.className || null,
          terminalPaneStatus: terminalPane?.getAttribute?.('data-connection-status') || null,
          terminalPaneCount: document.querySelectorAll('.terminal-pane-content').length,
          terminalHostCount: document.querySelectorAll('.terminal-live-host').length,
          canvasCount: canvases.length,
          canvases,
          dockText: dockPanel?.textContent?.slice(0, 200) || null,
          hostRect: host ? {
            width: Math.round(host.getBoundingClientRect().width),
            height: Math.round(host.getBoundingClientRect().height),
          } : null,
          terminalDebug,
        };
      };
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
      install();
    }
  });
}

async function capture(page, artifactDir: string, name: string, meta: Record<string, unknown> = {}) {
  const screenshotPath = join(artifactDir, `${name}.png`);
  const jsonPath = join(artifactDir, `${name}.json`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const snapshot = await page.evaluate((extra) => ({
    extra,
    state: window.__PICLAW_E2E__?.snapshot?.() || null,
    events: window.__PICLAW_E2E__?.events || [],
  }), meta);
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));
}

async function toggleTerminal(page) {
  await page.keyboard.press('Control+`');
}

async function openTerminal(page) {
  if (await page.locator('.terminal-live-host').count()) return;
  await toggleTerminal(page);
  await page.locator('.terminal-live-host').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function closeTerminal(page) {
  if (!(await page.locator('.terminal-live-host').count())) return;
  const closeButton = page.locator('button[aria-label="Hide terminal"]:visible').first();
  if (await closeButton.count()) {
    await closeButton.click();
  } else {
    await toggleTerminal(page);
  }
  await page.waitForFunction(() => document.querySelectorAll('.terminal-live-host').length === 0, undefined, { timeout: 15000 });
}

async function focusTerminal(page) {
  const host = page.locator('.terminal-live-host').first();
  await host.click({ position: { x: 24, y: 24 } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dir, '..', '..', '..');
  const stamp = stampNow();
  const artifactDir = resolve(repoRoot, 'artifacts', 'playwright-terminal-reopen', `${stamp}-${args.label}`);
  mkdirSync(artifactDir, { recursive: true });

  const consoleLines: string[] = [];
  const terminalNetwork: Array<Record<string, unknown>> = [];
  let browser = null;
  let context = null;
  let page = null;

  try {
    const storageState = await bootstrapE2EStorageState({
      baseUrl: args.baseUrl,
      internalSecret: args.internalSecret,
    });

    browser = await chromium.launch({
      headless: args.headless,
      slowMo: args.slowMo || undefined,
      executablePath: args.executablePath || undefined,
    });
    context = await browser.newContext({ storageState });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();

    await installPageInstrumentation(page);

    page.on('console', (message) => {
      consoleLines.push(`[${message.type()}] ${message.text()}`);
    });
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/terminal/')) {
        terminalNetwork.push({ kind: 'request', method: request.method(), url, ts: Date.now() });
      }
    });
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/terminal/')) {
        terminalNetwork.push({ kind: 'response', status: response.status(), url, ts: Date.now() });
      }
    });
    page.on('websocket', (ws) => {
      const url = ws.url();
      if (!url.includes('/terminal/ws')) return;
      terminalNetwork.push({ kind: 'websocket-open', url, ts: Date.now() });
      ws.on('framereceived', (event) => {
        const payload = String(event.payload || '');
        terminalNetwork.push({
          kind: 'ws-frame-received',
          url,
          ts: Date.now(),
          size: payload.length,
          preview: payload.slice(0, 240),
        });
      });
      ws.on('framesent', (event) => {
        const payload = String(event.payload || '');
        terminalNetwork.push({
          kind: 'ws-frame-sent',
          url,
          ts: Date.now(),
          size: payload.length,
          preview: payload.slice(0, 240),
        });
      });
      ws.on('close', () => {
        terminalNetwork.push({ kind: 'websocket-close', url, ts: Date.now() });
      });
    });

    await page.goto(args.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await capture(page, artifactDir, '00-loaded');

    await openTerminal(page);
    await wait(args.waitMs);
    await focusTerminal(page);
    await page.keyboard.type('echo __PICLAW_TERMINAL_REOPEN__\n', { delay: 8 });
    await wait(args.waitMs);
    await capture(page, artifactDir, '01-opened-after-command');

    await closeTerminal(page);
    await wait(100);
    await capture(page, artifactDir, '02-closed');

    await openTerminal(page);
    await capture(page, artifactDir, '03-reopened-immediate');
    for (const [idx, delay] of [50, 100, 200, 400].entries()) {
      await wait(delay);
      await capture(page, artifactDir, `04-reopened-plus-${idx + 1}-${delay}ms`, { delay });
    }

    await focusTerminal(page);
    await page.keyboard.type('printf "__PICLAW_REOPEN_TYPECHECK__\\n"\n', { delay: 8 });
    await wait(args.waitMs + 200);
    await capture(page, artifactDir, '05-reopened-after-typing');

    const finalState = await page.evaluate(() => ({
      state: window.__PICLAW_E2E__?.snapshot?.() || null,
      events: window.__PICLAW_E2E__?.events || [],
    }));

    const tracePath = join(artifactDir, 'trace.zip');
    await context.tracing.stop({ path: tracePath });

    writeFileSync(join(artifactDir, 'report.json'), JSON.stringify({
      baseUrl: args.baseUrl,
      artifactDir,
      consoleLines,
      terminalNetwork,
      finalState,
      tracePath,
    }, null, 2));

    log(`Artifacts written to ${artifactDir}`);
    log(`Trace: ${tracePath}`);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

await main();
