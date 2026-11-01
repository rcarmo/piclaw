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
  for (const skin of ["classic", "visual"]) for (const touch of [false, true]) browserTest(`${engineName}: ${skin} ${touch ? 'touch' : 'desktop'} native backend owns near-capacity picker and settings admission`, async () => {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1024, height: 768 }, hasTouch: touch, isMobile: touch, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [], unhandled = new Set<string>(), requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const chatJid = "web:default:branch:cold-start";
    let model = "fixture/first", thinking = "high";
    let usage: { tokens: number | null; contextWindow: number | null; percent: number | null } = { tokens: 90000, contextWindow: 200000, percent: 45 };
    let refuse = true; const commands: string[] = []; const notices: string[] = [];
    const compactions: string[] = [];
    const pins = { scope: "fixture", revision: 0, models: [] as string[], sessions: [] as string[] };
    page.on("dialog", async dialog => { notices.push(dialog.message()); await dialog.dismiss(); });
    const modelPayload = () => ({ current: model, thinking_level: thinking, thinking_level_label: thinking, supports_thinking: true, available_model_count: 2, model_options: [{ provider: "fixture", id: "first", context_window: 200000 }, { provider: "fixture", id: "near", context_window: 100000 }], oobe: { provider_ready_completed_instance: true } });
    const contextPayload = () => ({ ...usage, contextUpdate: "replace", sessionGeneration: "fixture-generation" });
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
      window.addEventListener("piclaw:status-flash", (event: any) => { (window as any).capacityNotice = event.detail.message; });
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
      if (req.method() === "POST" && /\/agent\/[^/]+\/message$/.test(url.pathname)) {
        expect(url.searchParams.get("chat_jid")).toBe(chatJid);
        const content = req.postDataJSON().content;
        if (content === "/compact") {
          compactions.push(content);
          return route.fulfill({ json: { command: { status: "success", message: "Compacted" } } });
        }
        commands.push(content); expect(content).toBe("/model fixture/near");
        if (!refuse) model = "fixture/near";
        body = { command: refuse ? { status: "error", message: "Native capacity refused" } : { status: "success" } };
      }
      else if (url.pathname === "/agent/status") body = { status: { status: "idle", state: "idle", data: null }, model: modelPayload(), context: contextPayload(), metrics: { cpu_percent: 2, ram_percent: 12 }, agent_name: "Fixture", errors: [] };
      else if (url.pathname === "/agent/models") body = modelPayload();
      else if (url.pathname === "/agent/context") body = contextPayload();
      else if (url.pathname === "/timeline") body = { posts: [], has_more: false, chat_jid: chatJid, user: { name: "Fixture User" }, agent: { name: "Fixture" } };
      else if (url.pathname === "/agent/addons/web-entries") body = { entries: [] };
      else if (url.pathname === "/agent/roster") body = { agents: [], default_agent: "fixture" };
      else if (url.pathname === "/agent/branches") body = { chats: [{ chat_jid: chatJid, root_chat_jid: "web:default", branch_id: "cold-start", agent_name: "fixture" }] };
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
      else if (url.pathname === "/agent/picker-pins") {
        if (req.method() === "POST") {
          const change = req.postDataJSON();
          expect(change.action).toBe("set"); expect(change.kind).toBe("model");
          pins.models = change.pinned ? [change.key] : []; pins.revision++;
        }
        body = pins;
      }
      else if (url.pathname === "/agent/skills") body = { skills: [] };
      else if (url.pathname === "/agent/plan") body = { plan: null };
      else if (url.pathname === "/manifest.json") body = { name: "Fixture", start_url: "/", icons: [] };
      else if (url.pathname === "/sw.js") return route.fulfill({ contentType: "text/javascript", body: "// disposable fixture: no caching" });
      else if (url.pathname.startsWith("/avatar/")) return route.fulfill({ status: 404, body: "no fixture avatar" });
      else { unhandled.add(url.pathname); return route.fulfill({ status: 404, json: { error: "Unhandled fixture route" } }); }
      return route.fulfill({ json: body });
    });
    const badge = page.locator(skin === "classic" ? ".compose-model-hint-btn" : ".model-badge").filter({ visible: true }).first();
    const ring = page.locator(skin === "classic" ? ".compose-context-pie" : ".context-ring").filter({ visible: true }).first();
    const waitModel = async (value: string) => {
      await page.waitForFunction(({ skin, value }) => Array.from(document.querySelectorAll(skin === "classic" ? ".compose-model-hint-btn" : ".model-badge")).some(el => el.textContent?.includes(value)), { skin, value }, { timeout: 10000 });
      expect(await badge.innerText()).toContain(value);
    };
    const waitContext = async (value: number) => {
      const label = `${value / 1000}${skin === "classic" ? "K" : "k"}`;
      await page.waitForFunction(({ skin, label }) => Array.from(document.querySelectorAll(skin === "classic" ? ".compose-context-pie" : ".context-ring")).some(el => el.getAttribute("title")?.includes(`Context: ${label} /`)), { skin, label }, { timeout: 10000 });
      expect(await ring.getAttribute("title")).toContain(`Context: ${label} /`);
    };
    const emit = (kind: string, payload: unknown) => page.evaluate(({ kind, payload }) => (window as any).emitShellEvent(kind, payload), { kind, payload });
    try {
      await page.goto(`${server.url}?skin=${skin}&chat_jid=${encodeURIComponent(chatJid)}`, { waitUntil: "load" });
      await page.locator('textarea,[contenteditable="true"]').first().waitFor();
      await waitModel("first");
      expect(await badge.getAttribute("title")).toContain("high");
      await waitContext(90000);
      // Same backend snapshot, in the shipped shells: never apply 1.1 + 4000 again.
      const project = async (next: typeof usage, title: string) => {
        usage = next;
        await emit("agent_status", { chat_jid: chatJid, type: "context_usage", context_usage: contextPayload() });
        await page.waitForFunction(({ skin, title }) => Array.from(document.querySelectorAll(skin === "classic" ? ".compose-context-pie" : ".context-ring")).some(el => el.getAttribute("title") === title), { skin, title });
        expect(await ring.getAttribute("title")).toBe(title);
        expect(await ring.getAttribute("aria-label")).toBe(title);
      };
      const title = (counts: string, percent: string) => `Context: ${counts} tokens (${percent})\nCompact context`;
      await project({ tokens: 80000, contextWindow: 100000, percent: 80 }, title(skin === "classic" ? "80K / 100K" : "80k / 100k", "80%"));
      await project({ tokens: 80000, contextWindow: 100000, percent: null }, title(skin === "classic" ? "80K / 100K" : "80k / 100k", "unavailable"));
      await project({ tokens: null, contextWindow: null, percent: null }, title(skin === "classic" ? "? / ?" : "-- / --", "unavailable"));
      await project({ tokens: 0, contextWindow: 100000, percent: 0 }, title(skin === "classic" ? "0 / 100K" : "0k / 100k", "0%"));
      expect(commands).toEqual([]); expect(compactions).toEqual([]);
      // Keep the existing compact control, native button/keyboard semantics and touch target.
      const compactResponse = () => page.waitForResponse(response => response.url().includes("/agent/") && response.request().postData()?.includes("/compact") === true);
      for (const key of ["Enter", "Space"]) {
        await ring.focus(); expect(await ring.evaluate(el => el === document.activeElement)).toBe(true);
        const response = compactResponse(); await ring.press(key); await response;
        await page.waitForFunction(() => !document.querySelector('.compose-context-pie[disabled],.compaction-badge'));
      }
      const response = compactResponse();
      if (touch) await ring.tap(); else await ring.click();
      await response;
      expect(compactions).toEqual(["/compact", "/compact", "/compact"]);
      expect(commands).toEqual([]);
      await project({ tokens: 90000, contextWindow: 200000, percent: 45 }, title(skin === "classic" ? "90K / 200K" : "90k / 200k", "45%"));
      // Candidate is selectable by keyboard despite the old browser false veto.
      await badge.click();
      const search = page.getByRole("combobox", { name: "Search models" });
      await search.fill("near");
      const option = page.getByRole("option").filter({ hasText: "fixture/near" });
      await option.waitFor(); expect(await option.isEnabled()).toBe(true);
      await page.waitForFunction(() => document.querySelector('[role="combobox"]')?.getAttribute('aria-activedescendant')?.endsWith('near'));
      await search.press("Alt+Enter");
      await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="option"]')).some(node => node.getAttribute('aria-label')?.includes('fixture/near, pinned.')));
      await search.press("Escape");
      await page.waitForFunction(() => document.activeElement?.matches('.compose-model-hint-btn,.model-badge'));
      await badge.click(); await search.fill("near");
      const refusalDialog = skin === "classic" ? page.waitForEvent("dialog") : null;
      await search.press("ArrowDown"); await search.press("Enter");
      if (skin === "visual") await page.waitForFunction(() => (window as any).capacityNotice === "Native capacity refused");
      else {
        await refusalDialog;
        await page.waitForFunction(() => !document.querySelector('.compose-model-hint-btn[disabled]'));
      }
      expect(commands).toEqual(["/model fixture/near"]);
      expect(model).toBe("fixture/first");
      if (skin === "classic") expect(notices).toEqual(["Failed to switch model: Native capacity refused"]);
      else expect(await page.evaluate(() => (window as any).capacityNotice)).toBe("Native capacity refused");
      refuse = false;
      // Pointer selection uses the same backend authority; no implicit compaction.
      if (touch) await option.tap(); else await option.click();
      await waitModel("near");
      expect(commands).toEqual(["/model fixture/near", "/model fixture/near"]);
      expect(await search.count()).toBe(0);
      // Restore the fixture backend choice and exercise the shipped Models pane.
      model = "fixture/first";
      await emit("model_changed", { chat_jid: chatJid, ...modelPayload() });
      await waitModel("first");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "models" } })));
      const row = page.getByRole("option").filter({ hasText: "fixture/near" });
      await row.waitFor(); await row.click();
      const use = page.getByRole("button", { name: "Use for current chat", exact: true });
      expect(await use.isEnabled()).toBe(true);
      refuse = true; await use.click();
      await page.getByText("Native capacity refused", { exact: true }).first().waitFor();
      expect(commands).toHaveLength(3); expect(model).toBe("fixture/first");
      refuse = false; await use.click();
      await page.getByRole("button", { name: "Current model", exact: true }).waitFor();
      expect(model).toBe("fixture/near"); expect(commands).toHaveLength(4);
      expect(errors).toEqual([]);
      expect([...unhandled]).toEqual([]);
    } catch (error) {
      console.log("SHELL_FAILURE", JSON.stringify({ engineName, skin, errors, unhandled: [...unhandled], requests, body: (await page.locator("body").innerText()).slice(-2500), badges: await page.locator(".model-badge-wrapper,.compose-model-meta").evaluateAll(nodes => nodes.map(n => n.outerHTML)), scripts: await page.locator("script[src]").evaluateAll(nodes => nodes.map(n => n.getAttribute("src"))) }));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }, 60000);
}
