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
      // Plan is a launcher: it opens the Plan tab and leaves the side bar view alone.
      await page.locator('.workbench-activity-plan').click(); await settle(page);
      expect(await page.evaluate(() => (window as any).workbench.probes.plans)).toBe(1);
      expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
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

  browserTest(`${engine}: meters toggle from the activity bar, fill the side bar foot, or sit in the status bar`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    // Live readings so the meter rows (and their plots) render.
    await page.route('**/agent/system-metrics*', (route) => route.fulfill({ json: { cpu_percent: 12, ram_percent: 40, cpu_series: [5, 20, 12, 30, 12], ram_series: [38, 39, 40, 40, 40] } }));
    try {
      await page.waitForSelector('.workbench-sidebar-footer .system-meters-hud', { state: 'attached', timeout: 5000 });
      expect(await page.locator('.system-meters-hud').count()).toBe(1);
      // The plots stretch to the side bar's width.
      const host = (await rect(page, '.workbench-view-host'))!;
      await page.waitForSelector('.workbench-sidebar-footer .system-meters-spark', { timeout: 5000 });
      expect((await rect(page, '.workbench-sidebar-footer .system-meters-spark'))!.width).toBeGreaterThan(host.width / 2);
      // Off and on from the activity bar.
      const meters = page.locator('.workbench-activity-meters');
      expect(await meters.getAttribute('aria-pressed')).toBe('true');
      await meters.click(); await settle(page);
      expect(await meters.getAttribute('aria-pressed')).toBe('false');
      expect(await page.locator('.system-meters-hud').count()).toBe(0);
      expect((await rect(page, '.workbench-sidebar-footer'))).toBeNull();
      await meters.click(); await settle(page);
      await page.waitForSelector('.workbench-sidebar-footer .system-meters-hud', { state: 'attached', timeout: 5000 });
      // Side bar collapsed: the meters move to the status bar, beside the model.
      await page.locator(sessionsButton).click(); await settle(page);
      await page.waitForSelector('.workbench-statusbar .system-meters-hud', { state: 'attached', timeout: 5000 });
      expect(await page.locator('.system-meters-hud').count()).toBe(1);
      const bar = (await rect(page, '.workbench-statusbar'))!, shell = await page.evaluate(() => document.querySelector('.app-shell')!.getBoundingClientRect().bottom);
      expect(bar.width).toBe(1440);
      expect(shell).toBeLessThanOrEqual(900 - 23);
      // Phones show the model and context in the status bar, without the meters, below the compose box.
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      expect((await rect(page, '.workbench-statusbar'))!.visible).toBe(true);
      expect((await rect(page, '.workbench-statusbar .system-meters-hud'))?.visible ?? false).toBe(false);
      const compose = (await page.locator('.compose-box').boundingBox())!, status = (await page.locator('.workbench-statusbar').boundingBox())!;
      expect(compose.y + compose.height).toBeLessThanOrEqual(status.y + 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: the status bar holds the model and context instead of the compose box`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await page.waitForSelector('.workbench-statusbar .compose-model-hint', { timeout: 5000 });
      expect(await page.locator('.compose-box .compose-meta-row').count()).toBe(0);
      expect(await page.locator('.workbench-statusbar .compose-context-pie').count()).toBe(1);
      expect((await page.locator('.workbench-statusbar .compose-model-hint').textContent())?.trim()).toContain('provider/model');
      // The status bar starts at the left edge, under the activity bar, and is not covered by the side bar.
      const hint = (await page.locator('.workbench-statusbar .compose-context-pie').boundingBox())!;
      expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.workbench-statusbar')), { x: hint.x + 2, y: hint.y + hint.height / 2 })).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: the global menu sits in the activity bar and can hide it, leaving only the menu`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await settle(page);
      const button = (await page.locator('[data-testid="hamburger"]').boundingBox())!;
      expect(button.x).toBe(0);
      expect(button.width).toBe(48);
      await page.locator('[data-testid="hamburger"]').click();
      const checked = () => page.$$eval('.timeline-menu-dropdown [role="menuitemcheckbox"]', (items) => items.map((item) => `${item.getAttribute('aria-checked') === 'true' ? '✓' : '·'} ${item.querySelector('.timeline-menu-check-label')?.textContent}`));
      expect(await checked()).toEqual(['✓ Sessions', '· Explorer', '✓ System meters', '✓ Activity bar', '· Show hidden files']);
      expect(await page.locator('.timeline-menu-dropdown').getByText('New file').count()).toBe(0);
      const menu = (await page.locator('.timeline-menu-dropdown').boundingBox())!;
      expect(menu.x).toBeGreaterThanOrEqual(48);
      // Views from the menu.
      await page.getByRole('menuitemcheckbox', { name: /Explorer/ }).click(); await settle(page);
      expect(await state(page)).toEqual({ workspaceOpen: true, view: 'explorer', shown: 'shown' });
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitem', { name: /Plan/ }).click();
      expect(await page.evaluate(() => (window as any).workbench.probes.plans)).toBe(1);
      // Hide the activity bar: no side bar or activity bar, only the menu.
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitemcheckbox', { name: /Activity bar/ }).click(); await settle(page);
      expect((await rect(page, '.workbench-sidebar'))!.visible).toBe(false);
      expect((await rect(page, '.workbench-activity-bar'))!.visible).toBe(false);
      expect(await page.evaluate(() => (document.querySelector('.app-shell') as HTMLElement).style.getPropertyValue('--workbench-reserved'))).toBe('0px');
      // Nothing but the chat at the left edge, apart from the floating menu button.
      expect(await page.evaluate(() => Boolean(document.elementFromPoint(4, 450)?.closest('.container, .app-shell')) && !document.elementFromPoint(4, 450)?.closest('.workbench-sidebar'))).toBe(true);
      expect((await rect(page, '[data-testid="hamburger"]'))!.visible).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('workbench.activityBarHidden'))).toBe('true');
      // A view opens as a drawer over the chat; the backdrop closes it.
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitemcheckbox', { name: /Sessions/ }).click(); await settle(page);
      const drawer = (await rect(page, '.workbench-sidebar'))!;
      expect(drawer.visible).toBe(true);
      expect(drawer.x).toBe(0);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.workbench-sidebar')!).position)).toBe('fixed');
      await page.locator('.workbench-drawer-backdrop').click({ position: { x: 1300, y: 300 } }); await settle(page);
      expect((await rect(page, '.workbench-sidebar'))!.visible).toBe(false);
      // Bring it back.
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitemcheckbox', { name: /Activity bar/ }).click(); await settle(page);
      expect((await rect(page, '.workbench-activity-bar'))!.width).toBe(48);
      expect((await page.locator('[data-testid="hamburger"]').boundingBox())!.x).toBe(0);
      await noOverflow(page);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: a running tool shows its status line under the agent's avatar in the timeline`, async () => {
    const { page, errors } = await open(engine, 1440, 900, '?running=1');
    try {
      const live = page.locator('.turn-activity-live');
      await live.waitFor();
      expect(await live.locator('.turn-activity-live-avatar img').count()).toBe(1);
      expect((await live.locator('.post-author').textContent())?.trim()).toBe('PiClaw');
      const status = live.locator('.post-body .turn-activity-live-status .agent-status');
      await status.waitFor();
      expect(await status.innerText()).toContain('make test');
      await live.locator('.agent-status-git-row').waitFor();
      expect((await live.locator('.agent-status-git-label').innerText()).replace(/\s+/g, ' ')).toContain('main');
      // Nothing floats above the compose box any more.
      expect(await page.locator('.container > .agent-status-panel-core, .chat-surface-compose ~ .agent-status-panel-core').count()).toBe(0);
      expect(await page.locator('.agent-status-panel-core').count()).toBe(1);
      const avatar = (await live.locator('.turn-activity-live-avatar').boundingBox())!, line = (await status.boundingBox())!;
      expect(line.x).toBeGreaterThan(avatar.x + avatar.width - 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: the Sessions view has header actions, a row menu and an archived section`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    page.on('dialog', (dialog) => dialog.type() === 'prompt' ? dialog.accept('ops-room') : dialog.accept());
    try {
      await settle(page);
      const actions = () => page.evaluate(() => (window as any).workbench.probes.actions);
      await page.locator('.sessions-sidebar-tool[aria-label="New session"]').click();
      await page.locator('.sessions-sidebar-tool[aria-label="Fork the current session"]').click();
      await page.waitForFunction(() => (window as any).workbench.probes.actions.length === 2);
      expect(await actions()).toEqual(['create:ops-room', 'fork']);
      const lunch = page.locator('.sessions-sidebar-item', { has: page.locator('.sessions-sidebar-handle', { hasText: '@lunch' }) }).first();
      // Row actions float over the row: the row keeps its full width.
      const lunchRow = (await lunch.boundingBox())!, lunchOpen = (await lunch.locator('.sessions-sidebar-open').boundingBox())!;
      expect(lunchOpen.width).toBeGreaterThanOrEqual(lunchRow.width - 1);
      expect(await page.locator('.sessions-sidebar-pin').count()).toBe(0);
      await lunch.click({ button: 'right' });
      expect(await page.locator('.sessions-row-menu .workspace-menu-item').allTextContents()).toEqual(['Pin', 'Open in new tab', 'Open in new window', 'Archive']);
      await page.locator('.sessions-row-menu .workspace-menu-item', { hasText: 'Pin' }).click();
      await page.waitForSelector('.sessions-row-menu', { state: 'detached' });
      expect(await lunch.locator('.sessions-sidebar-pinned').count()).toBe(1);
      await lunch.click({ button: 'right' });
      expect((await page.locator('.sessions-row-menu .workspace-menu-item').first().textContent())?.trim()).toBe('Unpin');
      await page.locator('.sessions-row-menu .workspace-menu-item', { hasText: 'Archive' }).click();
      await page.waitForSelector('.sessions-row-menu', { state: 'detached' });
      const current = page.locator('.sessions-sidebar-item.current');
      await current.locator('.sessions-sidebar-more').click();
      expect(await page.locator('.sessions-row-menu .workspace-menu-item').allTextContents()).toEqual(['Pin', 'Open in new tab', 'Open in new window', 'Rename…', 'Fork', 'Archive']);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.sessions-row-menu', { state: 'detached' });
      expect((await page.locator('.sessions-sidebar-section-archived summary').textContent())?.trim()).toBe('Archived (1)');
      await page.locator('.sessions-sidebar-section-archived summary').click();
      await page.locator('.sessions-sidebar-tool[aria-label="Restore @attic"]').click();
      await page.locator('.sessions-sidebar-tool[aria-label="Delete @attic permanently"]').click();
      await page.waitForFunction(() => (window as any).workbench.probes.actions.length === 5);
      expect(await actions()).toEqual(['create:ops-room', 'fork', 'archive:web:lunch', 'restore:web:attic', 'purge:web:attic']);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: Settings requests open the Settings tab and ask for editor room`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await page.evaluate(() => (window as any).requestOpenSettingsDialog({ section: 'keyboard' }));
      await page.waitForFunction(() => (window as any).workbench.probes.widthRequests.length === 1);
      expect(await page.evaluate(() => (window as any).workbench.probes.editors)).toEqual(['piclaw://settings']);
      expect(await page.evaluate(() => (window as any).__piclawSettingsRequestedSection)).toBe('keyboard');
      expect(await page.evaluate(() => (window as any).workbench.probes.widthRequests)).toEqual([720]);
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
      // Running sessions come straight after the current one.
      expect(await page.locator('.sessions-sidebar-section-heading').allTextContents()).toEqual(['Current', 'Active', 'Other sessions', 'Archived (1)']);
      expect((await page.locator('.sessions-sidebar-section-active .sessions-sidebar-handle').allTextContents())).toEqual(['@proxmox']);
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
      expect(await current.locator('.sessions-sidebar-context-ring').getAttribute('aria-valuenow')).toBe('42');
      // The activity label already says the session is active; no separate badge.
      expect((await proxmox.locator('.sessions-sidebar-meta').allTextContents()).join(' ')).not.toContain('active');
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


  browserTest(`${engine} 1194px touch: session row menus sit clear of the age and context ring`, async () => {
    const context = await browsers[engine].newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.goto(`${server.url}`);
      await page.waitForSelector('.sessions-sidebar-context-ring');
      await page.waitForSelector('.sessions-sidebar-preview.live');
      // Touch screens keep the row menu button visible, so it needs its own room.
      expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      const clashes = await page.evaluate(() => [...document.querySelectorAll('.sessions-sidebar-item')].flatMap((row) => {
        const button = row.querySelector('.sessions-sidebar-more');
        if (!button) return [];
        const more = button.getBoundingClientRect();
        return [...row.querySelectorAll('.sessions-sidebar-age, .sessions-sidebar-context-ring')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > more.left && r.left < more.right && r.bottom > more.top && r.top < more.bottom;
        }).map((el) => `${row.querySelector('.sessions-sidebar-handle')?.textContent} ${el.className}`);
      }));
      expect(clashes).toEqual([]);
      expect(await page.locator('.sessions-sidebar-item .sessions-sidebar-context-ring').count()).toBeGreaterThan(0);
    } finally { await context.close(); }
  }, 30000);

  browserTest(`${engine} 1440px: the home-indicator inset adds only what the status bar needs`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      await page.waitForSelector('.workbench-sidebar-footer .system-meters-hud', { state: 'attached', timeout: 5000 });
      // Stand in for an iPad home-screen app, where env(safe-area-inset-bottom) is 20px.
      await page.evaluate(() => document.documentElement.style.setProperty('--workbench-safe-area-bottom', '20px'));
      await settle(page);
      const m = await page.evaluate(() => {
        const bar = document.querySelector('.workbench-statusbar')!, foot = document.querySelector('.workbench-sidebar-footer')!;
        return {
          barHeight: Math.round(bar.getBoundingClientRect().height),
          barPadding: getComputedStyle(bar).paddingBottom,
          footPadding: getComputedStyle(foot).paddingBottom,
          shellGap: Math.round(bar.getBoundingClientRect().top - document.querySelector('.app-shell')!.getBoundingClientRect().bottom),
        };
      });
      // 24px row + 1px border + 8px: the row clears the indicator without a 20px blank band.
      expect(m).toEqual({ barHeight: 33, barPadding: '8px', footPadding: '6px', shellGap: -1 });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);


  for (const [width, height] of [[1440, 900], [390, 844]]) {
    browserTest(`${engine} ${width}px: side bar meters have no outline box and cannot be compacted`, async () => {
      const { page, errors } = await open(engine, width, height);
      await page.route('**/agent/system-metrics*', (route) => route.fulfill({ json: { cpu_percent: 12, ram_percent: 40, cpu_series: [5, 20, 12, 30, 12], ram_series: [38, 39, 40, 40, 40] } }));
      try {
        if (width < 640) { await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-tree-toggle'))); await settle(page); await page.locator(sessionsButton).click(); await settle(page); }
        const foot = page.locator('.workbench-sidebar-footer');
        await foot.locator('.system-meters-row.cpu').waitFor({ timeout: 5000 });
        // Full rows with plots, never the one-line summary, even on a phone.
        expect(await foot.locator('.system-meters-compact-summary').count()).toBe(0);
        expect(await foot.locator('.system-meters-row').count()).toBe(2);
        const card = await foot.locator('.system-meters-card').evaluate((el) => { const cs = getComputedStyle(el); return { border: cs.borderTopWidth, background: cs.backgroundColor, shadow: cs.boxShadow }; });
        expect(card).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', shadow: 'none' });
        // Clicking a reading neither collapses nor hides the meters.
        expect(await foot.locator('button.system-meters-row').count()).toBe(0);
        await foot.locator('.system-meters-row.cpu').click(); await settle(page);
        expect(await foot.locator('.system-meters-row').count()).toBe(2);
        expect(await page.evaluate(() => localStorage.getItem('piclaw_system_meters_collapsed'))).not.toBe('true');
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  for (const [width, height] of [[1440, 900], [820, 1100]]) {
    browserTest(`${engine} ${width}px: context sits after the model stats and the model picker opens from the status bar`, async () => {
      const { page, errors } = await open(engine, width, height);
      try {
        await page.waitForSelector('.workbench-statusbar .compose-context-pie', { timeout: 5000 });
        const box = async (s: string) => (await page.locator(s).first().boundingBox())!;
        const hint = await box('.workbench-statusbar .compose-model-hint');
        const stats = await page.locator('.workbench-statusbar .compose-model-usage-hint').count() ? await box('.workbench-statusbar .compose-model-usage-hint') : hint;
        const pie = await box('.workbench-statusbar .compose-context-pie');
        // Model, then its usage, then the context indicator.
        expect(pie.x).toBeGreaterThanOrEqual(Math.max(hint.x + hint.width, stats.x + stats.width) - 1);
        await page.locator('.workbench-statusbar .compose-model-hint').click();
        await page.waitForSelector('.compose-model-catalogue');
        const popup = await box('.compose-model-catalogue'), bar = await box('.workbench-statusbar');
        // The picker opens just above its trigger in the status bar, not over the compose box.
        expect(Math.round(bar.y - (popup.y + popup.height))).toBeGreaterThanOrEqual(2);
        expect(Math.round(bar.y - (popup.y + popup.height))).toBeLessThanOrEqual(10);
        expect(Math.abs(popup.x - Math.max(12, hint.x))).toBeLessThanOrEqual(1);
        expect(popup.x + popup.width).toBeLessThanOrEqual(width);
        expect(popup.y).toBeGreaterThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

}
