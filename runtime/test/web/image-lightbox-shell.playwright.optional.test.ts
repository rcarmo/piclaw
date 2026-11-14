import { afterAll, beforeAll, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";

// Exercise the shipped entrypoints and API adapter, not injected hook callbacks.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, "../../web");
let server: ReturnType<typeof Bun.serve>;
let image: Buffer;
beforeAll(async () => {
  if (!enabled) return;
  image = await sharp({create:{width:1600,height:1000,channels:4,background:"#2463eb"}}).png().toBuffer();
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
  for (const skin of ["classic"]) browserTest(`${engineName}: ${skin} shipped narrow thumbnail opens a visible viewport preview`, async () => {
    const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' && process.env.PICLAW_TEST_CHROMIUM_PATH ? {executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH} : {}) });
    const context = await browser.newContext({ viewport: { width: 480, height: 720 }, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default";
    const model = "fixture/first", thinking = "high", tokens = 1000;
    const settings = { providers: [], toolsets: [], themes: [], colorKeys: [], uiTheme: "default" };
    const modelPayload = () => ({ current: model, thinking_level: thinking, thinking_level_label: thinking, supports_thinking: true, available_model_count: 2, model_options: [{ id: model, context_window: 200000 }], oobe: { provider_ready_completed_instance: true } });
    const contextPayload = () => ({ tokens, percent: tokens / 2000, contextWindow: 200000, sessionGeneration: "fixture-generation" });
    await page.addInitScript(({ chatJid }) => {
      localStorage.setItem("piclaw_wizard_dismissed", "1");
      localStorage.setItem("piclaw-active-panel", "chat");
      localStorage.setItem("piclaw-sidebar-collapsed", "true");
      localStorage.setItem("piclaw_workspace_visible", "false");
      localStorage.setItem("workspaceOpen.desktop", "false");
      // Presence teardown is unrelated; WebKit aborts routed beacons during reload.
      Object.defineProperty(navigator, "sendBeacon", { value: () => true });
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => new URL(String(input), location.href).pathname === "/agent/push/presence"
        ? Promise.resolve(Response.json({ ok: true })) : fetch(input, init);
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
      if(url.pathname==="/media/1"||url.pathname==="/media/1/thumbnail")return route.fulfill({body:image,contentType:"image/png"});
      if(url.pathname==="/media/1/info")return route.fulfill({json:{filename:"picture.png",content_type:"image/png"}});
      if (url.pathname === "/agent/status") body = { status: { status: "idle", state: "idle", data: null }, model: modelPayload(), context: contextPayload(), metrics: { cpu_percent: 2, ram_percent: 12 }, agent_name: "Fixture", errors: [] };
      else if (url.pathname === "/agent/models") body = modelPayload();
      else if (url.pathname === "/agent/context") body = contextPayload();
      else if (url.pathname === "/timeline") body = { posts: [{id:777001,chat_jid:chatJid,type:'user',data:{type:'user_message',content:'[Image: picture.png]',content_blocks:[{type:'image',mime_type:'image/png'}],media_ids:[1],timestamp:new Date().toISOString(),sender_name:'Fixture',is_bot_message:false,thread_id:777001}}], has_more: false, chat_jid: chatJid, user: { name: "Fixture User" }, agent: { name: "Fixture" } };
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
      await page.goto(server.url+'?skin='+skin+'&chat_jid='+encodeURIComponent(chatJid),{waitUntil:'load'});
      const thumbnail=page.locator('.media-preview img');
      await thumbnail.waitFor();
      await thumbnail.click();
      const backdrop=page.locator('.image-modal');
      await backdrop.waitFor();
      const preview=backdrop.locator('img');await preview.evaluate((el:HTMLImageElement)=>el.decode());
      const box=await backdrop.boundingBox();
      expect(box!.x).toBeCloseTo(0,0);expect(box!.y).toBeCloseTo(0,0);
      expect(box!.width).toBeGreaterThanOrEqual(479);expect(box!.height).toBeGreaterThanOrEqual(719);
      const imageBox=await preview.boundingBox();expect(imageBox!.width).toBeGreaterThan(0);expect(imageBox!.x+imageBox!.width).toBeLessThanOrEqual(480);
      await page.setViewportSize({width:320,height:560});
      const resized=await preview.boundingBox();expect(resized!.x+resized!.width).toBeLessThanOrEqual(320);
      await page.keyboard.press('Escape');await backdrop.waitFor({state:'detached'});
      expect(errors).toEqual([]);expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("SHELL_FAILURE", JSON.stringify({ engineName, skin, errors, unhandled: [...unhandled], requests, body: (await page.locator("body").innerText()).slice(-2500), badges: await page.locator(".model-badge-wrapper,.compose-model-meta").evaluateAll(nodes => nodes.map(n => n.outerHTML)), scripts: await page.locator("script[src]").evaluateAll(nodes => nodes.map(n => n.getAttribute("src"))) }));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 90000);
}
