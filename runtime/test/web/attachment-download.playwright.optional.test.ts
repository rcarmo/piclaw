import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Browser } from 'playwright';
import { buildContentDisposition } from '../../src/channels/web/http/content-disposition.js';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, '../../web');
const browsers = new Map<string, Browser>();
const bytes = new TextEncoder().encode('Harmless download fixture. Not executable code.');
const scenarios = [
  { name: 'matching label', stored: 'setup-tool.exe', label: 'setup-tool.exe' },
  { name: 'numeric label', stored: 'setup-tool.exe', label: '417' },
  { name: 'missing label', stored: 'setup-tool.exe', label: null },
  { name: 'empty label', stored: 'setup-tool.exe', label: '' },
  { name: 'UTF-8 stored name', stored: 'résumé 日本語.exe', label: '417' },
] as const;
let server: ReturnType<typeof Bun.serve>;
let storedName: string = scenarios[0].stored;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({ entryPoints: [join(import.meta.dir, 'fixtures/attachment-download-fixture.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', jsxImportSource: 'preact', external: ['#editor-vendor/codemirror'] });
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(bundle.outputFiles[0].contents, { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname === '/editor-vendor/codemirror.js') return new Response(Bun.file(resolve(webRoot, '../extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname.startsWith('/media/')) {
      if (!req.headers.get('cookie')?.includes('fixture_download=allowed')) return new Response(null, { status: 401 });
      if (url.pathname === '/media/417/info') return Response.json({ filename: storedName, content_type: 'application/octet-stream', metadata: { size: bytes.length } });
      if (url.pathname === '/media/417') return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': buildContentDisposition('attachment', storedName) } });
      return new Response(null, { status: 404 });
    }
    if (url.pathname.startsWith('/static/')) {
      const file = resolve(webRoot, url.pathname.slice(1));
      if (file.startsWith(webRoot + '/static/')) return new Response(Bun.file(file));
    }
    if (url.pathname === '/') return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/static/${url.searchParams.get('skin') === 'visual' ? 'visual' : 'classic'}/css/styles.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><main id="app"></main><script type="module" src="/fixture.js"></script>`, { headers: { 'Content-Type': 'text/html' } });
    return new Response(null, { status: 404 });
  } });
  const options = { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } };
  browsers.set('chromium', await chromium.launch(options));
  browsers.set('webkit', await webkit.launch(options));
}, 30_000);

afterAll(async () => { for (const browser of browsers.values()) await browser.close(); server?.stop(true); });

for (const engine of ['chromium', 'webkit']) for (const skin of ['classic', 'visual']) for (const activation of ['keyboard', 'touch']) {
  browserTest(`${engine} ${skin} ${activation}: stored executable filename survives stale or missing message labels`, async () => {
    const context = await browsers.get(engine)!.newContext({ acceptDownloads: true, viewport: { width: activation === 'touch' ? 390 : 1100, height: 780 }, hasTouch: activation === 'touch' });
    try {
      const origin = server.url.origin;
      expect((await context.request.get(`${origin}/media/417`)).status()).toBe(401);
      await context.addCookies([{ name: 'fixture_download', value: 'allowed', url: origin }]);
      const page = await context.newPage();
      const errors: string[] = [], names: { scenario: string; filename: string }[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      for (const scenario of scenarios) {
        storedName = scenario.stored;
        const params = new URLSearchParams({ skin, chat_jid: 'web:test-exe-download' });
        if (scenario.label !== null) params.set('label', scenario.label);
        await page.goto(`${origin}/?${params}`);
        const received = page.waitForEvent('download');
        const trigger = skin === 'classic' ? page.locator('.file-attachment-main') : page.getByTitle('Download', { exact: true });
        if (activation === 'touch') await trigger.tap();
        else { await trigger.focus(); await page.keyboard.press('Enter'); }
        const download = await received;
        names.push({ scenario: scenario.name, filename: download.suggestedFilename() });
        console.log('ATTACHMENT_SAVED', engine, skin, scenario.name, download.suggestedFilename(), download.url());
        expect(await download.failure()).toBeNull();
        const stream = await download.createReadStream(), chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
      }
      expect(errors).toEqual([]);
      expect(names).toEqual(scenarios.map(scenario => ({ scenario: scenario.name, filename: engine === 'webkit' ? scenario.stored.replace(/ /g, '_') : scenario.stored })));
    } finally { await context.close(); }
  }, 30_000);
}
