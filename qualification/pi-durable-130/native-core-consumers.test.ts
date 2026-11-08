import "./src/test-guard.js";
import { admitAddonLocalRequest } from "../../runtime/src/addons/local-context.js";
import { getExtensionKvStore } from "../../runtime/src/extension-kv-registry.js";
import { test, expect, spyOn } from "bun:test";
import { cpSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";
import { SessionManager, SettingsManager, ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeChatMetadata, storeMessage } from "../../runtime/src/db.js";
import { extensionKvSet } from "../../runtime/src/db/extension-kv.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { registerOwnedAddonConfigApi, handleRegisteredAddonConfigApiRequest } from "../../runtime/src/channels/web/handlers/addon-config-api.js";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";

const slugs = ["code-review", "delegate", "goal", "observability", "plan-sidebar", "restic", "session-dashboard"];
for (const accounted of [false, true]) test(`all seven shipped consumers admit actual native startup and Restic effects without legacy sessions; accounted=${accounted}`, async () => {
  if (!process.env.PICLAW_NATIVE_CORE_CHILD) {
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE; delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolated = ensureTestFilesystemIsolation(env);
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path, '--test-name-pattern', `accounted=${accounted}$`], { cwd: import.meta.dir, env: { ...env, PICLAW_NATIVE_CORE_CHILD: "1" }, stdout: "pipe", stderr: "pipe" });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, out + err).toBe(0);
    } finally { isolated.cleanup(); }
    return;
  }
  const source = process.env.DURABLE_CORE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_CORE_ADDONS_ROOT must contain the approved native core add-ons");
  const workspace = process.env.PICLAW_WORKSPACE!;
  for (const slug of slugs) {
    const from = join(source, "addons", slug), to = join(workspace, ".pi/extensions/node_modules/@rcarmo", `piclaw-addon-${slug}`);
    cpSync(from, to, { recursive: true, filter: path => basename(path) !== "node_modules" });
    symlinkSync(join(import.meta.dir, slug === "observability" ? "node_modules" : "../../node_modules"), join(to, "node_modules"));
  }
  const loadAddon = (slug: string, file: string) => import(pathToFileURL(join(workspace, ".pi/extensions/node_modules/@rcarmo", `piclaw-addon-${slug}`, file)).href);
  const { ResticService } = await loadAddon("restic", "service.ts");
  const { resticRuntime } = await loadAddon("restic", "runtime-state.ts");
  const service = new ResticService({ paths: { sources: [{ name: "workspace", path: workspace }], stateDir: join(workspace, "backup-state"), stageDir: join(workspace, "backup-stage"), cacheDir: join(workspace, "backup-cache") },
    resolveSecret: async () => { throw Error("No secret retrieval"); }, run: async () => { throw Error("No backup subprocess"); } });
  const previousService = resticRuntime().service; resticRuntime().service = service;
  const saved = { ...service.configurationSnapshot().config, excludes: ["native-owned-config"] };
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "core-consumers.lock"), strictOwnership: true, disabled: false });
  initDatabase(); const root = getDb(); storeChatMetadata("web:default", new Date().toISOString());
  root.transaction(() => extensionKvSet("observability", "config", { instance_name: "native-persisted-instance", enabled: true, appinsights_enabled: false, graphite_enabled: false, appinsights_live_metrics: false }, "global")).immediate();
  const provider = accounted ? 'github-copilot' : 'synthetic';
  if (accounted) {
    mkdirSync(getPiclawAgentDir(), { recursive: true });
    writeFileSync(join(getPiclawAgentDir(), 'auth.json'), JSON.stringify({ 'github-copilot': {
      type: 'oauth', access: 'fixture-only', refresh: 'fixture-only-account', expires: Date.now() + 3600000,
    } }));
  }
  const model = { provider, id: "approved", name: "Approved", api: "openai-completions" as const, baseUrl: "https://invalid.invalid", input: ["text" as const], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: accounted ? 1 : 0, output: accounted ? 1 : 0, cacheRead: 0, cacheWrite: 0 } };
  const sequence = [{ action: "get_config", config: null }, { action: "set_config", config: saved }, { action: "status", config: null }];
  let calls = 0;
  let expectedInstance = "native-persisted-instance";
  const credentials = createTestCredentialStore({ [provider]: { type: "api_key", key: "fixture-only" } });
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, credentials, allowModelNetwork: false, refreshOnCreate: false });
  const stream = (_physical: unknown, input: unknown) => {
    expect(JSON.stringify(input)).toContain("## Observability");
    expect(JSON.stringify(input)).toContain(expectedInstance);
    expect(JSON.stringify(input)).toContain("OTel tracing active");
    expect(JSON.stringify(input)).not.toContain("Live Metrics enabled.");
    const step = calls++, output = createAssistantMessageEventStream();
    const message = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: step < sequence.length ? [{ type: "toolCall" as const, id: `restic-${step}`, name: "restic", arguments: sequence[step]! }] : [{ type: "text" as const, text: "Native core consumers complete" }],
      stopReason: step < sequence.length ? "toolUse" as const : "stop" as const,
      usage: { input: 1, output: 1, reasoning: 1, providerCost: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: accounted ? .000001 : 0, output: accounted ? .000001 : 0, cacheRead: 0, cacheWrite: 0, total: accounted ? .000002 : 0 } } };
    queueMicrotask(() => { output.push({ type: "done", reason: message.stopReason, message }); output.end(message); });
    return output;
  };
  runtime.registerNativeProvider({ id: provider, name: "Synthetic", getModels: () => [model] as any,
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }), resolve: async () => ({ auth: { apiKey: "fixture-only" }, source: "synthetic" }) } }, stream: stream as any, streamSimple: stream as any });
  await runtime.refresh({ allowNetwork: false }); await runtime.getAvailable();
  const settings = SettingsManager.create(workspace, getPiclawAgentDir()); settings.setDefaultModelAndProvider(provider, "approved"); await settings.flush();
  const spies = [spyOn(SessionManager, "create"), spyOn(SessionManager, "open"), spyOn(SessionManager, "inMemory")];
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => ({ modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime) } as RuntimeModelServices));
    const configUrl = "http://fixture/agent/addons/api/observability/config";
    const admitted = (request: Request) => {
      admitAddonLocalRequest(request, { userId: "default", mode: "single-user" }, () => !request.signal.aborted);
      return request;
    };
    const respond = (body: unknown, status = 200) => Response.json(body, { status });
    // Exercise the real request/transaction authority after legacy preflight invalidation.
    const denied = await handleRegisteredAddonConfigApiRequest(new Request(configUrl), "observability", "config", respond);
    expect(await denied!.json()).toEqual({ error: "Authenticated configuration owner required" });
    const kv = getExtensionKvStore();
    const probe = registerOwnedAddonConfigApi("observability", "authority-regression", {
      async get() { await Promise.resolve(); await kv.write!("observability", () => kv.set("observability", "authority-probe", true, "global")); },
      async set(payload, request) {
        await Promise.resolve();
        if (payload === "expire") controllers.get(request)!.abort();
        await kv.write!("observability", () => kv.set(payload === "cross-namespace" ? "goal" : "observability", "authority-probe", true, "global"));
      },
    }, "synthetic-authority-regression");
    const controllers = new WeakMap<Request, AbortController>();
    try {
      for (const [method, payload, error] of [
        ["GET", undefined, "Extension KV scope denied"],
        ["POST", "cross-namespace", "Extension KV scope denied"],
        ["POST", "expire", "Configuration request expired"],
      ] as const) {
        const controller = new AbortController();
        const request = new Request(configUrl, { method, signal: controller.signal,
          ...(payload ? { body: JSON.stringify(payload) } : {}) });
        controllers.set(request, controller);
        const response = await handleRegisteredAddonConfigApiRequest(admitted(request), "observability", "authority-regression", respond);
        expect(response!.status).toBe(500);
        expect(await response!.json()).toEqual({ error });
      }
      expect(root.query("SELECT COUNT(*) AS n FROM extension_kv WHERE key = 'authority-probe'").get()).toEqual({ n: 0 });
    } finally { probe.dispose(); }
    const initialConfig = await handleRegisteredAddonConfigApiRequest(admitted(new Request(configUrl)), "observability", "config", respond);
    expect(initialConfig!.status, await initialConfig!.clone().text()).toBe(200);
    expect(await initialConfig!.json()).toMatchObject({ enabled: true, instance_name: expectedInstance, appinsights_live_metrics: false });
    expectedInstance = "native-settings-instance";
    const updated = await handleRegisteredAddonConfigApiRequest(admitted(new Request(configUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance_name: expectedInstance }) })), "observability", "config", respond);
    expect(updated!.status, await updated!.clone().text()).toBe(200);
    expect(await updated!.json()).toMatchObject({ ok: true, config: { instance_name: expectedInstance, enabled: true } });
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: credentials, modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime), ...backend.sessionOptions });
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const message = { id: "native-core-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "Inspect and configure the fixture backup service", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
    const row = root.transaction(() => { const rowId = storeMessage(message); bound.getInputSourceAdmission!(message.chat_jid)!({ message, rowId, database: root }); return rowId; })();
    const receipt = await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!;
    expect(receipt).toMatchObject({ queued: false });
    expect(receipt.submission_id).toBeGreaterThan(0);
    const deadline = Date.now() + 20_000;
    let finalStatus: string | undefined;
    while (Date.now() < deadline) {
      const status = root.query('SELECT status FROM submissions WHERE id = ?').get(receipt.submission_id) as { status: string } | null;
      if (status && !['queued', 'placed'].includes(status.status)) {
        finalStatus = status.status;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(finalStatus).toBe('done');
    expect(calls).toBe(4);
    // Read the rows written by the real native SDK/accounting path using the
    // exact installed public-package collector, not a second SQL projection.
    {
      const { collectUsage } = await loadAddon('observability', 'usage-telemetry.ts');
      const before = root.serialize();
      const dbPath = (root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
      const batch = collectUsage({ graphite_host: '', graphite_port: 2003, graphite_prefix: 'piclaw', instance_name: 'fixture' },
        { runAt: '1970-01-01T00:00:00.000Z', id: 0 }, new Date(), dbPath);
      const points = new Map<string, number>(batch.points.map((point: { path: string; value: number }) => [point.path.replace(`piclaw.fixture.usage.${provider}.approved.`, ''), point.value]));
      expect(points.get('cost.provider_reported.currency_unknown.latest_known_amount')).toBe(2);
      expect(points.get('cost.provider_reported.currency_unknown.known_rows')).toBe(4);
      if(accounted){
        expect(points.get('cost.api_equivalent_usd.known_subtotal')).toBe(.000008);
        expect(points.get('cost.api_equivalent_usd.complete_rows')).toBe(4);
      }else{
        expect(points.has('cost.api_equivalent_usd.known_subtotal')).toBe(false);
        expect(points.get('cost.api_equivalent_usd.unknown_rows')).toBe(4);
      }
      for(const table of ['budget_work','budget_request_reservations','budget_usage_events'])expect(root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(points.get('tokens.reasoning')).toBe(4); expect(points.get('tokens.total')).toBe(8);
      expect(points.has('cost.estimated_usd')).toBe(false); expect(root.serialize()).toEqual(before);
    }
    expect(service.configurationSnapshot().config.excludes).toEqual(["native-owned-config"]);
    expect(resticRuntime().service).toBe(service);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    backend?.stop(); await backend?.close();
    for (const spy of spies) spy.mockRestore();
    service.stop(); resticRuntime().service = previousService; await closeDatabase(); owner.release();
  }
}, 30_000);
