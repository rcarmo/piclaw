import { test, expect } from 'bun:test';
import { chromium, webkit } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const binary = process.env.PICLAW_TEST_CHROMIUM;
const clientsEnabled = process.env.PICLAW_TEST_CDP_CLIENTS === '1';
const webkitEnabled = clientsEnabled || process.env.PICLAW_TEST_WEBKIT === '1';
for (const engine of ['chromium', 'webkit'] as const) {
((engine === 'chromium' ? binary || clientsEnabled : webkitEnabled) ? test : test.skip)(`${engine} client: shared pane streams frames, input and tablet/light/dark layouts`, async () => {
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../../web/src/panes/cdp-pane.ts')], target: 'browser', format: 'esm' });
  expect(built.success).toBe(true);
  const script = await built.outputs[0].text();
  const received: any[] = [];
  let jpeg = '';
  const sockets = new Set<any>();
  const server = Bun.serve({ port: 0, fetch(req, server) {
    const path = new URL(req.url).pathname;
    if (path === '/cdp-view/ws') { if (server.upgrade(req)) return; }
    if (path === '/skin.css') {
      const skin = "classic";
      return new Response(readFileSync(resolve(import.meta.dir, `../../web/static/${skin}/dist/app.bundle.css`)), { headers: { 'Content-Type': 'text/css' } });
    }
    if (path === '/pane.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
    return new Response('<html><head><link rel="stylesheet" href="/skin.css?skin='+new URL(req.url).searchParams.get('skin')+'"></head><body style="margin:0"><div id="host" style="height:100vh"></div><script type="module">import {cdpPaneExtension} from "/pane.js";window.pane=cdpPaneExtension.mount(document.querySelector("#host"),{path:"piclaw://cdp-view",mode:"view"});</script></body></html>', { headers: { 'Content-Type': 'text/html' } });
  }, websocket: { open(ws) { sockets.add(ws); ws.send(JSON.stringify({ type: 'tabs', sources: [{ id: 'fixture', label: 'Fixture', tabs: [{ id: 'tab', title: 'Test', url: 'about:blank' }] }] })); }, message(ws, raw) {
    const msg = JSON.parse(String(raw)); received.push(msg);
    if (msg.type === 'control') ws.send(JSON.stringify({ type: 'control', enabled: msg.enabled }));
    if (msg.type === 'attach') {
      ws.send(JSON.stringify({ type: 'status', state: 'connected' }));
      ws.send(JSON.stringify({ type: 'frame', source: 'fixture', target: 'tab', stream: 1, frame: 1, data: jpeg, metadata: { deviceWidth: 1600, deviceHeight: 900 } }));
    }
  }, close(ws) { sockets.delete(ws); } } });
  const browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: binary, headless: true, args: ['--no-sandbox'] });
  try {
    for (const skin of ['classic', 'modern']) for (const [width, height, scheme] of [[1200, 800, 'light'], [1200, 800, 'dark'], [768, 1024, 'light'], [768, 1024, 'dark']] as const) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, hasTouch: width === 768 });
      jpeg = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 1600, 900); return canvas.toDataURL('image/jpeg').split(',')[1]; });
      await page.goto(`http://127.0.0.1:${server.port}/?skin=${skin}`);
      await page.evaluate(light => { document.documentElement.classList.toggle('light', light); document.body.classList.toggle('light', light); }, scheme === 'light');
      await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent === 'Live — scale to fit');
      await page.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).naturalWidth === 1600);
      await page.waitForTimeout(30);
      expect(received.some(m => m.type === 'ack' && m.frame === 1 && m.stream === 1)).toBe(true);
      const area = await page.locator('[data-area]').boundingBox(); expect(area).toBeTruthy();
      await page.mouse.click(area!.x + area!.width / 2, area!.y + area!.height / 2);
      expect(received.filter(m => m.type === 'input')).toHaveLength(0);
      await page.getByRole('button', { name: 'Take control' }).click();
      await page.getByRole('button', { name: 'Release control' }).waitFor();
      await page.mouse.click(area!.x + area!.width / 2, area!.y + area!.height / 2);
      await page.waitForTimeout(50);
      const mouse = received.filter(m => m.type === 'input' && m.kind === 'mouse').at(-1); // WebKit rounds dispatched CSS pointer coordinates to whole pixels.
      expect(Math.abs(mouse.x - 800)).toBeLessThanOrEqual(2); expect(Math.abs(mouse.y - 450)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 768) {
        await page.touchscreen.tap(area!.x + area!.width / 2, area!.y + area!.height / 2);
        await page.waitForTimeout(30);
        expect(received.some(m => m.kind === 'touch' && m.event === 'touchEnd')).toBe(true);
      }
      page.once('dialog', dialog => dialog.accept());
      await page.getByLabel('Resize browser to pane').check();
      await page.waitForTimeout(250);
      expect(received.some(m => m.type === 'resize' && m.enabled === true)).toBe(true);
      await page.getByLabel('Resize browser to pane').uncheck();
      expect(received.some(m => m.type === 'resize' && m.enabled === false)).toBe(true);
      await page.getByRole('textbox', { name: 'Type into browser' }).fill('Safari client text');
      await page.waitForTimeout(30);
      expect(received.some(m => m.type === 'input' && m.kind === 'text' && m.text === 'Safari client text')).toBe(true);
      await page.locator('[data-area]').focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(30);
      expect(received.some(m => m.kind === 'key' && m.key === 'ArrowDown' && m.event === 'keyUp')).toBe(true);
      await page.keyboard.down('Shift');
      await page.getByRole('textbox', { name: 'Type into browser' }).click();
      await page.waitForTimeout(30);
      expect(received.some(m => m.type === 'release-input')).toBe(true);
      await page.keyboard.up('Shift');
      if (process.env.PICLAW_CDP_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PICLAW_CDP_SCREENSHOT_DIR}/cdp-${engine}-${skin}-${width}-${scheme}.png` });
      const attaches = received.filter(m => m.type === 'attach').length;
      await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
      await page.getByRole('button', { name: 'Take control' }).waitFor();
      await page.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).naturalWidth === 1600);
      expect(received.filter(m => m.type === 'attach').length).toBeGreaterThan(attaches);
      await page.evaluate(() => (window as any).pane.dispose()); await page.close(); received.length = 0;
    }
  } finally { await browser.close(); server.stop(true); }
}, 60000);
}
