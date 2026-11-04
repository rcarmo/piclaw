import { repoRoot } from "./src/repo-root.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect, spyOn } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync, realpathSync, mkdirSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { Socket } from "node:net";
import { Database } from "bun:sqlite";
import { DATA_DIR } from "../../runtime/src/core/config.js";
import type { Model, AssistantMessage, CredentialStore } from "../../node_modules/@earendil-works/pi-ai";
import { applicationAddonSourceProfiles } from "../../runtime/durable-engine/src/host-extension-catalog.js";
const rootUrl = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", rootUrl)) as typeof import("../../node_modules/@earendil-works/pi-coding-agent");
const { createAssistantMessageEventStream, getCurrentTools } = await import(import.meta.resolve("@earendil-works/pi-ai", rootUrl));

applicationTest("all 23 installed: explicit offline maintenance preserves enabled services without starting transports", async () => {
  const source = realpathSync(process.env.DURABLE_ADDONS_ROOT!);
  const workspace = process.env.PICLAW_WORKSPACE!;
  // Explicit profile inventory: copies only, never mutate candidate dependencies.
  expect(Object.keys(applicationAddonSourceProfiles)).toHaveLength(23);
  const rootModules = realpathSync(join(repoRoot("CORE"), "node_modules"));
  const catDeps = realpathSync(process.env.DURABLE_CATALOG_DEPENDENCIES ?? join(source, "node_modules"));
  const installed = [];
  for (const [kind, profile] of Object.entries(applicationAddonSourceProfiles)) {
    const slug = profile.name.replace("@rcarmo/piclaw-addon-", "");
    const pkg = join(workspace, ".pi/extensions/node_modules", profile.name);
    cpSync(join(source, "addons", slug), pkg, {recursive:true, filter: p => !p.split("/").includes("node_modules")});
    const dependencies = join(pkg, "node_modules"); mkdirSync(dependencies, {recursive:true});
    // Overlay scoped children, not scopes: Root SDK takes precedence over catalog development SDKs.
    for (const modules of [rootModules, catDeps, ...Object.values(applicationAddonSourceProfiles).map(profile => join(source, "addons", profile.name.replace("@rcarmo/piclaw-addon-", ""), "node_modules")).filter(path => existsSync(path))]) for (const entry of readdirSync(modules)) {
      if (entry.startsWith(".")) continue;
      if (entry.startsWith("@")) {
        mkdirSync(join(dependencies, entry), {recursive:true});
        for (const child of readdirSync(join(modules, entry))) {
          const target = join(dependencies, entry, child);
          if (!existsSync(target)) symlinkSync(join(modules, entry, child), target);
        }
      } else if (!existsSync(join(dependencies, entry))) symlinkSync(join(modules, entry), join(dependencies, entry));
    }
    installed.push({kind, name:profile.name});
  }
  writeFileSync(join(workspace, "all-installed-inventory.json"), JSON.stringify(installed,null,2));
  let peerStarts = 0;
  const peerOptions = {
    offlineMaintenance: true,
    transportFactory: () => ({id:"synthetic-peer", status:()=>({active:false}), ticket:()=>"synthetic-ticket", async start(){peerStarts++; throw Error("maintenance peer must not start");}, async request(){throw Error("peer network forbidden");}, async close(){}}),
    discoveryFactory: () => {throw Error("mDNS forbidden");},
  };
  const model: Model<"openai-codex-responses"> = { provider: "openai-codex", id: "synthetic-codex", name: "Synthetic Codex", api: "openai-codex-responses", baseUrl: "https://fixture.invalid", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
  const credentials: CredentialStore = {
    async read(id) { if (id !== model.provider) throw Error("Ambient credentials forbidden: " + id); return { type: "api_key", key: "synthetic-only" }; },
    async list() { return [{ providerId: model.provider, type: "api_key" }]; },
    async modify(_id, fn) { return fn(undefined); }, async delete() {},
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    async () => { throw Error("No HTTP allowed in combined factory fixture"); },
    { preconnect() { throw Error("No HTTP preconnect allowed in maintenance fixture"); } }));
  const socketSpy = spyOn(Socket.prototype, "connect").mockImplementation(() => { throw Error("No TCP allowed in maintenance fixture"); });
  const run = () => { calls++; throw Error("No model calls allowed in maintenance"); };
  const provider: Parameters<typeof runtime.registerNativeProvider>[0] = { id: model.provider, name: "Synthetic Codex", getModels: () => [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only", headers: { "x-fixture": "owned" } }, source: "fixture" }) } }, stream: run, streamSimple: run };
  runtime.registerNativeProvider(provider);
  expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  const services = { modelRuntime: runtime, modelRegistry: { getAvailable: () => [model] } };
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-only", refresh: "synthetic-refresh", expires: Date.now() + 3600000, accountId: "synthetic-account" } }));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "codex-production-owner.lock"), strictOwnership: true, disabled: false });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  const { extensionKvSet, extensionKvGet } = await import("../../runtime/src/db/extension-kv.js");
  const observation = { enabled:true, appinsights_enabled:false, usage_telemetry_enabled:true, graphite_enabled:true, graphite_host:"fixture.invalid", graphite_port:2003 };
  const peer = { enabled:true };
  getDb().transaction(() => extensionKvSet("observability", "config", observation, "global")).immediate();
  const peerDir = join(DATA_DIR, "addons", "remote-peer"); mkdirSync(peerDir, {recursive:true});
  const peerDb = new Database(join(peerDir, "peers.db"));
  peerDb.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  peerDb.query("INSERT INTO settings VALUES ('config',?)").run(JSON.stringify(peer));
  const assertPeerConfig = () => expect(JSON.parse((peerDb.query("SELECT value FROM settings WHERE key='config'").get() as {value:string}).value)).toEqual(peer);
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services as never, peerOptions);
    expect(calls).toBe(0);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
    expect(() => backend!.bind({} as never)).toThrow("Offline maintenance");
    expect(() => backend!.attachChannel!({} as never)).toThrow("Offline maintenance");
    const root = getDb();
    const executionRows = () => ["tasks", "submissions", "entries"].map(table => root.query(`SELECT * FROM ${table} ORDER BY id`).all());
    const before = executionRows();
    expect(before).toEqual([[], [], []]);
    await expect(backend.sessionOptions.dispatchSidePrompt!("web:default", "forbidden", {})).rejects.toThrow("Offline maintenance");
    await expect(backend.sessionOptions.dispatchScheduledAgent!({} as never)).rejects.toThrow("Offline maintenance");
    await expect(backend.sessionOptions.dispatchHostCommand!("web:default", "/model synthetic/forbidden")).rejects.toThrow("Offline maintenance");
    await expect(backend.sessionOptions.getDurableSession!("web:default")!.compact!()).rejects.toThrow("Offline maintenance");
    expect(executionRows()).toEqual(before);
    expect(calls).toBe(0);
    const treeBefore = await backend.sessionOptions.getDurableSession!("web:default")!.readTree!();
    expect(peerStarts).toBe(0);
    expect(socketSpy).toHaveBeenCalledTimes(0);
    expect(extensionKvGet("observability", "config", "global")).toEqual(observation);
    assertPeerConfig();
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    await backend.close(); backend = undefined;
    backend = await createDefaultApplicationRuntime(owner, async () => services as never, peerOptions);
    expect(calls).toBe(0);
    const treeAfter = await backend.sessionOptions.getDurableSession!("web:default")!.readTree!();
    expect(treeAfter).toEqual(treeBefore);
    expect(peerStarts).toBe(0);
    expect(socketSpy).toHaveBeenCalledTimes(0);
    expect(extensionKvGet("observability", "config", "global")).toEqual(observation);
    assertPeerConfig();
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  } finally { socketSpy.mockRestore(); fetchSpy.mockRestore(); await backend?.close(); peerDb.close(); owner.release(); await closeDatabase(); }
}, 60000);
