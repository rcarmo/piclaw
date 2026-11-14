import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'fixtures/passkey-settings-fixture.tsx')], target: 'browser', jsx: { runtime: 'automatic', importSource: 'preact' } });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  const css = await Bun.file(resolve(import.meta.dir, '../../web/shared/passkey-settings.css')).text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    return new URL(req.url).pathname === '/fixture.js' ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } }) : new Response(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;margin:10px}${css}</style><div id="app"></div><script type="module" src="/fixture.js"></script>`, { headers: { 'Content-Type': 'text/html' } });
  } });
}, 30000);
afterAll(() => server?.stop(true));
for (const [engineName, engine] of Object.entries({ chromium, webkit })) for (const skin of ['classic']) {
  browserTest(`${engineName} ${skin}: list rename cancel removal errors and narrow layout`, async () => {
    const browser = await engine.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    let keys = [
      { id: 'laptop', name: 'Laptop', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, rpId: 'piclaw.test', usable: true, removable: true },
      { id: 'backup', name: 'Backup', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, rpId: 'piclaw.test', usable: true, removable: true },
    ];
    let posts = 0, fail = false, recent = true;
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== server.url.origin) return route.abort();
      if (url.pathname !== '/agent/passkeys') return route.continue();
      if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
      if (req.method() === 'POST') {
        posts++; const body = req.postDataJSON();
        if (body.action === 'rename') keys = keys.map(k => k.id === body.id ? { ...k, name: body.name } : k);
        if (body.action === 'remove') keys = keys.filter(k => k.id !== body.id).map(k => ({ ...k, removable: false }));
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { passkeys: keys, enabled: true, recent_auth: recent, rp_id: 'piclaw.test', reauthenticate_url: '/login', unavailable_reason: null } });
    });
    try {
      await page.goto(`${server.url}?skin=${skin}`);
      const panel = page.locator('.passkey-settings'); await panel.getByText('Laptop', { exact: true }).waitFor();
      expect(await panel.getByText('Never used', { exact: true }).count()).toBe(2);
      await panel.getByRole('button', { name: 'Rename', exact: true }).first().click();
      await panel.getByLabel('Rename passkey', { exact: true }).fill('<b>Tablet</b>');
      await panel.getByRole('button', { name: 'Save', exact: true }).click();
      await panel.getByRole('heading', { name: '<b>Tablet</b>', exact: true }).waitFor();
      expect(await panel.locator('h4 b').count()).toBe(0);
      await panel.getByRole('button', { name: 'Remove', exact: true }).first().click();
      expect(await panel.getByText(/Existing login sessions are not signed out/).count()).toBe(1);
      await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(posts).toBe(1);
      await panel.getByRole('button', { name: 'Remove', exact: true }).first().click();
      await panel.getByRole('button', { name: 'Remove passkey', exact: true }).click();
      await panel.getByText('Passkey removed.', { exact: true }).waitFor();
      expect(await panel.getByRole('button', { name: 'Remove', exact: true }).isDisabled()).toBe(true);
      fail = true; await panel.getByRole('button', { name: 'Refresh', exact: true }).first().click();
      await panel.getByText('Showing the last confirmed list.', { exact: false }).waitFor();
      expect(await panel.getByRole('heading', { name: 'Backup', exact: true }).count()).toBe(1);
      expect(await panel.getByText('No passkeys registered.', { exact: true }).count()).toBe(0);
      fail = false; recent = false; await panel.getByRole('button', { name: 'Retry', exact: true }).click();
      await panel.getByRole('link', { name: 'Sign in again' }).waitFor();
      expect(await panel.getByRole('button', { name: 'Rename', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 30000);
  browserTest(`${engineName} ${skin}: native cancellation blur success and uncertain finish`, async () => {
    const browser = await engine.launch(); const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'PublicKeyCredential', { value: class {} });
      Object.defineProperty(navigator, 'credentials', { value: { create: async () => {
        (window as any).creates = ((window as any).creates || 0) + 1;
        window.dispatchEvent(new Event('blur'));
        if (!(window as any).succeed) throw new DOMException('Cancelled', 'NotAllowedError');
        return { id: 'new', rawId: new ArrayBuffer(1), type: 'public-key', response: { clientDataJSON: new ArrayBuffer(1), attestationObject: new ArrayBuffer(1), getTransports: () => ['internal'] }, getClientExtensionResults: () => ({}) };
      } } });
    });
    let finishes = 0, starts = 0, uncertain = false;
    const keys: any[] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== server.url.origin) return route.abort();
      if (url.pathname === '/agent/passkeys') return route.fulfill({ json: { passkeys: keys, enabled: true, recent_auth: true, rp_id: 'piclaw.test', reauthenticate_url: '/login', unavailable_reason: null } });
      if (url.pathname.endsWith('/register/start')) { starts++; return route.fulfill({ json: { token: 'fixture-token', options: { challenge: 'YQ', user: { id: 'YQ', name: 'Owner', displayName: 'Owner' }, rp: { name: 'Fixture' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } } }); }
      if (url.pathname.endsWith('/register/finish')) { finishes++; if (uncertain) return route.abort(); keys.push({ id: 'new', name: 'Backup', createdAt: new Date().toISOString(), lastUsedAt: null, rpId: 'piclaw.test', usable: true, removable: false }); return route.fulfill({ json: { ok: true } }); }
      return route.continue();
    });
    try {
      await page.goto(`${server.url}?skin=${skin}`); const panel = page.locator('.passkey-settings');
      await panel.getByText('No passkeys registered.', { exact: true }).waitFor();
      await panel.getByRole('button', { name: 'Add passkey' }).click();
      await panel.getByLabel('Passkey name', { exact: true }).fill('Backup');
      await panel.getByRole('button', { name: 'Create passkey', exact: true }).click();
      await panel.getByText(/Passkey creation was cancelled/).waitFor();
      expect(starts).toBe(1); expect(finishes).toBe(0);
      await page.evaluate(() => { (window as any).succeed = true; });
      await panel.getByRole('button', { name: 'Create passkey', exact: true }).click();
      await panel.getByText('Passkey added.', { exact: true }).waitFor();
      expect(finishes).toBe(1);
      uncertain = true;
      await panel.getByRole('button', { name: 'Add passkey' }).click();
      await panel.getByLabel('Passkey name', { exact: true }).fill('Another');
      await panel.getByRole('button', { name: 'Create passkey', exact: true }).click();
      await panel.getByText(/Registration could not be confirmed/).waitFor();
      expect(finishes).toBe(2); expect(starts).toBe(3);
      expect(await panel.getByText(/local credential may remain/).count()).toBeGreaterThan(0);
    } finally { await browser.close(); }
  }, 30000);
}
