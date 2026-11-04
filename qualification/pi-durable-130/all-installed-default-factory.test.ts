import { installApprovedAddonsFixture } from "./installed-addons-fixture.js";
import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect, spyOn } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { admitWebMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import type { Model, AssistantMessage, CredentialStore } from "../../node_modules/@earendil-works/pi-ai";
import { applicationAddonSourceProfiles } from "../../runtime/durable-engine/src/host-extension-catalog.js";
const rootUrl = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", rootUrl));
const { createAssistantMessageEventStream, getCurrentTools } = await import(import.meta.resolve("@earendil-works/pi-ai", rootUrl));

applicationTest("all 23 installed: actual default factory public provider terminal and reopen", async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  // Explicit profile inventory: copies only, never mutate candidate dependencies.
  expect(Object.keys(applicationAddonSourceProfiles)).toHaveLength(23);
  const installed = installApprovedAddonsFixture(workspace);
  writeFileSync(join(workspace, "all-installed-inventory.json"), JSON.stringify(installed,null,2));
  const peerOptions = {
    transportFactory: () => ({id:"synthetic-peer", status:()=>({active:false}), ticket:()=>"synthetic-ticket", async start(){throw Error("disabled peer must not start");}, async request(){throw Error("peer network forbidden");}, async close(){}}),
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
  let fixtureError: unknown;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => { throw Error("No HTTP allowed in combined factory fixture"); });
  const names = ["read", "bash", "edit", "write", "codemode", "set_model", "list_models", "view_image", "web_search", "image_generation"];
  const run: Parameters<typeof runtime.registerNativeProvider>[0]["streamSimple"] = (actual, context, options) => {
    calls++;
    expect(actual.provider).toBe(model.provider); expect(actual.id).toBe(model.id); expect(actual.api).toBe(model.api);
    const tools = getCurrentTools(context.messages);
    for (const name of names) expect(tools.some(t => t.name === name)).toBe(true);
    for (const name of ["exec_command", "write_stdin", "apply_patch"]) expect(tools.some(t => t.name === name)).toBe(false);
    expect(options?.onPayload).toBeFunction();
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        // Public Root consumes transformHeaders before entering the native provider.
        expect(options?.headers?.["x-fixture"]).toBe("owned");
        const payload = await options!.onPayload!({ model: model.id, input: [], tools: tools.map(t => ({type: "function", name: t.name, description: t.description, parameters: t.parameters})) }, actual);
        expect(payload).toBeDefined();
        for (const name of ["image_generation", "web_search"]) {
          expect(tools.find(t => t.name === name)!.parameters).toEqual({type:"object", additionalProperties:false});
          expect((payload as any).tools.some((t:any) => t.type === name && !t.parameters)).toBe(true);
          expect((payload as any).tools.some((t:any) => t.type === "function" && t.name === name)).toBe(false);
        }
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [{ type: "text", text: "owned synthetic codex terminal" }], stopReason: "stop", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
      } catch (error) {
        fixtureError = error;
        const message: AssistantMessage = { role: "assistant", provider: model.provider, model: model.id, api: model.api, timestamp: Date.now(), content: [], stopReason: "error", errorMessage: String(error), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } } };
        stream.push({ type: "error", reason: "error", error: message }); stream.end(message);

      }
    })();
    return stream;
  };
  const provider: Parameters<typeof runtime.registerNativeProvider>[0] = { id: model.provider, name: "Synthetic Codex", getModels: () => [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only", headers: { "x-fixture": "owned" } }, source: "fixture" }) } }, stream: run, streamSimple: run };
  runtime.registerNativeProvider(provider);
  expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  const services = { modelRuntime: runtime, modelRegistry: { getAvailable: () => [model] } };
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-only", refresh: "synthetic-refresh", expires: Date.now() + 3600000, accountId: "synthetic-account" } }));
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "codex-production-owner.lock"), strictOwnership: true, disabled: false });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services as never, undefined, peerOptions);
    expect(calls).toBe(0);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
    const base = createRuntimeBaseServices({ dataDir: workspace });
    const pool = new AgentPool({ credentialStore: createTestCredentialStore({}), modelRuntime: runtime, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as never);
    const bound = backend.bind({ queue: base.queue, agentPool: pool });
    const channel = new WebChannel(bound);
    const priorReservations = new Set((getDb().query("SELECT id FROM budget_request_reservations").all() as {id:string}[]).map(r=>r.id));
    const admitted = await admitWebMessage(channel, { chatJid: "web:default", content: "Reply with a short synthetic result", mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(admitted).not.toBeNull();
    const row = getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted!.id) as { id: string };
    const outcome = await bound.dispatchAcceptedInput!("web:default", row.id, admitted!.id)!();
    if (fixtureError) throw fixtureError;
    expect(outcome).toBe("settled");
    expect(calls).toBe(1);
    const reservations = (getDb().query("SELECT * FROM budget_request_reservations").all() as any[]).filter(r => !priorReservations.has(r.id));
    expect(reservations).toHaveLength(calls);
    for (const reservation of reservations) {
      expect(reservation.state).toBe("settled");
      expect(reservation.provider_id).toBe(model.provider);
      expect(reservation.model_id).toBe(model.id);
      expect(reservation.account_ref).toBeTruthy();
      expect(reservation.settlement_sha256).toHaveLength(64);
      expect((getDb().query("SELECT status FROM budget_work WHERE id=?").get(reservation.work_id) as any).status).toBe("completed");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    const terminals = getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND is_terminal_agent_reply=1 AND chat_jid=?").all("web:default");
    expect(terminals).toHaveLength(1);
    const position = backend.sessionOptions.getDurableSession!("web:default")!;
    const treeBefore = await position.readTree!();
    expect(JSON.stringify(treeBefore)).toContain("owned synthetic codex terminal");
    expect(JSON.stringify(treeBefore)).not.toContain("Files:");
    await backend.close(); backend = undefined;
    backend = await createDefaultApplicationRuntime(owner, async () => services as never, undefined, peerOptions);
    expect(calls).toBe(1);
    const treeAfter = await backend.sessionOptions.getDurableSession!("web:default")!.readTree!();
    expect(treeAfter).toEqual(treeBefore);
    expect(getDb().query("SELECT content FROM messages WHERE is_bot_message=1 AND is_terminal_agent_reply=1 AND chat_jid=?").all("web:default")).toEqual(terminals);
    expect(runtime.getRegisteredNativeProvider(model.provider)).toBe(provider);
  } finally { fetchSpy.mockRestore(); await backend?.close(); owner.release(); await closeDatabase(); }
}, 60000);
