import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// Long measurements are deliberately separate from ordinary optional browser regressions.
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" && process.env.PICLAW_RUN_IDLE_CPU_PROFILE === "1";
const browserTest = enabled ? test : test.skip;
const webRoot = resolve(import.meta.dir, "../../web");
const output = resolve(import.meta.dir, "../../../.artifacts/browser-idle-cpu");
function duration(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 120000) throw new Error(`${name} must be 1000–120000 milliseconds`);
  return value;
}
const settleMs = duration("PICLAW_IDLE_SETTLE_MS", 30000);
const measureMs = duration("PICLAW_IDLE_MEASURE_MS", 60000);
const selected = process.env.PICLAW_IDLE_CASES?.split(",");
const profileEnabled = process.env.PICLAW_IDLE_PROFILE === "1";
const useBaselineAssets = process.env.PICLAW_IDLE_BASELINE_ASSETS === "1";
const headed = process.env.PICLAW_IDLE_HEADED === "1";
let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
const results: unknown[] = [];
const metrics = { cpu_percent: 2, ram_percent: 12, swap_percent: 0, vram_percent: null, gpu_provider: null, buffers_bytes: 0, cached_bytes: 0, process_memory: { rss_bytes: 128 * 1024 * 1024 }, uptime: 100, hostname: "fixture" };
const status = { status: "idle", state: "idle", data: null, model: "fixture/model", extension_working: { message: null, indicator: null } };

beforeAll(async () => {
  if (!enabled) return;
  await mkdir(output, { recursive: true });
  if (useBaselineAssets && !await Bun.file(resolve(output, "../baseline-assets/app.bundle.js")).exists()) throw new Error("Missing baseline Classic bundle; see the issue1352 profiling runbook.");
  browser = await chromium.launch({ headless: !headed });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url);
    const skin = "classic";
    if (url.pathname === "/blank") return new Response("<!doctype html><title>Idle baseline</title><p>Idle baseline</p>", { headers: { "content-type": "text/html" } });
    if (url.pathname === "/") return new Response(Bun.file(join(webRoot, `static/${skin}/index.html`)), { headers: { "content-type": "text/html" } });
    if (useBaselineAssets && ["/static/classic/dist/app.bundle.js"].includes(url.pathname)) {
      const name = "app.bundle.js";
      return new Response(Bun.file(resolve(output, "../baseline-assets/" + name)), { headers: { "content-type": "text/javascript" } });
    }
    if (url.pathname === "/editor-vendor/codemirror.js") return new Response(Bun.file(resolve(webRoot, "../extensions/viewers/editor/vendor/codemirror.js")), { headers: { "content-type": "text/javascript" } });
    if (url.pathname.startsWith("/static/")) {
      const path = resolve(webRoot, url.pathname.slice(1));
      if (!path.startsWith(webRoot + "/static/")) return new Response(null, { status: 404 });
      const f = Bun.file(path);
      return await f.exists() ? new Response(f) : new Response(null, { status: 404 });
    }
    return Response.json({ error: "Unexpected fixture server request", path: url.pathname }, { status: 404 });
  } });
}, 30000);
afterAll(async () => {
  await browser?.close(); server?.stop(true);
  if (results.length) await writeFile(join(output, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), engine: headed ? "Chromium/Xvfb" : "Chromium/headless", browserVersion: browser?.version(), settleMs, measureMs, profileEnabled, useBaselineAssets, results }, null, 2) + "\n");
});

