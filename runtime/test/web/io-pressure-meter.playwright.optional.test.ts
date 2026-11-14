import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';
import { parseLinuxIoPressure, SystemMetricsSampler } from '../../src/channels/web/agent/system-metrics.js';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
let pressureText: string | null;
let sampler: SystemMetricsSampler;
const psi = (some: number, full: number) => `some avg10=${some} avg60=0.00 avg300=0.00 total=123\nfull avg10=${full} avg60=0.00 avg300=0.00 total=45\n`;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/io-pressure-workbench.ts')], target: 'browser', format: 'esm' });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/agent/system-metrics') return Response.json(sampler.readSnapshot(null, [], false));
    if (url.pathname === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({});
  } });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });

async function open(engine: string, width: number, theme = 'light', zero = false) {
  sampler = new SystemMetricsSampler(30, 2000, () => null, () => pressureText === null ? null : parseLinuxIoPressure(pressureText));
  for (const [some, full] of zero ? [[0, 0]] : [[10, 2], [40, 12], [25, 8]]) {
    pressureText = psi(some, full);
    sampler.readSnapshot(null, [], false);
  }
  const page = await browsers[engine].newPage({ viewport: { width, height: 900 }, hasTouch: width < 1024 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  await page.goto(server.url + '?usage&running=1');
  await page.waitForSelector('.io-pressure');
  await setTheme(page, theme);
  return { page, errors };
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate(theme => (window as any).setThemeModePreference(theme), theme);
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  await page.waitForTimeout(350); // Let the footer ResizeObserver publish its reservation.
}

async function expectChart(page: Page, value = '25%') {
  const row = page.locator('.io-pressure:visible');
  expect(await row.count()).toBe(1);
  expect(await row.locator('.system-meters-value').innerText()).toBe(value);
  expect(await row.getAttribute('title')).toContain('Linux PSI, 10s average');
  expect(await row.locator('.io-pressure-some').getAttribute('d')).toContain(' L ');
  expect(await row.locator('.io-pressure-full').getAttribute('d')).not.toContain('NaN');
  const geometry = await row.evaluate(element => {
    const r = element.getBoundingClientRect();
    const full = getComputedStyle(element.querySelector('.io-pressure-full')!);
    const some = getComputedStyle(element.querySelector('.io-pressure-some')!);
    return { left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      stroke: some.stroke, fullStroke: full.stroke, dash: full.strokeDasharray,
      chart: getComputedStyle(element).getPropertyValue('--meter-color').trim(), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(900);
  expect(geometry.width).toBeGreaterThan(70);
  expect(geometry.height).toBeGreaterThan(9);
  expect(geometry.chart).toBeTruthy();
  expect(geometry.stroke).not.toBe('none');
  expect(geometry.fullStroke).not.toBe('none');
  expect(geometry.fullStroke).not.toBe(geometry.stroke);
  expect(geometry.dash).not.toBe('none');
  expect(geometry.overflow).toBeLessThanOrEqual(1);
}

for (const engine of ['chromium', 'webkit']) {
  for (const width of [320, 820, 1440]) browserTest(`${engine}: I/O PSI chart fits sidebar/footer at ${width}px in both themes`, async () => {
    const { page, errors } = await open(engine, width);
    try {
      await expectChart(page);
      if (width === 1440) {
        expect(await page.locator('.workbench-sidebar-footer .io-pressure').count()).toBe(1);
        await page.locator('.workbench-activity-button[aria-label="Sessions"]').click();
        await page.waitForSelector('.workbench-statusbar .io-pressure');
      }
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await expectChart(page);
        const gap = await page.evaluate(() => document.querySelector('.app-shell')!.getBoundingClientRect().bottom - document.querySelector('.workbench-statusbar')!.getBoundingClientRect().top);
        expect(Math.abs(gap)).toBeLessThanOrEqual(1);
        if (process.env.PICLAW_TEST_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.PICLAW_TEST_SCREENSHOT_DIR, `io-${engine}-${width}-${theme}.png`) });
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  browserTest(`${engine}: zero remains visible; unavailable pressure disappears instead of becoming zero`, async () => {
    const { page, errors } = await open(engine, 390, 'dark', true);
    try {
      await expectChart(page, '0%');
      pressureText = 'some avg10=0.04 avg60=0.00 avg300=0.00 total=10\n';
      await page.waitForFunction(() => document.querySelector('.io-pressure .system-meters-value')?.textContent === '0.04%');
      expect(await page.locator('.io-pressure-some').count()).toBe(1);
      expect(await page.locator('.io-pressure-full').count()).toBe(0);
      pressureText = null;
      await page.waitForFunction(() => !document.querySelector('.io-pressure'));
      expect(await page.locator('.system-meters-compact-system').innerText()).toContain('CPU');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
