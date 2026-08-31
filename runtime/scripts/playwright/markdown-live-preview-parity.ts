#!/usr/bin/env bun

import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const runtimeRoot = resolve(import.meta.dir, '../..');
const fixturePath = join(runtimeRoot, 'test/fixtures/markdown-live-preview-parity/atomic-port-parity.md');
const workDir = join(runtimeRoot, 'generated/cache/markdown-live-preview-parity');
const outDir = join(workDir, 'dist');
const source = readFileSync(fixturePath, 'utf8');
const markdownPath = 'notes/atomic-port-parity.md';
const workspaceImagePaths = new Set([
  'notes/atomic-port-parity-20260831-151050.png',
  'notes/assets/editor-preview.png',
]);
const onePixelPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5WQAAAAASUVORK5CYII=',
  'base64',
));

const scenarios = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeHarness() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const entry = `
import {
  EditorState,
  EditorView,
  lineNumbers,
  markdown,
  markdownLanguage,
  minimalSetup,
} from '#editor-vendor/codemirror';
import { createMarkdownLivePreview, markdownParserExtensions } from '../../../extensions/viewers/editor/markdown/index.ts';
import { livePreviewFrozenField } from '../../../extensions/viewers/editor/markdown/live-preview.ts';
import { openEditorSearch, revealText, searchRevealExtension, isEditorSearchOpen } from '../../../extensions/viewers/editor/search-reveal.ts';

const source = ${JSON.stringify(source)};
const root = document.getElementById('editor');
if (!root) throw new Error('Missing #editor');

const view = new EditorView({
  parent: root,
  state: EditorState.create({
    doc: source,
    extensions: [
      minimalSetup,
      lineNumbers(),
      markdown({ base: markdownLanguage, extensions: markdownParserExtensions }),
      EditorView.lineWrapping,
      searchRevealExtension,
      createMarkdownLivePreview(${JSON.stringify(markdownPath)}),
    ],
  }),
});

window.__piclawMarkdownHarness = {
  source,
  view,
  doc: () => view.state.doc.toString(),
  reset: () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 0 } }),
  isFrozen: () => view.state.field(livePreviewFrozenField, false),
  openSearch: (query) => openEditorSearch(view, query),
  isSearchOpen: () => isEditorSearchOpen(view.state),
  reveal: (query) => revealText(view, query),
  focus: () => view.focus(),
  setCursor: (pos) => view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }),
  scrollTo: (pos) => view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) }),
  selection: () => ({
    from: view.state.selection.main.from,
    to: view.state.selection.main.to,
    head: view.state.selection.main.head,
    anchor: view.state.selection.main.anchor,
  }),
};
`;

  const html = `<!doctype html>
<html data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Piclaw Markdown Live Preview Parity Harness</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: #ddd; }
    #editor { width: 100vw; height: 100vh; }
    .cm-editor { height: 100%; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script type="module" src="./dist/harness.js"></script>
</body>
</html>`;

  const entryPath = join(workDir, 'harness.ts');
  writeFileSync(entryPath, entry);
  writeFileSync(join(workDir, 'index.html'), html);
  return entryPath;
}

async function buildHarness(entryPath: string) {
  const result = await Bun.build({
    entrypoints: [entryPath],
    outdir: outDir,
    target: 'browser',
    format: 'esm',
    sourcemap: 'none',
    naming: { entry: 'harness.js' },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Failed to build markdown live-preview browser harness.');
  }
}

async function count(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count();
}

function serveHarness() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/workspace/raw') {
        const workspacePath = url.searchParams.get('path') || '';
        if (!workspaceImagePaths.has(workspacePath)) {
          return new Response('Workspace image not found', { status: 404 });
        }
        return new Response(onePixelPng, { headers: { 'content-type': 'image/png' } });
      }
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const safePath = pathname.replace(/^\/+/, '');
      const filePath = resolve(workDir, safePath);
      if (!filePath.startsWith(workDir) || !existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      const headers = new Headers();
      if (filePath.endsWith('.html')) headers.set('content-type', 'text/html; charset=utf-8');
      else if (filePath.endsWith('.js')) headers.set('content-type', 'text/javascript; charset=utf-8');
      return new Response(Bun.file(filePath), { headers });
    },
  });
}

