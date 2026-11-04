import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const root = resolve(import.meta.dir, '../..');
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/editor-heading-spacing-fixture.ts')], target: 'browser', format: 'esm', external: ['#editor-vendor/codemirror', '/static/classic/dist/editor.bundle.js'] });
  if (!built.success) throw Error(built.logs.join('\n'));
  const script = await built.outputs[0].text();
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname === '/editor-vendor/codemirror.js') return new Response(Bun.file(join(root, 'extensions/viewers/editor/vendor/codemirror.js')), { headers: { 'content-type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) {
      const file = resolve(root, 'web', url.pathname.slice(1));
      if (file.startsWith(root + '/web/static/') && await Bun.file(file).exists()) return new Response(Bun.file(file));
    }
    if (url.pathname === '/workspace/file/stat') return Response.json({ mtime: 'fixture' });
    if (url.pathname !== '/') return new Response(null, { status: 404 });
    const skin = url.searchParams.get('skin') === 'visual' ? 'visual' : 'classic';
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/static/${skin}/css/styles.css"><style>html,body{margin:0}body{display:block;height:auto;min-height:0;overflow:visible}#editor{height:560px;width:100%}#preview{height:300px}#blur{position:fixed;right:0;top:0;z-index:100}</style><button id="blur">Blur</button><div id="editor" class="editor-pane-instance-host"></div><div id="preview"></div><div id="chat" class="post-content"><h1>Chat heading</h1><p>Chat prose</p></div><script src="/static/common/js/marked.min.js"></script><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="/fixture.js"></script>`, { headers: { 'content-type': 'text/html' } });
  } });
}, 30000);
afterAll(() => server?.stop(true));

