import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit, type Browser, type Page } from 'playwright';

// Real browser DOM, actual production renderers/copy handlers, no live server.
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const repo = resolve(import.meta.dir, '../../..');
let browser: Browser;
let bundle = '';

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  const built = await Bun.build({
    entrypoints: ['svg-test-entry'], target: 'browser', format: 'iife',
    plugins: [{ name: 'svg-test', setup(build) {
      build.onResolve({ filter: /^svg-test-entry$/ }, () => ({ path: 'entry', namespace: 'svg-test' }));
      build.onLoad({ filter: /.*/, namespace: 'svg-test' }, () => ({ loader: 'ts', contents: `
        import { classicSvgTest } from ${JSON.stringify(resolve(repo, 'runtime/web/src/components/post.ts'))};
        import { renderThinkingMarkdown as classicThinking } from ${JSON.stringify(resolve(repo, 'runtime/web/src/markdown.ts'))};
        import { sanitizeSvgImage, SVG_IMAGE_LIMITS } from ${JSON.stringify(resolve(repo, 'runtime/web/src/utils/svg-images.ts'))};
        import { initTheme } from ${JSON.stringify(resolve(repo, 'runtime/web/src/ui/theme.ts'))};
        import { WEB_THEME_PRESETS } from ${JSON.stringify(resolve(repo, 'runtime/src/core/ui-theme-catalogue.ts'))};
        import { selectLocalTheme } from ${JSON.stringify(resolve(repo, 'runtime/test/web/fixtures/select-theme.ts'))};
        import { renderMermaidDiagrams as classicMermaid } from ${JSON.stringify(resolve(repo, 'runtime/web/src/markdown.ts'))};
        Object.assign(window, { svgTest: { ...classicSvgTest, classicThinking, sanitizeSvgImage, initTheme,selectLocalTheme,presets:WEB_THEME_PRESETS,classicMermaid,limits: SVG_IMAGE_LIMITS } });
      ` }));
      build.onResolve({ filter: /^#editor-vendor\/codemirror$/ }, () => ({ path: resolve(repo, 'runtime/extensions/viewers/editor/vendor/codemirror.js') }));
      build.onLoad({ filter: /\/web\/src\/components\/post\.ts$/ }, (args) => ({ loader: 'ts', contents: readFileSync(args.path, 'utf8') + '\nexport const classicSvgTest = { classic: renderMarkdown, enhanceCodeBlocks };' }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.join('\n'));
  bundle = await built.outputs[0].text();
  browser = await (process.env.PICLAW_OPTIONAL_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page, requests: string[], dialogs: string[]) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  const requests: string[] = [], dialogs: string[] = [];
  await page.route('**/*', r => { requests.push(r.request().url()); return r.abort(); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  try {
    await page.setContent('<!doctype html><html><body><button id="focus">Focus sentinel</button><main id="post" style="width:280px"></main></body></html>');
    await page.evaluate(() => { const values=new Map<string,string>();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}}); });
    await page.addStyleTag({ content: readFileSync(resolve(repo, 'runtime/web/src/styles/svg-images.css'), 'utf8') });
    await page.addScriptTag({ content: readFileSync(resolve(repo, 'node_modules/marked/lib/marked.umd.js'), 'utf8') });
    await page.addScriptTag({ content: bundle });
    await run(page, requests, dialogs);
    expect(dialogs).toEqual([]);
    expect(requests).toEqual([]);
    expect(page.url()).toBe('about:blank');
  } finally { await page.close(); }
}

const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><title>A &amp; B</title><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="clip"><rect width="600" height="300"/></clipPath></defs><g clip-path="url(#clip)"><rect width="600" height="300" fill="url(#paint)" onload="alert(1)" style="fill:url(https://bad.invalid)"/><text x="5" y="20">Hello</text></g></svg>\n';

for (const skin of ['classic']) {
  browserTest(`${skin}: disabled SVG-fence sanitization restores trusted inline interaction`, async () => {
    await fixture(async page => {
      const result = await page.evaluate((skin) => {
        const api = (window as any).svgTest, root = document.querySelector('#post')!;
        (window as any).__PICLAW_SANITIZE_SVG_FENCES__ = false;
        root.innerHTML = api[skin]('```svg\n<svg viewBox="0 0 20 20"><rect id="interactive" width="20" height="20" onclick="this.setAttribute(\'data-clicked\', \'yes\')"/></svg>\n```', null);
        const rect = root.querySelector('#interactive') as SVGRectElement | null;
        rect?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
          imageCount: root.querySelectorAll('img').length,
          svgCount: root.querySelectorAll('svg').length,
          clicked: rect?.getAttribute('data-clicked'),
        };
      }, skin);
      expect(result).toEqual({ imageCount: 0, svgCount: 1, clicked: 'yes' });
    });
  }, 30_000);

  browserTest(`${skin}: safe image, label, layout, keyboard source copy and rerender (029,005,006,007)`, async () => {
    await fixture(async page => {
      const result = await page.evaluate(({ skin, source }) => {
        const api = (window as any).svgTest, root = document.querySelector('#post')!;
        (document.querySelector('#focus') as HTMLElement).focus();
        const output = api[skin]('```svg\n' + source + '```', null);
        root.innerHTML = output;
        const modelSvgCount = root.querySelectorAll('svg').length;
        const cleanup = api.enhanceCodeBlocks(root);
        (window as any).svgCleanup = cleanup;
        document.execCommand = (command) => {
          if (command !== 'copy') return false;
          const data = new DataTransfer();
          document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
          (window as any).copied = data.getData('text/plain') || (document.activeElement as HTMLTextAreaElement)?.value;
          return true;
        };
        const image = root.querySelector('img')!;
        return { modelSvgCount, label: image.alt, clean: atob(image.src.split(',')[1]), focus: document.activeElement?.id };
      }, { skin, source: safe });
      expect(result.modelSvgCount).toBe(0);
      expect(result.label).toBe('A & B'); expect(result.focus).toBe('focus');
      expect(result.clean).not.toMatch(/onload|style=|https:\/\/bad/);
      expect(result.clean).toContain('url(#paint)'); expect(result.clean).toContain('url(#clip)');
      await page.waitForFunction(() => (document.querySelector('#post img') as HTMLImageElement)?.naturalWidth > 0);
      const box = await page.locator('#post img').boundingBox();
      expect(box!.width).toBeLessThanOrEqual(280); expect(box!.width / box!.height).toBeCloseTo(2, 1);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { (document.querySelector('#post') as HTMLElement).style.width = '900px'; });
      const desktop = await page.locator('#post img').boundingBox();
      expect(desktop!.width).toBeLessThanOrEqual(900); expect(desktop!.width / desktop!.height).toBeCloseTo(2, 1);
      await page.locator('summary').focus(); await page.keyboard.press('Enter');
      const button = page.locator('.post-code-copy-btn');
      await button.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => (window as any).copied !== undefined);
      expect(await page.evaluate(() => (window as any).copied)).toBe(safe);
      const rerender = await page.evaluate(({ skin, source }) => {
        const api = (window as any).svgTest, root = document.querySelector('#post')!;
        (window as any).svgCleanup();
        root.innerHTML = api[skin]('```svg\n' + source.slice(0, -8), null);
        const incompleteImages = root.querySelectorAll('img').length;
        for (let i = 0; i < 3; i++) root.innerHTML = api[skin]('```svg\n' + source + '```', null);
        const cleanup = api.enhanceCodeBlocks(root);
        const counts = { incompleteImages, images: root.querySelectorAll('img').length, code: root.querySelectorAll('pre code').length, buttons: root.querySelectorAll('.post-code-copy-btn, .code-block__copy').length };
        cleanup(); return counts;
      }, { skin, source: safe });
      expect(rerender).toEqual({ incompleteImages: 0, images: 1, code: 1, buttons: 1 });
    });
  }, 30_000);

  browserTest(`${skin}: reject hazards and malformed SVG; keep fallback and unrelated paths (001,002,004)`, async () => {
    await fixture(async (page) => {
      const outcomes = await page.evaluate((skin) => {
        const api = (window as any).svgTest, root = document.querySelector('#post')!;
        const cases = [
          '<svg><script>document.querySelector("#focus").textContent="BAD";alert(1)</script></svg>',
          '<svg><foreignObject><iframe src="https://bad.invalid"/></foreignObject></svg>',
          '<svg><image href="https://bad.invalid"/></svg>', '<svg><use href="#loop" id="loop"/></svg>',
          '<svg><animate attributeName="href" to="https://bad.invalid"/></svg>',
          '<svg><style>@import "https://bad.invalid";</style></svg>',
          '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://bad.invalid">]><svg>&x;</svg>',
          '<?xml-stylesheet href="https://bad.invalid"?><svg/>', '<svg><path></svg>',
          '<x:svg xmlns:x="http://www.w3.org/2000/svg"/>', '<svg><g xmlns="http://www.w3.org/1999/xhtml"/></svg>',
          '<svg xmlns=""/>', '<svg xmlns="http://www.w3.org/2000/svg"><g xmlns=""/></svg>',
          '<svg><g id="same"/><g id="same"/></svg>', '<svg><svg/></svg>',
        ];
        const rows = cases.map(source => {
          root.innerHTML = api[skin]('```svg\n' + source + '\n```', null);
          return { code: root.querySelector('pre code')?.textContent, image: root.querySelectorAll('img').length, svg: root.querySelectorAll('svg').length, expected: source+'\n' };
        });
        root.innerHTML = api[skin]('<svg onload="alert(1)"><script>alert(2)</script></svg>', null);
        const rawSvg = root.querySelectorAll('svg,script').length;
        root.innerHTML = api[skin]('```xml\n<svg/>\n```', null);
        const otherFence = { images: root.querySelectorAll('img').length, code: root.querySelector('code')?.textContent };
        root.innerHTML = api[skin]('````markdown\n```svg\n<svg/>\n```\n````', null);
        const nestedImages = root.querySelectorAll('img').length;
        root.innerHTML = api[skin]('```mermaid\ngraph LR; A-->B\n```', null);
        const mermaid = root.querySelectorAll('.mermaid-container').length;
        return { rows, rawSvg, otherFence, nestedImages, mermaid, sentinel: document.querySelector('#focus')?.textContent };
      }, skin);
      for (const row of outcomes.rows) { expect(row.code).toBe(row.expected); expect(row.image).toBe(0); expect(row.svg).toBe(0); }
      expect(outcomes.rawSvg).toBe(0); expect(outcomes.otherFence.images).toBe(0); expect(outcomes.otherFence.code).toContain('<svg/>');
      expect(outcomes.nestedImages).toBe(0); expect(outcomes.mermaid).toBe(1); expect(outcomes.sentinel).toBe('Focus sentinel');
    });
  }, 30_000);
}

browserTest('shared sanitizer: root/descendant attributes, reference restrictions and dimension cap', async () => {
  await fixture(async page => {
    const result = await page.evaluate(() => {
      const api = (window as any).svgTest;
      const source = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 6000 3000" onload="alert(1)" style="background:url(https://bad.invalid)" href="javascript:alert(2)" fill="url(https://bad.invalid)"><rect width="6000" height="3000" xlink:href="https://bad.invalid" onclick="alert(3)" fill="u&#114;l(https://bad.invalid)" stroke="url(#missing)"/><text>✓</text></svg>';
      const image = api.sanitizeSvgImage(source);
      const clean = new DOMParser().parseFromString(atob(image.src.split(',')[1]), 'image/svg+xml');
      return { clean: atob(image.src.split(',')[1]), label: image.label, width: clean.documentElement.getAttribute('width'), height: clean.documentElement.getAttribute('height'), uppercase: api.classic('```SVG\n<svg/>\n```', null).includes('model-svg-image') };
    });
    expect(result.clean).not.toMatch(/bad.invalid|onload|onclick|style=|href=|javascript|missing/);
    expect(result.width).toBe('2048'); expect(result.height).toBe('1024'); expect(result.label).toBe('Model-generated SVG'); expect(result.uppercase).toBe(true);
  });
});

browserTest('limits reject before parsing bytes and at node/depth boundaries (003)', async () => {
  await fixture(async page => {
    const results = await page.evaluate(() => {
      const api = (window as any).svgTest, limits = api.limits;
      const outcomes: boolean[] = [];
      const bytes = (n: number) => '<svg><!--' + 'x'.repeat(n - '<svg><!----></svg>'.length) + '--></svg>';
      for (const n of [limits.bytes-1, limits.bytes, limits.bytes+1]) outcomes.push(!!api.sanitizeSvgImage(bytes(n)));
      const nodes = (n: number) => '<svg>' + '<g/>'.repeat(n-1) + '</svg>';
      for (const n of [limits.nodes-1, limits.nodes, limits.nodes+1]) outcomes.push(!!api.sanitizeSvgImage(nodes(n)));
      const depth = (n: number) => '<svg>' + '<g>'.repeat(n-1) + '</g>'.repeat(n-1) + '</svg>';
      for (const n of [limits.depth-1, limits.depth, limits.depth+1]) outcomes.push(!!api.sanitizeSvgImage(depth(n)));
      const original = DOMParser.prototype.parseFromString;
      let xmlCalls = 0;
      DOMParser.prototype.parseFromString = function(...args) { xmlCalls++; return original.apply(this, args); };
      try { api.sanitizeSvgImage('x'.repeat(limits.bytes+1)); api.sanitizeSvgImage('✓'.repeat(limits.bytes)); }
      finally { DOMParser.prototype.parseFromString = original; }
      const skinBounds = ['classic'].map(skin => {
        const root=document.querySelector('#post')!;
        return [bytes(limits.bytes+1), nodes(limits.nodes+1), depth(limits.depth+1)].map(source => {
          root.innerHTML=api[skin]('```svg\n'+source+'\n```',null);
          return root.querySelectorAll('img,svg').length === 0 && root.querySelector('code')?.textContent === source+'\n';
        });
      });
      return { outcomes, xmlCalls, skinBounds };
    });
    expect(results.outcomes).toEqual([true,true,false,true,true,false,true,true,false]);
    expect(results.xmlCalls).toBe(0);
    expect(results.skinBounds).toEqual([[true,true,true],[true,true,true]]);
  });
});

browserTest('benchmark and bounded-cache rerenders avoid repeated XML parsing', async () => {
  await fixture(async page => {
    const result = await page.evaluate(() => {
      const api = (window as any).svgTest;
      const source = (n: number, label: string) => '<svg viewBox="0 0 500 250"><title>'+label+'</title>'+'<rect x="1" y="1" width="10" height="10" fill="#123456"/>'.repeat(n)+'</svg>';
      const times: Record<string, number> = {};
      for (const n of [20, 200, 1500]) {
        const samples: number[]=[];
        for(let i=0;i<15;i++){const text=source(n, 'fresh-'+n+'-'+i),start=performance.now();api.sanitizeSvgImage(text);samples.push(performance.now()-start);}
        samples.sort((a,b)=>a-b); times['cold-'+n+'-median-ms']=samples[7]; times['cold-'+n+'-p95-ms']=samples[14];
      }
      const stable = source(200, 'stable'); api.sanitizeSvgImage(stable);
      const original = DOMParser.prototype.parseFromString; let calls=0;
      DOMParser.prototype.parseFromString=function(...args){calls++;return original.apply(this,args);};
      const start=performance.now();try{for(let i=0;i<1000;i++)api.sanitizeSvgImage(stable);}finally{DOMParser.prototype.parseFromString=original;}
      times['cached-1000-total-ms']=performance.now()-start;
      return { calls, times };
    });
    expect(result.calls).toBe(0);
    console.log('SVG_BENCHMARK '+JSON.stringify({engine:process.env.PICLAW_OPTIONAL_BROWSER||'chromium',...result.times}));
  });
});

for (const skin of ['classic']) {
  browserTest(`${skin}: exact CRLF/entity source, fallback copy and Markdown context`, async () => {
    await fixture(async page => {
      const source = '<svg><title>&lt;label&gt;</title>\r\n<rect width="10" height="10"/></svg>\r\n';
      const result = await page.evaluate(({ skin, source }) => {
        const api=(window as any).svgTest, root=document.querySelector('#post')!;
        const text='Before [link][target]\n\n```svg\r\n'+source+'```\r\n\nAfter\n\n[target]: https://example.com\n';
        root.innerHTML=api[skin](text,null);
        const image=root.querySelector('img')!;
        const first={label:image.alt, linkText:root.querySelector('a')?.textContent, text:root.textContent};
        const cleanup=api.enhanceCodeBlocks(root);
        (window as any).svgCleanup=cleanup;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).copied = text; } } });
        document.execCommand=(command)=>{if(command!=='copy')return false;const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));(window as any).copied=data.getData('text/plain')||(document.activeElement as HTMLTextAreaElement)?.value;return true;};
        return first;
      },{skin,source});
      expect(result.label).toBe('<label>'); expect(result.linkText).toBe('link'); expect(result.text).toContain('After');
      await page.locator('summary').click(); await page.locator('.post-code-copy-btn').click();
      await page.waitForFunction(()=>(window as any).copied!==undefined);
      expect(await page.evaluate(()=>(window as any).copied)).toBe(source);
      const fallback='<svg><script>alert(1)</script></svg>\n';
      await page.evaluate(({skin,source})=>{const api=(window as any).svgTest,root=document.querySelector('#post')!;(window as any).svgCleanup();delete (window as any).copied;root.innerHTML=api[skin]('```svg\n'+source+'```',null);(window as any).svgCleanup=api.enhanceCodeBlocks(root);},{skin,source:fallback});
      await page.locator('.post-code-copy-btn').click();
      await page.waitForFunction(()=>(window as any).copied!==undefined);
      expect(await page.evaluate(()=>(window as any).copied)).toBe(fallback);
      const failure = await page.evaluate(async () => {
        document.execCommand = () => false;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('fixture clipboard denied'); } } });
        const btn = document.querySelector<HTMLButtonElement>('.post-code-copy-btn, .code-block__copy')!;
        btn.click();
        await new Promise(resolve => setTimeout(resolve, 20));
        return { label: btn.getAttribute('aria-label'), buttons: document.querySelectorAll('.post-code-copy-btn, .code-block__copy').length };
      });
      expect(failure.label).toBe('Copy failed'); expect(failure.buttons).toBe(1);
      await page.evaluate(()=>(window as any).svgCleanup());
    });
  },30_000);
}

