import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';

// Classic workbench: activity bar and side bar (Sessions or Explorer) | chat | editor and viewer tabs.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/workbench-layout.ts')], target: 'browser', format: 'esm' });
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({});
  } });
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });

async function open(engine: string, width: number, height: number, query = '', meters = false) {
  const page = await browsers[engine].newPage({ viewport: { width, height }, hasTouch: width < 640 });
  if (meters) await page.addInitScript(() => localStorage.setItem('piclaw_system_meters_enabled', 'true'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  await page.goto(`${server.url}${query}`);
  await page.waitForSelector('.compose-box');
  await page.waitForTimeout(350);
  return { page, errors };
}
const rect = (page: Page, selector: string) => page.evaluate((s) => {
  const el = document.querySelector(s) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, right: r.right, width: r.width, visible: getComputedStyle(el).display !== 'none' && r.width > 0 };
}, selector);
const settle = (page: Page) => page.waitForTimeout(320);
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

const METERS_EVENT = 'piclaw-meters-change';
const explorerButton = '.workbench-activity-button[aria-label="Explorer"]';
const sessionsButton = '.workbench-activity-button[aria-label="Sessions"]';
const state = (page: Page) => page.evaluate(() => ({
  workspaceOpen: (window as any).workbench.workspaceOpen(),
  view: document.querySelector('.workbench-sidebar')?.getAttribute('data-view'),
  shown: document.querySelector('.app-shell')?.getAttribute('data-workbench-sidebar'),
}));

for (const engine of ['chromium', 'webkit']) {
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    browserTest(`${engine} ${width}px: activity bar, side bar, chat and editor in that order`, async () => {
      const { page, errors } = await open(engine, width, height, '?editor=1');
      try {
        await settle(page);
        const bar = (await rect(page, '.workbench-activity-bar'))!, host = (await rect(page, '.workbench-view-host'))!;
        const chat = (await rect(page, '.container'))!, editor = (await rect(page, '.editor-pane-container'))!;
        expect(bar.x).toBe(0);
        expect(bar.width).toBe(48);
        expect(host.x).toBeGreaterThanOrEqual(bar.right - 1);
        expect(host.right).toBeLessThanOrEqual(chat.x + 1);
        expect(chat.right).toBeLessThanOrEqual(editor.x + 1);
        expect(editor.right).toBeGreaterThanOrEqual(width - 1);
        expect(chat.width).toBeGreaterThanOrEqual(320);
        expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'shown' });
        // The side bar divider resizes from the keyboard.
        await page.locator('.workbench-splitter').focus();
        await page.keyboard.press('ArrowRight'); await settle(page);
        expect((await rect(page, '.workbench-view-host'))!.width).toBeCloseTo(host.width + 16, 0);
        await noOverflow(page);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  browserTest(`${engine}: the activity bar switches views and collapses the side bar`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await settle(page);
      await page.locator(explorerButton).click(); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
      expect((await rect(page, '.workbench-view-explorer .workspace-sidebar'))!.visible).toBe(true);
      expect((await rect(page, '.workbench-view-sessions'))!.visible).toBe(false);
      await page.locator(sessionsButton).click(); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'shown' });
      // Clicking the active view collapses the side bar; the activity bar stays.
      await page.locator(sessionsButton).click(); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'hidden' });
      expect((await rect(page, '.workbench-view-host'))!.width).toBe(0);
      expect((await rect(page, '.workbench-activity-bar'))!.width).toBe(48);
      expect(await page.locator(sessionsButton).getAttribute('aria-selected')).toBe('false');
      await page.locator(explorerButton).click(); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
      await page.locator('.workbench-activity-settings').click();
      expect(await page.evaluate(() => (window as any).workbench.probes.settings)).toBe(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: keyboard shortcuts show and hide the Explorer and Sessions views`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      const mod = engine === 'webkit' ? 'Meta' : 'Control';
      await page.locator('.compose-box textarea').focus();
      await page.keyboard.press(`${mod}+Shift+E`); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
      await page.keyboard.press(`${mod}+Shift+E`); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: false, view: 'explorer', shown: 'hidden' });
      await page.keyboard.press(`${mod}+Shift+B`); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'shown' });
      await page.keyboard.press(`${mod}+Shift+B`); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'hidden' });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: meters sit at the side bar foot, or in the status bar when it is collapsed`, async () => {
    const { page, errors } = await open(engine, 1440, 900, '', true);
    try {
      await page.evaluate((name) => window.dispatchEvent(new CustomEvent(name, { detail: { enabled: true } })), METERS_EVENT);
      await page.waitForSelector('.workbench-sidebar-footer .system-meters-hud', { state: 'attached', timeout: 5000 });
      expect(await page.locator('.workbench-statusbar').count()).toBe(0);
      expect(await page.locator('.system-meters-hud').count()).toBe(1);
      await page.locator(sessionsButton).click(); await settle(page);
      await page.waitForSelector('.workbench-statusbar .system-meters-hud', { state: 'attached', timeout: 5000 });
      expect(await page.locator('.system-meters-hud').count()).toBe(1);
      const bar = (await rect(page, '.workbench-statusbar'))!, shell = await page.evaluate(() => document.querySelector('.app-shell')!.getBoundingClientRect().bottom);
      expect(bar.width).toBe(1440);
      expect(shell).toBeLessThanOrEqual(900 - 23);
      // Phones keep the bottom edge for the compose box.
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      expect((await rect(page, '.workbench-statusbar'))!.visible).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine} docked right slot keeps every flow pane inside the shell`, async () => {
    const { page, errors } = await open(engine, 1440, 900, '?editor=1');
    try {
      await page.evaluate(() => document.documentElement.style.setProperty('--piclaw-shell-inset-right', '400px'));
      await settle(page); await settle(page);
      const shell = (await rect(page, '.app-shell'))!;
      const editor = (await rect(page, '.editor-pane-container'))!;
      const chat = (await rect(page, '.container'))!;
      expect(shell.right).toBe(1040);
      expect(editor.right).toBeLessThanOrEqual(shell.right + 1);
      expect(chat.width).toBeGreaterThanOrEqual(319);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine} 1024px: the side bar narrows, then hides, to keep the chat minimum`, async () => {
    const { page, errors } = await open(engine, 1024, 768, '?editor=1');
    try {
      await settle(page);
      expect((await rect(page, '.container'))!.width).toBeGreaterThanOrEqual(319);
      await page.locator('.editor-splitter').focus();
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowLeft');
      await settle(page); await settle(page);
      expect((await rect(page, '.container'))!.width).toBeGreaterThanOrEqual(319);
      expect((await rect(page, '.workbench-activity-bar'))!.width).toBe(48);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  for (const [width, height] of [[768, 1024], [390, 844]]) {
    browserTest(`${engine} ${width}px: the side bar is a drawer from the left`, async () => {
      const { page, errors } = await open(engine, width, height);
      try {
        await settle(page);
        expect((await rect(page, '.workbench-sidebar'))!.visible).toBe(false);
        expect((await rect(page, '.container'))!.width).toBeGreaterThanOrEqual(width - 80);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-tree-toggle')));
        await settle(page);
        const drawer = (await rect(page, '.workbench-sidebar'))!;
        expect(drawer.visible).toBe(true);
        expect(drawer.x).toBe(0);
        expect(drawer.width).toBeLessThanOrEqual(width - 48);
        expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
        await page.locator(sessionsButton).click(); await settle(page);
        expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'shown' });
        await page.locator('.workbench-drawer-backdrop').click({ position: { x: width - 10, y: 200 } }); await settle(page);
        expect(await state(page)).toEqual({ workspaceOpen: false, view: 'sessions', shown: 'hidden' });
        await noOverflow(page);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  browserTest(`${engine} 390px: the editor is a full-screen sheet with Chat and Editor controls`, async () => {
    const { page, errors } = await open(engine, 390, 844, '?editor=1');
    try {
      const editor = (await rect(page, '.editor-pane-container'))!;
      expect(editor.x).toBe(0);
      expect(editor.width).toBe(390);
      const back = (await page.locator('.editor-pane-back').boundingBox())!, tab = (await page.locator('.tab-item').boundingBox())!;
      expect(tab.x).toBeGreaterThanOrEqual(back.x + back.width - 1);
      await page.locator('.editor-pane-back').click(); await settle(page);
      expect((await rect(page, '.editor-pane-container'))!.visible).toBe(false);
      expect((await rect(page, '.container'))!.width).toBe(390);
      await page.locator('.editor-pane-restore').click(); await settle(page);
      expect((await rect(page, '.editor-pane-container'))!.visible).toBe(true);
      expect(await page.locator('.tab-item').count()).toBe(1);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine} 1440px: session rows show activity, live previews, replies and context`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await page.waitForFunction(() => (window as any).workbench.probes.statusCalls.length > 0);
      await page.waitForSelector('.sessions-sidebar-preview.live');
      expect((await page.locator('.sessions-sidebar-active-count').textContent())?.trim()).toBe('1 active');
      expect((await page.locator('.workbench-activity-badge').textContent())?.trim()).toBe('1');
      const proxmox = page.locator('.sessions-sidebar-item', { has: page.locator('.sessions-sidebar-handle', { hasText: '@proxmox' }) });
      expect(await proxmox.locator('.sessions-sidebar-activity').count()).toBe(1);
      expect((await proxmox.locator('.sessions-sidebar-age').textContent())?.trim()).toBe('Working');
      expect((await proxmox.locator('.sessions-sidebar-preview.live').textContent())?.replace(/\s+/g, ' ').trim()).toBe('Tool bash: make test');
      // Only other active sessions are polled; the current chat shows its own status.
      expect(new Set(await page.evaluate(() => (window as any).workbench.probes.statusCalls))).toEqual(new Set(['web:proxmox']));
      const current = page.locator('.sessions-sidebar-item.current');
      expect((await current.locator('.sessions-sidebar-age').textContent())?.trim()).toBe('3m');
      expect((await current.locator('.sessions-sidebar-preview').textContent())?.trim()).toBe('Summary for default The default session finished its last task.');
      expect(await current.locator('.sessions-sidebar-context').getAttribute('aria-valuenow')).toBe('42');
      const lunch = page.locator('.sessions-sidebar-open', { has: page.locator('.sessions-sidebar-handle', { hasText: '@lunch' }) });
      const line = (await lunch.locator('.sessions-sidebar-preview').boundingBox())!, row = (await lunch.boundingBox())!;
      expect(line.x + line.width).toBeLessThanOrEqual(row.x + row.width + 1);
      // Ctrl/Cmd-click opens a new tab and leaves the current chat alone.
      await lunch.click({ modifiers: [engine === 'webkit' ? 'Meta' : 'Control'] });
      const opened = await page.evaluate(() => (window as any).workbench.probes.opened);
      expect(opened).toHaveLength(1);
      expect(new URL(opened[0]).searchParams.get('chat_jid')).toBe('web:lunch');
      expect(new URL(opened[0]).searchParams.get('chat_only')).toBeNull();
      expect(await page.evaluate(() => (window as any).workbench.current())).toBe('web:default');
      await lunch.click();
      expect(await page.evaluate(() => (window as any).workbench.current())).toBe('web:lunch');
      // The window regaining focus refreshes the list.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      expect(await page.evaluate(() => (window as any).workbench.probes.refreshes)).toBeGreaterThan(0);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

}
