import { beforeAll, afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';
import { DIAGRAM_CORPUS } from './fixtures/diagram-corpus';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const repo = resolve(import.meta.dir, '../../..');
let browser: Browser, bundle = '';
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const result = await Bun.build({ entrypoints: ['diagram-tests'], target: 'browser', format: 'iife', plugins: [{ name: 'diagram-tests', setup(build) {
    build.onResolve({ filter: /^diagram-tests$/ }, () => ({ path: 'entry', namespace: 'diagram-tests' }));
    build.onLoad({ filter: /.*/, namespace: 'diagram-tests' }, () => ({ loader: 'ts', contents: `
      import { renderMermaidDiagrams as classic } from ${JSON.stringify(resolve(repo, 'runtime/web/src/markdown.ts'))};
      import { sanitizeDiagramSvg } from ${JSON.stringify(resolve(repo, 'runtime/web/src/ui/diagram-sanitizer.ts'))};
      import { initTheme, setThemeModePreference } from ${JSON.stringify(resolve(repo, 'runtime/web/src/ui/theme.ts'))};
      import { WEB_THEME_PRESETS } from ${JSON.stringify(resolve(repo, 'runtime/src/core/ui-theme-catalogue.ts'))};
      import { selectLocalTheme } from ${JSON.stringify(resolve(repo, 'runtime/test/web/fixtures/select-theme.ts'))};
      import DOMPurify from 'dompurify';
      window.diagramsTest = { classic, sanitizeDiagramSvg, initTheme, selectLocalTheme, setThemeModePreference, presets: WEB_THEME_PRESETS, DOMPurify };
    ` }));
  } }] });
  if (!result.success) throw Error(result.logs.join('\n'));
  bundle = await result.outputs[0].text();
  browser = await (process.env.PICLAW_OPTIONAL_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>, options: { load?: boolean; loader?: (page: Page) => Promise<void> } = {}) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const requests: string[] = [], dialogs: string[] = [];
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  try {
    await page.setContent('<!doctype html><html><body><button id="focus">Focus</button><main id="post" style="width:280px"></main></body></html>');
    await page.evaluate(() => {
      const values = new Map<string, string>();
      Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
      (window as any).putDiagram = (source: string) => {
        const element = document.createElement('div'); element.className = 'mermaid-container';
        element.dataset.mermaid = btoa(String.fromCharCode(...new TextEncoder().encode(source)));
        document.getElementById('post')!.append(element); return element;
      };
    });
    await page.addScriptTag({ content: bundle });
    if (options.load !== false) await page.addScriptTag({ content: readFileSync(resolve(repo, 'runtime/web/static/common/js/vendor/pele.js'), 'utf8') });
    await options.loader?.(page);
    await run(page);
    expect(dialogs).toEqual([]); expect(requests).toEqual([]); expect(page.url()).toBe('about:blank');
  } finally { await page.close(); }
}

for (const surface of ['classic', 'family']) browserTest(`${surface}: complete Pele corpus survives sanitization, references and repeated rendering`, async () => {
  await fixture(async page => {
    const results = await page.evaluate(async ({ surface, corpus }) => {
      const w = window as any, api = w.diagramsTest, post = document.getElementById('post')!;
      api.initTheme();
      const render = api.classic;
      const options = surface === 'family' ? { rewriteImageSrc: () => null } : {};
      for (const entry of corpus) w.putDiagram(entry.source);
      document.getElementById('focus')!.focus();
      await Promise.all([render(post, options), render(post, options)]);
      const rows = Array.from(post.children, (el: Element, index) => {
        const svg = el.querySelector('svg');
        return { name: corpus[index].name, error: el.querySelector('.mermaid-error')?.textContent, labels: svg?.textContent, width: svg?.getBoundingClientRect().width, pending: el.hasAttribute('data-mermaid'), authored: svg?.outerHTML.includes('#879a39') };
      });
      const before = post.innerHTML; await render(post, options);
      const ids = Array.from(post.querySelectorAll('[id]'), el => el.id);
      const refs = Array.from(post.querySelectorAll('[aria-labelledby],[aria-describedby]')).flatMap(el => [el.getAttribute('aria-labelledby'), el.getAttribute('aria-describedby')].filter(Boolean).flatMap(value => value!.split(/\s+/)));
      return { rows, unchanged: before === post.innerHTML, uniqueIds: ids.length === new Set(ids).size, referencesResolve: refs.every(ref => ids.includes(ref)), controls: post.querySelectorAll('button').length, focus: document.activeElement?.id };
    }, { surface, corpus: DIAGRAM_CORPUS });
    expect(results.unchanged).toBe(true); expect(results.uniqueIds).toBe(true); expect(results.referencesResolve).toBe(true); expect(results.controls).toBe(0); expect(results.focus).toBe('focus');
    for (const [index, row] of results.rows.entries()) {
      expect(row.error).toBeUndefined(); expect(row.pending).toBe(false);
      for (const label of DIAGRAM_CORPUS[index].labels) expect(row.labels).toContain(label);
      expect(row.width).toBeLessThanOrEqual(280);
      if (row.name === 'authored-style') expect(row.authored).toBe(true);
    }
  });
}, 30_000);