async function open(skin: string, postCount: number, instrument: boolean, reducedMotion: "reduce" | "no-preference" = "reduce", width = 1366, theme = "default") {
  const context = await browser.newContext({ viewport: { width, height: 820 }, reducedMotion });
  const page = await context.newPage();
  const errors: string[] = [], requests: string[] = [], unhandled = new Set<string>();
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(({ instrument, theme }) => {
    localStorage.setItem("piclaw_theme", theme);
    localStorage.setItem("piclaw_wizard_dismissed", "1");
    localStorage.setItem("piclaw-active-panel", "chat");
    localStorage.setItem("piclaw_workspace_visible", "false");
    localStorage.setItem("workspaceOpen.desktop", "false");
    const sources: EventTarget[] = [];
    class QuietEventSource extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      readyState = 0; onopen: any; onerror: any; onmessage: any;
      constructor(public url: string) {
        super(); sources.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event("open")); this.dispatchEvent(new Event("open")); this.dispatchEvent(new MessageEvent("connected", { data: JSON.stringify({ chat_jid: "web:default" }) })); }, 0);
      }
      close() { this.readyState = 2; const i = sources.indexOf(this); if (i >= 0) sources.splice(i, 1); }
    }
    Object.defineProperty(window, "EventSource", { value: QuietEventSource });
    (window as any).__idleFixtureEmit = (kind: string) => sources.forEach(s => s.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify(kind === "heartbeat" ? {} : { type: "context_usage", chat_jid: "web:default", context_usage: null }) })));
    const counts = { timeout: 0, interval: 0, raf: 0, mutations: 0, mutationNodes: 0, values: [] as string[], targets: {} as Record<string, number>, sources: {} as Record<string, number> };
    (window as any).__idleCounts = counts;
    if (!instrument) return;
    const source = () => new Error().stack?.split("\n").slice(3, 6).join("\n") || "unknown";
    for (const name of ["setTimeout", "setInterval", "requestAnimationFrame"] as const) {
      const original = window[name].bind(window) as any;
      const counter = name === "setTimeout" ? "timeout" : name === "setInterval" ? "interval" : "raf";
      (window as any)[name] = (callback: any, ...args: any[]) => {
        if (typeof callback !== "function") return original(callback, ...args);
        const origin = `${name}:${args[0] ?? ""}:` + source();
        return original((...params: any[]) => { counts[counter]++; counts.sources[origin] = (counts.sources[origin] || 0) + 1; callback(...params); }, ...args);
      };
    }
    addEventListener("DOMContentLoaded", () => new MutationObserver(records => { counts.mutations += records.length; counts.mutationNodes += records.reduce((n, r) => n + r.addedNodes.length + r.removedNodes.length, 0); for (const r of records) { const n = r.target instanceof Element ? r.target : r.target.parentElement; const k = `${n?.tagName}.${n?.className}:${r.attributeName || r.type}`; counts.targets[k] = (counts.targets[k] || 0) + 1; if (k.includes("compose-model-meta-subline") && counts.values.length < 10) counts.values.push(r.target.textContent || ""); } }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }));
  }, { instrument, theme });
  const posts = Array.from({ length: postCount }, (_, i) => ({ id: i + 1, timestamp: "2026-09-01T12:00:00.000Z", data: { content: `Fixture note ${i + 1}. A short settled message with **static text**.`, sender: i % 2 ? "agent" : "user", sender_name: i % 2 ? "Fixture Agent" : "Fixture User", is_from_me: false, chat_jid: "web:default", attachments: [] } }));
  await page.route("**/*", async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== server.url.origin) return route.abort();
    if (u.pathname === "/" || u.pathname === "/blank" || u.pathname.startsWith("/static/") || u.pathname === "/editor-vendor/codemirror.js") return route.continue();
    requests.push(`${req.method()} ${u.pathname}`);
    let body: unknown;
    if (u.pathname === "/timeline") body = { posts, has_more: false, chat_jid: "web:default", user: { name: "Fixture User" }, agent: { name: "Fixture Agent" } };
    else if (u.pathname === "/agent/status") body = u.searchParams.get('ui') === '1' ? {
      status, model: { current: 'fixture/model', models: ['fixture/model'], model_options: [], thinking_level: 'off', supports_thinking: false, oobe: {provider_ready_completed_instance:true} },
      context: { tokens: null, percent: null, contextWindow: null, cacheUsage: null }, metrics, agent_name: 'Fixture Agent', errors: [],
    } : status;
    else if (u.pathname === "/agent/context") body = { context: null, usage: null };
    else if (u.pathname === "/agent/models") body = { current: "fixture/model", models: ["fixture/model"], model_options: [], thinking_level: "off", supports_thinking: false, oobe: { provider_ready_completed_instance: true } };
    else if (u.pathname === "/agent/system-metrics") body = metrics;
    else if (u.pathname === "/agent/addons/web-entries") body = { entries: [] };
    else if (u.pathname === "/agent/picker-pins") body = { scope: "fixture-operator", revision: 0, models: [], sessions: [], import_needed: false };
    else if (u.pathname === "/agent/roster") body = { agents: [], default_agent: "fixture" };
    else if (u.pathname === "/agent/branches") body = { branches: [{ chat_jid: "web:default", root_chat_jid: "web:default", branch_id: "fixture-root", agent_name: "fixture" }] };
    else if (u.pathname === "/agent/active-chats") body = { chats: [{ chat_jid: "web:default", root_chat_jid: "web:default", agent_name: "fixture", is_active: false }] };
    else if (u.pathname === "/agent/queue") body = { items: [], queue: [] };
    else if (u.pathname === "/workspace/tree") body = { root: { name: "fixture", path: "", type: "directory", children: [] }, entries: [], tree: [] };
    else if (u.pathname === "/workspace/index-status") body = { state: "ready", indexed_file_count: 0, roots: [] };
    else if (u.pathname === "/workspace/visibility") body = { visible: false, open: false };
    else if (u.pathname === "/agent/settings/quick-actions") body = { actions: [], items: [] };
    else if (u.pathname === "/agent/commands") body = { commands: [] };
    else if (u.pathname === "/agent/push/presence") body = { ok: true };
    else if (u.pathname === "/agent/queue-state") body = { items: [], queue: [], queued: [] };
    else if (u.pathname === "/agent/autoresearch/status") body = { enabled: false, active: false };
    else if (u.pathname === "/auth/me") body = { mode: "single-user", authenticated: false };
    else if (u.pathname === "/agent/settings-data") body = { providers: [], toolsets: [], themes: [], colorKeys: [], uiTheme: theme };
    else if (u.pathname === "/agent/client-perf") body = { ok: true };
    else if (u.pathname.startsWith("/avatar/")) return route.fulfill({ status: 404, body: "no fixture avatar" });
    else if (u.pathname === "/agent/skills") body = { skills: [] };
    else if (u.pathname === "/agent/plan") body = { plan: null };
    else { unhandled.add(u.pathname); return route.fulfill({ status: 404, json: { error: "Unhandled fixture route" } }); }
    return route.fulfill({ json: body });
  });
  await page.goto(`${server.url}?skin=${skin}`, { waitUntil: "load" });
  {
    try { await page.locator('textarea,[contenteditable="true"]').first().waitFor({ timeout: 12000 }); }
    catch (error) { console.log("BOOT_FAILURE", JSON.stringify({ skin, errors, requests, unhandled: [...unhandled], body: (await page.locator("body").innerText()).slice(0, 1800) })); await context.close(); throw error; }
  }
  return { page, errors, requests, unhandled };
}
async function counters(page: Page) {
  return page.evaluate(() => ({ ...(window as any).__idleCounts, sources: { ...(window as any).__idleCounts.sources }, targets: { ...(window as any).__idleCounts.targets }, animations: document.getAnimations().map(a => ({ playState: a.playState, name: (a as CSSAnimation).animationName, iterations: a.effect?.getTiming().iterations })) }));
}
const cases = [
  { id: "blank", skin: "blank", posts: 0, traffic: false, instrument: true },
  { id: "classic-idle", skin: "classic", posts: 10, traffic: false, instrument: true },
  { id: "classic-minimal", skin: "classic", posts: 10, traffic: true, instrument: true },
  { id: "classic-long", skin: "classic", posts: 200, traffic: true, instrument: true },
  { id: "classic-control", skin: "classic", posts: 10, traffic: false, instrument: false },
  { id: "classic-full", skin: "classic", posts: 10, traffic: false, instrument: true, motion: "no-preference" as const, theme: "synthwave-84-full" },
  { id: "classic-motion", skin: "classic", posts: 10, traffic: false, instrument: true, motion: "no-preference" as const },
  { id: "classic-hidden-simulated", skin: "classic", posts: 10, traffic: true, instrument: true, hidden: true },
];
if (selected?.some(id => !cases.some(c => c.id === id))) throw new Error("Unknown idle profile case");
for (const config of cases.filter(c => !selected || selected.includes(c.id))) browserTest(`browser idle profile ${config.id}`, async () => {
  const f = await open(config.skin, config.posts, config.instrument, config.motion, config.width, config.theme), { page } = f;
  let timer: ReturnType<typeof setInterval> | undefined;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Performance.enable");
    if (config.traffic) timer = setInterval(() => { void page.evaluate(() => { (window as any).__idleFixtureEmit("heartbeat"); (window as any).__idleFixtureEmit("agent_status"); }).catch(error => { f.errors.push(`Fixture SSE injection failed: ${String(error)}`); }); }, 5000);
    await page.waitForTimeout(settleMs);
    const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m: any) => [m.name, m.value]));
    if (config.hidden) {
      // Playwright/Xvfb keeps both targets visible here. Exercise app handlers
      // explicitly; this is NOT browser background throttling evidence.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    const before = await read(), beforeCounts = await counters(page), beforeRequests = f.requests.length;
    if (profileEnabled) { await client.send("Profiler.enable"); await client.send("Profiler.start"); }
    await page.waitForTimeout(measureMs);
    if (profileEnabled) { const profile = await client.send("Profiler.stop"); await writeFile(join(output, `${config.id}.cpuprofile`), JSON.stringify(profile.profile)); }
    const after = await read(), afterCounts = await counters(page);
    const diff = Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount"].map(k => [k, (after[k] || 0) - (before[k] || 0)]));
    const origins = Object.entries(afterCounts.sources).map(([key, value]) => ({ origin: key, callbacks: Number(value) - Number(beforeCounts.sources[key] || 0) })).filter(x => x.callbacks).sort((a, b) => b.callbacks - a.callbacks).slice(0, 12);
    const measuredRequests = f.requests.slice(beforeRequests);
    const requestCounts = measuredRequests.reduce((counts, request) => { counts[request] = (counts[request] || 0) + 1; return counts; }, {} as Record<string, number>);
    const result = { ...config, theme: await page.locator("html").getAttribute("data-color-theme"), requestCounts, taskCpuEquivalentPercent: diff.TaskDuration / (measureMs / 1000) * 100, durations: diff,
      counts: Object.fromEntries(["timeout", "interval", "raf", "mutations", "mutationNodes"].map(k => [k, afterCounts[k] - beforeCounts[k]])), origins,
      values: afterCounts.values,
      targets: Object.entries(afterCounts.targets).map(([target, count]) => ({ target, mutations: Number(count) - Number(beforeCounts.targets[target] || 0) })).filter(x => x.mutations).sort((a,b) => b.mutations-a.mutations).slice(0,12),
      requests: measuredRequests, unhandled: [...f.unhandled], errors: f.errors, animations: afterCounts.animations, visibility: await page.evaluate(() => document.visibilityState), pageText: (await page.locator("body").innerText()).slice(0, 1100) };
    results.push(result); console.log(JSON.stringify(result));
    expect(f.errors).toEqual([]);
    expect([...f.unhandled]).toEqual([]);
    expect(Number.isFinite(result.taskCpuEquivalentPercent)).toBe(true);
    if (!useBaselineAssets && config.skin !== 'blank') {
      // The deterministic fixture has no model changes or turn completions.
      // Both skins must share status/model/context/metrics at the 5s cadence.
      const polls = requestCounts['GET /agent/status'] || 0;
      expect(polls).toBeGreaterThanOrEqual(Math.floor(measureMs / 5000) - 1);
      expect(polls).toBeLessThanOrEqual(Math.ceil(measureMs / 5000) + 1);
      for (const path of ['/agent/models','/agent/context','/agent/system-metrics','/agent/roster']) {
        expect(requestCounts[`GET ${path}`] || 0).toBe(0);
      }
    }
    if (config.hidden) {
      await page.evaluate(() => {
        delete (document as any).visibilityState;
        delete (document as any).hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() => document.visibilityState === "visible");
      expect(await page.locator('textarea,[contenteditable="true"]').first().isVisible()).toBe(true);
    }
  } finally { if (timer) clearInterval(timer); await client.detach(); await page.context().close(); }
}, settleMs + measureMs + 45000);
