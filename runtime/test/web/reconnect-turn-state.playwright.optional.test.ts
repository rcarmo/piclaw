import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' && process.env.PICLAW_E2E_DISPOSABLE === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
const scripts: Record<string, Uint8Array> = {};
const clients = new Map<ReadableStreamDefaultController<Uint8Array>, boolean>();
const encoder = new TextEncoder();
const jid = 'web:hook-fixture';
let snapshot: any = {status:'idle',data:null}, holdStatus = false;
let pendingStatus: Array<() => void> = [], pendingAbort: Array<() => void> = [];
let aborts = 0;
function emit(type: string, data: any) {
  for (const [client, visual] of clients) client.enqueue(encoder.encode(visual
    ? `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    : `data: ${JSON.stringify({type,data})}\n\n`));
}
function status(type: string, turn: string, started = '2026-11-06T01:00:00Z', chat = jid) {
  return { type, turn_id: turn, task_id: Number(turn.split(':')[1]), chat_jid: chat, started_at: started, title: type === 'thinking' ? 'Thinking...' : type };
}
beforeAll(async () => {
  if (!enabled) return;
  for (const [skin, entry] of Object.entries({classic:'agent-status-lifecycle-fixture.ts',visual:'reconnect-turn-visual-fixture.tsx'})) {
    const baseline = process.env.PICLAW_RECONNECT_BASELINE;
    const plugins = baseline ? [{name:'reconnect-baseline',setup(builder: any) {
      builder.onLoad({filter:/\/(app-sse-events\.ts|AgentStatusPanel\.tsx|ChatPanel\.tsx|useTimelineStream\.ts)$/}, (args: any) => {
        const relative = args.path.slice(join(import.meta.dir,'../../..').length + 1);
        const old = Bun.spawnSync(['git','show',`${baseline}:${relative}`],{cwd:join(import.meta.dir,'../../..')});
        if(old.exitCode)throw Error(old.stderr.toString());
        return {contents:old.stdout.toString(),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:join(args.path,'..')};
      });
    }}] : [];
    const result = await build({plugins,entryPoints:[join(import.meta.dir,'fixtures',entry)],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',jsxImportSource:'preact'});
    scripts[skin] = result.outputFiles[0].contents;
  }
  server = Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:60,async fetch(req) {
    const url = new URL(req.url), path = url.pathname;
    if (path === '/fixture.js') return new Response(scripts[url.searchParams.get('skin') || 'classic'],{headers:{'content-type':'text/javascript'}});
    if (path === '/fixture-events' || path === '/sse/stream') {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream({start(c){controller=c;clients.set(c,path==='/sse/stream');c.enqueue(encoder.encode(': ready\nretry: 50\n\n'));},cancel(){clients.delete(controller);}}),{headers:{'content-type':'text/event-stream','cache-control':'no-cache'}});
    }
    if (path === '/agent/status') {
      const captured = structuredClone(snapshot);
      if (holdStatus) await new Promise<void>(resolve => pendingStatus.push(resolve));
      return Response.json({status:captured,model:{current:'fixture/model',model_options:[],oobe:{provider_ready_completed_instance:true}},context:{},metrics:{},agent_name:'Fixture',errors:[]});
    }
    if (path.endsWith('/message')) {
      const body = await req.json();
      if (body.content === '/abort') {aborts++; await new Promise<void>(resolve => pendingAbort.push(resolve));}
      return Response.json({status:'ok'});
    }
    if (path.startsWith('/agent/')) return Response.json({models:[],commands:[],items:[],messages:[],agents:[],branches:[]});
    if (path === '/') return new Response(`<!doctype html><main id="app"></main><script type="module" src="/fixture.js?skin=${url.searchParams.get('skin') || 'classic'}"></script>`,{headers:{'content-type':'text/html'}});
    return Response.json({items:[],messages:[],has_more:false});
  }});
},30000);
afterAll(() => server?.stop(true));
for (const [engine, launcher] of Object.entries({chromium,webkit})) for (const skin of ['classic','visual']) {
  browserTest(`${engine}/${skin}: reconnect, Stop, queued completion, late older events preserve a newer held turn (#1519)`, async () => {
    snapshot={status:'idle',data:null};holdStatus=false;pendingStatus=[];pendingAbort=[];aborts=0;
    const browser=await launcher.launch(), page=await browser.newPage();
    const errors: string[]=[];page.setDefaultTimeout(4000);page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)});
    const origin=server.url.origin;
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const stop=skin==='classic'?'button[aria-label="Stop response"]':'button[title="Stop response (Escape)"]';
    const until=async (check:()=>boolean) => {for(let n=0;n<200&&!check();n++)await Bun.sleep(10);expect(check()).toBe(true);};
    try {
      await page.goto(`${origin}/?skin=${skin}&compose=1&chat_jid=${jid}`);
      await until(()=>clients.size>0);
      if(skin==='classic')await page.waitForFunction(()=>Boolean((window as any).statusLifecycleFixture));
      const old=status('thinking','durable:10');snapshot={status:'active',data:old};
      emit('agent_status',old);emit('agent_draft_delta',{chat_jid:jid,turn_id:'durable:10',reset:true,delta:'Original held draft'});
      await page.waitForSelector(stop);
      // Drop the actual SSE transport. The reconnect snapshot is held while
      // native events advance through abort and queued completion.
      holdStatus=true;
      if(skin==='classic')await page.evaluate(()=>(window as any).statusLifecycleFixture.connection('disconnected'));
      for(const client of clients.keys())client.close();
      clients.clear();
      await until(()=>clients.size>0);
      if(skin==='classic') {
        await page.evaluate(()=>{(window as any).statusLifecycleFixture.event('connected',{});(window as any).statusLifecycleFixture.connection('connected');});
        await page.waitForFunction(()=>(window as any).statusLifecycleFixture.count()>=1);
      } else await until(()=>pendingStatus.length>0);
      emit('agent_status',old);emit('agent_draft_delta',{chat_jid:jid,turn_id:'durable:10',reset:true,delta:'Restored held draft'});
      await page.waitForSelector(stop);
      await page.locator(stop).first().click();await until(()=>aborts===1);
      emit('agent_status',status('done','durable:10'));
      emit('agent_status',status('thinking','durable:20','2026-11-06T01:01:00Z'));
      emit('agent_status',status('done','durable:20','2026-11-06T01:01:00Z'));
      const held=status('thinking','durable:30','2026-11-06T01:02:00Z');snapshot={status:'active',data:held};
      emit('agent_status',held);emit('agent_draft_delta',{chat_jid:jid,turn_id:'durable:30',reset:true,delta:'NEW HELD DRAFT'});
      await page.waitForFunction(()=>document.body.textContent!.includes('NEW HELD DRAFT'));
      emit('agent_status',old);emit('agent_status',status('done','durable:10'));
      emit('agent_status',status('done','durable:30','2026-11-06T01:02:00Z','web:other'));
      emit('agent_response',{id:99,chat_jid:'web:other',content:'FOREIGN RESPONSE',timestamp:new Date().toISOString(),data:{}});
      emit('agent_response',{id:20,chat_jid:jid,content:'Late queued response',timestamp:new Date().toISOString(),data:{}});
      emit('agent_draft_delta',{chat_jid:jid,turn_id:'durable:10',reset:true,delta:'STALE DRAFT'});
      pendingAbort.splice(0).forEach(resolve=>resolve());
      holdStatus=false;pendingStatus.splice(0).forEach(resolve=>resolve());
      if(skin==='classic')await page.evaluate(payload=>(window as any).statusLifecycleFixture.release(0,payload),{status:'idle',data:null});
      await page.waitForTimeout(300);
      expect(await page.locator(stop).count()).toBeGreaterThan(0);
      expect(await page.locator('body').textContent()).toContain('NEW HELD DRAFT');
      expect(await page.locator('body').textContent()).not.toContain('STALE DRAFT');
      expect(await page.locator('body').textContent()).not.toContain('FOREIGN RESPONSE');
      // A later passive read can also return an older cached active owner,
      // without any SSE arriving during that read.
      snapshot = {status:'active',data:old};
      if (skin === 'classic') {
        await page.waitForTimeout(400);
        await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
        await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 2);
        await page.evaluate(payload => (window as any).statusLifecycleFixture.release(1,payload), snapshot);
      } else await page.evaluate(() => window.dispatchEvent(new Event('piclaw:sse-connected')));
      await page.waitForTimeout(100);
      expect(await page.locator(stop).count()).toBeGreaterThan(0);
      expect(await page.locator('body').textContent()).toContain('NEW HELD DRAFT');
      emit('agent_status',status('done','durable:30','2026-11-06T01:02:00Z'));snapshot={status:'idle',data:null};
      await page.waitForFunction(selector=>!document.querySelector(selector),stop);
      expect(errors).toEqual([]);
    } finally {holdStatus=false;pendingStatus.splice(0).forEach(r=>r());pendingAbort.splice(0).forEach(r=>r());await browser.close();clients.clear();}
  },20000);
}
