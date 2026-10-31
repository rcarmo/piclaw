import {beforeAll,afterAll,expect,test} from 'bun:test';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1',browserTest=enabled?test:test.skip;
let server:ReturnType<typeof Bun.serve>;
beforeAll(async()=>{if(!enabled)return;const result=await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/visual-panel-recovery.tsx')],target:'browser',jsx:{runtime:'automatic',importSource:'preact'}});if(!result.success)throw Error(result.logs.join('\n'));const script=await result.outputs[0].text();server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/fixture.js'?new Response(script,{headers:{'content-type':'text/javascript'}}):new Response('<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>',{headers:{'content-type':'text/html'}})});},30000);
afterAll(()=>server?.stop(true));
const snapshot={status:'active',data:{type:'tool_status',turn_id:'turn-a',tool_name:'read',title:'Reading background file',status:'running'},thought:{text:'Restored background thought',totalLines:1},draft:{text:'Restored background draft',totalLines:1}};
for(const [name,engine]of Object.entries({chromium,webkit})){
 browserTest(`${name}: return restores Visual thought, draft and current tool without reload`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage();try{
 await page.goto(`${server.url}?chat_jid=web:a`);await page.waitForFunction(()=>Boolean((window as any).panelRecovery));await page.waitForTimeout(100);
 await page.evaluate(snapshot=>{(window as any).panelRecovery.snapshot=snapshot;window.dispatchEvent(new Event('focus'));},snapshot);
 await page.waitForFunction(()=>document.body.textContent?.includes('Restored background thought'),undefined,{timeout:1500});
 expect(await page.locator('body').textContent()).toContain('Restored background draft');
 expect(await page.locator('body').textContent()).toContain('Reading background file');
 // A live draft arriving during recovery must not block a missing thought or
 // be overwritten by the older captured draft in the snapshot.
 await page.evaluate(()=>{const f=(window as any).panelRecovery;f.snapshot.thought.text='Latest background thought';f.hold=true;window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>Boolean((window as any).panelRecovery.release));
 await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('piclaw:agent-draft',{detail:{text:'Newer streamed draft'}}));(window as any).panelRecovery.release();});
 await page.waitForFunction(()=>document.body.textContent?.includes('Latest background thought'),undefined,{timeout:1500});
 expect(await page.locator('body').textContent()).toContain('Newer streamed draft');
 expect(await page.locator('body').textContent()).not.toContain('Restored background draft');
 }finally{await browser.close();}
 },15000);
 browserTest(`${name}: returning to another session rejects late preview recovery and clears old tool panes`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage();try{
 await page.goto(`${server.url}?chat_jid=web:a`);await page.waitForFunction(()=>Boolean((window as any).panelRecovery));await page.waitForTimeout(100);
 await page.evaluate(snapshot=>{const f=(window as any).panelRecovery;f.snapshot=snapshot;f.hold=true;window.dispatchEvent(new Event('focus'));},snapshot);
 await page.waitForFunction(()=>Boolean((window as any).panelRecovery.release));
 await page.evaluate(()=>{const f=(window as any).panelRecovery;history.replaceState(null,'','?chat_jid=web:b');f.snapshot={status:'idle',data:null};window.dispatchEvent(new CustomEvent('piclaw:current-chat-changed'));f.release();});
 await page.waitForTimeout(150);
 expect(await page.locator('body').textContent()).not.toContain('Restored background');
 expect(await page.locator('body').textContent()).not.toContain('Reading background file');
 expect(await page.evaluate(()=>(window as any).panelRecovery.calls.includes('web:b'))).toBe(true);
 }finally{await browser.close();}
 },15000);
}

