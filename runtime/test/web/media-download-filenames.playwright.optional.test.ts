import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, webkit, type Browser } from 'playwright';
import { initDatabase, createMedia, closeDatabase } from '../../src/db.js';
import { handleMediaRoutes } from '../../src/channels/web/http/dispatch-media.js';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const browsers: { name: string; browser: Browser }[] = [];
const fixtures: { id: number; filename: string; bytes: Uint8Array }[] = [];

beforeAll(async () => {
  if (!enabled) return;
  initDatabase();
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8v8AAAAASUVORK5CYII=', 'base64'));
  for (const [filename, type, bytes] of [
    ['timeline chart.png', 'image/png', png],
    ['résumé 日本語.png', 'image/png', png],
    ['voice recording.wav', 'audio/wav', new TextEncoder().encode('RIFFtestWAVE')],
    ['report.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7\nfixture')],
    ['setup-tool.exe', 'application/octet-stream', new TextEncoder().encode('Harmless download fixture; not executable code.')],
    ['installer.exe', 'application/x-msdownload', new TextEncoder().encode('Harmless MIME-policy fixture; not executable code.')],
  ] as const) fixtures.push({ id: createMedia(filename, type, bytes, null, null), filename, bytes });
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    parseOptionalInt: (value: string | null) => /^\d+$/.test(value || '') ? Number(value) : null,
  };
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    // Disposable cookie gate: no active Piclaw instance or real credentials.
    if (!req.headers.get('cookie')?.includes('fixture_download=allowed')) return new Response(null, { status: 401 });
    if (path === '/') return new Response('<!doctype html><body><main id="attachments"></main></body>', { headers: { 'Content-Type': 'text/html' } });
    return await handleMediaRoutes(channel, req, path) ?? new Response(null, { status: 404 });
  } });
  // The harness host uses LANG=C; browsers need UTF-8 to retain non-ASCII names.
  const options = { headless: true, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } };
  browsers.push({ name: 'chromium', browser: await chromium.launch(options) });
  browsers.push({ name: 'webkit', browser: await webkit.launch(options) });
}, 30_000);

afterAll(async () => {
  for (const { browser } of browsers) await browser.close();
  server?.stop(true);
  if (enabled) await closeDatabase();
});

for (const engine of ['chromium', 'webkit']) browserTest(`${engine}: native media saves use stored names without a client filename hint`, async () => {
  const context = await browsers.find(item => item.name === engine)!.browser.newContext({ acceptDownloads: true });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    await context.addCookies([{ name: 'fixture_download', value: 'allowed', url: origin }]);
    const page = await context.newPage();
    await page.goto(origin);
    const automaticDownloads: string[] = [];
    page.on('download', download => automaticDownloads.push(download.suggestedFilename()));
    // Inline images must still render, not become automatic attachments.
    await page.evaluate(id => {
      const image = document.createElement('img'); image.src = `/media/${id}`;
      document.getElementById('attachments')!.append(image);
    }, fixtures[0].id);
    await page.waitForFunction(() => (document.querySelector('img') as HTMLImageElement)?.naturalWidth === 1);
    expect(automaticDownloads).toEqual([]);
    for (const fixture of fixtures) {
      const response = await context.request.get(`${origin}/media/${fixture.id}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent(fixture.filename)}`);
      if (fixture.filename.endsWith('.exe')) expect(response.headers()['content-disposition'].startsWith('attachment;')).toBe(true);
      await page.evaluate(({ id, filename }) => {
        const link = document.createElement('a');
        link.href = `/media/${id}`;
        // Native Save As / callers lacking metadata cannot supply a name.
        link.download = ''; link.textContent = filename;
        document.getElementById('attachments')!.append(link);
      }, fixture);
      const received = page.waitForEvent('download');
      await page.getByRole('link', { name: fixture.filename, exact: true }).click();
      const download = await received;
      console.log('MEDIA_SAVED', engine, download.url(), download.suggestedFilename());
      // Linux WebKit's native filename policy replaces whitespace with underscores.
      expect(download.suggestedFilename()).toBe(engine === 'webkit' ? fixture.filename.replace(/ /g, '_') : fixture.filename);
      expect(await download.failure()).toBeNull();
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(fixture.bytes));
    }
  } finally { await context.close(); }
}, 30_000);
