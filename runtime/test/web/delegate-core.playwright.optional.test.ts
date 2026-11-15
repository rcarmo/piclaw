import { beforeAll, afterAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const entry = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/delegate-core.ts')], target: 'browser', format: 'esm' });
  if (!entry.success) throw Error(String(entry.logs));
  const code = await entry.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/fixture.js') return new Response(code, { headers: { 'content-type': 'text/javascript' } });
    if (path.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', path)));
    return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  browsers.chromium = await chromium.launch(); browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });
for (const engine of ['chromium', 'webkit']) for (const width of [390, 1280]) for (const scheme of ['light', 'dark']) {
  browserTest(`${engine}/${width}/${scheme}: Core Delegate pane loads without add-on, preserves approvals and saves exclusions`, async () => {
    const page = await browsers[engine].newPage({ viewport: { width, height: 900 }, colorScheme: scheme as 'light' | 'dark', hasTouch: width < 600 });
    const requests: { path: string; body: any }[] = [], errors: string[] = [];
    let config = { searchable_providers: [] as string[], excluded_providers: [] as string[], excluded_models: [] as string[] };
    let rejectSave = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== server.url.origin) return route.abort();
      if (!url.pathname.startsWith('/agent/')) return route.continue();
      if (url.pathname === '/agent/settings-data') return route.fulfill({ json: {} });
      if (url.pathname === '/agent/client-perf') return route.fulfill({ json: { ok: true } });
      const body = req.postData() ? req.postDataJSON() : null;
      requests.push({ path: url.pathname, body });
      if (url.pathname === '/agent/addons/api/delegate/config') {
        if (rejectSave) return route.fulfill({ status: 409, json: { error: 'Fixture save rejected' } });
        config = { ...config, ...body }; return route.fulfill({ json: { ok: true, config } });
      }
      if (url.pathname === '/agent/addons/api/delegate/models') return route.fulfill({ json: {
        ok: true, source: 'native', config,
        providers: [{ provider: 'fixture', modelCount: 1, enabled: config.searchable_providers.includes('fixture'), excluded: false }],
        runtime_catalog: { model_count: 1, current_model: 'fixture/gpt-6.1-sol', captured_at: 10, current_classification: { tier: 3, rule: 'gpt-6-1-sol' } },
        executable_catalog: { model_count: 1, candidate_count: config.searchable_providers.length },
        candidates: config.searchable_providers.length && !config.excluded_models.length ? [{ id: 'fixture/gpt-6.1-sol', tier: 3, family: 'gpt', classificationRule: 'gpt-6-1-sol', supportsImages: false }] : [],
        effective_exclusions: { providers: config.excluded_providers, models: config.excluded_models }, rejected_models: [], unclassified_models: [],
      } });
      return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
    });
    try {
      await page.goto(server.url.href); await page.evaluate(s => document.documentElement.classList.add(s), scheme);
      await page.getByRole('heading', { name: 'Approved providers', exact: true }).waitFor();
      expect(await page.locator('.settings-nav-item', { hasText: 'Delegate' }).count()).toBe(1);
      expect(await page.getByRole('heading', { name: 'Approved delegate models', exact: true }).count()).toBe(1);
      expect(await page.getByRole('radio', { name: 'Approved', exact: true }).isChecked()).toBe(false);
      expect(requests.some(request => request.body)).toBe(false);
      const radio = page.getByRole('radio', { name: 'Approved', exact: true }); await radio.focus(); await page.keyboard.press('Space');
      await page.getByText('Set fixture to search.', { exact: true }).waitFor();
      expect(requests.find(request => request.path.endsWith('/config'))?.body).toEqual({ searchable_providers: ['fixture'], excluded_providers: [] });
      await page.getByLabel('Excluded model patterns', { exact: true }).fill('gpt-6.1');
      await page.getByRole('button', { name: 'Save exclusions', exact: true }).click();
      await page.getByText('Saved model exclusions.', { exact: true }).waitFor();
      expect(config.excluded_models).toEqual(['gpt-6.1']);
      rejectSave = true;
      await page.getByLabel('Excluded model patterns', { exact: true }).fill('rejected-new-value');
      await page.getByRole('button', { name: 'Save exclusions', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Fixture save rejected' }).waitFor();
      expect(await page.getByLabel('Excluded model patterns', { exact: true }).inputValue()).toBe('gpt-6.1');
      expect(config.excluded_models).toEqual(['gpt-6.1']);
      const controls = await page.locator('.delegate-settings :is(input,textarea,button)').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, label: node.tagName === 'BUTTON' || Boolean((node as HTMLInputElement).labels?.length) };
      }));
      for (const control of controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); expect(control.label).toBe(true); }
      expect(await page.locator('.delegate-scroll').count()).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}
