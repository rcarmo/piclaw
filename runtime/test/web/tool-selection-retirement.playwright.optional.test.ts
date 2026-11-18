import {afterAll,beforeAll,expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium,webkit,type Browser} from 'playwright';
const browserTest=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'?test:test.skip;
const browsers=new Map<string,Browser>();let server:ReturnType<typeof Bun.serve>|undefined,base='';
beforeAll(async()=>{
 if(process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS!=='1')return;
 for(const[name,engine]of [['chromium',chromium],['webkit',webkit]] as const)browsers.set(name,await engine.launch({headless:true,args:name==='chromium'?['--use-angle=swiftshader','--ozone-platform=headless']:[]}));
 server=Bun.serve({port:0,async fetch(request){const path=new URL(request.url).pathname;
  if(path==='/fixture')return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"></head><body><div id="settings-widget-fixture-root"></div><script type="module" src="/static/classic/dist/settings-widget-fixture.bundle.js"></script></body></html>',{headers:{'content-type':'text/html'}});
  if(path.startsWith('/static/')&&!path.includes('..'))try{return new Response(await readFile(join(import.meta.dir,'../../web/static',path.slice(8))),{headers:{'content-type':path.endsWith('.css')?'text/css':'text/javascript'}});}catch{return new Response('Not found',{status:404});}
  if(path==='/editor-vendor/codemirror.js')return new Response(await readFile(join(import.meta.dir,'../../extensions/viewers/editor/vendor/codemirror.js')),{headers:{'content-type':'text/javascript'}});
  return Response.json({ok:true,entries:[]});
 }});base=`http://127.0.0.1:${server.port}`;
});
afterAll(async()=>{for(const browser of browsers.values())await browser.close();browsers.clear();server?.stop(true);});
for(const engine of ['chromium','webkit'])for(const touch of [false,true])for(const colorScheme of ['light','dark'] as const)
browserTest(`Classic ${engine} ${touch?'touch':'keyboard'} ${colorScheme}: tool catalogue has no selection controls or writes`,async()=>{
 const page=await browsers.get(engine)!.newPage({viewport:touch?{width:390,height:844}:{width:1280,height:800},hasTouch:touch,colorScheme});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(`${base}/fixture?section=tools&width=${touch?370:1100}&height=700`,{waitUntil:'networkidle'});
  await page.locator('.settings-tool-row').first().waitFor({state:'visible'});
  const rows=page.locator('.settings-tool-row');expect(await rows.count()).toBeGreaterThan(3);expect(await rows.locator('input,button,select').count()).toBe(0);
  expect(await page.locator('.settings-toolset-toggle,.settings-tool-compact,.settings-tool-status-header').count()).toBe(0);
  expect(await page.getByText('Read-only tool catalogue.',{exact:false}).count()).toBe(1);
  await page.evaluate(()=>{const original=window.fetch.bind(window);(window as any).__selectionWrites=[];window.fetch=(...args:Parameters<typeof fetch>)=>{if(args[1]?.method==='POST')(window as any).__selectionWrites.push({url:String(args[0]),body:args[1].body});return original(...args);};});
  const filter=page.getByRole('searchbox');await filter.fill('bash');expect(await page.locator('.settings-tool-row:not(.settings-tool-row-header)').count()).toBe(1);expect(await page.locator('.settings-tool-list').innerText()).toContain('bash');await filter.fill('');
  const mode=page.getByLabel('Match mode',{exact:false});
  // Search semantics remain independent of tool availability; no compaction/activation POST exists.
  if(touch)await mode.tap();else{await mode.focus();await page.keyboard.press('Space');}
  const writes=await page.evaluate(()=>(window as any).__selectionWrites);expect(writes).toHaveLength(1);expect(writes[0].url).toBe('/agent/settings/general');expect(JSON.parse(writes[0].body)).toEqual({searchMatchMode:'and'});
  const toolDimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));expect(toolDimensions.scroll).toBeLessThanOrEqual(toolDimensions.width+1);
  const compaction=page.locator('.settings-nav-item').filter({hasText:/^Compaction$/});if(touch)await compaction.tap();else{await compaction.focus();await page.keyboard.press('Enter');}
  await page.getByText('Local-lite prompt',{exact:true}).waitFor();expect(await page.getByText('Local-lite prompt and tools',{exact:true}).count()).toBe(0);
  expect(await page.getByText('without changing tool availability',{exact:false}).count()).toBe(1);
  const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width+1);expect(errors).toEqual([]);
 }finally{await page.close();}
});
