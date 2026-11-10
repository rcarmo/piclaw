import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers = new Map<string, Browser>();
let server: ReturnType<typeof Bun.serve> | undefined;
let base = '';
const models = {
  current: 'fixture/model', models: ['fixture/model'], thinking_level: 'off', supports_thinking: false,
  model_options: [{ label: 'fixture/model', provider: 'fixture', id: 'model', name: 'Fixture', context_window: 128000,
    reasoning: false, pricing: { input_per_million: 0.25, output_per_million: 1.25 } }],
  oobe: { provider_ready_completed_instance: true },
};
const tasks = { ok: true, counts: { active: 1, paused: 0, completed: 0 }, tasks: [{ id: 'fixture-task', chat_jid: 'web:default',
  task_kind: 'agent', status: 'active', schedule_type: 'cron', schedule_value: '0 9 * * *', summary: 'Retained task', prompt: 'Fixture',
  budget_usd: 0.75, budget_cap_enabled: true, budget_cap_revision: 1, recent_run_logs: [] }] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  await Promise.all(([['chromium', chromium], ['webkit', webkit]] as const).map(async ([name, engine]) => {
    // Use software rendering without an X server in container CI.
    browsers.set(name, await engine.launch({ headless: true, args: name === 'chromium' ? ['--use-angle=swiftshader', '--ozone-platform=headless'] : [] }));
  }));
  server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/classic') return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>`, { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/visual') return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/visual/dist/app.bundle.css"></head><body><div id="app"></div><script>localStorage.setItem('piclaw-active-panel','settings');localStorage.setItem('piclaw-settings-category','budget');localStorage.setItem('piclaw_wizard_dismissed','1');</script><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="/static/visual/dist/app.bundle.js"></script></body></html>`, { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/editor-vendor/codemirror.js') return new Response(await readFile(join(import.meta.dir, '../../extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/agent/settings-data') return json({ userName: 'Fixture', assistantName: 'Fixture assistant', providers: [], toolsets: [], themes: [], colorKeys: [] });
    if (url.pathname === '/agent/models') return json(models);
    if (url.pathname === '/agent/scheduled-tasks') return json(tasks);
    if (url.pathname === '/agent/addons/web-entries') return json({ entries: [] });
    if (url.pathname === '/agent/system-metrics') return json({});
    if (url.pathname.startsWith('/static/') && !url.pathname.includes('..')) {
      try { return new Response(await readFile(join(import.meta.dir, '../../web/static', url.pathname.slice('/static/'.length))), {
        headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' },
      }); } catch { return new Response('not found', { status: 404 }); }
    }
    return json({ ok: true, chats: [], branches: [] });
  } });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => { for (const browser of browsers.values()) await browser.close(); browsers.clear(); server?.stop(true); });

for (const engine of ['chromium', 'webkit']) for (const skin of ['classic', 'visual']) for (const touch of [false, true])
browserTest(`${skin}/${engine}/${touch ? 'phone touch' : 'desktop keyboard'} removes expense management and retains priced model/settings navigation`, async () => {
  const browser = browsers.get(engine); if (!browser) throw Error('Browser fixture missing');
  const page = await browser.newPage({ viewport: touch ? { width: 520, height: 720 } : { width: 1280, height: 800 }, hasTouch: touch });
  const errors: string[] = [], financialRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/agent/settings/budget')) financialRequests.push(request.url()); });
  try {
    await page.goto(`${base}/${skin}?section=budget&width=${touch ? 480 : 1100}&height=700`, { waitUntil: 'networkidle' });
    const nav = skin === 'classic' ? page.locator('.settings-nav') : page.locator('.settings-panel__nav');
    await nav.waitFor({ state: 'visible' });
    if (skin === 'classic') expect(await nav.locator('.settings-nav-item.active').textContent()).toContain('General');
    else {
      expect(await page.locator('.settings-panel__section-title').first().textContent()).toBe('General');
      expect(await nav.locator('.settings-panel__nav-item--active').count()).toBe(1);
      expect(await nav.locator('.settings-panel__nav-item--active').textContent()).toBe('General');
    }
    expect(await nav.getByRole('button', { name: 'Budget', exact: true }).count()).toBe(0);
    expect(await page.locator('.settings-budget-section,.settings-panel__section--budget').count()).toBe(0);
    const item = skin === 'classic' ? '.settings-nav-item' : '.settings-panel__nav-item';
    const model = nav.locator(item).filter({ hasText: /^Models$/ });
    if (touch) await model.tap(); else { await model.focus(); await page.keyboard.press('Enter'); }
    const pricing = page.locator(touch ? '.model-catalogue-settings__row-mobile-meta' : '.model-catalogue-settings__row-input-price').first();
    await pricing.waitFor({ state: 'visible' });
    expect(await pricing.innerText()).toContain('$');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw:open-settings', { detail: { section: 'constructor' } })));
    expect(await pricing.isVisible()).toBe(true);
    if (!touch) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.settings-dialog,.settings-panel')))).toBe(true);
    }
    const scheduled = nav.locator(item).filter({ hasText: /^Scheduled Tasks$/ });
    if (touch) await scheduled.tap(); else { await scheduled.focus(); await page.keyboard.press('Enter'); }
    const detail = page.locator(skin === 'classic' ? '.settings-task-row' : '.settings-panel__scheduled-detail');
    await detail.first().waitFor({ state: 'visible' });
    expect(await page.getByText(skin === 'classic' ? 'Daily fixture summary' : 'Retained task', { exact: true }).first().isVisible()).toBe(true);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    expect(financialRequests).toEqual([]); expect(errors).toEqual([]);
  } finally { await page.close(); }
});