for (const surface of ['classic', 'family']) browserTest(`${surface}: live catalogue and imported light/dark palettes recolour the same diagram nodes`, async () => {
  await fixture(async page => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const result = await page.evaluate(async surface => {
      const w = window as any, api = w.diagramsTest, post = document.getElementById('post')!;
      api.initTheme();
      w.putDiagram('flowchart LR\nA[Input] --> B[Output]');
      w.putDiagram('pie title Series\n"One" : 4\n"Two" : 6\n"Three" : 2');
      w.putDiagram('flowchart LR\nA[Authored]\nstyle A fill:#879a39');
      await (api.classic)(post, surface === 'family' ? { rewriteImageSrc: () => null } : {});
      const svgs = Array.from(post.querySelectorAll('svg'));
      const text = svgs[0].querySelector('text')!, node = svgs[0].querySelector('.pele-node rect')!, marker = svgs[0].querySelector('.pele-marker')!;
      const authored = svgs[2].querySelector('.pele-node rect')!;
      const probe = document.createElement('span'); document.body.append(probe);
      const color = (token: string) => { probe.style.color = 'var(' + token + ')'; return getComputedStyle(probe).color; };
      const failures: string[] = [];
      const inspect = (name: string) => {
        if (getComputedStyle(text).fill !== color('--text-primary')) failures.push(name + ' text');
        if (getComputedStyle(node).fill !== color('--bg-secondary')) failures.push(name + ' surface');
        if (getComputedStyle(marker).fill !== color('--text-secondary')) failures.push(name + ' arrow');
        if (getComputedStyle(authored).fill !== 'rgb(135, 154, 57)') failures.push(name + ' authored');
        if (svgs.some((svg, i) => svg !== post.querySelectorAll('svg')[i])) failures.push(name + ' regenerated');
        if (getComputedStyle(svgs[1]).getPropertyValue('--pele-series-1').trim() !== color('--accent-color')) {
          // Custom properties retain CSS syntax; resolve via a paint on a probe instead.
          probe.style.color = 'var(--accent-color)';
          const expected = getComputedStyle(probe).color;
          const seriesProbe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          seriesProbe.setAttribute('fill', 'var(--pele-series-1)'); svgs[1].append(seriesProbe);
          if (getComputedStyle(seriesProbe).fill !== expected) failures.push(name + ' series'); seriesProbe.remove();
        }
      };
      for (const preset of api.presets) { api.selectLocalTheme(preset.id); if (preset.mode === 'auto') for (const mode of ['light', 'dark']) { api.setThemeModePreference(mode); inspect(preset.id + '/' + mode); } else inspect(preset.id); }
      probe.remove(); return { failures, presetCount: api.presets.length, svgCount: svgs.length };
    }, surface);
    expect(result.failures).toEqual([]); expect(result.presetCount).toBeGreaterThan(10); expect(result.svgCount).toBe(3);
  });
}, 30_000);

