import {afterAll,beforeAll,expect,test} from 'bun:test';
import {join} from 'node:path';
import {chromium,type Browser} from 'playwright';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1',browserTest=enabled?test:test.skip;
let server:ReturnType<typeof Bun.serve>,browser:Browser;
beforeAll(async()=>{
 if(!enabled)return;
 const build=await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/delegate-progress-fixture.tsx')],target:'browser',format:'esm'});
 if(!build.success)throw new AggregateError(build.logs,'Delegate fixture build failed');
 server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PICLAW_BROWSER_FIXTURE_PORT??0),fetch(req){
  const url=new URL(req.url),skin="classic";
  if(url.pathname==='/fixture.js')return new Response(build.outputs[0],{headers:{'Content-Type':'text/javascript'}});
  if(url.pathname.startsWith('/static/'))return new Response(Bun.file(join(import.meta.dir,'../../web',url.pathname)));
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"><link rel="stylesheet" href="/static/common/css/delegate-progress.css"><main id="app" style="max-width:800px;margin:20px auto;padding:8px"></main><script type="module" src="/fixture.js"></script>`,{headers:{'Content-Type':'text/html'}});
 }});
 // A loopback-only SSH tunnel can reuse a workstation's installed browsers.
 browser=process.env.PLAYWRIGHT_CDP_ENDPOINT?await chromium.connectOverCDP(process.env.PLAYWRIGHT_CDP_ENDPOINT):await chromium.launch({headless:true});
},15000);
afterAll(async()=>{await browser?.close();server?.stop(true);});
const children=[{tool_call_id:'call_a|fc_1',model:'provider/model',phase:'tool',tools:['read'],elapsedSeconds:4,responseChars:20},{tool_call_id:'call_b|fc_2',model:'provider/model',phase:'generating',tools:[],elapsedSeconds:4,responseChars:40}];
for(const skin of ['classic'])browserTest(`${skin} visible independent Delegate progress survives sibling completion/reconnect and clears at turn end`,async()=>{
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(3000);
 const base=`http://127.0.0.1:${server.port}`;await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 try{
  await page.goto(base+'/?skin='+skin);await page.waitForFunction(()=>Boolean((window as any).delegateFixture));
  const emit=async(value:unknown)=>{await page.evaluate(detail=>(window as any).delegateFixture.emit(detail),value);await page.waitForTimeout(60);};
  const status={type:'tool_status',status:'running',tool_name:'delegate',title:'Delegate fixture',output_preview:'FALLBACK_METADATA_SHOULD_NOT_REPEAT',delegate_progress:children};
  // No tool_call and no output preview: this is the status-only reconnect path.
  await emit(status);const rows=page.locator('.agent-delegate-progress-item');expect(await rows.count()).toBe(2);expect(await page.locator('body').innerText()).not.toContain('FALLBACK_METADATA_SHOULD_NOT_REPEAT');
  expect(await rows.nth(0).innerText()).toContain('Running read');expect(await rows.nth(1).innerText()).toContain('Generating response');expect(await rows.nth(0).isVisible()).toBe(true);expect(await rows.nth(1).isVisible()).toBe(true);
  await emit({...status,delegate_progress:[{...children[0],phase:'done'},children[1]]});expect(await rows.count()).toBe(2);expect(await page.locator('[data-delegate-phase="done"]').count()).toBe(1);
  await page.setViewportSize({width:390,height:844});expect(await rows.evaluateAll(nodes=>nodes.every(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.left>=0&&rect.right<=innerWidth+1;}))).toBe(true);
  await emit({...status,delegate_progress:[],tool_name:'read',output_preview:'REAL_TOOL_OUTPUT_PRESERVED'});expect(await rows.count()).toBe(0);expect(await page.locator('body').innerText()).toContain('REAL_TOOL_OUTPUT_PRESERVED');
  await page.evaluate(()=>(window as any).delegateFixture.clear());await page.waitForTimeout(60);expect(await rows.count()).toBe(0);
  await emit({...status,delegate_progress:[...children,{tool_call_id:'bad',model:'<script>',phase:'generating',thinking:'PRIVATE_SENTINEL'}]});expect(await rows.count()).toBe(2);expect(await page.locator('body').innerText()).not.toContain('PRIVATE_SENTINEL');
  expect(errors).toEqual([]);
 }finally{await page.close();}
},10000);
