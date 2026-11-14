import {afterAll,beforeAll,expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import { GpuMetricsCache } from '../../src/channels/web/agent/gpu-metrics-cache.ts';
import { SystemMetricsSampler } from '../../src/channels/web/agent/system-metrics.ts';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'&&process.env.PICLAW_E2E_DISPOSABLE==='1',run=enabled?test:test.skip,root=resolve(import.meta.dir,'../..');let server:ReturnType<typeof Bun.serve>;let bundle='';
let pollingSampler: SystemMetricsSampler | null = null;
let pollingResponses: any[] = [];
let pollingTimes: number[] = [];
let fixture:any={};const base={cpu_percent:24,ram_percent:46,cpu_series:[20,24],ram_series:[40,46],swap_percent:null,swap_total_bytes:0};
const intel=()=>({id:'intel0',name:'Intel Iris Xe',provider:'intel-drm-fdinfo',driver:'i915',status:'ok',sample_time_ms:Date.now(),busy_percent:0,memory:{resident_bytes:1024,total_bytes:4096},history:[{busy_percent:0,resident_bytes:1024}],coverage:{clients:1}});
beforeAll(async()=>{if(!enabled)return;bundle=(await build({stdin:{contents:`import{h,render}from'./web/src/vendor/preact-htm.js';import{SystemMetersHud}from'./web/src/components/system-meters-hud.ts';render(h(SystemMetersHud,{}),document.getElementById('root'));`,resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'browser',jsx:'automatic',jsxImportSource:'preact',write:false})).outputFiles[0].text;server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const u=new URL(req.url);if(u.pathname==='/agent/system-metrics') {
 if (pollingSampler) {
  const metrics = pollingSampler.readSnapshot();
  pollingResponses.push(metrics);
  pollingTimes.push(performance.now());
  return Response.json(metrics);
 }
 return Response.json({...base,...fixture,gpus:(fixture.gpus??[]).map((row:any)=>({...row,sample_time_ms:Date.now()}))});
}if(u.pathname==='/pane.js')return new Response(bundle,{headers:{'content-type':'text/javascript'}});if(u.pathname==='/workspace-theme.css')return new Response(Bun.file(join(root,'web/static/common/css/workspace-theme.css')),{headers:{'content-type':'text/css'}});if(u.pathname.startsWith('/css/'))return new Response(Bun.file(join(root,`web/static/${u.pathname.split('/')[2]}/css/shell.css`)),{headers:{'content-type':'text/css'}});if(u.pathname==='/agent/ui-state')return Response.json({});return new Response(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/${u.searchParams.get('skin')??'classic'}/shell.css"><link rel="stylesheet" href="/css/classic/shell.css"><link rel="stylesheet" href="/workspace-theme.css"><style>:root{--bg-primary:#161616;--text-primary:#eee;--text-secondary:#aaa;--border-color:#444;--accent-color:#79afff;--chart-1:#38bdf8;--chart-5:#a855f7}body{background:#161616;font:14px system-ui}</style><div id="root"></div><script type="module" src="/pane.js"></script>`,{headers:{'content-type':'text/html'}});}});},30000);
afterAll(()=>server?.stop(true));
for(const[name,engine]of Object.entries({chromium,webkit}))for(const skin of ['classic'])run(`${skin}/${name}: disabled lines hidden and GPU details remain neutral and accessible`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true}),errors:string[]=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(() => {
 const original = window.fetch.bind(window);
 (window as any).holdGpuReply = false;
 window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await original(...args);
  if (String(args[0]).includes('/agent/system-metrics') && (window as any).holdGpuReply) {
   (window as any).gpuReplyHeld = true;
   return new Promise<Response>(resolve => { (window as any).releaseGpuReply = () => resolve(response); });
  }
  return response;
 };
});await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
 try{fixture={gpus:[{...intel(),disabled:true}],vram_percent:null,swap_percent:null,swap_total_bytes:4096};await page.goto(`${server.url}?skin=${skin}`);await page.locator('.system-meters-row.cpu').waitFor();expect(await page.locator('.intel-gpu,.intel-gmem,.system-meters-row.swap').count()).toBe(0);
 fixture={gpus:[{...intel(),busy_percent:null,memory:{resident_bytes:null},status:'unavailable'}]};await page.reload();await page.locator('.system-meters-row.cpu').waitFor();expect(await page.locator('.intel-gpu,.intel-gmem').count()).toBe(0);
 fixture={gpus:[{...intel(),memory:{resident_bytes:null}}]};await page.reload();const activity=page.locator('.system-meters-row.intel-gpu');await activity.waitFor();expect(await activity.innerText()).toContain('0%');expect(await page.locator('.intel-gmem').count()).toBe(0);await activity.click();await page.getByRole('dialog').waitFor();expect(await page.getByRole('dialog').innerText()).not.toContain('Engines');expect(await page.getByRole('dialog').innerText()).toContain('Activity');await page.keyboard.press('Escape');expect(await activity.evaluate(el=>el===document.activeElement)).toBe(true);
 fixture={gpus:[],gpu_provider:'nvml',vram_percent:50,vram_series:[25,50],vram_total_bytes:4096,vram_used_bytes:2048};await page.reload();const vram=page.getByRole('button',{name:/VRAM 50%.*GPU details/});await vram.waitFor();expect(await page.locator('.intel-gpu').count()).toBe(0);
 const columns = await page.locator('.system-meters-row .system-meters-spark').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })));
 expect(columns.length).toBeGreaterThanOrEqual(3);
 for (const column of columns) { expect(Math.abs(column.x - columns[0].x)).toBeLessThan(0.5);expect(Math.abs(column.width - columns[0].width)).toBeLessThan(0.5); }
 await vram.press('Enter');await page.getByRole('dialog').waitFor();expect(await page.getByRole('dialog').innerText()).toContain('Device memory');expect(await page.getByRole('dialog').innerText()).not.toContain('Intel');expect(await page.getByRole('dialog').innerText()).not.toContain('Observed client');await page.getByRole('button',{name:'Close',exact:true}).click();expect(await vram.evaluate(el=>el===document.activeElement)).toBe(true);
 fixture={gpus:[intel()]};await page.reload();const changing=page.locator('.system-meters-row.intel-gpu');await changing.waitFor();await changing.click();await page.getByRole('dialog').waitFor();fixture={gpus:[{...intel(),busy_percent:null}]};await page.waitForFunction(()=>document.querySelector('.system-meters-row.intel-gpu')?.textContent?.includes('—'));expect(await page.getByRole('dialog').count()).toBe(1);expect(await changing.count()).toBe(1);expect(await page.locator('.system-meters-row.intel-gmem').count()).toBe(1);
 fixture={gpus:[],gpu_provider:'nvml',vram_percent:50,vram_series:[25,50],vram_total_bytes:4096,vram_used_bytes:2048};await page.reload();await page.setViewportSize({width:390,height:844});const compact=page.locator('.system-meters-compact-gpu.intel-gmem');await compact.waitFor();expect((await page.locator('.system-meters-compact-summary').innerText()).match(/VRAM/g)?.length).toBe(1);
 const spark = compact.locator('svg');expect(await spark.count()).toBe(1);
 const drawing = await spark.evaluate(el => {const p=el.querySelector('path')!;const s=getComputedStyle(p);return {path:p.getAttribute('d'),stroke:s.stroke,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,strokeWidth:s.strokeWidth};});
 expect(drawing.path).toContain('L');expect(drawing.path).not.toContain('NaN');expect(drawing.stroke).toBe('rgb(168, 85, 247)');expect(Number.parseFloat(drawing.strokeWidth)).toBeGreaterThan(0);expect(drawing.width).toBeGreaterThan(0);expect(drawing.height).toBeGreaterThan(0);
 await compact.tap();await page.getByRole('dialog').waitFor();const box=await page.getByRole('dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
 fixture={gpus:[],vram_percent:null};await page.waitForFunction(()=>document.querySelector('.system-meters-compact-gpu.intel-gmem')?.textContent?.includes('—'));expect(await page.getByRole('dialog').count()).toBe(1);expect(await compact.count()).toBe(1);fixture={gpus:[{id:'replacement',provider:'nvml',disabled:true}],vram_percent:null};await page.getByRole('dialog').waitFor({state:'detached',timeout:8000});expect(await page.locator('.intel-gpu,.intel-gmem').count()).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();}
},20000);

