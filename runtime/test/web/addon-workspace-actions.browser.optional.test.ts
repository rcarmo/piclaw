import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const browserTest=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'?test:test.skip;

browserTest('real explorer exposes registered file action on desktop/touch and opens a separate readonly pane',async()=>{
 const root=await mkdtemp(join(tmpdir(),'addon-actions-browser-'));
 const web=resolve(import.meta.dir,'../../web/src');
 const entry=join(root,'fixture.ts');
 await writeFile(entry,`
 import {html,render} from '${web}/vendor/preact-htm.js';
 import {WorkspaceExplorer} from '${web}/components/workspace-explorer.ts';
 import {createAddonWebApi} from '${web}/ui/addon-web-extensions.ts';
 import {bindAddonPaneLauncher} from '${web}/ui/addon-workspace-actions.ts';
 import {paneRegistry} from '${web}/panes/pane-registry.ts';
 const api=createAddonWebApi(window);window.api=api;window.opens=[];window.edits=[];
 const path='piclaw://addon/example/review-1';
 api.registerPane({id:'example-review',label:'Review',placement:'tabs',capabilities:['readonly'],canHandle:c=>c.path===path,mount(container){container.textContent='REVIEW_SAVED_FILE';return{getContent(){},isDirty(){return false},focus(){},dispose(){container.textContent=''}};}});
 window.unregister=api.registerWorkspaceAction({id:'example.review',label:'Review file',title:'Review saved file without opening an editor',icon:'review',when:c=>c.path.endsWith('.ts'),run:c=>{window.selected=c;api.openPane({path,paneId:'example-review',label:'Review file'});}});
 bindAddonPaneLauncher((path,options)=>{window.opens.push({path,options});paneRegistry.resolve({path,mode:'view'}).mount(document.getElementById('pane'),{path,mode:'view'});});
 render(html\`<\${WorkspaceExplorer} onOpenEditor=\${(p)=>window.edits.push(p)} />\`,document.getElementById('explorer'));
 `);
 const build=await Bun.build({entrypoints:[entry],outdir:root,target:'browser',format:'esm',naming:'fixture.js'});
 expect(build.success).toBe(true);
 let statCalls=0;const requests:string[]=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  const u=new URL(req.url);requests.push(u.pathname);
  if(u.pathname==='/')return new Response('<html><body><div id="explorer"></div><div id="pane"></div><script type="module" src="/fixture.js"></script></body></html>',{headers:{'content-type':'text/html'}});
  if(u.pathname==='/fixture.js')return new Response(Bun.file(join(root,'fixture.js')),{headers:{'content-type':'text/javascript'}});
  if(u.pathname.startsWith('/static/'))return new Response(Bun.file(join(import.meta.dir,'../../web',u.pathname)),{headers:{'content-type':'text/javascript'}});
  if(u.pathname==='/workspace/tree')return Response.json({root:{name:'.',path:'.',type:'dir',children:[{name:'unchanged.ts',path:'unchanged.ts',type:'file',size:20}]}});
  if(u.pathname==='/workspace/file')return Response.json({path:'unchanged.ts',kind:'text',text:'const value = 1;',size:20});
  if(u.pathname==='/workspace/stat'){statCalls++;return Response.json({path:'unchanged.ts',type:'file',size:20});}
  if(u.pathname==='/workspace/index-status')return Response.json({});
  return Response.json({});
 }});
 let browser:any;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH});
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort());
  await page.goto(server.url.href);
  try { await page.locator('[data-item-path="unchanged.ts"]').click({timeout:5000}); }
  catch(error) { console.error({errors,requests,body:await page.locator('body').innerText()});throw error; }
  const action=page.locator('.workspace-preview-actions button[aria-label="Review file"]');
  await action.waitFor();
  expect(await action.locator('svg[aria-hidden="true"]').count()).toBe(1);
  expect(await action.innerText()).toBe('');
  await action.click();
  await page.waitForFunction(()=>document.getElementById('pane')?.textContent==='REVIEW_SAVED_FILE');
  // Selecting the file opens it in a tab; the add-on action adds only its own readonly pane.
  expect(await page.evaluate(()=>({opens:(window as any).opens.length,edits:(window as any).edits,path:(window as any).selected.path}))).toEqual({opens:1,edits:['unchanged.ts'],path:'unchanged.ts'});
  await page.setViewportSize({width:390,height:844});await action.click();
  await page.waitForFunction(()=>(window as any).opens.length===2);
  expect(await page.evaluate(()=>(window as any).opens.length)).toBe(2);
  expect(statCalls).toBe(2);
  await page.evaluate(()=>(window as any).unregister());
  await page.waitForFunction(()=>!document.querySelector('.workspace-preview-actions button[aria-label="Review file"]'));
  expect(requests.some(p=>p.includes('piclaw:'))).toBe(false);expect(errors).toEqual([]);
 }finally{await browser?.close();server.stop(true);await rm(root,{recursive:true,force:true});}
},60000);
