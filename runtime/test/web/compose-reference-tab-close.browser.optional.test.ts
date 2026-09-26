import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;

browserTest('closing a referenced file tab removes only its compose reference without changing hook order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compose-reference-tab-close-'));
  const web = resolve(import.meta.dir, '../../web/src');
  const entry = join(root, 'fixture.ts');
  await writeFile(entry, `
    import { h, render, useState } from '${web}/vendor/preact-htm.js';
    import { useEditorState } from '${web}/ui/use-editor-state.ts';
    import { usePaneComposeReferenceRemoval } from '${web}/ui/app-main-pane-composition.ts';
    import { bindComposeReferenceRemoval } from '${web}/ui/app-main-interaction-composition.ts';
    import { tabStore } from '${web}/panes/tab-store.ts';
    import { removeStringRef } from '${web}/ui/app-shell-ref-utils.ts';
    function Fixture() {
      const [fileRefs, setFileRefs] = useState(['keep.md', 'close.md']);
      const [revision, setRevision] = useState(0);
      const { removeFileRefRef, onTabClosed } = usePaneComposeReferenceRemoval();
      const editor = useEditorState({ onTabClosed });
      bindComposeReferenceRemoval({
        removeFileRefRef,
        composeReferenceActions: {
          removeFileRef: path => setFileRefs(previous => {
            window.removalRevisions.push(revision);
            return removeStringRef(previous, path);
          }),
        },
      });
      window.editor = editor;
      window.setRevision = setRevision;
      return h('div', null, h('output', { id: 'refs' }, fileRefs.join(',')), h('output', { id: 'revision' }, String(revision)));
    }
    window.removalRevisions = [];
    tabStore.open('keep.md');
    tabStore.open('close.md');
    render(h(Fixture), document.getElementById('app'));
  `);
  const build = await Bun.build({ entrypoints: [entry], outdir: root, target: 'browser', format: 'esm', naming: 'fixture.js' });
  expect(build.success).toBe(true);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/fixture.js') return new Response(Bun.file(join(root, 'fixture.js')), { headers: { 'content-type': 'text/javascript' } });
    return new Response('<div id="app"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.PICLAW_TEST_CHROMIUM_PATH });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url.href);
    await page.waitForFunction(() => document.querySelector('#refs')?.textContent === 'keep.md,close.md');
    await page.evaluate(() => (window as any).setRevision(1));
    await page.waitForFunction(() => document.querySelector('#revision')?.textContent === '1');
    await page.evaluate(() => (window as any).editor.handleTabClose('close.md'));
    await page.waitForFunction(() => document.querySelector('#refs')?.textContent === 'keep.md');
    expect(await page.evaluate(() => ({ revisions: (window as any).removalRevisions, tabs: (window as any).editor.tabStripTabs.map((tab: any) => tab.id) })))
      .toEqual({ revisions: [1], tabs: ['keep.md'] });
    await page.evaluate(() => (window as any).editor.handleTabClose('keep.md'));
    await page.waitForFunction(() => document.querySelector('#refs')?.textContent === '');
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
