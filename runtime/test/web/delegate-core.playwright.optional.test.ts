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
  browserTest(`${engine}/${width}/${scheme}: Core Delegate pane filters and changes exact model approvals`, async () => {
    const page = await browsers[engine].newPage({ viewport: { width, height: 900 }, colorScheme: scheme as 'light' | 'dark', hasTouch: width < 600 });
    const requests: { path: string; body: any }[] = [], errors: string[] = [];
    let config = { approved_models: ['retired/model'] };
    const available = [
      { id:'fixture/gpt-6.1-sol', tier:3, family:'gpt', classificationRule:'gpt-6-1-sol' },
      { id:'another/gpt-5.4-mini', tier:2, family:'gpt', classificationRule:'gpt-mini' },
      ...Array.from({ length: 24 }, (_, i) => ({ id:`fixture/gpt-5.4-mini-${String(i).padStart(2,'0')}`, tier:2, family:'gpt', classificationRule:'gpt-mini' })),
    ];
    const payload = () => ({ ok:true, source:'native', config, available,
      models:[...available.map(({ id }) => ({ id, name: id.endsWith('sol') ? 'GPT Sol' : undefined })), {id:'fixture/unknown', reason:'Not classified'}],
      candidates: available.filter(row => config.approved_models.includes(row.id)).sort((a,b) => a.tier-b.tier),
    });
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
        if (body.add_model && !config.approved_models.includes(body.add_model)) config.approved_models.push(body.add_model);
        if (body.remove_model) config.approved_models = config.approved_models.filter(id => id !== body.remove_model);
        return route.fulfill({ json: payload() });
      }
      if (url.pathname === '/agent/addons/api/delegate/models') return route.fulfill({ json: payload() });
      return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
    });
    try {
      await page.goto(`${server.url.href}?section=general`); await page.evaluate(s => document.documentElement.classList.add(s), scheme);
      await page.getByRole('button', { name: 'Delegate', exact: true }).waitFor();
      const placement = () => page.locator('.settings-nav').evaluate(nav => {
        const nodes = [...nav.children];
        const labels = nodes.map(node => node.getAttribute('aria-label'));
        return { nextAfterModels: labels[labels.indexOf('Models') + 1], delegateIndex: labels.indexOf('Delegate'), separatorIndex: nodes.findIndex(node => node.getAttribute('role') === 'separator') };
      });
      // The lazy placeholder and the loaded Core registration keep the same
      // Main-group position directly after Models when the pane registers.
      const unloaded = await placement();
      expect(unloaded.nextAfterModels).toBe('Delegate');
      expect(unloaded.delegateIndex).toBeLessThan(unloaded.separatorIndex);
      await page.getByRole('button', { name: 'Delegate', exact: true }).click();
      await page.getByRole('heading', { name: 'Available models', exact: true }).waitFor();
      const loaded = await placement();
      expect(loaded.nextAfterModels).toBe('Delegate');
      expect(loaded.delegateIndex).toBeLessThan(loaded.separatorIndex);
      expect(await page.locator('.settings-content').evaluate(node => node.classList.contains('settings-addon-pane'))).toBe(false);
      expect(await page.locator('.settings-nav-item', { hasText: 'Delegate' }).count()).toBe(1);
      const results = page.getByRole('region', {name:'Available models'});
      const whitelist = page.getByRole('region', {name:'Delegate whitelist'});
      const search = page.getByRole('searchbox',{name:'Search models'});
      expect(await results.locator('code').allTextContents()).toEqual(payload().models.map(m => m.id).sort());
      expect(await results.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await page.getByRole('radio').count()).toBe(0);
      expect(await page.locator('.delegate-settings textarea').count()).toBe(0);
      expect(await results.getByRole('button',{name:/unknown/}).count()).toBe(0);
      expect(await whitelist.getByRole('button',{name:'Remove retired/model from whitelist'}).isVisible()).toBe(true);
      expect(requests.some(request => request.body)).toBe(false);
      await search.fill('FIXTURE sol');
      expect(await results.locator('code').allTextContents()).toEqual(['fixture/gpt-6.1-sol']);
      const add = results.getByRole('button',{name:'Add fixture/gpt-6.1-sol to whitelist'});
      await add.focus(); await page.keyboard.press('Space');
      await page.getByText('Added fixture/gpt-6.1-sol.',{exact:true}).waitFor();
      expect(requests.find(request => request.path.endsWith('/config'))?.body).toEqual({add_model:'fixture/gpt-6.1-sol'});
      expect(await results.getByRole('button',{name:'fixture/gpt-6.1-sol is on the whitelist'}).getAttribute('aria-disabled')).toBe('true');
      await search.fill('another');
      await results.getByRole('button',{name:'Add another/gpt-5.4-mini to whitelist'}).click();
      await page.getByText('Added another/gpt-5.4-mini.',{exact:true}).waitFor();
      expect(await whitelist.getByRole('heading').allTextContents()).toEqual(['Tier 2','Tier 3','Unavailable']);
      rejectSave = true;
      const remove = whitelist.getByRole('button',{name:'Remove fixture/gpt-6.1-sol from whitelist'});
      await remove.click();
      await page.getByRole('alert').filter({hasText:'Fixture save rejected'}).waitFor();
      expect(await remove.count()).toBe(1);
      rejectSave = false;
      await remove.focus();
      await page.keyboard.press('Space');
      await page.getByText('Removed fixture/gpt-6.1-sol.',{exact:true}).waitFor();
      expect(await whitelist.getByRole('heading').allTextContents()).toEqual(['Tier 2','Unavailable']);
      expect(await search.evaluate(el => el === document.activeElement)).toBe(true);
      await search.fill('NoSuchModel');
      expect(await results.getByText('No models match your search.').isVisible()).toBe(true);
      const controls = await page.locator('.delegate-settings :is(input,button)').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, label: node.tagName === 'BUTTON' || Boolean((node as HTMLInputElement).labels?.length) };
      }));
      for (const control of controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); expect(control.label).toBe(true); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}
