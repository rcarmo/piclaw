import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const root = resolve(import.meta.dir, '../..');
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/editor-theme-fixture.ts')],target:'browser',format:'esm',external:['#editor-vendor/codemirror','/static/classic/dist/editor.bundle.js']});
  if (!build.success) throw Error(build.logs.join('\n'));
  const js = await build.outputs[0].text();
  server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req) {
    const url = new URL(req.url);
    if(url.pathname==='/editor-vendor/codemirror.js')return new Response(Bun.file(join(root,'extensions/viewers/editor/vendor/codemirror.js')),{headers:{'content-type':'text/javascript'}});
    if(url.pathname==='/fixture.js') return new Response(js,{headers:{'content-type':'text/javascript'}});
    if(url.pathname.startsWith('/static/')) {
      const file = resolve(root,'web',url.pathname.slice(1));
      if(file.startsWith(root+'/web/static/')&&await Bun.file(file).exists())return new Response(Bun.file(file));
    }
    if(url.pathname==='/')return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/static/${url.searchParams.get('skin')==='visual'?'visual':'classic'}/css/styles.css"><style>html,body{height:100%;margin:0}#editor{height:760px;width:100%;}#blur{position:fixed;top:0;right:0;z-index:100}</style><button id="blur">Blur</button><div id="editor"></div><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><script type="module" src="/fixture.js"></script>`,{headers:{'content-type':'text/html'}});
    if(url.pathname==='/workspace/file/stat')return Response.json({mtime:'fixture'});
    return new Response(null,{status:404});
  }});
},30000);
afterAll(()=>server?.stop(true));

for(const [name,engine] of Object.entries({chromium,webkit}))for(const skin of ['classic','visual'])for(const bundle of [false,true]) {
  browserTest(`${name} ${skin} ${bundle ? 'bundle' : 'source'}: actual editor selections track themes across all modes`,async()=>{
    const browser=await engine.launch();const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
      await page.goto(`${server.url}?skin=${skin}${bundle?'&bundle=1':''}`);await page.waitForFunction(()=>!!(window as any).editorFixture);
      for(const mode of ['preview','raw','text','code','vim','large','diff']){
        await page.evaluate(mode=>(window as any).editorFixture.mount(mode),mode);
        await page.waitForTimeout(200);
        if(mode==='preview')await page.locator('.cm-md-inline-code').waitFor();
        const palettes = await page.evaluate(() => (window as any).editorFixture.presets.map((p:any) => p.id));
        for(const palette of palettes){
          const result=await page.evaluate(({palette,mode})=>{
            const f=(window as any).editorFixture;f.selectLocalTheme(palette);f.select();
            const resolve=(property:string)=>{const p=document.createElement('span');p.style.color=`var(${property})`;document.body.append(p);const value=getComputedStyle(p).color;p.remove();return value;};
            return { views:f.views().map((view:any)=>({native:getComputedStyle(view.contentDOM,'::selection').backgroundColor,nativeText:getComputedStyle(view.contentDOM,'::selection').color,text:getComputedStyle(view.contentDOM).color,bg:getComputedStyle(view.scrollDOM).backgroundColor})),expectedBg:resolve(mode==='preview'?'--bg-primary':'--bg-code'),expectedText:resolve(mode==='preview'?'--text-primary':'--text-code'),expectedSelection:resolve('--selection-background')};
          },{palette,mode});
          for(const v of result.views){
            expect(v.native,`${mode}/${palette} native selection must not double-paint`).toBe('rgba(0, 0, 0, 0)');
            expect(v.nativeText,`${mode}/${palette} native selection must not replace foreground`).toBe(v.text);
            expect(v.bg,`${mode}/${palette} surface`).toBe(result.expectedBg);
            expect(v.text,`${mode}/${palette} foreground`).toBe(result.expectedText);
            const rgb=(s:string)=>s.match(/[\d.]+/g)!.map(Number);
            const base=rgb(v.bg), overlay=rgb(result.expectedSelection), foreground=rgb(v.text);
            const alpha=overlay[3]??1;
            const selected=base.map((c,i)=>c*(1-alpha)+overlay[i]*alpha);
            const luminance=(c:number[])=>c.slice(0,3).map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
            const fg=luminance(foreground),bg=luminance(selected),contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
            if(mode==='preview')expect(contrast,`${palette} selected prose contrast`).toBeGreaterThanOrEqual(4.49);
          }
          if(mode!=='vim'){
            await page.waitForTimeout(20);
            const bg=await page.locator('.cm-selectionBackground').first().evaluate(el=>getComputedStyle(el).backgroundColor);
            expect(bg,`${mode}/${palette} drawn selection`).toBe(result.expectedSelection);
          }
        }
      }
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.mount('preview');f.selectLocalTheme('github-light');f.select();});
      await page.waitForTimeout(200);
      await mkdir(join(root, '../.artifacts/editor-theme'), {recursive:true});
      await page.locator('#editor').screenshot({path:join(root,`../.artifacts/editor-theme/${name}-${skin}-${bundle?'bundle':'source'}-selection.png`)});
      expect(errors).toEqual([]);
    }finally{await browser.close();}
  },180000);
}