for(const [name,engine]of Object.entries({chromium,webkit})) browserTest(`${name}: recovered tool metadata cannot leak across a session switch`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage();try{
 await page.goto(`${server.url}?chat_jid=web:a`);await page.waitForFunction(()=>Boolean((window as any).panelRecovery));await page.waitForTimeout(100);
 await page.evaluate(snapshot=>{const f=(window as any).panelRecovery;f.snapshot={...snapshot,data:{...snapshot.data,tool_args:{path:'file.ts'},output_preview:'Output from A'}};window.dispatchEvent(new Event('focus'));},snapshot);
 await page.waitForFunction(()=>Boolean((window as any).panelRecovery.branchRelease));
 await page.evaluate(()=>{const f=(window as any).panelRecovery;history.replaceState(null,'','?chat_jid=web:b');f.snapshot={status:'active',data:{type:'tool_status',turn_id:'turn-b',tool_name:'read',title:'Tool B',status:'running',output_preview:'Output from B'}};window.dispatchEvent(new CustomEvent('piclaw:current-chat-changed'));});
 await page.waitForFunction(()=>document.body.textContent?.includes('Output from B'));
 await page.evaluate(()=>(window as any).panelRecovery.branchRelease());await page.waitForTimeout(100);
 expect(await page.locator('body').textContent()).not.toContain('STALE_BRANCH');
 expect(await page.locator('body').textContent()).not.toContain('Output from A');
 expect(await page.locator('body').textContent()).toContain('Output from B');
 }finally{await browser.close();}
},15000);

for(const [name,engine]of Object.entries({chromium,webkit})) browserTest(`${name}: recovered metadata cannot overwrite newer output in the same turn`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage();try{
 await page.goto(`${server.url}?chat_jid=web:a`);await page.waitForFunction(()=>Boolean((window as any).panelRecovery));await page.waitForTimeout(100);
 await page.evaluate(snapshot=>{const f=(window as any).panelRecovery;f.snapshot={...snapshot,data:{...snapshot.data,tool_args:{path:'file.ts'},output_preview:'Output from A'}};window.dispatchEvent(new Event('focus'));},snapshot);
 await page.waitForFunction(()=>Boolean((window as any).panelRecovery.branchRelease));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:agent-status',{detail:{type:'tool_status',turn_id:'turn-a',tool_name:'bash',title:'Tool B',status:'running',output_preview:'Newer output from B'}})));
 await page.waitForFunction(()=>document.body.textContent?.includes('Newer output from B'));
 await page.evaluate(()=>(window as any).panelRecovery.branchRelease());await page.waitForTimeout(100);
 expect(await page.locator('body').textContent()).not.toContain('STALE_BRANCH');
 expect(await page.locator('body').textContent()).toContain('Newer output from B');
 expect(await page.locator('body').textContent()).toContain('Tool B');
 }finally{await browser.close();}
},15000);

for(const [name,engine]of Object.entries({chromium,webkit})) browserTest(`${name}: newer output clears branch metadata from a different context`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage();try{
 await page.goto(`${server.url}?chat_jid=web:a`);await page.waitForFunction(()=>Boolean((window as any).panelRecovery));await page.waitForTimeout(100);
 await page.evaluate(snapshot=>{const f=(window as any).panelRecovery;f.snapshot={...snapshot,data:{...snapshot.data,tool_args:{path:'file.ts'},output_preview:'Output from A'}};window.dispatchEvent(new Event('focus'));},snapshot);
 await page.waitForFunction(()=>Boolean((window as any).panelRecovery.branchRelease));
 await page.evaluate(()=>(window as any).panelRecovery.branchRelease());
 await page.waitForFunction(()=>document.body.textContent?.includes('STALE_BRANCH'));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:agent-status',{detail:{type:'tool_status',turn_id:'turn-a',tool_name:'bash',title:'Tool B',status:'running',output_preview:'Newer output without repository'}})));
 await page.waitForFunction(()=>document.body.textContent?.includes('Newer output without repository'));
 expect(await page.locator('body').textContent()).not.toContain('STALE_BRANCH');
 expect(await page.locator('body').textContent()).toContain('Newer output without repository');
 }finally{await browser.close();}
},15000);
