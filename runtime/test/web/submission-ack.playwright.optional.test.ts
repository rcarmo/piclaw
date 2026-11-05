import { afterAll, beforeAll, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";

// Exercise the shipped entrypoints and API adapter, not injected hook callbacks.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, "../../web");
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  if (!enabled) return;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(Bun.file(join(webRoot, `static/${url.searchParams.get("skin") === "visual" ? "visual" : "classic"}/index.html`)), { headers: { "content-type": "text/html" } });
    if (url.pathname === "/editor-vendor/codemirror.js") return new Response(Bun.file(resolve(webRoot, "../extensions/viewers/editor/vendor/codemirror.js")), { headers: { "content-type": "text/javascript" } });
    if (url.pathname.startsWith("/static/")) {
      const path = resolve(webRoot, url.pathname.slice(1));
      if (path.startsWith(webRoot + "/static/") && await Bun.file(path).exists()) return new Response(Bun.file(path));
    }
    return new Response(null, { status: 404 });
  } });
});
afterAll(() => server?.stop(true));

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  for (const skin of ["classic", "visual"]) browserTest(`${engineName}: ${skin} acknowledges submissions without SSE delay and deduplicates event order`, async () => {
    const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' && process.env.PICLAW_TEST_CHROMIUM_PATH ? {executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH} : {}) });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default:branch:cold-start";
    let model = "fixture/first", thinking = "high", tokens = 1000;
    let accepted = 0;
    let sseFirst = false;
    let rejectNext = false;
    let uncertainPosts=0,uncertainPending=false,releaseUncertain!:()=>void;
    const uncertainGate=new Promise<void>(resolve=>{releaseUncertain=resolve;});
    let queueNext = false;
    let invalidAck: 'json' | 'empty' | null = null;
    const shortcutPosts: any[] = [];
    const invalidRequests: string[] = [];
    let heldShortcut = false;
    let shortcutPending = false;
    let releaseShortcut!: () => void;
    const shortcutGate = new Promise<void>(resolve => { releaseShortcut = resolve; });
    let releaseAck!: () => void;
    let holdAck = new Promise<void>(resolve => { releaseAck = resolve; });
    let lastPost: any;
    // Enough rows to exercise Classic's virtualized history window, not only
    // an empty timeline where every acknowledged row is already mounted.
    const durablePosts: any[] = Array.from({length:160}, (_, index) => ({
      id:1000+index, chat_jid:chatJid, type:index%2?'agent':'user',
      timestamp:'2026-10-28T00:00:00Z',
      data:{content:`History ${index}\n\n${'Historical context. '.repeat(30)}`, is_bot_message:index%2===1, sender_name:'Fixture'},
    }));
    let ackAt = 0;
    const modelPayload = () => ({ current: model, thinking_level: thinking, thinking_level_label: thinking, supports_thinking: true, available_model_count: 2, model_options: [{ id: model, context_window: 200000 }], oobe: { provider_ready_completed_instance: true } });
    const contextPayload = () => ({ tokens, percent: tokens / 2000, contextWindow: 200000, sessionGeneration: "fixture-generation" });
    await page.addInitScript(({ chatJid }) => {
      (window as any).feedbackEvents = [];
      window.addEventListener('piclaw:agent-status', (event: any) => (window as any).feedbackEvents.push(event.detail));
      localStorage.setItem("piclaw_wizard_dismissed", "1");
      localStorage.setItem("piclaw-active-panel", "chat");
      localStorage.setItem("piclaw_workspace_visible", "false");
      localStorage.setItem("workspaceOpen.desktop", "false");
      // Presence teardown is unrelated; WebKit aborts routed beacons during reload.
      Object.defineProperty(navigator, "sendBeacon", { value: () => true });
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => new URL(String(input), location.href).pathname === "/agent/push/presence"
        ? Promise.resolve(Response.json({ ok: true })) : fetch(input, init);
      // Keep a stale cached usage marker, as in the reported first-load failure.
      localStorage.setItem(`piclaw:ctx:${chatJid}`, JSON.stringify({ tokens: 321, contextWindow: 200000, percent: 0.1605, sessionGeneration: "fixture-generation" }));
      const sources: EventTarget[] = [];
      class FixtureEventSource extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
        readyState = 0; onopen: any; onerror: any; onmessage: any;
        constructor(public url: string) {
          super(); sources.push(this);
          setTimeout(() => { this.readyState = 1; this.onopen?.(new Event("open")); this.dispatchEvent(new Event("open")); this.dispatchEvent(new MessageEvent("connected", { data: JSON.stringify({ chat_jid: chatJid }) })); }, 0);
        }
        close() { this.readyState = 2; const i = sources.indexOf(this); if (i >= 0) sources.splice(i, 1); }
      }
      Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
      (window as any).emitShellEvent = (kind: string, payload: unknown) => sources.forEach(source => source.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(payload) })));
    }, { chatJid });
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== server.url.origin) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: await Bun.file(join(webRoot, `static/${skin}/index.html`)).text() });
      if (url.pathname.startsWith("/static/") || url.pathname === "/editor-vendor/codemirror.js") return route.continue();
      requests.push(`${req.method()} ${url.pathname}`);
      let body: unknown;
      if (url.pathname.startsWith('/agent/') && url.pathname.endsWith('/message') && req.method() === 'POST') {
        if(req.postDataJSON().content==='Uncertain saved prompt'){uncertainPosts++;uncertainPending=true;await uncertainGate;return route.fulfill({status:503,json:{accepted:true,thread_id:779001,error:'Input saved; SDK admission could not be confirmed.'}});}
        if (req.postDataJSON().content === '/theme default') return route.fulfill({json:{ui_only:true,command:{status:'success',message:'Theme set'},response_delivery:'failed'}});
        if (invalidAck) invalidRequests.push(req.postDataJSON().content);
        if (invalidAck === 'json') return route.fulfill({status:201,contentType:'application/json',body:'not json'});
        if (invalidAck === 'empty') return route.fulfill({status:201,json:{}});
        if(rejectNext) return route.fulfill({status:500,json:{error:'Fixture submission rejected'}});
        if (req.postDataJSON().content.startsWith('Ctrl steer')) {
          shortcutPosts.push(req.postDataJSON());
          if (heldShortcut) { shortcutPending = true; await shortcutGate; }
          const post = {id:778000+shortcutPosts.length,chat_jid:url.searchParams.get('chat_jid') || chatJid,type:'user',timestamp:new Date().toISOString(),data:{type:'user_message',content:req.postDataJSON().content,sender_name:'Fixture User',is_bot_message:false,thread_id:777001}};
          durablePosts.push(post);
          await page.evaluate(post=>(window as any).emitShellEvent('new_post',post),post);
          return route.fulfill({status:201,json:{queued:'steer',thread_id:777001,user_message:post}});
        }
        if(queueNext) { queueNext = false; return route.fulfill({ status:201,json:{thread_id:null,queued:'followup'} }); }
        accepted++;
        const id=777000+accepted;
        lastPost={id,chat_jid:url.searchParams.get("chat_jid") || chatJid,type:'user',timestamp:new Date().toISOString(),data:{type:'user_message',content:req.postDataJSON().content,sender_name:'Fixture User',is_bot_message:false,thread_id:id}};
        durablePosts.push(lastPost);
        if(sseFirst){
          await page.evaluate(post=>{(window as any).emitShellEvent('new_post',post);(window as any).emitShellEvent('agent_status',{chat_jid:post.chat_jid,thread_id:post.timestamp,type:'thinking',phase:'thinking',turn_id:'second-turn'});},lastPost);
          await Bun.sleep(100);
        }
        await holdAck;
        ackAt=Date.now();
        body = {thread_id:id,user_message:lastPost};
      }
      else if (url.pathname === "/agent/status") body = { status: { status: "idle", state: "idle", data: null }, model: modelPayload(), context: contextPayload(), metrics: { cpu_percent: 2, ram_percent: 12 }, agent_name: "Fixture", errors: [] };
      else if (url.pathname === "/agent/models") body = modelPayload();
      else if (url.pathname === "/agent/context") body = contextPayload();
      else if (url.pathname === "/timeline") body = { posts: durablePosts, has_more: false, chat_jid: chatJid, user: { name: "Fixture User" }, agent: { name: "Fixture" } };
      else if (url.pathname === "/agent/addons/web-entries") body = { entries: [] };
      else if (url.pathname === "/agent/roster") body = { agents: [], default_agent: "fixture" };
      else if (url.pathname === "/agent/branches") body = { chats: [{ chat_jid: chatJid, root_chat_jid: "web:default", branch_id: "cold-start", agent_name: "fixture" }] };
      else if (url.pathname === "/agent/active-chats") body = { chats: [{ chat_jid: chatJid, root_chat_jid: "web:default", agent_name: "fixture", is_active: false }] };
      else if (["/agent/queue", "/agent/queue-state"].includes(url.pathname)) body = { count: 0, items: [], queue: [], queued: [] };
      else if (url.pathname === "/workspace/tree") body = { root: { name: "fixture", path: "", type: "directory", children: [] }, entries: [], tree: [] };
      else if (url.pathname === "/workspace/index-status") body = { state: "ready", indexed_file_count: 0, roots: [] };
      else if (url.pathname === "/workspace/visibility") body = { visible: false, open: false };
      else if (url.pathname === "/agent/settings/quick-actions") body = { actions: [], items: [] };
      else if (url.pathname === "/agent/commands") body = { commands: [] };
      else if (["/agent/push/presence", "/agent/client-perf"].includes(url.pathname)) body = { ok: true };
      else if (url.pathname === "/agent/autoresearch/status") body = { enabled: false, active: false };
      else if (url.pathname === "/auth/me") body = { mode: "single-user", authenticated: false };
      else if (url.pathname === "/agent/settings-data") body = { providers: [], toolsets: [], themes: [], colorKeys: [], uiTheme: "default" };
      else if (url.pathname === "/agent/picker-pins") body = { scope: "fixture", revision: 0, models: [], sessions: [] };
      else if (url.pathname === "/agent/skills") body = { skills: [] };
      else if (url.pathname === "/agent/plan") body = { plan: null };
      else if (url.pathname === "/manifest.json") body = { name: "Fixture", start_url: "/", icons: [] };
      else if (url.pathname === "/sw.js") return route.fulfill({ contentType: "text/javascript", body: "// disposable fixture: no caching" });
      else if (url.pathname === '/favicon.ico') return route.fulfill({status:404,body:''});
      else if (url.pathname.startsWith("/avatar/")) return route.fulfill({ status: 404, body: "no fixture avatar" });
      else { unhandled.add(url.pathname); return route.fulfill({ status: 404, json: { error: "Unhandled fixture route" } }); }
      return route.fulfill({ json: body });
    });
    try {
      await page.goto(`${server.url}?skin=${skin}&chat_jid=${encodeURIComponent(chatJid)}`, { waitUntil: "load" });
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await page.waitForTimeout(500);
      const input=page.locator('textarea').filter({visible:true}).first();
      const waitForSubmitReady = () => page.waitForFunction(() => {
        const button = document.querySelector<HTMLButtonElement>('.compose-box .send-btn, .chat__send-btn');
        return button != null && !button.disabled;
      });
      const scroller = page.locator(skin === 'classic' ? '.timeline' : '.message-list').first();
      const readHistory = async () => {
        await scroller.evaluate((el:HTMLElement) => { el.scrollTop = -3000; });
        await page.waitForTimeout(150);
        expect(await scroller.evaluate(el => el.scrollTop)).toBeLessThan(-60);
      };
      const expectSubmittedRowVisible = async (id:number) => {
        await page.waitForFunction(({id,skin}) => {
          const row=document.querySelector(skin==='classic'?`#post-${id}`:`[data-message-id="${id}"]`);
          const root=document.querySelector(skin==='classic'?'.timeline':'.message-list');
          if(!row || !root) return false;
          const r=row.getBoundingClientRect(),s=root.getBoundingClientRect();
          return r.bottom>s.top && r.top<s.bottom;
        }, {id,skin}, {timeout:1500});
      };
      await readHistory();
      await input.fill('Latency probe submission');
      await input.press('Enter');
      await page.locator('[data-submission-state="sending"]').waitFor({ timeout: 1500 });
      expect(await page.locator('[data-submission-state="sending"]').textContent()).toContain('Sending');
      expect(await page.locator('[data-submission-state="sending"]').getAttribute('class')).toContain(skin==='classic'?'agent-status':'agent-status-panel__status');
      expect(await page.locator('[data-submission-state="sending"] .agent-status-spinner, [data-submission-state="sending"] .agent-status-panel__spinner').count()).toBe(1);
      expect(await page.locator('#post-777001,[data-message-id="777001"]').count()).toBe(0);
      releaseAck();
      await page.waitForFunction(()=>document.querySelector('#post-777001,[data-message-id="777001"]'),{},{timeout:1500});
      expect(accepted).toBe(1);
      await expectSubmittedRowVisible(777001);
      await page.locator('[data-submission-state]').waitFor({state:'hidden',timeout:1500});
      expect(await page.getByText('Message accepted. Waiting for agent…',{exact:true}).count()).toBe(0);
      await page.evaluate(payload=>(window as any).emitShellEvent('agent_status',payload),{chat_jid:lastPost.chat_jid,thread_id:777000,type:'tool_status',title:'Previous turn',turn_id:'previous'});
      expect(await page.locator('[data-submission-state]').count()).toBe(0);
      await page.evaluate(payload=>(window as any).emitShellEvent('agent_status',payload),{chat_jid:lastPost.chat_jid,thread_id:lastPost.timestamp,type:'thinking',phase:'thinking',title:'Thinking...',turn_id:'accepted-turn'});
      await page.locator('[data-submission-state]').waitFor({ state: 'hidden', timeout: 1500 });
      expect(Date.now()-ackAt).toBeLessThan(1500);
      await page.evaluate(post=>(window as any).emitShellEvent('new_post',post),lastPost);
      await page.waitForTimeout(100);
      expect(await page.locator('#post-777001,[data-message-id="777001"]').count()).toBe(1);
      await page.evaluate(payload=>(window as any).emitShellEvent('agent_status',payload),{chat_jid:lastPost.chat_jid,thread_id:lastPost.timestamp,type:'done',turn_id:'accepted-turn'});
      await page.waitForTimeout(150);
      // Event first, response later must likewise leave exactly one durable row.
      sseFirst=true;
      await readHistory();
      await input.fill('Second latency probe');await input.press('Enter');
      await page.waitForFunction(()=>document.querySelector('#post-777002,[data-message-id="777002"]'),{},{timeout:1500});
      await page.waitForTimeout(300);
      expect(accepted).toBe(2);
      await expectSubmittedRowVisible(777002);
      expect(await page.locator('#post-777002,[data-message-id="777002"]').count()).toBe(1);
      expect(await page.locator('[data-submission-state="waiting"]').count()).toBe(0);
      queueNext=true;
      await input.fill('Queued fixture prompt'); await input.press('Enter');
      await page.waitForTimeout(300);
      expect(await page.locator('[data-submission-state]').count()).toBe(0);
      expect(accepted).toBe(2);
      await input.fill('Ctrl steer blocked shortcut');
      await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,repeat:true,bubbles:true,cancelable:true})));
      await input.evaluate(el => { const event = new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,bubbles:true,cancelable:true});event.preventDefault();el.dispatchEvent(event); });
      await page.waitForTimeout(100);
      expect(shortcutPosts).toHaveLength(0);
      expect(await input.inputValue()).toBe('Ctrl steer blocked shortcut');
      // Explicit Ctrl+Enter must request steering, independent of stale UI busy state.
      await page.evaluate(payload=>(window as any).emitShellEvent('agent_status',payload),{chat_jid:lastPost.chat_jid,type:'thinking',phase:'thinking',thread_id:'busy-thread',turn_id:'busy-turn'});
      heldShortcut=true;
      await input.fill('Ctrl steer while busy'); await input.press('Control+Enter');
      await page.waitForTimeout(100);
      expect(shortcutPending).toBe(true);
      await input.fill('Next draft while queue acknowledgement is pending');
      releaseShortcut(); heldShortcut=false;
      await page.locator('[data-submission-state]').waitFor({state:'hidden'});
      await waitForSubmitReady();
      expect(await input.inputValue()).toContain('Next draft while queue acknowledgement is pending');
      expect(shortcutPosts).toHaveLength(1);
      expect(shortcutPosts[0]).toMatchObject({content:'Ctrl steer while busy',mode:'steer'});
      // Classic retired the legacy flag when native accepted-input storage became
      // authoritative; Visual still sends it, but both must send steering mode.
      expect(shortcutPosts[0].persist_steer).toBe(skin==='visual' ? true : undefined);
      await page.locator('#post-778001,[data-message-id="778001"]').waitFor();
      expect(await page.locator('#post-778001,[data-message-id="778001"]').count()).toBe(1);
      expect(await page.getByText('Steering queued for the current turn.',{exact:true}).count()).toBe(0);
      expect(await page.getByText('Follow-up queued.',{exact:true}).count()).toBe(0);
      await input.fill('Shift Enter newline'); await input.press('Shift+Enter');
      expect(await input.inputValue()).toContain('\n');
      expect(shortcutPosts).toHaveLength(1);
      await page.evaluate(payload=>(window as any).emitShellEvent('agent_status',payload),{chat_jid:lastPost.chat_jid,type:'done',thread_id:'busy-thread',turn_id:'busy-turn'});
      await input.fill('Ctrl steer while idle'); await input.press('Control+Enter');
      await page.waitForFunction(()=>document.querySelector('textarea')?.value === '');
      await input.fill('Ctrl steer with Cmd');
      await waitForSubmitReady();
      await input.press('Meta+Enter');
      await page.waitForFunction(()=>document.querySelector('textarea')?.value === '');
      expect(shortcutPosts).toHaveLength(3);
      expect(shortcutPosts.every(post => post.mode === 'steer' && post.persist_steer === (skin==='visual' ? true : undefined))).toBe(true);
      expect(await page.locator('#post-778002,[data-message-id="778002"]').count()).toBe(1);
      expect(await page.locator('#post-778003,[data-message-id="778003"]').count()).toBe(1);
      for (const invalid of ['json', 'empty'] as const) {
        invalidAck=invalid;
        const draft=`Unconfirmed ${invalid} draft`;
        await input.fill(draft);
        await waitForSubmitReady();
        await input.press('Control+Enter');
        await page.locator('[role="alert"]').waitFor({state:'visible'});
        await page.locator('[data-submission-state]').waitFor({state:'hidden'});
        await waitForSubmitReady();
        expect(await input.inputValue()).toBe(draft);
        expect(invalidRequests).toContain(draft);
        expect(await page.locator('[role="alert"]').count()).toBeGreaterThan(0);
      }
      invalidAck=null;
      // Rejected submissions are never made to look accepted in the timeline.
      rejectNext=true;
      await input.fill('Rejected latency probe');await waitForSubmitReady();await input.press('Control+Enter');
      await page.waitForTimeout(500);
      expect(accepted).toBe(2);
      expect(await input.inputValue()).toBe('Rejected latency probe');
      expect(await page.locator('[data-submission-state]').count()).toBe(0);
      expect(await page.locator('#post-777003,[data-message-id="777003"]').count()).toBe(0);
      rejectNext=false;await input.fill('/theme default');await waitForSubmitReady();await input.press('Enter');
      await page.getByText('Command handled, but its timeline reply could not be delivered. Do not resend the command.',{exact:false}).waitFor({timeout:5000});
      expect(await input.inputValue()).toBe('');expect(accepted).toBe(2);
      await input.fill('Uncertain saved prompt');await waitForSubmitReady();await input.press('Enter');
      await page.waitForFunction(()=>document.querySelector('[data-submission-state="sending"]')!==null);
      const until=Date.now()+1500;while(!uncertainPending&&Date.now()<until)await page.waitForTimeout(5);expect(uncertainPending).toBe(true);
      await input.fill('Next independently typed draft');releaseUncertain();
      await page.getByText('Input saved, but SDK admission is unconfirmed. Do not resend this input.',{exact:false}).first().waitFor({timeout:1500});
      await page.locator('[data-submission-state]').waitFor({state:'hidden'});
      expect(await input.inputValue()).toBe('Next independently typed draft');
      expect(await page.locator('#post-779001,[data-message-id="779001"]').count()).toBe(0);
      await page.waitForTimeout(200);expect(uncertainPosts).toBe(1);
      expect(new URL(page.url()).searchParams.get('chat_jid')).toBe(chatJid);
      expect(await page.getByText('Queue could not be refreshed. Reconnect or try again.',{exact:false}).count()).toBe(0);
      expect(errors).toEqual([]);
      expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("SHELL_FAILURE", JSON.stringify({ engineName, skin, errors, unhandled: [...unhandled], requests, invalidRequests, shortcutPosts, feedbackEvents: await page.evaluate(() => (window as any).feedbackEvents), body: (await page.locator("body").innerText()).slice(-2500), badges: await page.locator(".model-badge-wrapper,.compose-model-meta").evaluateAll(nodes => nodes.map(n => n.outerHTML)), scripts: await page.locator("script[src]").evaluateAll(nodes => nodes.map(n => n.getAttribute("src"))) }));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 60000);
}
