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
const scenarios = [
  { name: 'unbound', accounted: false, storedIdentity: false, actual: 2, reportFailure: false },
  { name: 'accounted', accounted: true, storedIdentity: true, actual: 2, reportFailure: false },
  { name: 'actual-zero', accounted: false, storedIdentity: false, actual: 0, reportFailure: false },
  { name: 'actual-absent', accounted: false, storedIdentity: false, actual: undefined, reportFailure: false },
  { name: 'identity-without-price', accounted: false, storedIdentity: true, actual: 2, reportFailure: false },
  { name: 'one-report-failure', accounted: false, storedIdentity: false, actual: 2, reportFailure: true },
];
for (const scenario of scenarios) test(`all seven shipped consumers admit actual native startup and Restic effects without legacy sessions; scenario=${scenario.name}`, async () => {
  const { accounted, storedIdentity, actual, reportFailure } = scenario;
  if (!process.env.PICLAW_NATIVE_CORE_CHILD) {
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE; delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolated = ensureTestFilesystemIsolation(env);
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path, '--test-name-pattern', `scenario=${scenario.name}$`], { cwd: import.meta.dir, env: { ...env, PICLAW_NATIVE_CORE_CHILD: "1" }, stdout: "pipe", stderr: "pipe" });
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
  const provider = storedIdentity ? 'github-copilot' : 'synthetic';
  if (storedIdentity) {
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
      usage: { input: actual === 0 ? 0 : 1, output: actual === 0 ? 0 : 1, reasoning: actual === 0 ? 0 : 1,
        invocationId: 'provider-selected-collision', usageEventId: 'provider-selected-collision',
        ...(actual === undefined ? {} : { providerCost: reportFailure && step === 0 ? 3 : actual }), cacheRead: 0, cacheWrite: 0, totalTokens: actual === 0 ? 0 : 2, cost: { input: accounted ? .000001 : 0, output: accounted ? .000001 : 0, cacheRead: 0, cacheWrite: 0, total: accounted ? .000002 : 0 } } };
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
    let bound = backend.bind({ queue: base.queue, agentPool: pool });
    const message = { id: "native-core-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "Inspect and configure the fixture backup service", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
    const row = root.transaction(() => { const rowId = storeMessage(message); bound.getInputSourceAdmission!(message.chat_jid)!({ message, rowId, database: root }); return rowId; })();
    if (reportFailure) root.exec(`CREATE TEMP TRIGGER reject_one_native_report BEFORE INSERT ON main.token_usage
      WHEN NEW.provider_cost_total=3 BEGIN SELECT RAISE(ABORT,'Fixture report failure'); END`);
    expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe("settled");
    expect(calls).toBe(4);
    let expectedRows = reportFailure ? 3 : 4;
    expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: expectedRows });
    expect(root.query('SELECT disposition FROM service_effect_s02_commits').all()).toEqual([{ disposition: 'completed' }]);
    // Replay the existing accepted source; no provider or report duplication.
    const reports = root.query('SELECT * FROM token_usage ORDER BY id').all();
    const tasks = root.query('SELECT * FROM tasks ORDER BY id').all();
    if (scenario.name === 'unbound' || reportFailure) {
      backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => ({ modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime) } as RuntimeModelServices));
      const reopenedPool = new AgentPool({ credentialStore: credentials, modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime), ...backend.sessionOptions });
      bound = backend.bind({ queue: base.queue, agentPool: reopenedPool });
    }
    expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe('settled');
    expect(root.query('SELECT * FROM token_usage ORDER BY id').all()).toEqual(reports);
    expect(root.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasks); expect(calls).toBe(4);
    if (reportFailure) {
      root.exec('DROP TRIGGER reject_one_native_report');
      expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe('settled');
      const repaired = root.query('SELECT * FROM token_usage ORDER BY id').all();
      expect(repaired).toHaveLength(4);
      expect(repaired.slice(0, reports.length)).toEqual(reports);
      expect(root.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasks); expect(calls).toBe(4);
      expectedRows = 4;
    }
    // Read the rows written by the real native SDK/accounting path using the
    // exact installed public-package collector, not a second SQL projection.
    {
      const { collectUsage } = await loadAddon('observability', 'usage-telemetry.ts');
      const before = root.serialize();
      const dbPath = (root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
      const batch = collectUsage({ graphite_host: '', graphite_port: 2003, graphite_prefix: 'piclaw', instance_name: 'fixture' },
        { runAt: '1970-01-01T00:00:00.000Z', id: 0 }, new Date(), dbPath);
      expect(batch).not.toBeNull();
      const points = new Map<string, number>(batch.points.map((point: { path: string; value: number }) => [point.path.replace(`piclaw.fixture.usage.${provider}.approved.`, ''), point.value]));
      if (actual === undefined) {
        expect(points.has('cost.provider_reported.currency_unknown.latest_known_amount')).toBe(false);
        expect(points.get('cost.provider_reported.currency_unknown.known_rows')).toBe(0);
        expect(points.get('cost.provider_reported.currency_unknown.unknown_rows')).toBe(expectedRows);
      } else {
        expect(points.get('cost.provider_reported.currency_unknown.latest_known_amount')).toBe(actual);
        expect(points.get('cost.provider_reported.currency_unknown.known_rows')).toBe(expectedRows);
      }
      if (accounted) {
        expect(points.get('cost.api_equivalent_usd.known_subtotal')).toBe(.000008);
        expect(points.get('cost.api_equivalent_usd.complete_rows')).toBe(4);
      } else {
        expect(points.has('cost.api_equivalent_usd.known_subtotal')).toBe(false);
        expect(points.get('cost.api_equivalent_usd.unknown_rows')).toBe(expectedRows);
        expect(root.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 0 });
      }
      expect(points.get('tokens.reasoning')).toBe(actual === 0 ? 0 : expectedRows); expect(points.get('tokens.total')).toBe(actual === 0 ? 0 : expectedRows * 2);
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