browserTest('diagram sanitizer removes resources and active content and fails closed when unavailable', async () => {
  await fixture(async page => {
    const result = await page.evaluate(async () => {
      const w = window as any, api = w.diagramsTest;
      const malicious = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><style>@import "https://bad.invalid";</style><foreignObject><iframe src="https://bad.invalid"></iframe></foreignObject><image href="/media/42"/><a href="javascript:alert(1)"><text>Link</text></a><use href="#ref"/><animate attributeName="href" to="https://bad.invalid"/><rect style="fill:url(https://bad.invalid);"/><text>Safe</text></svg>';
      const output = api.sanitizeDiagramSvg(malicious);
      const indirect = api.sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect id="set" style="background-image:image-set(\'/resource.png\' 1x)"/><rect id="webkit" style="background-image:-webkit-image-set(\'/other.png\' 1x)"/></svg>');
      const element = document.createElement('div'); element.innerHTML = output + indirect; document.getElementById('post')!.append(element);
      const sanitize = w.piclawDiagrams.sanitize; w.piclawDiagrams.sanitize = undefined;
      const failed = w.putDiagram('flowchart LR\nA-->B');
      try { await api.classic(document.getElementById('post')); } finally { w.piclawDiagrams.sanitize = sanitize; }
      return { output, indirect, active: element.querySelectorAll('script,style,foreignObject,image,a,use,animate,iframe').length, failed: failed.textContent, svgCount: failed.querySelectorAll('svg').length };
    });
    expect(result.active).toBe(0); expect(result.output).not.toMatch(/onload|href=|https:\/\/bad|\/media\/42/); expect(result.output).toContain('Safe'); expect(result.indirect).not.toContain('image-set'); expect(result.indirect).not.toContain('/resource.png'); expect(result.indirect).not.toContain('/other.png'); expect(result.failed).toContain('Diagram sanitizer is unavailable'); expect(result.svgCount).toBe(0);
  });
}, 30_000);

browserTest('cold loader joins callers, renders the latest streamed bytes and ignores detached placeholders', async () => {
  await fixture(async page => {
    await page.evaluate(() => {
      const w = window as any, append = document.head.append.bind(document.head); w.heldLoads = [];
      document.head.append = (...nodes: (Node | string)[]) => { for (const node of nodes) if (node instanceof HTMLScriptElement && node.src.endsWith('/pele.js')) w.heldLoads.push(node); else append(node); };
      const post = document.getElementById('post')!, el = w.putDiagram('flowchart LR\nA[Old]-->B');
      w.pendingFirst = w.diagramsTest.classic(post); w.pendingSecond = w.diagramsTest.classic(post);
      el.dataset.mermaid = btoa('flowchart LR\nA[Latest]-->B');
      const removed = w.putDiagram('flowchart LR\nC[Removed]-->D'); w.pendingDetached = w.diagramsTest.classic(post); removed.remove(); w.detached = removed;
    });
    await page.addScriptTag({ content: readFileSync(resolve(repo, 'runtime/web/static/common/js/vendor/pele.js'), 'utf8') });
    const result = await page.evaluate(async () => {
      const w = window as any; for (const script of w.heldLoads) script.onload();
      await Promise.all([w.pendingFirst, w.pendingSecond, w.pendingDetached]);
      return { loads: w.heldLoads.length, text: document.getElementById('post')!.textContent, count: document.querySelectorAll('#post svg').length, detached: w.detached.querySelectorAll('svg').length };
    });
    expect(result.loads).toBe(1); expect(result.text).toContain('Latest'); expect(result.text).not.toContain('Old'); expect(result.count).toBe(1); expect(result.detached).toBe(0);
  }, { load: false });
}, 30_000);

browserTest('failed local script load uses the existing error surface and a later diagram can retry', async () => {
  await fixture(async page => {
    const first = await page.evaluate(async () => {
      const w = window as any, append = document.head.append.bind(document.head); w.loads = [];
      document.head.append = (...nodes: (Node | string)[]) => { for (const node of nodes) if (node instanceof HTMLScriptElement && node.src.endsWith('/pele.js')) { w.loads.push(node); queueMicrotask(() => node.onerror(new Event('error'))); } else append(node); };
      const el = w.putDiagram('flowchart LR\nA-->B'); await w.diagramsTest.classic(document.getElementById('post'));
      return el.textContent;
    });
    expect(first).toContain('Mermaid library failed to load');
    await page.addScriptTag({ content: readFileSync(resolve(repo, 'runtime/web/static/common/js/vendor/pele.js'), 'utf8') });
    const count = await page.evaluate(async () => { const w = window as any; w.putDiagram('flowchart LR\nC-->D'); await w.diagramsTest.classic(document.getElementById('post')); return document.querySelectorAll('#post svg').length; });
    expect(count).toBe(1);
  }, { load: false });
}, 30_000);
