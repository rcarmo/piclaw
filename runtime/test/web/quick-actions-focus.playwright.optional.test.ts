import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, '../../web');
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints:[join(import.meta.dir,'fixtures/quick-actions-focus-fixture.ts')], target:'browser',format:'esm',external:['#editor-vendor/codemirror'] });
  if (!build.success) throw new Error(String(build.logs));
  const fixture = await build.outputs[0].text();
  server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    const url = new URL(request.url);
    if(url.pathname==='/fixture.js')return new Response(fixture,{headers:{'content-type':'text/javascript'}});
    if(url.pathname.startsWith('/static/'))return new Response(Bun.file(join(webRoot,url.pathname.slice(1))));
    if(url.pathname==='/editor-vendor/codemirror.js')return new Response(Bun.file(resolve(webRoot,'../extensions/viewers/editor/vendor/codemirror.js')),{headers:{'content-type':'text/javascript'}});
    if(url.pathname==='/')return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/${url.searchParams.has('bundle')?'dist/app.bundle.css':'css/styles.css'}"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script></head><body><div id="app"></div><input id="normal-field" aria-label="Normal field"><button id="normal-button">Normal button</button><script type="module" src="/fixture.js"></script></body></html>`,{headers:{'content-type':'text/html'}});
    return new Response(null,{status:404});
  }});
},30000);
afterAll(()=>server?.stop(true));
for(const [engineName,engine] of Object.entries({chromium,webkit}))for(const bundled of [false,true]){
  browserTest(`${engineName} ${bundled?'built':'source'}: Quick Actions input has no focus contour across themes`,async()=>{
    const browser=await engine.launch({headless:true});
    const page=await browser.newPage({viewport:{width:900,height:700},reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(server.url+(bundled?'?bundle=1':''),{waitUntil:'networkidle'});
      await page.locator('body').click({position:{x:500,y:450}});
      await page.keyboard.press('w');
      const input=page.locator('.timeline-quick-actions-input');await input.waitFor();
      await page.waitForFunction(()=>document.activeElement?.classList.contains('timeline-quick-actions-input'));
      const results=await page.evaluate(()=>{
        const f=(window as any).quickActionsFixture;
        const input=document.querySelector<HTMLInputElement>('.timeline-quick-actions-input')!;
        const field=document.querySelector<HTMLInputElement>('#normal-field')!;
        const button=document.querySelector<HTMLButtonElement>('#normal-button')!;
        return f.presets.map((preset:any)=>{
          f.selectLocalTheme(preset.id);
          input.focus();const focused=getComputedStyle(input);
          const result={id:preset.id,outline:focused.outlineStyle,shadow:focused.boxShadow,border:focused.borderTopWidth,caret:focused.caretColor,foreground:focused.color,active:document.activeElement===input,normalOutline:'',buttonOutline:''};
          field.focus();result.normalOutline=getComputedStyle(field).outlineStyle;
          button.focus();result.buttonOutline=getComputedStyle(button).outlineStyle;
          return result;
        });
      });
      for(const result of results){
        expect(result.outline).toBe('none');expect(result.shadow).toBe('none');expect(result.border).toBe('0px');expect(result.active).toBe(true);
        expect(result.caret).not.toBe('rgba(0, 0, 0, 0)');expect(result.foreground).not.toBe('rgba(0, 0, 0, 0)');
        expect(result.normalOutline).toBe('solid');expect(result.buttonOutline).toBe('solid');
      }
      if(engineName==='chromium'){
        await page.emulateMedia({forcedColors:'active'});await input.focus();
        expect(await input.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
        await page.locator('#normal-field').focus();expect(await page.locator('#normal-field').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
        await page.emulateMedia({forcedColors:'none'});
      }
      await input.fill('workspace');
      await page.locator('.timeline-quick-actions-item.active').filter({hasText:'Show workspace'}).waitFor();
      await input.press('Enter');
      await page.waitForFunction(()=>(window as any).selectedQuickAction==='workspace');
      await input.waitFor({state:'detached'});
      await page.locator('body').click({position:{x:500,y:450}});await page.keyboard.press('t');await input.waitFor();
      await page.waitForFunction(()=>document.activeElement?.classList.contains('timeline-quick-actions-input'));
      await input.press('Escape');await input.waitFor({state:'detached'});
      expect(errors).toEqual([]);
    }finally{await page.close();await browser.close();}
  },60000);
}
