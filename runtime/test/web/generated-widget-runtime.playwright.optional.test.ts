import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { serveStatic } from '../../src/channels/web/http/static.js';
import { getRouteFlags, shouldSkipAuthCheck } from '../../src/channels/web/http/route-flags.js';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
const requests: string[] = [];
const dependencyRequests: Array<{ origin: string | null; cookie: string | null }> = [];
// () -> i32, exported as answer; returns 42. No external runtime dependency.
const wasm = Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  if (process.env.PICLAW_E2E_DISPOSABLE !== '1') throw new Error('Widget browser tests require PICLAW_E2E_DISPOSABLE=1');
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/generated-widget-runtime-fixture.ts')], target: 'browser', bundle: true, jsx: { runtime: 'automatic', importSource: 'preact' } });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname; requests.push(path);
    if (path === '/fixture.css') return new Response('#styled { color: rgb(17, 34, 51); }', { headers: { 'Content-Type': 'text/css' } });
    if (path === '/fixture.js') return new Response(bundle.outputs[0], { headers: { 'Content-Type': 'text/javascript' } });
    if (path === '/fixture.wasm') return new Response(wasm, { headers: { 'Content-Type': 'application/wasm', 'Access-Control-Allow-Origin': '*' } });
    if (path.startsWith('/static/')) {
      dependencyRequests.push({origin: req.headers.get('Origin'), cookie: req.headers.get('Cookie')});
      if (!shouldSkipAuthCheck(getRouteFlags(req, path), false)) return new Response('Auth required', {status:401});
      return serveStatic(path.slice('/static/'.length), () => new Response('missing', {status:404}), req);
    }
    if (path === '/credential-probe') return Response.json({ cookie: req.headers.get('Cookie') });
    if (path === '/child') return new Response('<p>Same-origin child</p>', { headers: { 'Content-Type': 'text/html' } });
    return new Response('<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
  } });
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

