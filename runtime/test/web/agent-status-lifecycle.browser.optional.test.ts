import { afterAll, beforeAll, expect, test } from 'bun:test';
import { build } from 'esbuild';
import { chromium, webkit, type Browser } from 'playwright';
import { manualCompactionBackend } from './fixtures/manual-compaction-backend.js';
import { join } from 'node:path';
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
let backend = manualCompactionBackend();
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();
beforeAll(async () => {
  if (!enabled) return;
  const baseline = process.env.PICLAW_STATUS_BASELINE;
  const plugins = baseline ? [{ name: 'status-baseline', setup(builder: any) {
    builder.onLoad({ filter: /\/web\/src\/ui\/(agent-ui-snapshot|app-agent-status-lifecycle|app-agent-status-orchestration|app-connection-lifecycle)\.ts$/ }, async (args: any) => {
      const relative = args.path.slice(join(import.meta.dir, '../..').length + 1);
      const result = Bun.spawnSync(['git', 'show', `${baseline}:runtime/${relative}`], { cwd: join(import.meta.dir, '../../..') });
      if (result.exitCode !== 0) throw Error(result.stderr.toString());
      return { contents: result.stdout.toString(), loader: 'ts', resolveDir: join(args.path, '..') };
    });
  } }] : [];
  const built = await build({ plugins, entryPoints: [join(import.meta.dir, 'fixtures/agent-status-lifecycle-fixture.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture-events') {
      if (request.method === 'POST') {
        const events = await request.json();
        for (const event of events) for (const client of sseClients) client.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        return Response.json({ ok: true });
      }
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; sseClients.add(value); value.enqueue(encoder.encode(': ready\n\n')); }, cancel() { sseClients.delete(controller); } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    const result = await backend.fetch(path === '/agent/default/message' ? new Request(new URL('/manual', request.url), request) : request);
    if (result) return result;
    if (path.startsWith('/agent/')) return Response.json({ models: [], commands: [] });
    if (new URL(request.url).pathname === '/fixture.js') return new Response(built.outputFiles[0].contents, { headers: { 'content-type': 'text/javascript' } });
    return new Response('<!doctype html><main id="app"></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  browser = await (process.env.PICLAW_STATUS_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); server?.stop(true); backend.cleanup(); });

browserTest('real status hook fences disconnect ABA and reconnect starts a separate fresh refresh', async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  try {
    await page.goto(origin);
    await page.waitForFunction(() => Boolean((window as any).statusLifecycleFixture));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 1);
    await page.evaluate(() => (window as any).statusLifecycleFixture.connection('disconnected'));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    expect(await page.evaluate(() => (window as any).statusLifecycleFixture.count())).toBe(1);
    await page.evaluate(() => (window as any).statusLifecycleFixture.connection('connected'));
    // The old request is still unresolved. Joining it would prevent recovery.
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 2, undefined, { timeout: 2000 });
    await page.evaluate(() => (window as any).statusLifecycleFixture.release(0, {
      status: 'active', data: { type: 'thinking', turn_id: 'old' },
      draft: { text: 'stale draft', totalLines: 1 }, thought: { text: 'stale thought', totalLines: 1 },
    }));
    expect(JSON.parse((await page.locator('#state').textContent())!).status).toBeNull();
    expect(JSON.parse((await page.locator('#state').textContent())!).draft.text).toBe('');
    await page.evaluate(() => (window as any).statusLifecycleFixture.release(1, {
      status: 'active', data: { type: 'thinking', turn_id: 'fresh' },
      draft: { text: 'fresh draft', totalLines: 1 }, thought: { text: 'fresh thought', totalLines: 1 },
    }));
    await page.waitForFunction(() => document.querySelector('#state')!.textContent!.includes('fresh draft'));
    const state = JSON.parse((await page.locator('#state').textContent())!);
    expect(state.status.turn_id).toBe('fresh');
    expect(state.thought.text).toBe('fresh thought');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 15000);

const heldScenarios = [false, true].flatMap(compose =>
  ['success', 'error', 'cancelled'].map(terminal => ({ compose, terminal, lateCompletion: false })));
heldScenarios.push({ compose: true, terminal: 'success', lateCompletion: true });
for (const { compose, terminal, lateCompletion } of heldScenarios) {
  browserTest(`held manual compaction rejects pre-intent idle and retains ownership through command publication: ${terminal}, actual Compose=${compose}, late completion=${lateCompletion}`, async () => {
    const stop = compose ? 'button[aria-label="Compacting context — Stop response"]' : '#stop';
    backend.cleanup(); backend = manualCompactionBackend();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const deliver = async () => {
      const events = backend.events.splice(0);
      if (compose) {
        await page.request.post(`${origin}/fixture-events`, { data: events });
        await page.waitForTimeout(30);
      } else for (const event of events) await page.evaluate(({ type, data }) => (window as any).statusLifecycleFixture.event(type, data), event);
    };
    try {
      await page.goto(origin + (compose ? '/?compose=1' : '/'));
      if (compose) await page.waitForFunction(() => (window as any).fixtureSseReady);
      await page.waitForFunction(() => Boolean((window as any).statusLifecycleFixture));
      if (lateCompletion) {
        await page.evaluate(() => { void (window as any).statusLifecycleFixture.manual('/stats').then(() => { (window as any).statsDone = true; }); });
        for (let i = 0; i < 100 && !backend.events.some(event => event.type === 'agent_response'); i++) await Bun.sleep(10);
        expect(backend.events.some(event => event.type === 'agent_response')).toBe(true);
        await deliver();
      }
      await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
      await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 1);
      await page.evaluate(() => { (window as any).manualDone = false; });
      if (compose) await page.locator('.compose-context-pie').click();
      else await page.evaluate(() => { void (window as any).statusLifecycleFixture.manual(); });
      // The command is genuinely held server-side, not a status-only simulation.
      for (let i = 0; i < 100 && !backend.events.length; i++) await Bun.sleep(10);
      expect(backend.events.some(event => event.data?.intent_key === 'compaction')).toBe(true);
      await deliver();
      await page.waitForSelector(stop);
      if (compose) expect(await page.locator('.compose-context-pie.is-compacting').count()).toBe(1);
      await page.evaluate(() => (window as any).statusLifecycleFixture.release(0, { status: 'idle', data: null }));
      await page.waitForTimeout(30);
      expect(await page.locator(stop).count()).toBe(1);
      expect(JSON.parse((await page.locator('#state').textContent())!).status.intent_key).toBe('compaction');
      for (let i = 0; i < 3; i++) {
        const status = await (await page.request.get(`${origin}/status`)).json();
        expect(status.status).toBe('active');
        expect(status.data.intent_key).toBe('compaction');
      }
      expect(await page.evaluate(() => (window as any).manualDone)).toBe(false);
      if (lateCompletion) {
        // The earlier real command finishes publishing AFTER the newer compact
        // intent. Its terminal must not erase the newer operation in the store.
        backend.publish();
        await page.waitForFunction(() => (window as any).statsDone);
        await deliver();
        // The live event's foreign turn is ignored; the persisted snapshot is
        // the independently observed path which can erase compaction later.
        expect(await page.locator(stop).count()).toBe(1);
        const lateStatus = await (await page.request.get(`${origin}/status`)).json();
        await page.waitForTimeout(350);
        await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
        await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 2);
        await page.evaluate(payload => (window as any).statusLifecycleFixture.release(1, payload), lateStatus);
        await page.waitForTimeout(30);
        console.info('late command completion evidence', JSON.stringify({ lateStatus, state: await page.locator('#state').textContent(), stopCount: await page.locator(stop).count() }));
        expect(lateStatus.status).toBe('active');
        expect(lateStatus.data.intent_key).toBe('compaction');
        expect(await page.locator(stop).count()).toBe(1);
      }
      if (terminal === 'cancelled') {
        await page.locator(stop).click();
        for (let i = 0; i < 100 && backend.aborts === 0; i++) await Bun.sleep(10);
        expect(backend.aborts).toBe(1);
      } else backend.finish(terminal);
      for (let i = 0; i < 100 && !backend.events.some(event => event.type === 'agent_response'); i++) await Bun.sleep(10);
      expect(backend.events.some(event => event.type === 'agent_response')).toBe(true);
      await deliver();
      expect(await page.locator(stop).count()).toBe(1);
      expect((await (await page.request.get(`${origin}/status`)).json()).status).toBe('active');
      backend.publish();
      await page.waitForFunction(() => (window as any).manualDone);
      await deliver();
      await page.waitForFunction(selector => !document.querySelector(selector), stop);
      if (compose) expect(await page.locator('.compose-context-pie.is-compacting').count()).toBe(0);
      expect((await (await page.request.get(`${origin}/status`)).json()).status).toBe('idle');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 15000);
}

browserTest('return snapshot restores missing thought while current-turn draft keeps streaming', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(server.url.toString());
    await page.waitForFunction(() => Boolean((window as any).statusLifecycleFixture));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 1);
    await page.evaluate(() => (window as any).statusLifecycleFixture.release(0, {
      status:'active',data:{type:'thinking',turn_id:'background-turn'},draft:{text:'Earlier draft',totalLines:1},
    }));
    await page.waitForFunction(() => document.querySelector('#state')!.textContent!.includes('Earlier draft'));
    await page.evaluate(() => { void (window as any).statusLifecycleFixture.refresh(); });
    await page.waitForFunction(() => (window as any).statusLifecycleFixture.count() === 2);
    await page.evaluate(() => {
      const f=(window as any).statusLifecycleFixture;
      f.event('agent_draft_delta',{chat_jid:'web:hook-fixture',turn_id:'background-turn',reset:true,delta:'Newer live draft'});
      f.event('agent_status',{chat_jid:'web:hook-fixture',turn_id:'background-turn',type:'tool_status',tool_name:'read',title:'Background tool',status:'running'});
      f.release(1,{status:'active',data:{type:'thinking',turn_id:'background-turn'},draft:{text:'Earlier draft',totalLines:1},thought:{text:'Recovered background thought',totalLines:1}});
    });
    await page.waitForFunction(() => document.querySelector('#state')!.textContent!.includes('Recovered background thought'),undefined,{timeout:1500});
    const state=JSON.parse((await page.locator('#state').textContent())!);
    expect(state.draft.fullText).toBe('Newer live draft');
    expect(state.thought.text).toBe('Recovered background thought');
    expect(state.status.title).toBe('Background tool');
  } finally { await page.close(); }
},15000);