browserTest('cache is bounded, invalid results are reused and non-SVG messages do not parse XML', async()=>{
  await fixture(async page=>{
    const result=await page.evaluate(()=>{
      const api=(window as any).svgTest;
      const original=DOMParser.prototype.parseFromString;let xml=0;
      DOMParser.prototype.parseFromString=function(...args){if(args[1]==='image/svg+xml')xml++;return original.apply(this,args);};
      try{
        api.classic('ordinary **message**',null);const ordinary=xml;
        const invalid='<svg><unknown cache="fixture"/></svg>';api.sanitizeSvgImage(invalid);api.sanitizeSvgImage(invalid);const invalidCalls=xml;
        for(let i=0;i<12;i++)api.sanitizeSvgImage('<svg><title>evict-'+i+'</title></svg>');
        const before=xml;api.sanitizeSvgImage(invalid);
        return {ordinary,invalidCalls,reparsed:xml-before};
      }finally{DOMParser.prototype.parseFromString=original;}
    });
    expect(result).toEqual({ordinary:0,invalidCalls:1,reparsed:1});
  });
});

for (const skin of ['classic']) browserTest(`${skin}: SVG defaults, explicit paints, live palettes and preview surfaces agree`,async()=>{
  await fixture(async(page)=>{
    await page.emulateMedia({colorScheme:'dark'});
    const result=await page.evaluate((skin)=>{
      const api=(window as any).svgTest,post=document.getElementById('post')!;
      api.initTheme();api.selectLocalTheme('paper');
      const source='<svg viewBox="0 0 240 120"><title>Theme defaults</title><rect x="5" y="5" width="40" height="40"/><rect x="60" y="5" width="40" height="40" fill="currentColor"/><rect x="110" y="5" width="40" height="40" fill="#e04020"/><rect x="160" y="5" width="40" height="40" fill="var(--svg-accent)"/><text x="8" y="80">Theme text</text></svg>\n';
      post.innerHTML=api[skin]('\x60\x60\x60svg\n'+source+'\x60\x60\x60',null);
      (window as any).svgCleanup=api.enhanceCodeBlocks(post);
      const img=post.querySelector('img')!;
      const parse=()=>new DOMParser().parseFromString(atob(img.src.split(',')[1]),'image/svg+xml');
      const probe=document.createElement('span');document.body.append(probe);const color=(name:string)=>{probe.style.color='var('+name+')';return getComputedStyle(probe).color;};
      const failures:string[]=[];
      for(const preset of api.presets){api.selectLocalTheme(preset.id);const doc=parse();if(doc.documentElement.getAttribute('color')!==color('--text-primary'))failures.push(preset.id+' foreground');if(doc.documentElement.getAttribute('fill')!=='currentColor')failures.push('default');if(doc.querySelectorAll('rect')[2].getAttribute('fill')!=='#e04020')failures.push('authored changed');if(doc.querySelectorAll('rect')[3].getAttribute('fill')!==color('--accent-color'))failures.push(preset.id+' accent');}
      probe.remove();api.selectLocalTheme('paper');return {failures,source,src:img.src,paperMode:document.documentElement.dataset.theme};
    },skin);
    expect(result.failures).toEqual([]);expect(result.paperMode).toBe('light');
    await page.locator('.model-svg-surface').selectOption('dark');
    const dark=await page.locator('.model-svg-image').getAttribute('src');expect(dark).not.toBe(result.src);
    await page.evaluate(()=>(window as any).svgTest.selectLocalTheme('as400'));
    expect(await page.locator('.model-svg-image').getAttribute('src')).toBe(dark);
    await page.locator('.model-svg-surface').selectOption('theme');
    expect(await page.locator('.model-svg-image').getAttribute('src')).not.toBe(dark);
    await page.locator('.model-svg-surface').selectOption('light');
    expect(await page.locator('.model-svg-image').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
    // Cleanup removes listeners; detached content cannot keep parsing on theme changes.
    const before=await page.locator('.model-svg-image').getAttribute('src');await page.evaluate(()=>(window as any).svgCleanup());
    await page.evaluate(()=>(window as any).svgTest.selectLocalTheme('synthwave-84-full'));expect(await page.locator('.model-svg-image').getAttribute('src')).toBe(before);
  });
},30000);

for(const skin of ['classic']) browserTest(`${skin}: actual Mermaid SVG follows selected palette, not OS, without rerender`,async()=>{
  await fixture(async(page)=>{
    await page.addScriptTag({content:readFileSync(resolve(repo,'runtime/web/static/common/js/vendor/pele.js'),'utf8')});
    await page.emulateMedia({colorScheme:'dark'});
    const result=await page.evaluate(async(skin)=>{
      const api=(window as any).svgTest,post=document.getElementById('post')!;
      api.initTheme();api.selectLocalTheme('paper');post.innerHTML=api[skin]('\x60\x60\x60mermaid\ngraph LR\nA[Input] --> B[Output]\n\x60\x60\x60',null);
      await api[skin+'Mermaid'](post);
      const svg=post.querySelector('svg')!;if(!svg)throw Error(post.innerHTML);const text=svg.querySelector('text')!;const initial=getComputedStyle(text).fill;
      api.selectLocalTheme('as400');const changed=getComputedStyle(text).fill;
      const probe=document.createElement('span');probe.style.color='var(--text-primary)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();
      return {initial,changed,expected,same:svg===post.querySelector('svg'),source:svg.outerHTML,labels:svg.textContent};
    },skin);
    expect(result.initial).not.toBe(result.changed);expect(result.changed).toBe(result.expected);expect(result.same).toBe(true);expect(result.labels).toContain('Input');expect(result.source).toContain('--text-primary');
  });
},30000);

for(const skin of ['classic']) browserTest(`${skin}: rasterized SVG defaults and authored paints survive surface/import changes`,async()=>{
 await fixture(async(page)=>{
  await page.evaluate((skin)=>{
   const api=(window as any).svgTest,post=document.getElementById('post')!;api.initTheme();api.selectLocalTheme('paper');
   post.innerHTML=api[skin]('\x60\x60\x60svg\n<svg width="120" height="40"><rect width="40" height="40"/><rect x="40" width="40" height="40" fill="#ff3300"/><rect x="80" width="40" height="40" fill="var(--svg-accent)"/></svg>\n\x60\x60\x60',null);
   (window as any).svgCleanup=api.enhanceCodeBlocks(post);
  },skin);
  const pixels=()=>page.evaluate(async()=>{const image=document.querySelector<HTMLImageElement>('.model-svg-image')!;await image.decode();const canvas=document.createElement('canvas');canvas.width=120;canvas.height=40;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return [20,60,100].map(x=>Array.from(c.getImageData(x,20,1,1).data));});
  const light=await pixels();expect(light[1]).toEqual([255,51,0,255]);
  await page.evaluate(()=>(window as any).svgTest.selectLocalTheme('as400'));const green=await pixels();expect(green[0][0]).toBe(0);expect(green[0][2]).toBe(0);expect(green[1]).toEqual(light[1]);expect(green[0]).not.toEqual(light[0]);
  await page.locator('.model-svg-surface').selectOption('light');expect((await pixels())[0]).toEqual([24,33,43,255]);
  await page.evaluate(()=>{const a=(window as any).svgTest;a.selectLocalTheme('synthwave-84-full');});
  await page.locator('.model-svg-surface').selectOption('theme');
  const dir=resolve(repo,'.artifacts/svg-themes');mkdirSync(dir,{recursive:true});
  await page.locator('#post').screenshot({path:resolve(dir,`${process.env.PICLAW_OPTIONAL_BROWSER||'chromium'}-${skin}-theme-svg.png`)});
  await page.evaluate(()=>(window as any).svgCleanup());
 });
},30000);

browserTest('theme tokens are a finite safe paint set; authored root colours and gradient references win',async()=>{
 await fixture(async(page)=>{
  const result=await page.evaluate(()=>{const a=(window as any).svgTest;a.initTheme();a.selectLocalTheme('as400');const src='<svg color="#123456" fill="#abcdef"><defs><linearGradient id="g"><stop stop-color="var(--svg-accent)"/></linearGradient></defs><rect fill="url(#g)"/><path stroke="var(--arbitrary)"/><circle fill="var(--svg-accent, url(https://bad.invalid))"/></svg>';const out=a.sanitizeSvgImage(src);const xml=atob(out.src.split(',')[1]);return {xml,docColor:new DOMParser().parseFromString(xml,'image/svg+xml').documentElement.getAttribute('color')};});
  expect(result.docColor).toBe('#123456');expect(result.xml).toContain('fill="#abcdef"');expect(result.xml).toContain('url(#g)');expect(result.xml).not.toMatch(/var\(|bad.invalid|arbitrary/);
 });
});

for(const skin of ['classic'])browserTest(`${skin}: literal fenced/inline bytes and actual copy handlers survive entity/tag syntax`,async()=>{
  await fixture(async page=>{
    const result=await page.evaluate(async skin=>{
      const api=(window as any).svgTest,root=document.querySelector('#post')!;
      let copied:string|undefined;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});
      document.execCommand=(command)=>{if(command!=='copy')return false;copied=(document.activeElement as HTMLTextAreaElement)?.value;return true;};
      const code='if (a < b && c > d) return "&lt;literal&gt; &amp; &#39;";';
      const nested='```mermaid\nnot a real diagram <b> &lt;x&gt;\n```';
      const cases=[
        {source:'```js\n'+code+'\n```',expected:code+'\n'},
        {source:'~~~unknown\n<code><b>literal</b></code> &lt;&amp;\n~~~',expected:'<code><b>literal</b></code> &lt;&amp;\n'},
        {source:'````markdown\n'+nested+'\n````',expected:nested+'\n'},
        {source:'```js\n'+code,expected:code+'\n'},
        {source:'> ```js\n> '+code+'\n> ```',expected:code+'\n'},
      ];
      const checks=[];
      for(const item of cases){
        root.innerHTML=api[skin](item.source,null);
        const node=root.querySelector('pre code')!;
        const text=node?.textContent;
        const cleanup=api.enhanceCodeBlocks(root);
        copied=undefined;(root.querySelector('.post-code-copy-btn') as HTMLElement)?.click();
        for(let i=0;i<20&&copied===undefined;i++)await new Promise(r=>setTimeout(r,5));
        checks.push({text,copied,expected:item.expected,diagrams:root.querySelectorAll('.mermaid-container').length});cleanup();
        root.innerHTML=api[skin+'Thinking'](item.source);
        checks.push({text:root.querySelector('pre code')?.textContent,expected:item.expected,diagrams:root.querySelectorAll('.mermaid-container').length});
      }
      const inline='a < b && c > d &lt;x&gt; &amp;';
      root.innerHTML=api[skin]('`'+inline+'`',null);const inlineText=root.querySelector('code')?.textContent;
      root.innerHTML=api[skin]('<script>window.__literalExploit=1</script><img src="javascript:alert(1)" onerror="window.__literalExploit=2"><span onclick="window.__literalExploit=3" style="color:red" title="safe">Safe</span>',null);
      return {checks,inline,inlineText,unsafe:!!root.querySelector('script,[onclick],[onerror],[style],[src^="javascript:"]'),exploit:(window as any).__literalExploit??null};
    },skin);
    expect(result.inlineText).toBe(result.inline);expect(result.unsafe).toBe(false);expect(result.exploit).toBeNull();
    for(const check of result.checks){expect(check.text).toBe(check.expected);if('copied' in check)expect(check.copied).toBe(check.expected);expect(check.diagrams).toBe(0);}
  });
},30000);

