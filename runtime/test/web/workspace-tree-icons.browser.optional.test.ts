import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

// The Explorer's Pierre tree shows coloured file-type icons drawn from the active theme's palette.
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  browserTest(`${name}: Explorer file icons are coloured from the theme palette`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-tree-icons-'));
    const web = resolve(import.meta.dir, '../../web/src');
    const entry = join(root, 'fixture.ts');
    await writeFile(entry, `
      import { html, render } from '${web}/vendor/preact-htm.js';
      import { WorkspaceExplorer } from '${web}/components/workspace-explorer.ts';
      render(html\`<\${WorkspaceExplorer} onOpenEditor=\${() => {}} />\`, document.getElementById('explorer'));
    `);
    const build = await Bun.build({ entrypoints: [entry], outdir: root, target: 'browser', format: 'esm', naming: 'fixture.js' });
    expect(build.success).toBe(true);
    const files = ['notes.md', 'app.ts', 'ci.yml', 'main.go', 'data.json'];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const url = new URL(req.url);
      // A theme palette as applied by the theme module: terminal colours on :root.
      if (url.pathname === '/') return new Response('<html><head><style>:root{--term-red:rgb(201,1,1);--term-green:rgb(2,202,2);--term-yellow:rgb(203,203,3);--term-blue:rgb(4,4,204);--term-magenta:rgb(205,5,205);--term-cyan:rgb(6,206,206);--text-secondary:rgb(107,107,107)}</style></head><body style="margin:0"><div id="explorer" style="height:600px;width:320px;display:flex"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/fixture.js') return new Response(Bun.file(join(root, 'fixture.js')), { headers: { 'content-type': 'text/javascript' } });
      if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)), { headers: { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' } });
      if (url.pathname === '/workspace/tree') return Response.json({ root: { name: '.', path: '.', type: 'dir', children: files.map((file) => ({ name: file, path: file, type: 'file', size: 4 })) } });
      return Response.json({});
    } });
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.goto(server.url.href);
      await page.waitForSelector('[data-item-path="notes.md"]');
      const colours = () => page.evaluate((paths) => {
        const host = document.querySelector('file-tree-container')!.shadowRoot!;
        return Object.fromEntries(paths.map((path) => {
          const icon = host.querySelector(`[data-item-path="${path}"] [data-item-section="icon"] [data-icon-token]`);
          return [path, icon ? getComputedStyle(icon).color : null];
        }));
      }, files.slice(0, 4));
      expect(await colours()).toEqual({ 'notes.md': 'rgb(2, 202, 2)', 'app.ts': 'rgb(4, 4, 204)', 'ci.yml': 'rgb(201, 1, 1)', 'main.go': 'rgb(6, 206, 206)' });
      // A theme change recolours the icons without remounting the tree.
      await page.evaluate(() => document.documentElement.style.setProperty('--term-green', 'rgb(9, 99, 9)'));
      expect((await colours())['notes.md']).toBe('rgb(9, 99, 9)');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
}