for (const mode of ['classic']) {
  browserTest(`${mode} rejects known-key cross-window bridge forgery and isolates parent`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${server.url}?mode=${mode}`);
      await page.locator('iframe').waitFor();
      await page.waitForTimeout(200);
      const frame = page.frames().find(f => f.parentFrame() === page.mainFrame())!;
      const access = await frame.evaluate(() => {
        try { void parent.document.body; return 'allowed'; } catch { return 'blocked'; }
      });
      await page.evaluate(() => { (window as any).widgetEvents = []; });
      await page.evaluate((mode) => {
        const attacker = document.createElement('iframe');
        attacker.sandbox.value = 'allow-scripts';
        const data = mode === 'classic'
          ? { __piclawGeneratedWidget: true, kind: 'widget.submit', widgetId: 'runtime-fixture', payload: {text:'forged'} }
          : { type: 'piclaw:widget-submit', widgetId: 'runtime-fixture', payload: {text:'forged'} };
        attacker.srcdoc = '<script>parent.postMessage(' + JSON.stringify(data) + ', "*")<\/script>';
        document.body.append(attacker);
      }, mode);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => (window as any).widgetEvents)).toEqual([]);
      expect(access).toBe('blocked');
      expect(await frame.evaluate(() => window.origin)).toBe('null');
      expect(await frame.evaluate(() => {
        try { void localStorage.length; return 'allowed'; } catch { return 'blocked'; }
      })).toBe('blocked');
      await frame.evaluate(() => (window as any).piclawWidget.submit({text:'accepted'}));
      await page.waitForFunction(() => (window as any).widgetEvents.some((e: any) => e.kind === 'widget.submit' && e.payload.text === 'accepted'));
    } finally { await page.close(); }
  }, 15000);
  browserTest(`${mode} disposed and replaced frames cannot replay a known bridge key`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${server.url}?mode=${mode}`);
      await page.locator('iframe').waitFor();
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        (window as any).retiredWidgetWindow = document.querySelector('iframe')!.contentWindow;
        (window as any).widgetFixture.dispose();
        (window as any).widgetEvents = [];
      });
      const replay = () => page.evaluate((mode) => {
        const data = mode === 'classic'
          ? { __piclawGeneratedWidget: true, kind: 'widget.submit', widgetId: 'runtime-fixture', payload: {text:'replay'} }
          : { type: 'piclaw:widget-submit', payload: {text:'replay'} };
        window.dispatchEvent(new MessageEvent('message', { source: (window as any).retiredWidgetWindow, origin: 'null', data }));
        window.dispatchEvent(new MessageEvent('message', { source: null, origin: location.origin, data }));
      }, mode);
      await replay();
      expect(await page.evaluate(() => (window as any).widgetEvents)).toEqual([]);
      await page.evaluate(() => (window as any).widgetFixture.mount());
      await page.locator('iframe').waitFor();
      await page.waitForTimeout(100);
      await page.evaluate(() => { (window as any).widgetEvents = []; });
      await replay();
      expect(await page.evaluate(() => (window as any).widgetEvents)).toEqual([]);
      const frame = page.frames().find(f => f.parentFrame() === page.mainFrame())!;
      await frame.evaluate(() => (window as any).piclawWidget.submit({text:'accepted'}));
      await page.waitForFunction(() => (window as any).widgetEvents.some((e: any) => e.kind === 'widget.submit' && e.payload.text === 'accepted'));
    } finally { await page.close(); }
  }, 15000);
  browserTest(`${mode} actual widget pane loads WASM, vendored ESM imports, Mermaid and CSS from an opaque origin without JS eval`, async () => {
    const page = await browser.newPage();
    try {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      dependencyRequests.length = 0;
      await page.context().addCookies([{ name: 'fixture-session', value: 'test-only', url: server.url.href }]);
      await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.goto(`${server.url}?mode=${mode}`);
      expect(await page.evaluate(async () => (await (await fetch('/credential-probe')).json()).cookie)).toContain('fixture-session=test-only');
      await page.waitForTimeout(100);
      expect(errors).toEqual([]);
      await page.locator('iframe').waitFor();
      const frame = page.frames().find(f => f.parentFrame() === page.mainFrame())!;
      await frame.waitForFunction(() => (window as any).result?.ready);
      expect(await frame.evaluate(() => (window as any).result)).toEqual({ answer: 42, module: true, mermaid: true, crossOrigin: 'blocked', eval: 'blocked', ready: true });
      await frame.frameLocator('iframe').first().getByText('Same-origin child').waitFor();
      await frame.waitForFunction(() => ['connect-src', 'frame-src', 'script-src'].every(d => (window as any).violations.includes(d)));
      expect(await frame.evaluate(() => (window as any).violations)).toEqual(expect.arrayContaining(['connect-src', 'frame-src', 'script-src']));
      expect(requests).toContain('/fixture.wasm');
      expect(requests).toContain('/static/common/js/vendor/three/three.core.min.js');
      expect(dependencyRequests.length).toBeGreaterThan(2);
      expect(dependencyRequests.every(req => req.origin === 'null' && req.cookie === null)).toBe(true);
      // Public dependency CORS must not become a credentialed API channel.
      expect(await frame.evaluate(async () => {
        try {
          await fetch('/static/common/js/vendor/three/three.core.min.js', { credentials: 'include' });
          return 'allowed';
        } catch { return 'blocked'; }
      })).toBe('blocked');
      expect(await frame.locator('#styled').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
      expect(requests).toContain('/child');
    } finally { await page.close(); }
  }, 15000);
}

for (const mode of ["classic"]) browserTest(mode + " static preview prevents script execution and network access", async () => {
 const page=await browser.newPage();
 try {
  const requested:string[]=[];page.on("request",request=>requested.push(new URL(request.url()).pathname));
  await page.goto(server.url.href + "?mode="+mode+"&static=1");
  await page.locator("iframe").waitFor();
  const frame=page.frames().find(f=>f.parentFrame()===page.mainFrame())!;
  await frame.locator("#styled").waitFor();
  expect(await frame.evaluate(()=>Boolean((window as any).result))).toBe(false);
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe("allow-downloads");
  expect(await frame.locator("#styled").evaluate(el=>getComputedStyle(el).color)).toBe("rgb(17, 34, 51)");
  expect(requested).not.toContain("/fixture.wasm");expect(requested).not.toContain("/child");
 }finally{await page.close();}
},15000);