for(const skin of ['classic'])browserTest(`${skin}: language fences are projected only from real parser code tokens`,async()=>{
  await fixture(async page=>{
    const result=await page.evaluate(skin=>{
      const api=(window as any).svgTest,root=document.querySelector('#post')!,calls:any[]=[];
      (window as any).katex={renderToString:(text:string,options:any)=>{calls.push({text,display:options.displayMode});return '<span class="katex">Rendered math</span>';}};
      const math='\\frac{a}{b} < x';
      root.innerHTML=api[skin]('```math\n'+math+'\n```',null);const mathCount=root.querySelectorAll('.katex').length;
      root.innerHTML=api[skin+'Thinking']('```math\n'+math+'\n```');const literal=root.querySelector('code')?.textContent;
      const diagram='graph TD\nA-->B';root.innerHTML=api[skin]('```mermaid\n'+diagram+'\n```',null);
      const containers=root.querySelectorAll('[data-mermaid]');return {calls,mathCount,literal,math,diagrams:containers.length,diagram,source:atob(containers[0]?.getAttribute('data-mermaid')??'')};
    },skin);
    expect(result.calls).toEqual([{text:result.math,display:true}]);expect(result.mathCount).toBe(1);expect(result.literal).toBe(result.math+'\n');expect(result.diagrams).toBe(1);expect(result.source).toBe(result.diagram);
  });
},30000);
