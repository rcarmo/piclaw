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
    if (url.pathname === "/") return new Response(Bun.file(join(webRoot, `static/${"classic"}/index.html`)), { headers: { "content-type": "text/html" } });
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
  for (const skin of ["classic"]) browserTest(`${engineName}: ${skin} sends large uploads as workspace references and keeps small media attachments`, async () => {
    const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' && process.env.PICLAW_TEST_CHROMIUM_PATH ? {executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH} : {}) });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default:branch:cold-start";
    let model = "fixture/first", thinking = "high", tokens = 1000;
    let accepted = 0;
    let chunkRequests=0;
    let smallUploads=0;
    let uploadedPath='';
    let submitted:any;
    let rejectChunks=false;
    let effectiveLimitOverride: number | undefined;
    const settingsSaves: Record<string, unknown>[] = [];
    const settings:any={providers:[],toolsets:[],themes:[],colorKeys:[],uiTheme:'default',workspaceUploadLimitMb:512,composeUploadLimitMb:512};
    const fileSize=33*1024*1024;
    let lastPost: any;
    const modelPayload = () => ({ current: model, thinking_level: thinking, thinking_level_label: thinking, supports_thinking: true, available_model_count: 2, model_options: [{ id: model, context_window: 200000 }], oobe: { provider_ready_completed_instance: true } });
    const contextPayload = () => ({ tokens, percent: tokens / 2000, contextWindow: 200000, sessionGeneration: "fixture-generation" });
    await page.addInitScript(({ chatJid }) => {
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
      if(url.pathname==='/media/upload-chunk') {
        if(rejectChunks)return route.fulfill({status:413,json:{error:'Fixture limit exceeded'}});
        chunkRequests++;
        const headers=req.headers();const id=headers['x-upload-id'];const index=Number(headers['x-chunk-index']);
        expect(Number(headers['x-file-size'])).toBe(fileSize);
        expect(Number(headers['x-chunk-total'])).toBe(5);
        // WebKit's protocol omits routed Blob bodies; byte bounds are asserted
        // by the direct handler and transfer tests, and Chromium exposes them here.
        const payloadBytes=req.postDataBuffer();
        if(payloadBytes)expect(payloadBytes.byteLength).toBe(Math.min(8*1024*1024,fileSize-index*8*1024*1024));
        uploadedPath=`uploads/${id}/large.bin`;
        body=index===4?{complete:true,storage:'workspace',path:uploadedPath,size:fileSize}:{complete:false};
      }
      else if(url.pathname==='/media/upload') {smallUploads++;body={id:17,filename:'small.txt'};}
      else if (url.pathname.startsWith('/agent/') && url.pathname.endsWith('/message') && req.method() === 'POST') {
        accepted++;submitted=req.postDataJSON();
        const id=777000+accepted;
        lastPost={id,chat_jid:chatJid,type:'user',data:{type:'user_message',content:req.postDataJSON().content,timestamp:new Date().toISOString(),sender_name:'Fixture User',is_bot_message:false,thread_id:id}};
        body = {thread_id:id,user_message:lastPost};
      }
      else if (url.pathname === '/media/17/info') body={id:17,filename:'small.txt',content_type:'text/plain',metadata:{size:13}};
      else if (url.pathname === '/media/17' || url.pathname === '/media/17/thumbnail') return route.fulfill({body:'small fixture',contentType:'text/plain'});
      else if (url.pathname === "/agent/status") body = { status: { status: "idle", state: "idle", data: null }, model: modelPayload(), context: contextPayload(), metrics: { cpu_percent: 2, ram_percent: 12 }, agent_name: "Fixture", errors: [] };
      else if (url.pathname === "/agent/models") body = modelPayload();
      else if (url.pathname === "/agent/context") body = contextPayload();
      else if (url.pathname === "/timeline") body = { posts: [], has_more: false, chat_jid: chatJid, user: { name: "Fixture User" }, agent: { name: "Fixture" } };
      else if (url.pathname === "/agent/addons/web-entries") body = { entries: [] };
      else if (url.pathname === "/agent/roster") body = { agents: [], default_agent: "fixture" };
      else if (url.pathname === "/agent/branches") body = { branches: [{ chat_jid: chatJid, root_chat_jid: "web:default", branch_id: "cold-start", agent_name: "fixture" }] };
      else if (url.pathname === "/agent/active-chats") body = { chats: [{ chat_jid: chatJid, root_chat_jid: "web:default", agent_name: "fixture", is_active: false }] };
      else if (["/agent/queue", "/agent/queue-state"].includes(url.pathname)) body = { items: [], queue: [], queued: [] };
      else if (url.pathname === "/workspace/tree") body = { root: { name: "fixture", path: "", type: "directory", children: [] }, entries: [], tree: [] };
      else if (url.pathname === "/workspace/index-status") body = { state: "ready", indexed_file_count: 0, roots: [] };
      else if (url.pathname === "/workspace/visibility") body = { visible: false, open: false };
      else if (url.pathname === "/agent/settings/quick-actions") body = { actions: [], items: [] };
      else if (url.pathname === "/agent/commands") body = { commands: [] };
      else if (["/agent/push/presence", "/agent/client-perf"].includes(url.pathname)) body = { ok: true };
      else if (url.pathname === "/agent/autoresearch/status") body = { enabled: false, active: false };
      else if (url.pathname === "/auth/me") body = { mode: "single-user", authenticated: false };
      else if (url.pathname === "/agent/settings-data") body = settings;
      else if (url.pathname === '/agent/settings/general') {
        const patch = req.postDataJSON();
        settingsSaves.push(patch);
        Object.assign(settings, patch);
        settings.workspaceUploadLimitMb = effectiveLimitOverride ?? Math.min(1024, Math.max(1, Math.round(Number(settings.workspaceUploadLimitMb))));
        settings.composeUploadLimitMb = settings.workspaceUploadLimitMb;
        body = { ok: true, settings };
      }
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
      const large=Buffer.alloc(fileSize,7);
      await page.locator('.compose-box input[type="file"][multiple]').setInputFiles([{name:'large.bin',mimeType:'application/octet-stream',buffer:large},{name:'small.txt',mimeType:'text/plain',buffer:Buffer.from('small fixture')}]);
      await input.fill('Mixed upload probe');await input.press('Enter');
      await page.waitForFunction(()=>document.querySelector('#post-777001,[data-message-id="777001"]'),{},{timeout:15000});
      expect(chunkRequests).toBe(5);expect(smallUploads).toBe(1);expect(accepted).toBe(1);
      expect(submitted.media_ids).toEqual([17]);
      expect(submitted.content).toContain('Files:\n- '+uploadedPath);
      expect(submitted.content).toContain('attachment:17 (small.txt)');
      expect(submitted.content).not.toContain('attachment:undefined');
      const post=page.locator('#post-777001,[data-message-id="777001"]');
      expect(await post.innerText()).toContain('large.bin');
      expect(await post.getByRole('link',{name:'large.bin',exact:true}).getAttribute('href')).toBe('/workspace/raw?path='+encodeURIComponent(uploadedPath)+'&download=1');
      // A chunk error must preserve the draft and never send a broken reference.
      rejectChunks=true;
      await page.locator('.compose-box input[type="file"][multiple]').setInputFiles({name:'large.bin',mimeType:'application/octet-stream',buffer:large});
      await input.fill('Failed upload draft');await input.press('Enter');
      await page.getByText(/Fixture limit exceeded/).first().waitFor();
      expect(accepted).toBe(1);expect(await input.inputValue()).toContain('Failed upload draft');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:open-settings',{detail:{section:'general'}})));
      const content=page.locator('.settings-content').filter({visible:true});
      const limit=content.getByLabel('Upload limit (MB)',{exact:true});
      await limit.waitFor();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="Upload limit (MB)"]')).some(el=>el.value==='512'));
      expect(await limit.inputValue()).toBe('512');
      expect(await content.getByText('Compose upload (MB)',{exact:true}).count()).toBe(0);
      expect(await content.getByText('Workspace upload (MB)',{exact:true}).count()).toBe(0);
      expect(await limit.count()).toBe(1);
      await limit.fill('600');await limit.blur();await page.waitForTimeout(1100);
      expect(settings.workspaceUploadLimitMb).toBe(600);expect(settings.composeUploadLimitMb).toBe(600);
      expect(await limit.inputValue()).toBe('600');
      // Returning the same effective value must still replace a rejected draft.
      effectiveLimitOverride=600;
      await limit.fill('700');await limit.blur();await page.waitForTimeout(1100);
      expect(settings.workspaceUploadLimitMb).toBe(600);
      expect(await limit.inputValue()).toBe('600');
      effectiveLimitOverride=undefined;
      for (const [draft, effective] of [['2000','1024'],['0','1'],['512','512']]) {
        await limit.fill(draft);await limit.blur();await page.waitForTimeout(1100);
        expect(settings.workspaceUploadLimitMb).toBe(Number(effective));
        expect(settings.composeUploadLimitMb).toBe(Number(effective));
        expect(await limit.inputValue()).toBe(effective);
        expect(await limit.getAttribute('aria-invalid')).not.toBe('true');
      }
      expect(settingsSaves.length).toBeGreaterThanOrEqual(5);
      for (const patch of settingsSaves) {
        expect(patch).toHaveProperty('workspaceUploadLimitMb');
        expect(patch).not.toHaveProperty('composeUploadLimitMb');
      }
      await page.reload({waitUntil:'load'});
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:open-settings',{detail:{section:'general'}})));
      await limit.waitFor();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="Upload limit (MB)"]')).some(el=>el.value==='512'));
      expect(await limit.inputValue()).toBe('512');
      expect(errors).toEqual([]);
      expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("SHELL_FAILURE", JSON.stringify({ engineName, skin, errors, unhandled: [...unhandled], requests, body: (await page.locator("body").innerText()).slice(-2500), badges: await page.locator(".model-badge-wrapper,.compose-model-meta").evaluateAll(nodes => nodes.map(n => n.outerHTML)), scripts: await page.locator("script[src]").evaluateAll(nodes => nodes.map(n => n.getAttribute("src"))) }));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 90000);
}
