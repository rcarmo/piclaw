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
  for (const skin of ["classic", "visual"]) browserTest(`${engineName}: ${skin} About versions and window workspace state`, async () => {
    const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' && process.env.PICLAW_TEST_CHROMIUM_PATH ? {executablePath:process.env.PICLAW_TEST_CHROMIUM_PATH} : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default";
    const model = "fixture/first", thinking = "high", tokens = 1000;
    const versions={piclaw:'3.2.5',piAi:'0.99.1',bun:'1.4.2'};
    const settings={providers:[],toolsets:[],themes:[],colorKeys:[],uiTheme:'default',runtimeVersions:versions};
    let aboutFail=false;
    let aboutRequests=0;
    const modelPayload = () => ({ current: model, thinking_level: thinking, thinking_level_label: thinking, supports_thinking: true, available_model_count: 2, model_options: [{ id: model, context_window: 200000 }], oobe: { provider_ready_completed_instance: true } });
    const contextPayload = () => ({ tokens, percent: tokens / 2000, contextWindow: 200000, sessionGeneration: "fixture-generation" });
    await context.addInitScript(({ chatJid }) => {
      localStorage.setItem("piclaw_wizard_dismissed", "1");
      localStorage.setItem("piclaw-active-panel", "chat");
      localStorage.setItem("piclaw_workspace_visible", "false");
      if (localStorage.getItem("workspaceOpen.desktop") === null) localStorage.setItem("workspaceOpen.desktop", "true");
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
    await context.route("**/*", async route => {
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
      else if (url.pathname === '/agent/about') { aboutRequests++; return route.fulfill({status:aboutFail?503:200,json:aboutFail?{error:'fixture'}:versions}); }
      else if (url.pathname === '/workspace/branch') body={branch:null};
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
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await page.waitForFunction(()=>new URL(location.href).searchParams.get('chat_jid')==='web:default');
      if(skin==='classic') {
        const toggle=page.locator('.workspace-toggle-tab');
        await toggle.waitFor();
        expect(await toggle.getAttribute('aria-expanded')).toBe('true');
        await toggle.click();
        expect(await toggle.getAttribute('aria-expanded')).toBe('false');
        const second=await context.newPage();
        second.on('pageerror',e=>errors.push(e.message));
        await second.goto(server.url+'?skin='+skin+'&chat_jid='+encodeURIComponent(chatJid),{waitUntil:'load'});
        const otherToggle=second.locator('.workspace-toggle-tab');
        await otherToggle.waitFor();
        expect(await otherToggle.getAttribute('aria-expanded')).toBe('false');
        await otherToggle.click();
        expect(await otherToggle.getAttribute('aria-expanded')).toBe('true');
        await page.bringToFront();
        await page.evaluate(()=>{
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
          document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(await toggle.getAttribute('aria-expanded')).toBe('false');
        await page.reload({waitUntil:'load'});await toggle.waitFor();
        expect(await toggle.getAttribute('aria-expanded')).toBe('false');
        await second.reload({waitUntil:'load'});await otherToggle.waitFor();
        expect(await otherToggle.getAttribute('aria-expanded')).toBe('true');
        await second.close();
        await page.bringToFront();
        expect(await toggle.getAttribute('aria-expanded')).toBe('false');
        await toggle.click();
        await page.waitForFunction(()=>document.querySelector('.workspace-toggle-tab')?.getAttribute('aria-expanded')==='true');
        const menuButton=page.getByTestId('hamburger');
        const openAbout=async()=>{
          await menuButton.click();
          const menu=page.locator('.timeline-menu-dropdown[role="menu"]');
          expect(await menu.getByRole('menuitem').last().innerText()).toBe('About…');
          expect(await menu.locator('.workspace-menu-scale-control').evaluate(el => el.nextElementSibling?.classList.contains('workspace-menu-language'))).toBe(true);
          await menu.getByRole('menuitem',{name:'About…',exact:true}).click();
          return page.getByRole('dialog',{name:'About',exact:true});
        };
        let dialog=await openAbout();
        await dialog.locator('.about-version').last().waitFor();
        expect(await dialog.locator('dt').allTextContents()).toEqual(['PiClaw','pi-ai','Bun']);
        expect(await dialog.locator('dd').allTextContents()).toEqual(Object.values(versions));
        expect(await dialog.getByRole('link').count()).toBe(3);
        expect(await dialog.getByRole('link').first().getAttribute('href')).toBe('https://github.com/rcarmo/piclaw');
        expect(await dialog.getByRole('link').nth(1).getAttribute('href')).toBe('https://github.com/earendil-works/pi/tree/main/packages/ai');
        expect(await dialog.getByRole('link').last().getAttribute('href')).toBe('https://github.com/oven-sh/bun');
        for(const link of await dialog.getByRole('link').all()) {
          expect(await link.getAttribute('target')).toBe('_blank');
          expect(await link.getAttribute('rel')).toContain('noopener');
        }
        const close=dialog.getByRole('button',{name:'Close About'});
        await close.focus();await page.keyboard.press('Shift+Tab');
        expect(await dialog.getByRole('link').last().evaluate(el=>el===document.activeElement)).toBe(true);
        await page.keyboard.press('Tab');
        expect(await close.evaluate(el=>el===document.activeElement)).toBe(true);
        await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
        expect(await menuButton.evaluate(el=>el===document.activeElement)).toBe(true);
        aboutFail=true;dialog=await openAbout();
        await dialog.getByText('Unable to load versions.').waitFor();
        expect(await dialog.locator('.about-version').count()).toBe(0);
        await dialog.getByRole('button',{name:'Close About'}).click();
        aboutFail=false;dialog=await openAbout();await dialog.locator('.about-version').last().waitFor();
        await page.setViewportSize({width:390,height:844});
        const box=await dialog.boundingBox();expect(box!.width).toBeLessThanOrEqual(390);expect(box!.x).toBeGreaterThanOrEqual(0);
        await page.emulateMedia({colorScheme:'light'});
        await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
        expect(await dialog.locator('dd').allTextContents()).toEqual(Object.values(versions));
        await dialog.getByRole('button',{name:'Close About'}).click();
        await page.setViewportSize({width:1280,height:850});
        expect(aboutRequests).toBe(3);
      }
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('piclaw:open-settings',{detail:{section:'general'}})));
      const content=page.locator(skin==='classic'?'.settings-content':'.settings-panel__content').filter({visible:true});
      const about=content.locator('.settings-about');
      await about.locator('.about-version').last().waitFor();
      await about.getByRole('link',{name:'PiClaw 3.2.5 on GitHub',exact:true}).waitFor();
      expect(await about.locator('dd').allTextContents()).toEqual(Object.values(versions));
      expect(await about.locator('dt').allTextContents()).toEqual(['PiClaw','pi-ai','Bun']);
      expect(await about.evaluate(el=>el===el.parentElement!.lastElementChild)).toBe(true);
      expect(await about.getByRole('link').count()).toBe(3);
      expect(errors).toEqual([]);expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("SHELL_FAILURE", JSON.stringify({ engineName, skin, errors, unhandled: [...unhandled], requests, workspace: await page.locator('.workspace-sidebar,.workspace-menu-button,.workspace-toggle-tab').evaluateAll(nodes=>nodes.map(el=>({class:el.className,rect:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,expanded:el.getAttribute('aria-expanded')}))), state: await page.evaluate(()=>({url:location.href,local:localStorage.getItem('workspaceOpen.desktop'),session:sessionStorage.getItem('workspaceOpen.window')})), body: (await page.locator("body").innerText()).slice(-2500), badges: await page.locator(".model-badge-wrapper,.compose-model-meta").evaluateAll(nodes => nodes.map(n => n.outerHTML)), scripts: await page.locator("script[src]").evaluateAll(nodes => nodes.map(n => n.getAttribute("src"))) }));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 90000);
}
