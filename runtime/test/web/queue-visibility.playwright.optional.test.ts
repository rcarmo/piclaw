import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Browser } from 'playwright';
import { withTempWorkspaceEnv } from '../helpers.js';
import { initDatabase, closeDatabase } from '../../src/db/connection.js';
import { QueuedFollowupLifecycleService } from '../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import { admitWebMessage } from '../../src/channels/web/messaging/message-store.js';
import { handleAgentMessage } from '../../src/channels/web/handlers/agent.js';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' && process.env.PICLAW_E2E_DISPOSABLE === '1';
const browserTest = enabled ? test : test.skip;
const root = resolve(import.meta.dir, '../..');
let bundle = '';
let browser: Browser | null = null;
let engine: string | null = null;
async function getBrowser(name: string) { if (engine !== name) { await browser?.close(); browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true }); engine = name; } return browser!; }
beforeAll(async () => {
  if (!enabled) return;
  const result = await build({ stdin: { contents: `import{h,render}from'preact';import{ChatPanel}from'./web/static/visual/frontend/src/panels/ChatPanel';render(h(ChatPanel,{}),document.getElementById('root'));window.unmount=()=>render(null,document.getElementById('root'));`, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', jsxImportSource: 'preact', write: false,
    plugins: [{ name: 'fixture-only-display-stubs', setup(build) {
      build.onResolve({ filter: /\/components\/(?:MessageList|AgentStatusPanel)$/ }, args => args.importer.endsWith('ChatPanel.tsx') ? { path: args.path, namespace: 'display-fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'display-fixture' }, () => ({ contents: 'export function MessageList(){return null}export function AgentStatusPanel(){return null}', loader: 'js' }));
    } }],
  });
  bundle = result.outputFiles[0].text;
}, 30000);
afterAll(async () => { await browser?.close(); browser = null; });

for (const name of ['chromium', 'webkit']) browserTest(`Visual queued input is visible from durable acknowledgement with SSE absent: ${name}`, async () => {
  await withTempWorkspaceEnv('queue-visibility-', {}, async ws => {
    mkdirSync(join(ws.workspace, '.piclaw'), { recursive: true });
    writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }), { mode: 0o600 });
    initDatabase();
    const queue = new QueuedFollowupLifecycleService();
    const chatJid = 'web:queue-fixture';
    queue.enqueueQueuedFollowupItem(chatJid, 0, 'Pre-existing durable input');
    let holdSnapshot = false, release: (() => void) | undefined;
    let stateRequests = 0;
    let denyAction = false;
    const actions: Array<{path:string;chatJid:string|null}> = [];
    const channel = { admitQueuedFollowupItem: queue.admitQueuedFollowupItem.bind(queue), agentPool: { isStreaming: () => true, isActive: () => true }, getQueuedFollowupCount: (jid: string) => queue.getQueuedFollowupCount(jid), enqueueQueuedFollowupItem: (...args: any[]) => (queue.enqueueQueuedFollowupItem as any)(...args), broadcastEvent() {}, json: (value: unknown, status = 200) => Response.json(value, { status }) } as any;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html' } });
      if (url.pathname === '/fixture.js') return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
      if (url.pathname === '/style.css') return new Response(readFileSync(join(root, 'web/static/visual/dist/app.bundle.css')), { headers: { 'Content-Type': 'text/css' } });
      if (url.pathname === '/agent/queue-state') {
        stateRequests++;
        const items = queue.listQueuedStateItems(url.searchParams.get('chat_jid')!);
        if (holdSnapshot) { holdSnapshot = false; await new Promise<void>(resolve => { release = resolve; }); }
        return Response.json({ count: items.length, items });
      }
      if (/^\/agent\/[^/]+\/message$/.test(url.pathname)) return handleAgentMessage(channel, req, url.pathname, url.searchParams.get('chat_jid')!, 'default');
      if (['/agent/queue-remove','/agent/queue-steer'].includes(url.pathname)) {
        actions.push({path:url.pathname,chatJid:url.searchParams.get('chat_jid')});
        if (denyAction) return Response.json({error:'denied'},{status:403});
        if(url.pathname==='/agent/queue-steer')return Response.json({queued:"steer",removed:false});
        const {row_id}=await req.json(); const {removed}=await queue.removeQueuedFollowupForAction(url.searchParams.get('chat_jid')!,row_id);
        return Response.json({removed:Boolean(removed)});
      }
      return Response.json({});
    } });
    const page = await (await getBrowser(name)).newPage({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
    try {
      await page.goto(`${server.url}?chat_jid=${encodeURIComponent(chatJid)}`);
      await page.getByText('Pre-existing durable input', { exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw:agent-status', { detail: { type: 'thinking' } })));
      await page.locator('textarea').fill('Accepted while SSE is disconnected');
      const started = performance.now();
      await page.locator('textarea').press('Enter');
      await page.getByText('Accepted while SSE is disconnected', { exact: true }).waitFor();
      const submitToVisibleMs = performance.now() - started;
      expect(queue.getQueuedFollowupCount(chatJid)).toBe(2);
      expect(await page.locator('.queue-stack__item').count()).toBe(2);
      expect(stateRequests).toBeGreaterThanOrEqual(2);
      // A held older GET must not resurrect a row consumed while it was in flight.
      holdSnapshot = true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('piclaw:sse-connected')));
      const deadline = Date.now() + 3000; while (!release && Date.now() < deadline) await Bun.sleep(5); expect(release).toBeTruthy();
      const consumed = queue.peekQueuedFollowupItem(chatJid)!;
      await admitWebMessage(channel, { chatJid, content: consumed.queuedContent, isBot: false, mediaIds: [], agentId: 'default', agentName: 'Fixture' },
        { consumeDeferredFollowupRowId: consumed.rowId });
      await page.evaluate(payload => window.dispatchEvent(new CustomEvent('piclaw:followup-consumed', { detail: payload })), { row_id: consumed.rowId, chat_jid: chatJid });
      release!();
      await page.getByText('Pre-existing durable input', { exact: true }).waitFor({ state: 'detached' });
      expect(await page.getByText('Accepted while SSE is disconnected', { exact: true }).count()).toBe(1);
      const visibleItem=page.locator('.queue-stack__item').filter({hasText:'Accepted while SSE is disconnected'});
      // Failed actions keep the server row visible and never claim removal.
      denyAction=true;await visibleItem.getByTitle('Remove from queue').click();await page.waitForFunction(()=>document.querySelector('.queue-stack__btn--remove')?.hasAttribute('disabled')===false);
      expect(queue.getQueuedFollowupCount(chatJid)).toBe(1);expect(await visibleItem.count()).toBe(1);denyAction=false;
      for(const action of ['cancel','steer'] as const){
        if(action==='steer'){
          queue.enqueueQueuedFollowupItem(chatJid,0,'Steer while snapshot held');
          await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:sse-connected')));
          await page.getByText('Steer while snapshot held',{exact:true}).waitFor();
        }
        holdSnapshot=true;release=undefined;
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:sse-connected')));
        const until=Date.now()+3000;while(!release&&Date.now()<until)await Bun.sleep(5);expect(release).toBeTruthy();
        const text=action==='cancel'?'Accepted while SSE is disconnected':'Steer while snapshot held';
        await page.locator('.queue-stack__item').filter({hasText:text}).getByTitle(action==='cancel'?'Remove from queue':'Inject as steering now').click();
        if(action==='steer'){
          await page.waitForFunction(()=>document.querySelector('.queue-stack__btn--steer')?.hasAttribute('disabled')===false);
          expect(await page.getByText(text,{exact:true}).count()).toBe(1);
          const item=queue.peekQueuedFollowupItem(chatJid)!;
          await admitWebMessage(channel,{chatJid,content:item.queuedContent,isBot:false,mediaIds:[],agentId:'default',agentName:'Fixture'},{consumeDeferredFollowupRowId:item.rowId});
          await page.evaluate(payload=>window.dispatchEvent(new CustomEvent('piclaw:followup-consumed',{detail:payload})),{row_id:item.rowId,chat_jid:chatJid});
        }
        await page.getByText(text,{exact:true}).waitFor({state:'detached'});release!();await page.waitForTimeout(30);
        expect(await page.getByText(text,{exact:true}).count()).toBe(0);
      }
      expect(actions).toHaveLength(3);expect(actions.every(action=>action.chatJid===chatJid)).toBe(true);
      expect(errors).toEqual([]);
      console.log(JSON.stringify({ kind: 'queue-visibility-browser', engine: name, submitToVisibleMs, queueStateRequests: stateRequests, realMessageHandler: true, realDiskQueue: false, SSE: 'absent except controlled race events', displayPanels: 'fixture stubs; real ChatPanel and QueueStack' }));
      await page.evaluate(() => (window as any).unmount());
    } finally { release?.(); await page.close(); server.stop(true); closeDatabase(); }
  });
}, 20000);