async function runScenario(page: Page, baseUrl: string, scenario: typeof scenarios[number]) {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('.cm-editor');
  await page.waitForTimeout(250);

  assert(await count(page, '.cm-md-h1-line') >= 1, `${scenario.name}: missing live heading line decoration`);
  assert(await count(page, '.cm-md-heading-fold') >= 1, `${scenario.name}: missing heading fold affordance`);
  assert(await count(page, '.cm-md-callout') >= 1, `${scenario.name}: missing callout decoration`);
  assert(await count(page, '.cm-md-frontmatter-line') >= 1, `${scenario.name}: missing frontmatter decoration`);
  assert(await count(page, 'input.cm-md-checkbox') >= 2, `${scenario.name}: missing task checkbox widgets`);

  const referenceLinkState = await page.evaluate(() => ({
    links: Array.from(document.querySelectorAll('a.cm-md-link-widget')).map((anchor: any) => ({
      text: anchor.textContent,
      href: anchor.href,
      title: anchor.title,
    })),
    referenceDefs: document.querySelectorAll('.cm-md-link-reference-def').length,
  }));
  const linkTexts = referenceLinkState.links.map((link) => link.text);
  assert(linkTexts.includes('safe link'), `${scenario.name}: missing inline link widget`);
  assert(linkTexts.includes('reference link'), `${scenario.name}: missing full reference link widget`);
  assert(linkTexts.includes('collapsed ref'), `${scenario.name}: missing collapsed reference link widget`);
  assert(linkTexts.includes('shortcut ref'), `${scenario.name}: missing shortcut reference link widget`);
  assert(referenceLinkState.links.some((link) => link.text === 'reference link' && link.href === 'https://example.com/reference' && link.title === 'Reference title'), `${scenario.name}: reference link did not resolve href/title`);
  assert(referenceLinkState.referenceDefs >= 3, `${scenario.name}: missing inactive reference definition styling`);

  const checkboxToggle = await page.evaluate(async () => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 120));
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox'));
    const checkedBefore = boxes.filter((box) => box.checked).length;
    const target = boxes.find((box) => box.checked) || boxes[0];
    if (!target) return { found: false };
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await wait();
    const afterBoxes = Array.from(document.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox'));
    return {
      found: true,
      doc: (window as any).__piclawMarkdownHarness.doc(),
      checkedBefore,
      checkedAfter: afterBoxes.filter((box) => box.checked).length,
    };
  });
  if (!checkboxToggle.found) {
    throw new Error(`${scenario.name}: checkbox toggle target not found`);
  }
  const toggledCheckbox = checkboxToggle as { found: true; doc: string; checkedBefore: number; checkedAfter: number };
  assert(toggledCheckbox.doc.includes('- [ ] Top-level checked task'), `${scenario.name}: checkbox toggle did not update source markdown`);
  assert(toggledCheckbox.checkedAfter < toggledCheckbox.checkedBefore, `${scenario.name}: checkbox toggle did not update visible checked state`);
  await page.evaluate(() => (window as any).__piclawMarkdownHarness.reset());
  await page.waitForTimeout(160);

  const revealSearch = await page.evaluate(async () => {
    const harness = (window as any).__piclawMarkdownHarness;
    const before = harness.selection().head;
    harness.openSearch('frontmatter');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const searchOpen = harness.isSearchOpen();
    const revealed = harness.reveal('missing first line\nFootnote reference');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return {
      searchOpen,
      revealed,
      revealCount: document.querySelectorAll('.cm-initialRevealMatch').length,
      after: harness.selection().head,
      before,
    };
  });
  assert(revealSearch.searchOpen, `${scenario.name}: openSearch API did not open search panel`);
  assert(revealSearch.revealed && revealSearch.revealed.from < revealSearch.revealed.to, `${scenario.name}: revealText API did not find fallback snippet`);
  assert(revealSearch.revealCount >= 1, `${scenario.name}: revealText API did not paint reveal highlight`);
  assert(revealSearch.after === revealSearch.before, `${scenario.name}: revealText API moved the editor selection`);

  await page.evaluate(() => {
    const harness = (window as any).__piclawMarkdownHarness;
    harness.scrollTo(harness.source.indexOf('![Alt image'));
  });
  await page.waitForTimeout(150);
  assert(await count(page, '.cm-md-image-block') >= 3, `${scenario.name}: missing image block widgets`);
  const workspaceImages = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLImageElement>('.cm-md-image'))
    .filter((image) => image.alt === 'Pasted image' || image.alt === 'Relative image')
    .map((image) => ({
      alt: image.alt,
      src: image.getAttribute('src'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
    })));
  assert(workspaceImages.length === 2, `${scenario.name}: missing pasted or relative image element`);
  assert(workspaceImages.every((image) => image.src?.startsWith('/workspace/raw?path=')), `${scenario.name}: workspace images did not use the raw-file endpoint`);
  assert(workspaceImages.every((image) => image.complete && image.naturalWidth > 0), `${scenario.name}: workspace images did not load`);

  await page.evaluate(() => {
    const harness = (window as any).__piclawMarkdownHarness;
    harness.scrollTo(harness.source.indexOf('| Left | Center | Right |'));
  });
  await page.waitForTimeout(150);
  assert(await count(page, '.cm-md-editable-table') >= 1, `${scenario.name}: missing editable table widget`);

  const tableInteraction = await page.evaluate(async () => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
    const harness = (window as any).__piclawMarkdownHarness;
    const tableLineCount = (text: string) => text.split('\n').filter((line) => line.startsWith('|')).length;
    const caretOffset = (cell: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return -1;
      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(cell);
      range.setEnd(selection.anchorNode!, selection.anchorOffset);
      return range.toString().length;
    };
    const setCaret = (cell: HTMLElement, offset: number) => {
      cell.focus();
      const text = cell.firstChild ?? cell.appendChild(document.createTextNode(''));
      const range = document.createRange();
      range.setStart(text, Math.max(0, Math.min(offset, text.textContent?.length ?? 0)));
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    const insertAtCaret = (cell: HTMLElement, text: string) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) throw new Error('missing table cell selection');
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      cell.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    };

    const cell = document.querySelector<HTMLElement>('.cm-md-editable-table tbody td[data-row="1"][data-col="0"] .cm-md-table-cell-source');
    if (!cell) throw new Error('editable table body cell source not found');

    cell.focus();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await wait();
    const tabCol = (document.activeElement as HTMLElement | null)?.dataset?.col ?? null;
    const secondCell = document.querySelector<HTMLElement>('.cm-md-editable-table tbody td[data-row="1"][data-col="1"] .cm-md-table-cell-source');
    if (!secondCell) throw new Error('editable table second cell source not found');
    secondCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await wait();
    const shiftTabCol = (document.activeElement as HTMLElement | null)?.dataset?.col ?? null;

    cell.textContent = 'abcdef';
    setCaret(cell, 3);
    insertAtCaret(cell, 'X');
    await wait();
    const caretAfterMiddleInsert = caretOffset(cell);
    const caretDoc = harness.doc();

    const pipeCell = document.querySelector<HTMLElement>('.cm-md-editable-table tbody td[data-row="1"][data-col="1"] .cm-md-table-cell-source');
    if (!pipeCell) throw new Error('editable table pipe cell source not found');
    pipeCell.textContent = 'pipe value';
    setCaret(pipeCell, 4);
    insertAtCaret(pipeCell, ' |');
    await wait();
    const pipeCaret = caretOffset(pipeCell);
    const pipeDoc = harness.doc();

    pipeCell.textContent = 'abcdef';
    setCaret(pipeCell, 3);
    const data = new DataTransfer();
    data.setData('text/plain', 'M\nN');
    pipeCell.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    await wait();
    const pasteCaret = caretOffset(pipeCell);
    const pasteDoc = harness.doc();

    const compositionCell = document.querySelector<HTMLElement>('.cm-md-editable-table tbody td[data-row="1"][data-col="2"] .cm-md-table-cell-source');
    if (!compositionCell) throw new Error('editable table composition cell source not found');
    compositionCell.textContent = '';
    compositionCell.focus();
    compositionCell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    compositionCell.textContent = 'é';
    compositionCell.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'é' }));
    await wait();
    const compositionDocDuring = harness.doc();
    compositionCell.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'é' }));
    await wait();
    const compositionDocAfter = harness.doc();

    cell.focus();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.cm-md-editable-table-button'));
    const byText = (text: string) => buttons.find((button) => button.textContent === text);
    const addRow = byText('+ row');
    const deleteRow = byText('- row');
    const addCol = byText('+ col');
    const deleteCol = byText('- col');
    const alignCenter = byText('↔');
    if (!addRow || !deleteRow || !addCol || !deleteCol || !alignCenter) throw new Error('editable table mutation buttons not found');

    alignCenter.click();
    await wait();
    const alignDoc = harness.doc();

    const beforeRows = tableLineCount(alignDoc);
    addRow.click();
    await wait();
    const afterAddRowDoc = harness.doc();
    deleteRow.click();
    await wait();
    const afterDeleteRowDoc = harness.doc();

    addCol.click();
    await wait();
    const afterAddColDoc = harness.doc();
    deleteCol.click();
    await wait();
    const afterDeleteColDoc = harness.doc();
    const activeCellAfterMutation = (document.activeElement as HTMLElement | null)?.classList.contains('cm-md-table-cell-source') ?? false;

    const lastCell = Array.from(document.querySelectorAll<HTMLElement>('.cm-md-editable-table tbody td[data-row][data-col] .cm-md-table-cell-source')).at(-1);
    if (!lastCell) throw new Error('editable table last cell source not found');
    const beforeTabEndRows = tableLineCount(harness.doc());
    lastCell.focus();
    lastCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await wait();
    const afterTabEndRows = tableLineCount(harness.doc());
    const tabEndFocus = {
      row: (document.activeElement as HTMLElement | null)?.dataset?.row ?? null,
      col: (document.activeElement as HTMLElement | null)?.dataset?.col ?? null,
    };

    const contextCell = document.querySelector<HTMLElement>('.cm-md-editable-table tbody td[data-row="1"][data-col="0"]');
    if (!contextCell) throw new Error('editable table context cell not found');
    const beforeContextRows = tableLineCount(harness.doc());
    contextCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
    await wait();
    const contextVisible = !document.querySelector<HTMLElement>('.cm-md-editable-table-context-menu')?.hidden;
    const menuAddRow = Array.from(document.querySelectorAll<HTMLButtonElement>('.cm-md-editable-table-menu-button')).find((button) => button.textContent === '+ row');
    if (!menuAddRow) throw new Error('editable table context add-row missing');
    menuAddRow.click();
    await wait();
    const afterContextRows = tableLineCount(harness.doc());

    return {
      tabCol,
      shiftTabCol,
      caretAfterMiddleInsert,
      caretDoc,
      pipeCaret,
      pipeDoc,
      pasteCaret,
      pasteDoc,
      compositionDocDuring,
      compositionDocAfter,
      alignDoc,
      beforeRows,
      afterAddRows: tableLineCount(afterAddRowDoc),
      afterDeleteRows: tableLineCount(afterDeleteRowDoc),
      addedColumn: afterAddColDoc.includes('Column '),
      deletedColumn: !afterDeleteColDoc.includes('Column '),
      activeCellAfterMutation,
      beforeTabEndRows,
      afterTabEndRows,
      tabEndFocus,
      contextVisible,
      beforeContextRows,
      afterContextRows,
    };
  });
  assert(tableInteraction.tabCol === '1', `${scenario.name}: Tab did not move focus to next editable table cell`);
  assert(tableInteraction.shiftTabCol === '0', `${scenario.name}: Shift-Tab did not move focus to previous editable table cell`);
  assert(tableInteraction.caretDoc.includes('abcXdef'), `${scenario.name}: editable table middle insert did not serialize`);
  assert(tableInteraction.caretAfterMiddleInsert === 4, `${scenario.name}: editable table caret offset was not preserved after middle insert`);
  assert(tableInteraction.pipeDoc.includes('pipe \\| value'), `${scenario.name}: editable table did not escape literal pipe`);
  assert(tableInteraction.pipeCaret === 6, `${scenario.name}: editable table caret offset was not preserved after pipe insertion`);
  assert(tableInteraction.pasteDoc.includes('abcM Ndef'), `${scenario.name}: editable table paste did not insert flattened text in the middle`);
  assert(tableInteraction.pasteCaret === 6, `${scenario.name}: editable table paste caret offset was not preserved`);
  assert(!tableInteraction.compositionDocDuring.includes('| é |'), `${scenario.name}: editable table serialized during composition`);
  assert(tableInteraction.compositionDocAfter.includes('| é |'), `${scenario.name}: editable table did not serialize after compositionend`);
  assert(tableInteraction.alignDoc.includes('| :---: |'), `${scenario.name}: editable table alignment control did not serialize center alignment`);
  assert(tableInteraction.afterAddRows > tableInteraction.beforeRows, `${scenario.name}: editable table add-row did not serialize`);
  assert(tableInteraction.afterDeleteRows === tableInteraction.beforeRows, `${scenario.name}: editable table delete-row did not serialize`);
  assert(tableInteraction.addedColumn, `${scenario.name}: editable table add-column did not serialize`);
  assert(tableInteraction.deletedColumn, `${scenario.name}: editable table delete-column did not serialize`);
  assert(tableInteraction.activeCellAfterMutation, `${scenario.name}: editable table did not restore focus after mutation`);
  assert(tableInteraction.afterTabEndRows > tableInteraction.beforeTabEndRows, `${scenario.name}: Tab at final cell did not append a row`);
  assert(tableInteraction.tabEndFocus.col === '0', `${scenario.name}: Tab at final cell did not focus first cell of appended row`);
  assert(tableInteraction.contextVisible, `${scenario.name}: editable table context menu did not open`);
  assert(tableInteraction.afterContextRows > tableInteraction.beforeContextRows, `${scenario.name}: editable table context-menu row insertion did not serialize`);

  await page.evaluate(() => (window as any).__piclawMarkdownHarness.reset());
  await page.waitForTimeout(80);

  const initialDocMatches = await page.evaluate(() => {
    const harness = (window as any).__piclawMarkdownHarness;
    return harness.doc() === harness.source;
  });
  assert(initialDocMatches, `${scenario.name}: rendered preview changed raw Markdown source`);

  await page.evaluate(() => {
    const harness = (window as any).__piclawMarkdownHarness;
    const event = new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 });
    harness.view.contentDOM.dispatchEvent(event);
  });
  assert(await page.evaluate(() => (window as any).__piclawMarkdownHarness.isFrozen()), `${scenario.name}: pointerdown did not freeze preview reveal`);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 })));
  await page.waitForTimeout(150);
  assert(!await page.evaluate(() => (window as any).__piclawMarkdownHarness.isFrozen()), `${scenario.name}: pointerup did not release preview freeze`);

  const tableSelection = await page.evaluate(async () => {
    const harness = (window as any).__piclawMarkdownHarness;
    const sourceText = harness.source as string;
    const tableFrom = sourceText.indexOf('| Left | Center | Right |');
    const tableTo = sourceText.indexOf('\n\nFootnote reference');
    if (tableFrom < 0 || tableTo < 0) throw new Error('table range not found');
    harness.focus();
    harness.setCursor(tableTo + 1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { tableFrom, tableTo };
  });
  await page.keyboard.press('Backspace');
  const selected = await page.evaluate(() => (window as any).__piclawMarkdownHarness.selection());
  assert(selected.from === tableSelection.tableFrom && selected.to === tableSelection.tableTo, `${scenario.name}: Backspace did not select table atomically`);

  const finalDocMatches = await page.evaluate(() => {
    const harness = (window as any).__piclawMarkdownHarness;
    return harness.doc() === harness.source;
  });
  assert(finalDocMatches, `${scenario.name}: browser interactions changed raw Markdown source`);

  const viewportOk = await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement | null;
    return !!scroller && scroller.clientWidth <= window.innerWidth;
  });
  assert(viewportOk, `${scenario.name}: editor scroller exceeds viewport width`);
}

async function main() {
  const entryPath = writeHarness();
  await buildHarness(entryPath);

  const server = serveHarness();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[browser:${message.type()}] ${message.text()}`);
    });
    for (const scenario of scenarios) {
      await runScenario(page, server.url.href, scenario);
      console.log(`[markdown-live-preview-parity] ${scenario.name}: ok`);
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
}

await main();
