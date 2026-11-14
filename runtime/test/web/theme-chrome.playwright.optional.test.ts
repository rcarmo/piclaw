import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { WEB_THEME_PRESETS } from '../../src/core/ui-theme-catalogue';
import { buildThemeBootstrap } from '../../scripts/theme-bootstrap';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'fixtures/theme-chrome-fixture.ts')], target: 'browser' });
  if (!result.success) throw Error(String(result.logs));
  const js = await result.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } });
    const skin = "classic";
    const original = await Bun.file(resolve(import.meta.dir, `../../web/static/${skin}/index.html`)).text();
    const head = original.split('</head>')[0].replace(/<link[^>]*>/g, '');
    return new Response(`${head}</head><body><input id="focus"><div style="height:1800px"></div><script type="module" src="/fixture.js"></script></body>`, { headers: { 'Content-Type': 'text/html' } });
  } });
});
afterAll(() => server?.stop(true));
for (const [name, engine] of Object.entries({ chromium, webkit })) for (const skin of ['classic']) {
  browserTest(`${name} ${skin}: startup colours match every catalogue entry before runtime initialisation`, async () => {
    const browser = await engine.launch(); const page = await browser.newPage({ colorScheme: 'light', viewport: { width: 390, height: 844 } });
    try {
      await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
      await page.goto(`${server.url}?skin=${skin}`); await page.waitForFunction(() => Boolean((window as any).themeChromeFixture));
      const expected = Object.fromEntries(WEB_THEME_PRESETS.map(p => [p.id, p.mode === 'dark' ? p.dark!.bgPrimary : p.light!.bgPrimary]));
      const result = await page.evaluate(({ code, expected }) => {
        const failures: string[] = [];
        for (const [id, bg] of Object.entries(expected)) {
          localStorage.setItem('piclaw_theme', id); localStorage.removeItem('piclaw_tint'); localStorage.removeItem('piclaw_custom_theme');
          (0, eval)(code);
          const swatch = document.createElement('span'); swatch.style.background = bg;
          if (document.documentElement.style.background !== swatch.style.background) failures.push(id + ':background');
          for (const tag of document.querySelectorAll('meta[name="theme-color"]')) if (tag.getAttribute('content') !== bg) failures.push(id + ':meta');
        }
        return failures;
      }, { code: buildThemeBootstrap(), expected });
      expect(result).toEqual([]);
      for (const id of ['synthwave-84-full', 'lumon']) {
        await page.evaluate(id => localStorage.setItem('piclaw_theme', id), id);
        await page.reload(); await page.waitForFunction(() => Boolean((window as any).themeChromeFixture));
        const bg = expected[id];
        expect(await page.locator('#dynamic-theme-color').getAttribute('content')).toBe(bg);
        expect(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content')).toBe('black-translucent');
      }
      await page.evaluate(() => { localStorage.setItem('piclaw_theme', 'default'); localStorage.setItem('piclaw_theme_mode', 'dark'); });
      await page.reload(); await page.waitForFunction(() => Boolean((window as any).themeChromeFixture));
      expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');

      for (const tint of ['#f50', '#ff5500', 'rgb(255, 85, 0)', 'tomato']) {
        const match = await page.evaluate(({ code, tint }) => {
          localStorage.setItem('piclaw_theme_mode', 'light'); localStorage.setItem('piclaw_tint', tint);
          (0, eval)(code); const initial = document.documentElement.style.background;
          const stop = (window as any).themeChromeFixture.start(); const final = document.documentElement.style.background;
          stop(); return { initial, final };
        }, { code: buildThemeBootstrap(), tint });
        expect(match.initial).toBe(match.final);
      }

    } finally { await browser.close(); }
  }, 30000);
  browserTest(`${name} ${skin}: standalone theme/import/resume updates are bounded and do not change layout`, async () => {
    const browser = await engine.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        const raf = window.requestAnimationFrame.bind(window);
        (window as any).frames = 0;
        window.requestAnimationFrame = cb => raf(t => { (window as any).frames++; cb(t); });
      });
      await page.route('**/*', r => new URL(r.request().url()).origin === server.url.origin ? r.continue() : r.abort());
      await page.goto(`${server.url}?skin=${skin}`); await page.waitForFunction(() => Boolean((window as any).themeChromeFixture));
      await page.evaluate(() => { (window as any).disposeTheme = (window as any).themeChromeFixture.start(); });
      await page.waitForTimeout(80);
      await page.locator('#focus').focus();
      // WebKit's asynchronous focus reveal can scroll independently of theming.
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 200));
      await page.waitForTimeout(100);
      const result = await page.evaluate(async () => {
        const api = (window as any).themeChromeFixture;
        const before = { scroll: scrollY, width: innerWidth, height: innerHeight, active: document.activeElement?.id, frames: (window as any).frames };
        const oldMeta = document.getElementById('dynamic-theme-color');
        api.select('dracula'); api.select('nord');
        await new Promise(r => setTimeout(r, 80));
        return { before, after: { scroll: scrollY, width: innerWidth, height: innerHeight, active: document.activeElement?.id }, frames: (window as any).frames - before.frames, replaced: oldMeta !== document.getElementById('dynamic-theme-color'), meta: document.getElementById('dynamic-theme-color')?.getAttribute('content') };
      });
      expect(result.meta).toBe('#2e3440'); expect(result.replaced).toBe(true); expect(result.frames).toBe(1);
      expect(result.after).toEqual({ scroll: result.before.scroll, width: result.before.width, height: result.before.height, active: result.before.active });
      await page.evaluate(() => { document.body.style.background = '#000'; window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      expect(await page.locator('body').evaluate(el => (el as HTMLElement).style.background)).toBe('rgb(46, 52, 64)');
      await page.waitForTimeout(80);
      const cancelled = await page.evaluate(async () => { const n=(window as any).frames; (window as any).themeChromeFixture.select('dracula'); (window as any).disposeTheme(); await new Promise(r=>setTimeout(r,60)); return (window as any).frames-n; });
      expect(cancelled).toBe(0);
      const hiddenFrames = await page.evaluate(async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        const n = (window as any).frames; (window as any).themeChromeFixture.select('nord');
        await new Promise(r=>setTimeout(r,60)); delete (document as any).hidden; return (window as any).frames-n;
      });
      expect(hiddenFrames).toBe(0);
      const desktopFrames = await page.evaluate(async () => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => false });
        const n=(window as any).frames; (window as any).themeChromeFixture.select('dracula'); await new Promise(r=>setTimeout(r,60));return (window as any).frames-n;
      });
      expect(desktopFrames).toBe(0);
    } finally { await browser.close(); }
  }, 30000);
}
