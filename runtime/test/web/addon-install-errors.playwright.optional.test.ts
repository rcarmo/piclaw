import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/addon-install-errors.ts')], target: 'browser', format: 'esm' });
  if (!result.success) throw Error(String(result.logs));
  const script = await result.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/agent/addons') return Response.json({ addons: [{ slug: 'observability', name: '@rcarmo/piclaw-addon-observability', version: '0.1.23', installedVersion: '0.1.22', installed: true, hasUpdate: true, type: 'extension', tags: [], skills: [], description: 'Observability', installKind: 'tarball' }] });
    if (path === '/agent/settings-data') return Response.json({});
    return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
  } });
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
}, 30_000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });
const required = 'This Core release requires Observability 0.1.22. Update Core before installing this add-on. The installed add-on has not been changed.';
const unavailable = 'Add-on compatibility could not be verified. Wait for the native runtime to be available, then try again. The installed add-on has not been changed.';
for (const engine of ['chromium', 'webkit']) for (const skin of ['classic']) for (const action of ['install', 'uninstall']) for (const mode of ['incompatible', 'unavailable', 'html', 'malformed-success', 'network', 'success']) {
  browserTest(`${engine} ${skin}: add-on ${action} ${mode} preserves server outcome and restart state`, async () => {
    const page = await browsers[engine].newPage({ viewport: { width: 1280, height: 900 } });
    let installs = 0, restarts = 0;
    try {
      await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.route('**/agent/addons/restart', route => { restarts++; return route.fulfill({ json: { ok: true } }); });
      await page.route('**/agent/addons', route => route.fulfill({ json: { addons: [{ slug: 'observability', name: '@rcarmo/piclaw-addon-observability', version: '0.1.23', installedVersion: '0.1.22', installed: true, hasUpdate: action === 'install', type: 'extension', tags: [], skills: [], description: 'Observability', installKind: 'tarball' }] } }));
      await page.route('**/agent/addons/' + action, route => {
        installs++;
        if (mode === 'network') return route.abort('failed');
        if (mode === 'success') return route.fulfill({ json: { ok: true, message: 'Completed; restart required.' } });
        if (mode === 'incompatible') return route.fulfill({ status: 409, json: { error: required, code: 'addon_incompatible' } });
        if (mode === 'unavailable') return route.fulfill({ status: 503, json: { error: unavailable, code: 'addon_compatibility_unavailable' } });
        return route.fulfill({ status: mode === 'html' ? 503 : 200, contentType: 'text/html', body: '<html>PRIVATE PROXY DETAIL</html>' });
      });
      await page.goto(server.url + '?skin=' + skin);
      const button = action === 'install' ? 'Update' : 'Remove';
      await page.getByRole('button', { name: button, exact: true }).click();
      if (mode === 'success') {
        await page.getByRole('button', { name: /Restart [Nn]ow/ }).waitFor();
        expect(installs).toBe(1); expect(restarts).toBe(0);
        return;
      }
      const error = page.locator('#status');
      await error.waitFor({ state: 'visible' });
      await page.waitForFunction(({selector, mode}) => { const text = document.querySelector(selector)?.textContent || ''; return mode === 'incompatible' ? text.includes('requires Observability') : mode === 'unavailable' ? text.includes('compatibility could not') : text.includes('Check its installed state'); }, { selector: '#status', mode });
      const text = await error.textContent();
      if (mode === 'incompatible') expect(text).toBe(required);
      else if (mode === 'unavailable') expect(text).toBe(unavailable);
      else expect(text).toContain('Check its installed state');
      expect(text).not.toContain('PRIVATE PROXY DETAIL');
      expect(await page.getByRole('button', { name: /Restart [Nn]ow/ }).count()).toBe(0);
      expect(await page.getByRole('button', { name: button, exact: true }).isEnabled()).toBe(true);
      expect(installs).toBe(1); expect(restarts).toBe(0);
    } finally { await page.close(); }
  });
}