run('HUD polling keeps asynchronous GPU telemetry and a continuous VRAM sparkline', async () => {
 const worker = {
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null,
  postMessage(message: any) {
   if (message.type !== 'sample') return;
   setTimeout(() => worker.onmessage?.({ data: { id: message.id, snapshot: {
    totalBytes: 4096, usedBytes: 2048, percent: 50, provider: 'nvml',
   } } } as MessageEvent), 5);
  },
 };
 const cache = new GpuMetricsCache(() => worker);
 pollingSampler = new SystemMetricsSampler(30, 2000, () => cache.read());
 pollingResponses = [];
 pollingTimes = [];
 const browser = await chromium.launch({ headless: true });
 const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 try {
  await page.goto(server.url.href);
  await page.locator('.system-meters-row.intel-gmem').waitFor({ timeout: 4500 });
  await page.waitForFunction(() => {
   const path = document.querySelector('.intel-gmem path')?.getAttribute('d') || '';
   return path.includes('56.00') && !path.includes('NaN');
  }, null, { timeout: 4500 });
  // Wait for five actual responses; the first multi-point path can arrive
  // sooner when optional activity history starts during async discovery.
  const deadline = Date.now() + 6500;
  while (pollingResponses.length < 5 && Date.now() < deadline) await page.waitForTimeout(100);
  expect(pollingResponses.length).toBeGreaterThanOrEqual(5);
  expect(pollingResponses[0].vram_percent).toBeNull();
  for (let i = 1; i < pollingResponses.length; i += 1) {
   expect(pollingResponses[i].gpu_provider).toBe('nvml');
   expect(pollingResponses[i].vram_series).toHaveLength(i);
   expect(pollingTimes[i] - pollingTimes[i - 1]).toBeLessThan(4500);
  }
  expect(await page.locator('.intel-gmem').innerText()).toContain('50%');
  expect(await page.locator('.intel-gmem path').getAttribute('d')).toContain('56.00');
  // The compact mobile row must render a painted sparkline as well.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.locator('.system-meters-compact-gpu.intel-gmem');
  await mobile.waitFor();
  await page.waitForTimeout(2100);
  expect(await mobile.locator('svg path').getAttribute('d')).toContain('56.00');
  expect(await mobile.locator('svg path').evaluate(el => getComputedStyle(el).stroke)).not.toBe('none');
  expect(await mobile.innerText()).toContain('50%');
  expect(errors).toEqual([]);
 } finally {
  await browser.close();
  pollingSampler = null;
  cache.dispose();
 }
}, 15000);

