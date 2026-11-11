import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';

// Classic three-pane layout (#1987): sessions | chat | file tree | editor.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/three-pane-layout.ts')], target: 'browser', format: 'esm' });
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

async function open(engine: string, width: number, height: number, query = '') {
  const page = await browsers[engine].newPage({ viewport: { width, height }, hasTouch: width < 640 });
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

for (const engine of ['chromium', 'webkit']) {
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    browserTest(`${engine} ${width}px: sessions, chat, tree and editor are resizable panes in that order`, async () => {
      const { page, errors } = await open(engine, width, height, '?editor=1&tree=1');
      try {
        await settle(page);
        const sessions = (await rect(page, '.sessions-sidebar'))!, chat = (await rect(page, '.container'))!;
        const editor = (await rect(page, '.editor-pane-container'))!, tree = (await rect(page, '.workspace-sidebar'))!;
        expect(sessions.x).toBe(0);
        expect(sessions.right).toBeLessThanOrEqual(chat.x + 1);
        expect(chat.right).toBeLessThanOrEqual(tree.x + 1);
        expect(tree.right).toBeLessThanOrEqual(editor.x + 1);
        expect(editor.right).toBeGreaterThanOrEqual(width - 1);
        expect(chat.width).toBeGreaterThanOrEqual(320);
        expect(await page.locator('.sessions-sidebar-item').count()).toBe(6);

        // Sessions: switch, search, pin, drag, keyboard, collapse and restore.
        await page.locator('.sessions-sidebar-item:has-text("@lunch") .sessions-sidebar-open').click();
        expect(await page.evaluate(() => (window as any).threePane.current())).toBe('web:lunch');
        await page.locator('.sessions-sidebar-search input').fill('prox');
        await settle(page);
        expect(await page.locator('.sessions-sidebar-item').count()).toBe(1);
        await page.locator('.sessions-sidebar-search input').fill('');
        await page.locator('.sessions-sidebar-item:has-text("@proxmox") .sessions-sidebar-pin').click({ force: true });
        await settle(page);
        expect(await page.locator('.sessions-sidebar-section-pinned .sessions-sidebar-item').count()).toBe(1);
        const divider = (await page.locator('.sessions-splitter').boundingBox())!;
        await page.mouse.move(divider.x + 2, 400); await page.mouse.down(); await page.mouse.move(divider.x + 32, 400, { steps: 4 }); await page.mouse.up();
        await settle(page);
        const dragged = (await rect(page, '.sessions-sidebar'))!.width;
        expect(Math.abs(dragged - (sessions.width + 30))).toBeLessThanOrEqual(3);
        await page.locator('.sessions-splitter').focus(); await page.keyboard.press('ArrowLeft'); await settle(page);
        expect(Math.abs((await rect(page, '.sessions-sidebar'))!.width - (dragged - 16))).toBeLessThanOrEqual(3);
        await page.keyboard.press('Enter'); await settle(page);
        expect((await rect(page, '.sessions-sidebar'))!.width).toBe(0);
        await page.locator('.sessions-toggle-tab').click(); await settle(page);
        expect((await rect(page, '.sessions-sidebar'))!.width).toBeGreaterThan(190);

        // Editor divider: dragging left widens; Enter collapses and restores without unmounting.
        const editorDivider = (await page.locator('.editor-splitter').boundingBox())!;
        const editorBefore = (await rect(page, '.editor-pane-container'))!.width;
        await page.mouse.move(editorDivider.x + 2, 400); await page.mouse.down(); await page.mouse.move(editorDivider.x - 38, 400, { steps: 4 }); await page.mouse.up();
        await settle(page);
        expect((await rect(page, '.editor-pane-container'))!.width).toBeGreaterThan(editorBefore);
        await page.locator('.editor-splitter').focus(); await page.keyboard.press('Enter'); await settle(page);
        expect((await rect(page, '.editor-pane-container'))!.visible).toBe(false);
        expect(await page.locator('.editor-pane-container .tab-item').count()).toBe(1);
        await page.keyboard.press('Enter'); await settle(page);
        expect((await rect(page, '.editor-pane-container'))!.visible).toBe(true);

        // Tree: ArrowLeft widens; the shortcut hides it while the editor stays anchored right.
        const treeBefore = (await rect(page, '.workspace-sidebar'))!.width;
        const editorAnchored = (await rect(page, '.editor-pane-container'))!;
        await page.locator('.workspace-splitter').focus(); await page.keyboard.press('ArrowLeft'); await settle(page);
        expect((await rect(page, '.workspace-sidebar'))!.width).toBeGreaterThan(treeBefore);
        await page.locator('.container textarea').focus();
        await page.keyboard.press('Control+Shift+E'); await settle(page);
        expect(await page.evaluate(() => (window as any).threePane.workspaceOpen())).toBe(false);
        expect((await rect(page, '.workspace-sidebar'))!.width).toBeLessThan(2);
        const editorAfter = (await rect(page, '.editor-pane-container'))!;
        expect(Math.abs(editorAfter.x - editorAnchored.x)).toBeLessThanOrEqual(1);
        expect(editorAfter.right).toBeGreaterThanOrEqual(width - 2);
        const tab = (await rect(page, '.workspace-toggle-tab'))!, chatNow = (await rect(page, '.container'))!;
        expect(Math.abs(tab.right - chatNow.right)).toBeLessThanOrEqual(1);
        await page.keyboard.press('Meta+Shift+E'); await settle(page);
        expect(await page.evaluate(() => (window as any).threePane.workspaceOpen())).toBe(true);
        await page.locator('.workspace-splitter').focus(); await page.keyboard.press('Enter'); await settle(page);
        expect(await page.evaluate(() => (window as any).threePane.workspaceOpen())).toBe(false);
        await noOverflow(page);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  browserTest(`${engine} 1024px: sessions shrink, then hide, to keep the chat minimum`, async () => {
    const { page, errors } = await open(engine, 1024, 768, '?editor=1&tree=1');
    try {
      await settle(page);
      const chat = (await rect(page, '.container'))!, sessions = (await rect(page, '.sessions-sidebar'))!;
      expect(chat.width).toBeGreaterThanOrEqual(319);
      expect(sessions.width).toBeGreaterThanOrEqual(199);
      expect(sessions.width).toBeLessThan(260);
      // Widen the editor: the sessions pane gives way, the chat does not.
      await page.locator('.editor-splitter').focus();
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('Shift+ArrowLeft');
      await settle(page); await settle(page);
      expect((await rect(page, '.container'))!.width).toBeGreaterThanOrEqual(319);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  for (const [width, height] of [[768, 1024], [390, 844]]) {
    browserTest(`${engine} ${width}px: no sessions pane; the tree is a drawer from the right`, async () => {
      const { page, errors } = await open(engine, width, height);
      try {
        expect((await rect(page, '.sessions-sidebar'))?.visible ?? false).toBe(false);
        expect((await rect(page, '.container'))!.width).toBeGreaterThanOrEqual(width - 80);
        await page.keyboard.press('Control+Shift+E'); await settle(page);
        const tree = (await rect(page, '.workspace-sidebar'))!;
        expect(tree.visible).toBe(true);
        expect(tree.right).toBeGreaterThanOrEqual(width - 1);
        await page.locator('.workspace-drawer-backdrop').click({ position: { x: 10, y: 200 } }); await settle(page);
        expect(await page.evaluate(() => (window as any).threePane.workspaceOpen())).toBe(false);
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
      await page.waitForFunction(() => (window as any).threePane.probes.statusCalls.length > 0);
      await page.waitForSelector('.sessions-sidebar-preview.live');
      expect((await page.locator('.sessions-sidebar-active-count').textContent())?.trim()).toBe('1 active');
      const proxmox = page.locator('.sessions-sidebar-item', { has: page.locator('.sessions-sidebar-handle', { hasText: '@proxmox' }) });
      expect(await proxmox.locator('.sessions-sidebar-activity').count()).toBe(1);
      expect((await proxmox.locator('.sessions-sidebar-age').textContent())?.trim()).toBe('Working');
      expect((await proxmox.locator('.sessions-sidebar-preview.live').textContent())?.replace(/\s+/g, ' ').trim()).toBe('Tool bash: make test');
      // Only other active sessions are polled; the current chat shows its own status.
      expect(new Set(await page.evaluate(() => (window as any).threePane.probes.statusCalls))).toEqual(new Set(['web:proxmox']));
      const current = page.locator('.sessions-sidebar-item.current');
      expect((await current.locator('.sessions-sidebar-age').textContent())?.trim()).toBe('3m');
      expect((await current.locator('.sessions-sidebar-preview').textContent())?.trim()).toBe('Summary for default The default session finished its last task.');
      expect(await current.locator('.sessions-sidebar-context').getAttribute('aria-valuenow')).toBe('42');
      const lunch = page.locator('.sessions-sidebar-open', { has: page.locator('.sessions-sidebar-handle', { hasText: '@lunch' }) });
      const line = (await lunch.locator('.sessions-sidebar-preview').boundingBox())!, row = (await lunch.boundingBox())!;
      expect(line.x + line.width).toBeLessThanOrEqual(row.x + row.width + 1);
      // Ctrl/Cmd-click opens a new tab and leaves the current chat alone.
      await lunch.click({ modifiers: [engine === 'webkit' ? 'Meta' : 'Control'] });
      const opened = await page.evaluate(() => (window as any).threePane.probes.opened);
      expect(opened).toHaveLength(1);
      expect(new URL(opened[0]).searchParams.get('chat_jid')).toBe('web:lunch');
      expect(new URL(opened[0]).searchParams.get('chat_only')).toBeNull();
      expect(await page.evaluate(() => (window as any).threePane.current())).toBe('web:default');
      await lunch.click();
      expect(await page.evaluate(() => (window as any).threePane.current())).toBe('web:lunch');
      // The window regaining focus refreshes the list.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      expect(await page.evaluate(() => (window as any).threePane.probes.refreshes)).toBeGreaterThan(0);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: the sessions shortcut toggles the pane on desktop only, and hidden panes do not poll`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      const key = engine === 'webkit' ? 'Meta+Shift+B' : 'Control+Shift+B';
      await page.locator('.compose-box textarea').focus();
      await page.keyboard.press(key); await settle(page);
      expect(await page.locator('.sessions-sidebar').getAttribute('class')).toContain('collapsed');
      expect(await page.locator('.sessions-toggle-tab').count()).toBe(1);
      await page.evaluate(() => { (window as any).threePane.probes.statusCalls.length = 0; });
      await page.waitForTimeout(3300);
      expect(await page.evaluate(() => (window as any).threePane.probes.statusCalls.length)).toBe(0);
      await page.keyboard.press(key); await settle(page);
      expect(await page.locator('.sessions-sidebar').getAttribute('class')).not.toContain('collapsed');
      await page.setViewportSize({ width: 900, height: 900 }); await settle(page);
      await page.evaluate(() => { (window as any).threePane.probes.statusCalls.length = 0; });
      await page.keyboard.press(key); await settle(page);
      expect(await page.locator('.sessions-sidebar').getAttribute('class')).not.toContain('collapsed');
      await page.waitForTimeout(3300);
      expect(await page.evaluate(() => (window as any).threePane.probes.statusCalls.length)).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}
