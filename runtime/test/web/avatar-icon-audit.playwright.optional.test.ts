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
  for (const skin of ["classic"]) browserTest(`${engineName}: ${skin} avatar/icon update audit`, async () => {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default:branch:cold-start";
    let model = "fixture/first", thinking = "high", tokens = 1000;
    let agentAvatar = "/avatar/agent?v=old";
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
      if (url.pathname === "/agent/status") body = { status: { status: "idle", state: "idle", data: null }, model: modelPayload(), context: contextPayload(), metrics: { cpu_percent: 2, ram_percent: 12 }, agent_name: "Fixture", errors: [] };
      else if (url.pathname === "/agent/models") body = modelPayload();
      else if (url.pathname === "/agent/context") body = contextPayload();
      else if (url.pathname === "/timeline") body = { posts: [], has_more: false, chat_jid: chatJid, user: { name: "Fixture User" }, agent: { name: "Fixture" } };
      else if (url.pathname === "/agent/addons/web-entries") body = { entries: [] };
      else if (url.pathname === "/agent/roster") body = { agents: [{ id: "default", name: "Fixture", avatar_url: agentAvatar }], default_agent: "default" };
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
      else if (url.pathname === "/agent/settings-data") body = { providers: [], toolsets: [], themes: [], colorKeys: [], uiTheme: "default" };
      else if (url.pathname === "/agent/picker-pins") body = { scope: "fixture", revision: 0, models: [], sessions: [] };
      else if (url.pathname === "/agent/skills") body = { skills: [] };
      else if (url.pathname === "/agent/plan") body = { plan: null };
      else if (url.pathname === "/manifest.json") body = { name: "Fixture", start_url: "/", icons: [], piclaw_avatar: agentAvatar };
      else if (url.pathname === "/sw.js") return route.fulfill({ contentType: "text/javascript", body: "// disposable fixture: no caching" });
      else if (url.pathname === "/favicon.ico" || url.pathname.startsWith("/apple-touch-icon")) return route.fulfill({ status: 404, body: "no synthetic icon pixels" });
      else if (url.pathname.startsWith("/avatar/")) return route.fulfill({ status: 404, body: "no fixture avatar" });
      else { unhandled.add(url.pathname); return route.fulfill({ status: 404, json: { error: "Unhandled fixture route" } }); }
      return route.fulfill({ json: body });
    });
    const emit = (kind: string, payload: unknown) => page.evaluate(({ kind, payload }) => (window as any).emitShellEvent(kind, payload), { kind, payload });
    try {
      await page.goto(`${server.url}?skin=${skin}&chat_jid=${encodeURIComponent(chatJid)}`, { waitUntil: "load" });
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await page.waitForTimeout(1000);
      const links = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('link[id^="dynamic-"]')).map(el => [el.id, el.getAttribute('href')])));
      const initial = await links();
      agentAvatar = '/avatar/agent?v=new';
      await emit('profile_update', { agent_id: 'default', agent_name: 'Fixture', agent_avatar: agentAvatar });
      await page.waitForTimeout(500);
      const changed = await links();
      expect(changed["dynamic-favicon"]).toBe("/favicon.ico?v=new");
      expect(changed["dynamic-manifest"]).toBe("/manifest.json?v=new");
      expect(changed["dynamic-apple-touch-icon-180"]).toBe("/apple-touch-icon-180x180.png?v=new");
      // A command/status event carries the stable unversioned avatar endpoint.
      await emit('agent_status', { chat_jid: chatJid, type: 'intent', agent_id: 'default', agent_name: 'Fixture', agent_avatar: '/avatar/agent' });
      await page.waitForTimeout(100);
      const command1 = await links();
      expect(command1['dynamic-favicon']).not.toBe(initial['dynamic-favicon']);
      await emit('agent_status', { chat_jid: chatJid, type: 'intent', agent_id: 'default', agent_name: 'Fixture', agent_avatar: '/avatar/agent' });
      await page.waitForTimeout(100);
      const command2 = await links();
      expect(command2).toEqual(command1);
      await emit('profile_update', { agent_id: 'default', agent_name: 'Fixture', agent_avatar: null });
      await page.waitForTimeout(100);
      const cleared = await links();
      expect(cleared['dynamic-favicon']).toBe('/favicon.ico?v=default');
      expect(cleared['dynamic-apple-touch-icon']).toBe('/apple-touch-icon.png?v=default');
      await emit('profile_update', {agent_id:'other', agent_name:'Other', agent_avatar:'/avatar/agent?v=other'});
      expect(await links()).toEqual(cleared);
      agentAvatar = '/avatar/agent?v=reloaded';
      await page.reload({ waitUntil: 'load' });
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await page.waitForTimeout(300);
      const reloaded = await links();
      expect(reloaded['dynamic-favicon']).toBe('/favicon.ico?v=reloaded');
      expect(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content')).toBe('Fixture');
      console.log('ICON_BROWSER_RESULT ' + JSON.stringify({ engineName, skin, initial, changed, command1, command2, cleared, reloaded, pageTitle: await page.title(), appleTitle: await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content') }));
      expect(errors).toEqual([]);
      expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("ICON_FAILURE", JSON.stringify({engineName,skin,errors,unhandled:[...unhandled],requests}));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 60000);
}
