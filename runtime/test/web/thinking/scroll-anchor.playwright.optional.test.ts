import {afterAll,beforeAll,expect,test} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,webkit,type Browser} from 'playwright';

const browserTest=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'?test:test.skip;
const root=resolve(import.meta.dir,'../../..');
const browsers=new Map<string,Browser>();
let directory='',bundle='',server:ReturnType<typeof Bun.serve>|undefined;
beforeAll(async()=>{
  if(process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS!=='1')return;
  directory=await mkdtemp(join(tmpdir(),'scroll-anchor-browser-'));
  const entry=join(directory,'fixture.ts');
  await writeFile(entry,`import * as classic from ${JSON.stringify(join(root,'web/src/ui/scroll-anchor.ts'))};\nwindow.anchorApis={classic};`);
  const built=await Bun.build({entrypoints:[entry],target:'browser',format:'esm'});
  if(!built.success)throw new AggregateError(built.logs,'Scroll fixture build failed');
  bundle=await built.outputs[0].text();
  server=Bun.serve({port:0,fetch(request){
    if(new URL(request.url).pathname==='/anchor.js')return new Response(bundle,{headers:{'content-type':'text/javascript'}});
    return new Response(`<!doctype html><style>
      #scroller{height:320px;width:420px;overflow:auto;display:flex;flex-direction:column-reverse;overflow-anchor:none}
      #tail{height:600px;flex-shrink:0} #history{height:900px;flex-shrink:0}
      #disclosure{flex-shrink:0} #header{height:40px} #panel{height:0px}
      </style><div id=scroller><div id=tail></div><div id=disclosure><div id=header>Reasoning header</div><div id=panel></div></div><div id=history></div></div><script type=module src=/anchor.js></script>`,{headers:{'content-type':'text/html'}});
  }});
  // Independent engines start together; keep the original default hook deadline.
  await Promise.all([
    chromium.launch({headless:true}).then(browser=>{browsers.set('chromium',browser);}),
    webkit.launch({headless:true}).then(browser=>{browsers.set('webkit',browser);}),
  ]);
});
afterAll(async()=>{
  for(const browser of browsers.values())await browser.close();
  browsers.clear();server?.stop(true);if(directory)await rm(directory,{recursive:true,force:true});
});

for(const engine of ['chromium','webkit'])for(const skin of ['classic'])browserTest(`${engine} ${skin} shared anchoring preserves toggles, user scroll and disposal`,async()=>{
  const browser=browsers.get(engine);if(!browser||!server)throw Error('Disposable browser fixture unavailable');
  const page=await browser.newPage({viewport:{width:800,height:700},deviceScaleFactor:2});
  try{
    await page.goto(`http://127.0.0.1:${server.port}`,{waitUntil:'networkidle'});
    const before=await page.evaluate(async kind=>{
      const win=window as any,api=win.anchorApis[kind];
      const scroller=document.getElementById('scroller')!,panel=document.getElementById('panel')!;
      win.stats={added:0,removed:0,disconnected:0};
      const add=scroller.addEventListener.bind(scroller),remove=scroller.removeEventListener.bind(scroller);
      scroller.addEventListener=((...args:any[])=>{if(args[0]==='scroll')win.stats.added++;return Reflect.apply(add,scroller,args);}) as typeof scroller.addEventListener;
      scroller.removeEventListener=((...args:any[])=>{if(args[0]==='scroll')win.stats.removed++;return Reflect.apply(remove,scroller,args);}) as typeof scroller.removeEventListener;
      const Original=ResizeObserver;
      win.ResizeObserver=class extends Original{disconnect(){win.stats.disconnected++;super.disconnect();}};
      win.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      scroller.scrollTop=-500;await win.frames();
      win.anchor=api.attachHeaderAnchor(scroller,panel);
      win.api=api;
      return{header:document.getElementById('header')!.getBoundingClientRect().top,top:scroller.scrollTop};
    },skin);
    for(const height of [160,0,160,0]){
      const after=await page.evaluate(async size=>{
        const win=window as any;win.anchor.mark();document.getElementById('panel')!.style.height=size+'px';win.anchor.compensate();await win.frames();
        return{header:document.getElementById('header')!.getBoundingClientRect().top,top:document.getElementById('scroller')!.scrollTop};
      },height);
      expect(Math.abs(after.header-before.header)).toBeLessThanOrEqual(1);
      if(height===0)expect(after.top).toBe(before.top);
    }
    // Wait for the public self-write suppression flag, then use a real scroll
    // event. A user move must cancel compensation rather than being undone.
    await page.waitForFunction(()=>!(window as any).api.isAnchorScrolling(document.getElementById('scroller')));
    const cancelled=await page.evaluate(async()=>{
      const win=window as any,scroller=document.getElementById('scroller')!,panel=document.getElementById('panel')!;
      win.anchor.mark();scroller.scrollTop-=60;await win.frames();const userTop=scroller.scrollTop;
      panel.style.height='220px';win.anchor.compensate();await win.frames();const after=scroller.scrollTop;
      win.anchor.dispose();panel.style.height='300px';await win.frames();
      return{userTop,after,disposedTop:scroller.scrollTop,...win.stats};
    });
    expect(cancelled.after).toBe(cancelled.userTop);expect(cancelled.disposedTop).toBe(cancelled.userTop);
    expect(cancelled.added).toBe(1);expect(cancelled.removed).toBe(1);expect(cancelled.disconnected).toBe(1);
  }finally{await page.close();}
},15000);
