import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
import { build } from 'esbuild';
import sharp from 'sharp';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, '../../web');
let server: ReturnType<typeof Bun.serve>;
const browsers = new Map<string, Browser>();
let image: Buffer;
beforeAll(async () => {
  if (!enabled) return;
  image = await sharp({create:{width:1600,height:1000,channels:4,background:'#2463eb'}}).png().toBuffer();
  const bundle = await build({ entryPoints:[join(import.meta.dir,'fixtures/image-lightbox-fixture.ts')], bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',jsxImportSource:'preact',external:['#editor-vendor/codemirror'] });
  server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    const url=new URL(req.url);
    if(url.pathname==='/fixture.js')return new Response(bundle.outputFiles[0].contents,{headers:{'Content-Type':'text/javascript'}});
    if(url.pathname==='/editor-vendor/codemirror.js')return new Response(Bun.file(resolve(webRoot,'../extensions/viewers/editor/vendor/codemirror.js')),{headers:{'Content-Type':'text/javascript'}});
    if(url.pathname==='/media/1/info')return Response.json({filename:'picture.png',content_type:'image/png'});
    if(url.pathname==='/media/1'||url.pathname==='/media/1/thumbnail')return new Response(image,{headers:{'Content-Type':'image/png'}});
    if(url.pathname.startsWith('/static/'))return new Response(Bun.file(join(webRoot,url.pathname)));
    if(url.pathname==='/')return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${'classic'}/css/styles.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script></head><body><main id="app"></main><script type="module" src="/fixture.js"></script></body></html>`,{headers:{'Content-Type':'text/html'}});
    return Response.json({});
  }});
  browsers.set('chromium',await chromium.launch({headless:true}));
  browsers.set('webkit',await webkit.launch({headless:true}));
}, 30000);
afterAll(async()=>{for(const browser of browsers.values())await browser.close();server?.stop(true);});
for(const engine of ['chromium','webkit'])for(const skin of ['classic'])for(const surface of ['thumbnail']) for (const viewport of [{width:320,height:640},{width:600,height:400},{width:900,height:780}]) {
  browserTest(`${engine} ${skin} ${surface} ${viewport.width}px: narrow pane preview covers the viewport`,async()=>{
    const context=await browsers.get(engine)!.newContext({viewport,reducedMotion:'reduce'});
    try {
      const page=await context.newPage();page.setDefaultTimeout(5000);
      const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort());
      await page.goto(server.url+'?skin='+skin+'&surface='+surface);
      const trigger=page.locator('.media-preview img');
      await trigger.click();
      const backdrop=page.locator('.image-modal');
      await backdrop.waitFor();
      const box=await backdrop.boundingBox();
      expect(Math.abs(box!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.y)).toBeLessThanOrEqual(1);
      expect(box!.width).toBeGreaterThanOrEqual(viewport.width-1);
      expect(box!.height).toBeGreaterThanOrEqual(viewport.height-1);
      expect(await backdrop.evaluate(el=>!document.getElementById('app')!.contains(el))).toBe(true);
      const preview=backdrop.locator('img');await preview.waitFor();
      await preview.evaluate((el:HTMLImageElement)=>el.decode());
      const rect=await preview.boundingBox();expect(rect!.width).toBeGreaterThan(0);expect(rect!.height).toBeGreaterThan(0);
      expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(viewport.width);
      expect(rect!.y).toBeGreaterThanOrEqual(0);expect(rect!.y+rect!.height).toBeLessThanOrEqual(viewport.height);
      await page.setViewportSize({width:280,height:400});
      const resized=await backdrop.boundingBox();expect(resized!.width).toBeGreaterThanOrEqual(279);
      const resizedImage=await preview.boundingBox();expect(resizedImage!.x+resizedImage!.width).toBeLessThanOrEqual(280);

      await page.keyboard.press('Escape');await backdrop.waitFor({state:'detached'});
      expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
      await trigger.click();await backdrop.waitFor();
      await backdrop.click({position:{x:2,y:2}});await backdrop.waitFor({state:'detached'});
      expect(errors).toEqual([]);
    }finally{await context.close();}
  },20000);
}