for (const [engineName, engine] of Object.entries({ chromium, webkit })) for (const skin of ['classic', 'visual']) for (const bundle of [false, true]) {
  browserTest(`${engineName} ${skin} ${bundle ? 'bundle' : 'source'}: headings use compact spacing without editor geometry drift`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
      await page.goto(`${server.url}?skin=${skin}${bundle ? '&bundle=1' : ''}`);
      await page.waitForFunction(() => (window as any).headingFixture?.ready);
      for (const theme of ['github-light', 'github-dark']) for (const blankLines of [0, 1, 2]) {
        const text = Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} Heading ${index + 1}\n${'\n'.repeat(blankLines)}Body ${index + 1}.`).join('\n' + '\n'.repeat(blankLines));
        await page.evaluate(({ text, theme }) => { (window as any).editorFixture.selectLocalTheme(theme); (window as any).headingFixture.setDocument(text); }, { text, theme });
        await page.waitForFunction(() => document.querySelectorAll('#preview h1, #preview h2, #preview h3, #preview h4, #preview h5, #preview h6').length === 6 && document.querySelectorAll('.cm-md-h-line').length === 6);
        const state = await page.evaluate(() => {
          const f = (window as any).editorFixture, view = f.instance.view;
          const metrics = (element: Element) => {
            const css = getComputedStyle(element);
            return { top: parseFloat(css.marginTop), bottom: parseFloat(css.marginBottom), padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), font: parseFloat(css.fontSize), line: parseFloat(css.lineHeight), height: element.getBoundingClientRect().height, children: [...element.querySelectorAll('span')].map(span => ({ className: span.className, font: getComputedStyle(span).fontSize, line: getComputedStyle(span).lineHeight, height: span.getBoundingClientRect().height })) };
          };
          const heading = document.querySelector('#preview h1')!, box = heading.getBoundingClientRect();
          const previewReceivesPointer = Boolean(document.elementFromPoint(box.left + 10, box.top + box.height / 2)?.closest('#preview'));
          return { previewReceivesPointer, text: view.state.doc.toString(), lines: [...document.querySelectorAll('.cm-md-h-line')].map(metrics), headings: [...document.querySelectorAll('#preview :is(h1,h2,h3,h4,h5,h6)')].map(metrics), chat: metrics(document.querySelector('#chat h1')!) };
        });
        if (theme === 'github-light' && blankLines === 0) {
          const directory = resolve(root, 'generated/reports/editor-heading-spacing');
          await mkdir(directory, { recursive: true });
          const path = join(directory, `${engineName}-${skin}-${bundle ? 'bundle' : 'source'}-${Date.now()}.png`);
          await page.locator('#editor').screenshot({ path });
          await page.locator('#preview .md-preview-panel').screenshot({ path: path.replace('.png', '-preview.png') });
          console.log('Heading spacing evidence', JSON.stringify({ path, lines: state.lines, headings: state.headings }));
        }
        expect(state.previewReceivesPointer, 'the real attached preview must not be obscured by an unconstrained editor fixture').toBe(true);
        expect(state.text).toBe(text);
        for (const line of state.lines) {
          expect(line.padding, `inline heading must not add padding to source blank lines: ${JSON.stringify(line)}`).toBe(0);
          expect(line.top).toBe(0); expect(line.bottom).toBe(0);
          expect(line.line / line.font).toBeLessThanOrEqual(1.33);
          expect(line.height).toBeCloseTo(line.line, 1);
          for (const token of line.children.filter(child => child.className.split(' ').includes('tok-heading'))) expect(parseFloat(token.font)).toBeCloseTo(line.font, 1);
        }
        for (const [index, heading] of state.headings.entries()) {
          expect(heading.top).toBeCloseTo(index === 0 ? 0 : heading.font * 0.5, 1);
          expect(heading.bottom, 'rendered headings must not add a second following margin').toBe(0);
          expect(heading.line / heading.font).toBeCloseTo(1.25, 2);
        }
        expect(state.chat.top).toBeCloseTo(state.chat.font * 0.5, 1);
        expect(state.chat.bottom).toBeCloseTo(state.chat.font * 0.25, 1);
        // Moving into/out of each heading keeps its line geometry and document intact.
        for (let level = 1; level <= 6; level++) {
          const result = await page.evaluate(async level => {
            const view = (window as any).editorFixture.instance.view;
            const line = Array.from({ length: view.state.doc.lines }, (_, i) => view.state.doc.line(i + 1)).find((line: any) => line.text.startsWith('#'.repeat(level) + ' '))!;
            const measure = () => document.querySelector(`.cm-md-h${level}-line`)!.getBoundingClientRect().height;
            const before = measure();
            view.dispatch({ selection: { anchor: line.from + level + 1 }, scrollIntoView: true }); view.focus();
            await new Promise(requestAnimationFrame);
            const active = measure(), position = view.coordsAtPos(view.state.selection.main.head)!;
            const hit = view.posAtCoords({ x: position.left, y: (position.top + position.bottom) / 2 });
            view.dispatch({ selection: { anchor: view.state.doc.length } });
            await new Promise(requestAnimationFrame);
            return { before, active, after: measure(), hit, expected: line.from + level + 1, text: view.state.doc.toString() };
          }, level);
          expect(result.active).toBeCloseTo(result.before, 1); expect(result.after).toBeCloseTo(result.before, 1);
          expect(result.hit).toBe(result.expected); expect(result.text).toBe(text);
        }
      }
      for (const text of ['# Only title', 'Paragraph\n# Heading\n## Adjacent\nParagraph', '# Outer\n\n- List item\n\n## Detail\n\n```\ncode\n```\n\n### Last']) {
        await page.evaluate(text => (window as any).headingFixture.setDocument(text), text);
        const count = text.split('\n').filter(line => /^#{1,6} /.test(line)).length;
        await page.waitForFunction(count => document.querySelectorAll('.cm-md-h-line').length === count && document.querySelectorAll('#preview :is(h1,h2,h3,h4,h5,h6)').length === count, count);
        const headings = await page.evaluate(() => [...document.querySelectorAll('.cm-md-h-line, #preview :is(h1,h2,h3,h4,h5,h6)')].map(element => { const css = getComputedStyle(element); return { padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), bottom: parseFloat(css.marginBottom) }; }));
        for (const heading of headings) { expect(heading.padding).toBe(0); expect(heading.bottom).toBe(0); }
        expect(await page.evaluate(() => (window as any).editorFixture.instance.view.state.doc.toString())).toBe(text);
      }
      // A wrapped heading remains measurable, selectable and foldable at narrow widths/zoom.
      await page.setViewportSize({ width: 360, height: 1000 });
      for (const zoom of [1, 1.25]) {
        await page.evaluate(zoom => { document.querySelector<HTMLElement>('#editor')!.style.zoom = String(zoom); (window as any).headingFixture.setDocument('# A long heading that wraps across several visual lines in a narrow editor viewport\n\nSection body\n\n## Next section\nBody'); }, zoom);
        await page.waitForFunction(() => document.querySelector('.cm-md-heading-fold') && document.querySelector('.cm-md-h1-line')!.getBoundingClientRect().height > 40);
        const result = await page.evaluate(() => {
          const view = (window as any).editorFixture.instance.view;
          const before = view.state.doc.toString();
          view.dispatch({ selection: { anchor: 10, head: 65 } }); view.focus();
          return { text: view.state.doc.toString(), before, from: view.state.selection.main.from, to: view.state.selection.main.to };
        });
        expect(result.text).toBe(result.before); expect(result.from).toBe(10); expect(result.to).toBe(65);
        await page.evaluate(() => { const view = (window as any).editorFixture.instance.view; view.dispatch({ selection: { anchor: view.state.doc.length } }); });
        await page.locator('.cm-md-heading-fold').first().click();
        await page.waitForFunction(() => document.querySelectorAll('.cm-md-heading-collapsed-line').length > 0, undefined, { timeout: 2000 });
        expect(await page.locator('.cm-md-heading-collapsed-line').count()).toBeGreaterThan(0);
        await page.locator('.cm-md-heading-fold').first().press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('.cm-md-heading-collapsed-line').length === 0, undefined, { timeout: 2000 });
        expect(await page.locator('.cm-md-heading-collapsed-line').count()).toBe(0);
      }
      // The same editor's styles must survive a transfer to a pop-out document.
      const transferred = await page.evaluate(async () => {
        const f = (window as any).editorFixture;
        (window as any).headingFixture.setDocument('# Transferred heading\n\nBody');
        await new Promise(requestAnimationFrame);
        const instance = f.instance, text = instance.view.state.doc.toString();
        const iframe = document.createElement('iframe'); document.body.append(iframe);
        const doc = iframe.contentDocument!;
        doc.documentElement.style.cssText = document.documentElement.style.cssText;
        const host = doc.createElement('div'); host.style.cssText = 'height:300px;width:500px'; doc.body.append(host);
        const state = instance.exportHostTransferState();
        instance.beforeDetachFromHost({ reason: 'move', target: 'popout' });
        instance.moveHost(host, { reason: 'move', hostMode: 'popout', transferState: state });
        await new Promise(requestAnimationFrame);
        const heading = doc.querySelector('.cm-md-h1-line')!, css = doc.defaultView!.getComputedStyle(heading);
        return { text: instance.view.state.doc.toString(), expected: text, padding: parseFloat(css.paddingTop) + parseFloat(css.paddingBottom), margin: parseFloat(css.marginTop) + parseFloat(css.marginBottom) };
      });
      expect(transferred.text).toBe(transferred.expected); expect(transferred.padding).toBe(0); expect(transferred.margin).toBe(0);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 90000);
}
