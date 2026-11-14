import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
const metrics = {
  cpu_percent: 12, ram_percent: 40, swap_percent: 7, swap_total_bytes: 4e9,
  cpu_series: [4, 30, 12], ram_series: [30, 50, 40], swap_series: [3, 7],
  buffer_cache_bytes: 2e9, buffer_cache_series_bytes: [1e9, 2e9],
  process_memory: { rss_bytes: 320e6 }, process_rss_series_bytes: [200e6, 320e6],
};
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/workbench-layout.ts')], target: 'browser', format: 'esm' });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/agent/system-metrics') return Response.json(metrics);
    if (url.pathname === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    return Response.json({});
  } });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });

async function open(engine: string, width: number, height: number, query = '?usage', extraMetrics?: object) {
  const page = await browsers[engine].newPage({ viewport: { width, height }, hasTouch: width <= 1024 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const url = new URL(r.request().url());
    if (url.origin !== server.url.origin) return r.abort();
    if (url.pathname === '/agent/system-metrics' && extraMetrics) return r.fulfill({ json: { ...metrics, ...extraMetrics } });
    return r.continue();
  });
  await page.goto(server.url + query);
  await page.waitForSelector('.workbench-statusbar .compose-context-pie');
  if (width >= 1024 && width > height) await page.locator('.workbench-activity-button[aria-label="Sessions"]').click();
  await page.waitForTimeout(350);
  return { page, errors };
}
const layout = (page: Page) => page.evaluate(() => {
  const box = (s: string) => {
    const el = document.querySelector<HTMLElement>(s)!;
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width,
      visible: css.display !== 'none' && r.width > 0 && r.height > 0, clippedX: el.scrollWidth > el.clientWidth + 1, clippedY: el.scrollHeight > el.clientHeight + 1 };
  };
  return { bar: box('.workbench-statusbar'), model: box('.workbench-statusbar-compose'), usage: box('.compose-model-usage-hint'),
    meters: box('.workbench-statusbar .system-meters-hud'), shell: box('.app-shell'),
    font: getComputedStyle(document.querySelector('.compose-model-usage-hint')!).fontSize,
    overflow: document.documentElement.scrollWidth - innerWidth };
});