for (const [name, engine] of Object.entries({ chromium, webkit })) run(`${name}: NVML activity and VRAM remain independent in desktop and mobile meters`, async () => {
 const browser = await engine.launch({ headless: true });
 const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
 try {
  fixture = { gpus: [], gpu_provider: 'nvml', vram_percent: 50, vram_series: [25,50], vram_total_bytes: 4096, vram_used_bytes: 2048,
   gpu_busy_percent: 0, gpu_busy_series: [70,null,0] };
  await page.goto(server.url.href);
  const activity = page.locator('.system-meters-row.intel-gpu');
  await activity.waitFor();
  expect(await activity.innerText()).toContain('0%');
  expect(await activity.locator('path').getAttribute('d')).toContain('M');
  expect(await page.locator('.system-meters-row.intel-gmem').innerText()).toContain('50%');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.locator('.system-meters-compact-gpu.intel-gpu');
  await mobile.waitFor();
  expect(await mobile.locator('svg').count()).toBe(1);
  fixture.gpu_busy_percent = null; fixture.gpu_busy_series = [70,null,0,null];
  await page.waitForFunction(() => document.querySelector('.system-meters-compact-gpu.intel-gpu')?.textContent?.includes('—'), null, { timeout: 5000 });
  expect(await page.locator('.system-meters-compact-gpu.intel-gmem').innerText()).toContain('50%');
  fixture.gpu_busy_percent=100;fixture.gpu_busy_series=[70,null,0,null,100];
  await page.waitForFunction(() => document.querySelector('.system-meters-compact-gpu.intel-gpu')?.textContent?.includes('100%'), null, { timeout: 5000 });
  expect(await mobile.locator('path').evaluate(el => getComputedStyle(el).stroke)).toBe('rgb(56, 189, 248)');
 } finally { await browser.close(); }
}, 15000);
