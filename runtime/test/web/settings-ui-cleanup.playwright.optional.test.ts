import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';

// Synthetic settings fixture only: mocked fetch, and every non-fixture request is aborted.
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const runtimeRoot = join(import.meta.dir, '../..');
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const built = await Bun.build({ entrypoints: [join(runtimeRoot, 'web/src/dev/settings-widget-fixture.ts')], target: 'browser', format: 'esm', external: ['#editor-vendor/codemirror'] });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/') && !url.pathname.includes('..')) return new Response(Bun.file(join(runtimeRoot, 'web', url.pathname)));
    if (url.pathname === '/') return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><div id="settings-widget-fixture-root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({ ok: true });
  } });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 180000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });

export async function openSettings(engine: string, width: number, section: string, scheme: 'light' | 'dark' = 'light') {
  const height = width < 600 ? 844 : 860;
  const page = await browsers[engine].newPage({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 600, isMobile: width < 600 && engine === 'chromium' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  const dialogWidth = width < 600 ? width : 1040, dialogHeight = width < 600 ? height - 60 : 760;
  await page.goto(`${server.url.origin}/?section=${section}&width=${dialogWidth}&height=${dialogHeight}`);
  await page.locator('.settings-dialog').waitFor();
  await page.locator('.settings-loading-pane').waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  return { page, errors };
}

for (const engine of ['chromium', 'webkit']) {
  browserTest(`${engine}: Editor and Developer panes are listed and open by deep link or nav`, async () => {
    const { page, errors } = await openSettings(engine, 1280, 'developer');
    try {
      const nav = page.locator('.settings-nav-item');
      expect(await nav.filter({ hasText: 'Developer' }).count()).toBe(1);
      expect(await nav.filter({ hasText: 'Editor' }).count()).toBe(1);
      await page.locator('.settings-content h3', { hasText: /developer/i }).first().waitFor();
      expect(await page.locator('.settings-nav-item.active').innerText()).toContain('Developer');
      await nav.filter({ hasText: 'Editor' }).click();
      await page.locator('.settings-content h3', { hasText: /editor/i }).first().waitFor();
      expect(await page.locator('.settings-nav-item.active').innerText()).toContain('Editor');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number; scrollWidth: number; clientWidth: number; text: string };
const boxes = (page: Page, selector: string) => page.locator(selector).evaluateAll(elements => elements
  .filter(element => (element as HTMLElement).offsetParent !== null)
  .map(element => { const r = element.getBoundingClientRect(), e = element as HTMLElement;
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, text: (e.textContent || (e as HTMLInputElement).value || '').trim() }; })) as Promise<Box[]>;
const content = (page: Page) => page.locator('.settings-content').evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right }; });

for (const engine of ['chromium', 'webkit']) for (const width of [390, 1280]) {
  browserTest(`${engine} ${width}px: Tools headers own their columns without overlapping`, async () => {
    const { page, errors } = await openSettings(engine, width, 'tools');
    try {
      const header = await boxes(page, '.settings-toolset >> nth=0 >> .settings-tool-row-header > span');
      const row = await boxes(page, '.settings-toolset >> nth=0 >> .settings-tool-row:not(.settings-tool-row-header) >> nth=0 >> > *');
      expect(header.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < header.length; i++) expect(header[i].left).toBeGreaterThanOrEqual(header[i - 1].right - 0.5);
      for (const cell of header) if (cell.text) expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
      // Column starts are shared by the header and the rows.
      for (let i = 0; i < Math.min(header.length, row.length); i++) {
        const [h, r] = [header[i], row[i]];
        expect(Math.abs(h.left - r.left) <= 1 || Math.abs(h.right - r.right) <= 1 || Math.abs((h.left + h.right) / 2 - (r.left + r.right) / 2) <= 1).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}

for (const engine of ['chromium', 'webkit']) {
  browserTest(`${engine}: Models catalogue shows prices beside the detail panel without horizontal clipping`, async () => {
    const { page, errors } = await openSettings(engine, 1280, 'models');
    try {
      const list = (await boxes(page, '.model-catalogue-settings__list'))[0];
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
      for (const name of ['Input / 1M', 'Output / 1M']) {
        const header = (await boxes(page, `.model-catalogue-settings__columns > span:text-is("${name}")`))[0];
        expect(header).toBeTruthy();
        expect(header.right).toBeLessThanOrEqual(list.right + 1);
        expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
      }
      const row = (await boxes(page, '.model-catalogue-settings__row >> nth=0 >> .model-catalogue-settings__row-output-price'))[0];
      expect(row.right).toBeLessThanOrEqual(list.right + 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine} 390px: Keychain headers, Environment add row and TOTP fields fit the phone layout`, async () => {
    for (const section of ['keychain', 'environment', 'authentication']) {
      const { page, errors } = await openSettings(engine, 390, section);
      try {
        const bounds = await content(page);
        if (section === 'keychain') {
          await page.locator('.settings-keychain-row').first().waitFor();
          for (const th of await boxes(page, '.settings-keychain-table th')) {
            expect(th.height).toBeLessThan(40);
            expect(th.scrollWidth).toBeLessThanOrEqual(th.clientWidth + 1);
          }
          expect((await boxes(page, '.settings-keychain-type-inline')).length).toBeGreaterThan(0);
        }
        if (section === 'environment') {
          const controls = await boxes(page, '.settings-env-add > *');
          expect(controls.length).toBe(3);
          for (const control of controls) { expect(control.left).toBeGreaterThanOrEqual(bounds.left - 1); expect(control.right).toBeLessThanOrEqual(bounds.right + 1); }
        }
        if (section === 'authentication') {
          const fields = await boxes(page, '.settings-totp-meta input');
          expect(fields.length).toBe(3);
          for (const field of fields) { expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1); expect(field.right).toBeLessThanOrEqual(bounds.right + 1); }
        }
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  }, 60000);
}
