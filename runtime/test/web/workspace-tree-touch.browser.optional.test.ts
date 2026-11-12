import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Touch drag-to-move in the Pierre-based Explorer tree: long-press a file, drag it onto a folder.
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;

browserTest('a long-press drag on a touch screen moves a file into a folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tree-touch-'));
  const web = resolve(import.meta.dir, '../../web/src');
  const entry = join(root, 'fixture.ts');
  await writeFile(entry, `
    import { html, render } from '${web}/vendor/preact-htm.js';
    import { WorkspaceExplorer } from '${web}/components/workspace-explorer.ts';
    window.confirm = () => true;
    render(html\`<\${WorkspaceExplorer} onOpenEditor=\${() => {}} />\`, document.getElementById('explorer'));
  `);
  const build = await Bun.build({ entrypoints: [entry], outdir: root, target: 'browser', format: 'esm', naming: 'fixture.js' });
  expect(build.success).toBe(true);
  const moves: Array<{ path: string; target: string }> = [];
  let moved = false;
  const tree = () => ({ root: { name: '.', path: '.', type: 'dir', children: moved
    ? [{ name: 'docs', path: 'docs', type: 'dir', child_count: 1, children: [{ name: 'notes.md', path: 'docs/notes.md', type: 'file', size: 4 }] }]
    : [{ name: 'docs', path: 'docs', type: 'dir', child_count: 0, children: [] }, { name: 'notes.md', path: 'notes.md', type: 'file', size: 4 }] } });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('<html><body style="margin:0"><div id="explorer" style="height:600px;width:320px;display:flex"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/fixture.js') return new Response(Bun.file(join(root, 'fixture.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)), { headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' } });
    if (url.pathname === '/workspace/tree') return Response.json(tree());
    if (url.pathname === '/workspace/move') {
      const body = await req.json();
      moves.push(body);
      moved = true;
      return Response.json({ ok: true, path: `${body.target}/notes.md` });
    }
    return Response.json({});
  } });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.goto(server.url.href);
    await page.waitForSelector('[data-item-path="notes.md"]');
    const source = (await page.locator('[data-item-path="notes.md"]').boundingBox())!;
    const target = (await page.locator('[data-item-path="docs/"]').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    const sx = source.x + source.width / 2, sy = source.y + source.height / 2;
    const tx = target.x + target.width / 2, ty = target.y + target.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(sx, sy) });
    await page.waitForTimeout(550); // past the 400 ms long-press
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(sx + ((tx - sx) * step) / 6, sy + ((ty - sy) * step) / 6) });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (let attempt = 0; attempt < 50 && moves.length === 0; attempt += 1) await page.waitForTimeout(100);
    await page.waitForSelector('[data-item-path="docs/"]');
    expect(moves).toEqual([{ path: 'notes.md', target: 'docs' }]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

browserTest('the Explorer draws folder icons across the full width, with one New file action at its foot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-tree-chrome-'));
  const web = resolve(import.meta.dir, '../../web/src');
  const entry = join(root, 'fixture.ts');
  await writeFile(entry, `
    import { html, render } from '${web}/vendor/preact-htm.js';
    import { WorkspaceExplorer } from '${web}/components/workspace-explorer.ts';
    render(html\`<\${WorkspaceExplorer} onOpenEditor=\${() => {}} />\`, document.getElementById('explorer'));
  `);
  const build = await Bun.build({ entrypoints: [entry], outdir: root, target: 'browser', format: 'esm', naming: 'fixture.js' });
  expect(build.success).toBe(true);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('<html><head><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body style="margin:0"><div class="workbench-view workbench-view-explorer" id="explorer" style="height:600px;width:300px;display:flex"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/fixture.js') return new Response(Bun.file(join(root, 'fixture.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)), { headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' } });
    if (url.pathname === '/workspace/tree') return Response.json({ root: { name: '.', path: '.', type: 'dir', children: [
      { name: 'docs', path: 'docs', type: 'dir', child_count: 1, children: [{ name: 'guide.md', path: 'docs/guide.md', type: 'file', size: 4 }] },
      { name: 'notes.md', path: 'notes.md', type: 'file', size: 4 }] } });
    return Response.json({});
  } });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    await page.goto(server.url.href);
    await page.waitForSelector('[data-item-path="docs/"]');
    // One New file action, in the action bar at the foot, even with nothing selected.
    expect(await page.locator('.workspace-header .workspace-create').count()).toBe(0);
    expect(await page.locator('.workspace-selection-bar .workspace-create').count()).toBe(1);
    // Folders get a folder icon (open once expanded); rows span the side bar.
    const icon = (path: string) => page.locator(`[data-item-path="${path}"]`).evaluate((row) => {
      const before = getComputedStyle(row.querySelector('[data-item-section="content"]')!, '::before');
      return { content: before.content, mask: before.maskImage || (before as any).webkitMaskImage };
    });
    const closed = await icon('docs/');
    expect(closed.content).not.toBe('none');
    expect(await page.locator('[data-item-path="notes.md"]').evaluate((row) => getComputedStyle(row.querySelector('[data-item-section="content"]')!, '::before').content)).toBe('none');
    await page.locator('[data-item-path="docs/"]').click();
    await page.waitForSelector('[data-item-path="docs/guide.md"]');
    expect((await icon('docs/')).mask).not.toBe(closed.mask);
    const host = (await page.locator('file-tree-container').boundingBox())!, row = (await page.locator('[data-item-path="docs/"]').boundingBox())!;
    expect(row.x - host.x).toBeLessThanOrEqual(8);
    expect(host.x + host.width - (row.x + row.width)).toBeLessThanOrEqual(10);
    // Selecting a file does not repeat its path below the tree.
    await page.locator('[data-item-path="notes.md"]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('.workspace-preview-title').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