for (const [name, engine] of Object.entries({chromium, webkit})) for (const skin of ['classic', 'visual']) {
  browserTest(`${name} ${skin}: live theme changes cover widgets, search, Vim, imports and diff`, async () => {
    const browser = await engine.launch();
    const page = await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    try {
      await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
      await page.goto(`${server.url}?skin=${skin}`);await page.waitForFunction(()=>!!(window as any).editorFixture);
      await page.locator('.cm-md-code-content .tok-keyword').first().waitFor();
      const resolve = async (selector:string,property:string,variable:string,pseudo?:string) => page.evaluate(({selector,property,variable,pseudo})=>{
        const el=document.querySelector(selector)!;
        const probe=document.createElement('span');probe.style.color=`var(${variable})`;document.body.append(probe);
        const expected=getComputedStyle(probe).color;probe.remove();
        return {actual:getComputedStyle(el,pseudo).getPropertyValue(property),expected};
      },{selector,property,variable,pseudo});
      for(const palette of ['github-light','solarized-light','dracula','lumon','monokai']) {
        await page.evaluate(p=>(window as any).editorFixture.selectLocalTheme(p),palette);
        for(const [selector,variable] of [['.cm-md-code-content .tok-keyword','--syntax-keyword'],['.cm-md-code-content .tok-string','--syntax-string'],['.cm-md-code-content .tok-number','--syntax-number'],['.cm-md-code-content .tok-comment','--syntax-comment'],['.cm-md-callout-title','--warning-color'],['.cm-md-inline-code','--text-code']]) {
          const r=await resolve(selector,'color',variable); expect(r.actual,palette+'/'+selector).toBe(r.expected);
        }
        // Inline/fenced/table code use the code surface, not a hardcoded dark fill.
        for(const selector of ['.cm-md-inline-code','.cm-md-code-line']) {
          const r=await resolve(selector,'background-color','--bg-code');expect(r.actual).toBe(r.expected);
        }
      }
      // A browser-drawn selection should keep highlighted token foregrounds too.
      await page.evaluate(()=>(window as any).editorFixture.mount('code'));
      await page.waitForTimeout(100);
      const selectedToken=await page.evaluate(()=>{
        const token=document.querySelector('.cm-content .tok-keyword')!;
        return {normal:getComputedStyle(token).color,selected:getComputedStyle(token,'::selection').color,background:getComputedStyle(token,'::selection').backgroundColor};
      });
      expect(selectedToken.selected).toBe(selectedToken.normal);expect(selectedToken.background).toBe('rgba(0, 0, 0, 0)');
      // Verify actual paint, not just CSS: only the selection layer changes.
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.mount('preview');f.selectLocalTheme('github-light');f.select();});
      await page.waitForTimeout(150);
      const selection = page.locator('.cm-selectionBackground').first();
      const box = await selection.boundingBox();expect(box).not.toBeNull();
      const clip = {x:Math.floor(box!.x),y:Math.floor(box!.y),width:Math.max(1,Math.floor(box!.width)),height:Math.max(1,Math.floor(box!.height))};
      const visiblePaint=await page.screenshot({clip});
      await selection.evaluate(el=>(el as HTMLElement).style.visibility='hidden');
      const hiddenPaint=await page.screenshot({clip});
      await selection.evaluate(el=>(el as HTMLElement).style.visibility='');
      const before=await sharp(visiblePaint).removeAlpha().raw().toBuffer();
      const after=await sharp(hiddenPaint).removeAlpha().raw().toBuffer();
      let changed=0;for(let i=0;i<before.length;i+=3)if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>12)changed++;
      expect(changed/(before.length/3)).toBeGreaterThan(.2);
      await page.evaluate(()=>(window as any).editorFixture.mount('preview'));
      await page.waitForTimeout(150);
      // Widget text editing must retain native selection: drawSelection doesn't own it.
      await page.locator('.cm-md-editable-table-cell').first().waitFor();
      const widget=await page.evaluate(()=>{
        const cell=document.querySelector('.cm-md-editable-table-cell [contenteditable], .cm-md-table-cell-source[contenteditable], .cm-md-editable-table-cell[contenteditable]')!;
        if(!cell)return null;
        return {bg:getComputedStyle(cell,'::selection').backgroundColor,text:getComputedStyle(cell,'::selection').color};
      });
      expect(widget).not.toBeNull();expect(widget!.bg).not.toBe('rgba(0, 0, 0, 0)');
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.mount('raw');f.search();f.reveal();});
      await page.locator('.cm-searchMatch').first().waitFor();
      for(const palette of ['github-light','dracula']) {
        await page.evaluate(p=>(window as any).editorFixture.selectLocalTheme(p),palette);
        const r=await resolve('.cm-searchMatch:not(.cm-searchMatch-selected)','background-color','--search-highlight-color');expect(r.actual).toBe(r.expected);
        const panel=await resolve('.cm-panels','background-color','--bg-secondary');expect(panel.actual).toBe(panel.expected);
      }
      // Apply RGB accent without a theme event: no cached/hex-only selection colour.
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.mount('text');document.documentElement.style.setProperty('--selection-background','rgba(19, 155, 88, 0.4)');document.documentElement.style.setProperty('--accent-color','rgb(19, 155, 88)');f.select();});
      await page.locator('.cm-selectionBackground').first().waitFor();
      expect(await page.locator('.cm-selectionBackground').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(19, 155, 88, 0.4)');
      await page.locator('#blur').click();
      expect(await page.locator('.cm-selectionBackground').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(19, 155, 88, 0.4)');
      // Imported selection is independent of the focus/accent colour.
      const imported=await page.evaluate(()=>{
        const f=(window as any).editorFixture;
        const before=f.instance.view;before.dispatch({changes:{from:0,insert:'Edited '}});f.select();
        const text=before.state.doc.toString(),selection=before.state.selection.main.to;
        const vars=f.importVSCodeTheme({type:'light',colors:{'editor.background':'#ffffff','editor.foreground':'#222222',focusBorder:'#7733bb','selection.background':'#ff000055','editor.selectionBackground':'#11aa3355'}});f.applyTheme(vars);
        const probe=document.createElement('span');probe.style.color='var(--selection-background)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();
        return {mapped:vars['--selection-background'],accent:vars['--accent'],expected,same:before===f.instance.view,textKept:text===before.state.doc.toString(),selectionKept:selection===before.state.selection.main.to,dirty:f.instance.dirty};
      });
      expect(imported.accent).toBe('#7733bb');expect(imported.mapped).toBe('rgba(17,170,51,0.333)');expect(imported.same&&imported.textKept&&imported.selectionKept&&imported.dirty).toBe(true);
      expect(await page.locator('.cm-selectionBackground').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(imported.expected);
      // Match browser system colours in forced-colours mode (not vendor blues).
      await page.emulateMedia({forcedColors:'active'});
      const forced = await page.evaluate(() => {
        const selection=document.querySelector('.cm-selectionBackground')!;
        const probe=document.createElement('span');probe.style.backgroundColor='Highlight';document.body.append(probe);
        const expected=getComputedStyle(probe).backgroundColor;probe.remove();
        return {actual:getComputedStyle(selection).backgroundColor,expected};
      });
      expect(forced.actual).toBe(forced.expected);
      await page.emulateMedia({forcedColors:'none'});
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.selectLocalTheme('github-dark');f.mount('vim');});
      await page.locator('.cm-content').click();
      await page.locator('.cm-fat-cursor').first().waitFor();
      const vim=await resolve('.cm-fat-cursor','background-color','--accent-color');expect(vim.actual).toBe(vim.expected);
      await page.keyboard.press('Escape');await page.keyboard.press('g');await page.keyboard.press('g');await page.keyboard.press('0');await page.keyboard.press('v');await page.keyboard.press('l');
      await page.locator('.cm-selectionBackground').first().waitFor();
      const visual=await resolve('.cm-selectionBackground','background-color','--selection-background');expect(visual.actual).toBe(visual.expected);
      await page.evaluate(()=>{const f=(window as any).editorFixture;f.mount('diff');f.selectLocalTheme('github-light');});
      expect(await page.locator('.cm-mergeView .cm-editor').count()).toBe(2);
      expect(await page.locator('.cm-changedLine').count()).toBeGreaterThan(0);
      // Switching host document must bind to the destination's theme event/window.
      const transfer=await page.evaluate(async()=>{
        const f=(window as any).editorFixture;f.mount('text');f.select();
        const iframe=document.createElement('iframe');document.body.append(iframe);
        const doc=iframe.contentDocument!;doc.documentElement.dataset.theme='light';doc.documentElement.style.setProperty('--text-code','#123456');doc.documentElement.style.setProperty('--bg-code','#fefefe');
        const host=doc.createElement('div');doc.body.append(host);
        const instance=f.instance;const text=instance.view.state.doc.toString();
        const state=instance.exportHostTransferState();instance.beforeDetachFromHost({reason:'move',target:'popout'});instance.moveHost(host,{reason:'move',hostMode:'popout',transferState:state});
        return {moved:instance.view.dom.ownerDocument===doc,textKept:instance.view.state.doc.toString()===text,foreground:iframe.contentWindow!.getComputedStyle(instance.view.contentDOM).color};
      });
      expect(transfer.moved&&transfer.textKept).toBe(true);
      expect(transfer.foreground).toBe('rgb(18, 52, 86)');
      expect(errors).toEqual([]);
    } finally {await browser.close();}
  },60000);
}
