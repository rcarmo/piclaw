import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const bundles = new Map<string, string>();
  for (const [skin, file] of Object.entries({ classic: 'agent-status-lifecycle-fixture.ts' })) {
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures', file)], target: 'browser', external: ['#editor-vendor/codemirror'], jsx: { runtime: 'automatic', importSource: 'preact' } });
    if (!built.success) throw Error(String(built.logs));
    bundles.set('/' + skin + '.js', await built.outputs[0].text());
  }
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.headers.get('accept')?.includes('text/event-stream')) return new Response(': fixture\n\n', { headers: { 'content-type': 'text/event-stream' } });
    if (path === '/editor-vendor/codemirror.js') return new Response(Bun.file(join(import.meta.dir, '../../extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'content-type': 'text/javascript' } });
    if (bundles.has(path)) return new Response(bundles.get(path), { headers: { 'content-type': 'text/javascript' } });
    const skin = 'classic';
    return new Response(`<!doctype html><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><div id="app"></div><script type="module" src="/${skin}.js"></script>`, { headers: { 'content-type': 'text/html' } });
  } });
  browsers.chromium = await chromium.launch(); browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });
const known = { tokens: 1234, percent: 1.234, contextWindow: 100000, sessionGeneration: 'same', contextUpdate: 'replace' };
const unknown = { tokens: null, percent: null, contextWindow: null, sessionGeneration: 'same', contextUpdate: 'replace' };
const stale = { ...known, tokens: 777, percent: 77.7 };
const active = { status: 'active', data: { type: 'tool_call', title: 'Old tool', tool_name: 'read', tool_call_id: 'old', turn_id: 'old' } };
for (const engine of ['chromium', 'webkit']) for (const skin of ['classic']) for (const history of ['valid', 'malformed']) browserTest(`${engine}/${skin}/${history}: cold projection cache and late reconnect replies cannot restore stale work or erase the composer`, async () => {
  const page = await browsers[engine].newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.clock.install();
    await page.addInitScript(({ history, stale, _skin }) => {
      const key = ('piclaw:ctx:') + 'web:hook-fixture';
      localStorage.setItem(key, history === 'valid' ? JSON.stringify(stale) : '{malformed');
      localStorage.setItem('piclaw:notifications', 'on'); localStorage.setItem('piclaw_compose_height', '220');
      const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
      const accesses: string[] = [];
      Storage.prototype.getItem = function(key) { if (key.startsWith('piclaw:context-cache:') || key.startsWith('piclaw:ctx:')) accesses.push('read:' + key); return read.call(this, key); };
      Storage.prototype.setItem = function(key, value) { if (key.startsWith('piclaw:context-cache:') || key.startsWith('piclaw:ctx:')) accesses.push('write:' + key); return write.call(this, key, value); };
      Object.assign(window, { projectionStorage: { accesses, historical: () => read.call(localStorage, key) } });
    }, { history, stale, skin });
    await page.goto(`${server.url}${skin}?chat_jid=web%3Ahook-fixture&compose=1&projection=1`);
    const output = page.locator('#state');
    const state = async () => JSON.parse(await output.innerText());
    await output.waitFor(); await page.clock.runFor(250);
    expect((await state()).context).toBeNull();
    expect((await state()).status).toBeNull();
    const input = page.locator('[data-testid="compose-input"]');
    await input.fill('unsent private words — keep across reconnect');
    {
      await page.evaluate(() => { const f = (window as any).statusLifecycleFixture; void f.refresh(); void f.refreshContext(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.contextCount() === 1);
      await page.evaluate(({ known, active }) => { const f = (window as any).statusLifecycleFixture; f.release(0, active); f.releaseContext(0, known); }, { known, active });
    }
    await page.waitForFunction(selector => JSON.parse(document.querySelector(selector)!.textContent!).context?.tokens === 1234, '#state');

    {
      await page.evaluate(() => { const f = (window as any).statusLifecycleFixture; void f.refresh(); void f.refreshContext(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.contextCount() === 2);
      await page.evaluate(() => { const f = (window as any).statusLifecycleFixture; f.connection('reconnecting'); });
      expect((await state()).context.tokens).toBeNull(); expect((await state()).status).toBeNull();
      await page.evaluate(() => (window as any).statusLifecycleFixture.connection('connected'));
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.contextCount() === 3, undefined, { timeout: 3000 });
      await page.evaluate(({ unknown }) => { const f = (window as any).statusLifecycleFixture; f.release(2, {status:'idle',data:null}); f.releaseContext(2, unknown); }, { unknown });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).context?.tokens === null);
      await page.evaluate(({ active, stale }) => { const f = (window as any).statusLifecycleFixture; f.release(1, active); f.releaseContext(1, stale); }, { active, stale });
    }
    await page.clock.runFor(100);
    const final = await state();
    expect(final.context.tokens).toBeNull();
    expect(final.status).toBeNull();
    // Losing the backend binding also clears known meters during an ordinary
    // poll, without relying on a disconnect to have cleared the signals first.
    {
      await page.evaluate(() => { void (window as any).statusLifecycleFixture.refreshContext(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.contextCount() === 4);
      await page.evaluate(known => (window as any).statusLifecycleFixture.releaseContext(3, known), known);
    }
    await page.waitForFunction(selector => JSON.parse(document.querySelector(selector)!.textContent!).context?.tokens === 1234, '#state');
    {
      await page.evaluate(() => { void (window as any).statusLifecycleFixture.refreshContext(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.contextCount() === 5);
      await page.evaluate(unknown => (window as any).statusLifecycleFixture.releaseContext(4, {...unknown,sessionGeneration:null}), unknown);
    }
    await page.waitForFunction(selector => JSON.parse(document.querySelector(selector)!.textContent!).context?.tokens === null, '#state');
    expect((await state()).context.tokens).toBeNull();
    const indicator = page.locator('.compose-context-pie').first();
    await page.waitForFunction(_skin => document.querySelector('.compose-context-pie')?.getAttribute('title')?.includes('(unavailable)'), skin);
    expect(await indicator.getAttribute('title')).toContain('Context: ? / ? tokens (unavailable)');
    expect(await input.inputValue()).toBe('unsent private words — keep across reconnect');
    expect(await page.evaluate(() => (window as any).projectionStorage.accesses)).toEqual([]);
    expect(await page.evaluate(() => (window as any).projectionStorage.historical())).toBe(history === 'valid' ? JSON.stringify(stale) : '{malformed');
    expect(await page.evaluate(() => localStorage.getItem('piclaw:notifications'))).toBe('on');
    expect(await page.evaluate(() => localStorage.getItem('piclaw_compose_height'))).toBe('220');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);