for (const engine of ['chromium', 'webkit']) {
  for (const width of [320, 390, 600, 640, 820, 1024]) {
    browserTest(`${engine} ${width}px: model stats stack above meters without shrinking text or wasting space`, async () => {
      const { page, errors } = await open(engine, width, width >= 820 ? 1366 : 844);
      try {
        const m = await layout(page);
        expect(m.meters.visible).toBe(true);
        expect(m.meters.top).toBeGreaterThanOrEqual(m.model.bottom - 1);
        expect(m.meters.top - m.model.bottom).toBeLessThanOrEqual(2);
        expect(m.model.width).toBeGreaterThanOrEqual(width - 18);
        expect(m.usage.clippedX || m.usage.clippedY).toBe(false);
        expect(Number.parseFloat(m.font)).toBeGreaterThanOrEqual(11);
        expect(m.bar.height).toBeLessThanOrEqual(61); // up to two model lines plus one meter line; 1px border
        expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
        expect(m.overflow).toBe(0);
        expect(await page.locator('.compose-model-usage-hint').innerText()).toContain('CH75.0%');
        expect(await page.locator('.workbench-statusbar .system-meters-card').innerText()).toContain('CPU');
        expect(await page.locator('.workbench-statusbar .system-meters-card').innerText()).toContain('RAM');
        // The model picker retains keyboard activation.
        await page.locator('.workbench-statusbar .compose-model-hint').focus();
        await page.keyboard.press('Enter');
        await page.locator('.compose-model-catalogue').waitFor();
        await page.keyboard.press('Escape');
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  browserTest(`${engine}: long model names wrap only as needed and disabling meters releases their row`, async () => {
    const { page, errors } = await open(engine, 390, 844, '?usage&long-model');
    try {
      const before = await layout(page);
      expect(before.meters.visible).toBe(true);
      expect(before.usage.clippedX || before.usage.clippedY).toBe(false);
      expect(before.bar.height).toBeLessThanOrEqual(61);
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitemcheckbox', { name: /System meters/ }).click();
      await page.waitForTimeout(350);
      const bar = await page.locator('.workbench-statusbar').boundingBox();
      expect(bar!.height).toBeLessThan(before.bar.height);
      expect(bar!.height).toBeLessThanOrEqual(41);
      expect(await page.locator('.system-meters-hud').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: desktop stays on one 24px row`, async () => {
    const { page, errors } = await open(engine, 1440, 900);
    try {
      const m = await layout(page);
      expect(m.bar.height).toBe(25); // 24px plus border
      expect(Math.abs(m.model.top - m.meters.top)).toBeLessThanOrEqual(1);
      expect(m.meters.left).toBeGreaterThanOrEqual(m.model.right);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: quota text wraps without clipping or extra blank rows`, async () => {
    const { page, errors } = await open(engine, 320, 844, '?usage&quota&long-model');
    try {
      const m = await layout(page);
      expect(m.usage.clippedX || m.usage.clippedY).toBe(false);
      expect(m.meters.top).toBeGreaterThanOrEqual(m.model.bottom - 1);
      expect(m.bar.height).toBeLessThanOrEqual(81);
      expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
      expect(m.overflow).toBe(0);
      expect(await page.locator('.compose-model-usage-hint').innerText()).toContain('resets in 4h 25m');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  for (const width of [320, 640, 1440]) {
    browserTest(`${engine} ${width}px: GPU rows wrap within the footer and their details open above it`, async () => {
      const now = Date.now();
      const { page, errors } = await open(engine, width, width === 1440 ? 900 : 844, '?usage', { gpus: [{
        id: 'fixture-gpu', name: 'Fixture GPU', provider: 'nvidia', status: 'ok', sample_time_ms: now, busy_percent: 30,
        memory: { used_bytes: 2e9, total_bytes: 8e9 },
        history: [{ timestamp_ms: now - 1000, busy_percent: 10, resident_bytes: 1e9 }, { timestamp_ms: now, busy_percent: 30, resident_bytes: 2e9 }],
      }] });
      try {
        const buttons = page.locator('.workbench-statusbar .system-meters-meter-button[aria-haspopup="dialog"]');
        expect(await buttons.count()).toBe(2);
        const m = await layout(page);
        expect(m.meters.clippedX || m.meters.clippedY).toBe(false);
        expect(m.overflow).toBe(0);
        expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
        if (width < 1440) expect(m.bar.height).toBeLessThanOrEqual(81);
        if (width < 1440) await buttons.first().tap();
        else await buttons.first().click();
        const dialog = page.getByRole('dialog', { name: 'Fixture GPU details' });
        await dialog.waitFor();
        const box = (await dialog.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(m.bar.top);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        expect(await dialog.count()).toBe(0);
        expect(await buttons.first().evaluate(el => el === document.activeElement)).toBe(true);
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  browserTest(`${engine}: GPU details respect short keyboard bounds with long model stats`, async () => {
    const now = Date.now();
    const { page, errors } = await open(engine, 320, 844, '?usage&long-model&quota', { gpus: [{
      id: 'fixture-gpu', name: 'Fixture GPU', provider: 'nvidia', status: 'ok', sample_time_ms: now, busy_percent: 30,
      memory: { used_bytes: 2e9, total_bytes: 8e9 },
      history: [{ timestamp_ms: now - 1000, busy_percent: 10, resident_bytes: 1e9 }, { timestamp_ms: now, busy_percent: 30, resident_bytes: 2e9 }],
    }] });
    try {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-ios-keyboard-viewport', '1');
        document.documentElement.style.setProperty('--app-height', '240px');
        document.body.style.height = 'var(--app-height)';
      });
      await page.waitForTimeout(150);
      await page.locator('.workbench-statusbar .system-meters-meter-button[aria-haspopup="dialog"]').first().tap();
      const dialog = page.getByRole('dialog', { name: 'Fixture GPU details' });
      await dialog.waitFor();
      const box = (await dialog.boundingBox())!, bar = (await page.locator('.workbench-statusbar').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await dialog.evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: rotation and desktop resizing update the reservation, without stale row heights`, async () => {
    const { page, errors } = await open(engine, 390, 844);
    try {
      for (const [width, height] of [[844, 390], [1440, 900], [320, 844]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(350);
        if (await page.locator('.app-shell').getAttribute('data-workbench-sidebar') === 'shown') {
          await page.locator('.workbench-activity-button[aria-label="Sessions"]').click();
          await page.waitForTimeout(350);
        }
        const m = await layout(page);
        expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
        expect(m.overflow).toBe(0);
        if (width === 1440) expect(m.bar.height).toBe(25);
        else expect(m.meters.top).toBeGreaterThanOrEqual(m.model.bottom - 1);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  browserTest(`${engine}: compact footer remains above the safe area and keyboard, including with meters off`, async () => {
    const { page, errors } = await open(engine, 390, 844);
    try {
      await page.evaluate(() => document.documentElement.style.setProperty('--workbench-safe-area-bottom', '34px'));
      await page.waitForTimeout(100);
      let m = await layout(page);
      expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
      expect(m.meters.bottom).toBeLessThanOrEqual(844 - 22);
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-ios-keyboard-viewport', '1');
        document.documentElement.style.setProperty('--app-height', '500px');
        document.body.style.height = 'var(--app-height)';
      });
      await page.waitForTimeout(100);
      m = await layout(page);
      expect(m.bar.bottom).toBe(500);
      expect(Math.abs(m.shell.bottom - m.bar.top)).toBeLessThanOrEqual(1);
      expect(m.meters.bottom).toBeLessThanOrEqual(500);
      const heightWithMeters = m.bar.height;
      await page.locator('[data-testid="hamburger"]').click();
      await page.getByRole('menuitemcheckbox', { name: /System meters/ }).click();
      await page.waitForTimeout(150);
      const bar = (await page.locator('.workbench-statusbar').boundingBox())!;
      expect(bar.y + bar.height).toBe(500);
      expect(bar.height).toBeLessThan(heightWithMeters);
      expect(Math.abs(await page.locator('.app-shell').evaluate(el => el.getBoundingClientRect().bottom) - bar.y)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
}
