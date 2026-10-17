import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "../../node_modules/@earendil-works/pi-coding-agent";
import { createProvider as createLegacyProvider, createAssistantMessageEventStream as createLegacyStream, type Context as LegacyContext } from "../../node_modules/@earendil-works/pi-ai";
import type { ToolDefinition, ExtensionToolContext } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { JsonValue } from "../../runtime/durable-engine/qualification/chord.ts";
import { BACKGROUND_CONTEXT as context, awaitWithContext } from "../../runtime/durable-engine/qualification/context.ts";
import { createModels, createProvider, type AssistantMessage, type Model, type TSchema, type JsonObject } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { Harness, MemoryStorage, createRegistry, defineExtension, type GenerationHooks, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { createHostTool } from "../../runtime/durable-engine/src/index.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";

// Standalone qualification, intentionally NOT silently skipped or in the default
// package suite until CI supplies the companion checkout. No installed/live paths.
// DURABLE_ADDONS_ROOT must be a checkout of rcarmo/piclaw-addons at
// de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3. Verify all executable inputs below.
const root = process.env.DURABLE_ADDONS_ROOT;
if (!root) throw new Error("Plan qualification requires DURABLE_ADDONS_ROOT (piclaw-addons de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3)");
const addonDir = resolve(root, "addons/plan-sidebar");
for (const [file, digest] of Object.entries({
  "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
  "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
})) {
  expect(createHash("sha256").update(new Uint8Array(await Bun.file(resolve(addonDir, file)).arrayBuffer())).digest("hex")).toBe(digest);
}
expect((await Bun.file(resolve(addonDir, "package.json")).json()).version).toBe("0.1.25");

type Definition = ToolDefinition<TSchema, JsonValue>;
type HiddenMessage = { customType: string; content: { type: "text"; text: string }[]; display: boolean };
type PlanHook = (event: { systemPrompt: string }, ctx: { sessionManager: { getSessionDir(): string } }) => Promise<{
  systemPrompt?: string; message?: HiddenMessage;
}>;
type Capture = {
  on(event: "before_agent_start", handler: PlanHook): void;
  registerTool(definition: Definition): void;
};

test("actual Plan 0.1.25 factory: existing-chat KV, prepared tool, per-request context projection (not full SDK run equivalence), scope and effect fences; hidden-entry gap explicit", async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclawRuntimeInterop", "__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  const db = new Database(":memory:");
  db.run("CREATE TABLE kv (extension TEXT, key TEXT, scope TEXT, chat TEXT, value TEXT, PRIMARY KEY(extension,key,scope,chat))");
  const invocation = new AsyncLocalStorage<{ jid: string; assertAllowed(): void }>();
  const events: unknown[] = [];
  let writes = 0, allowed = true, denyAtSink = false;
  const check = () => { if (!allowed) throw new Error("SYNTHETIC_PRIVATE_AUTHORITY"); };
  const assertScope = (extension: string, key: string, scope: string, jid: string) => {
    const local = invocation.getStore();
    if (!local || extension !== "plan-sidebar" || key !== "plan" || scope !== "chat" || jid !== local.jid) {
      throw new Error("SYNTHETIC_PRIVATE_SCOPE");
    }
    local.assertAllowed();
  };
  // Only the ACTUAL runtime services used by this Plan source. This is a test
  // fixture, not an ExtensionAPI/session shim or a new production global bridge.
  globals.__piclawRuntimeInterop = { getExtensionKvStore: () => ({
    get(extension: string, key: string, scope: string, jid: string) {
      assertScope(extension, key, scope, jid);
      const row = db.query("SELECT value FROM kv WHERE extension=? AND key=? AND scope=? AND chat=?").get(extension, key, scope, jid) as { value: string } | null;
      return row ? JSON.parse(row.value) : null;
    },
    set(extension: string, key: string, value: unknown, scope: string, jid: string) {
      if (denyAtSink) allowed = false;
      assertScope(extension, key, scope, jid); // Fence at actual SQL mutation.
      db.run("INSERT OR REPLACE INTO kv VALUES(?,?,?,?,?)", [extension, key, scope, jid, JSON.stringify(value)]);
      writes++;
    },
  }) };
  delete globals.__piclaw_registerAddonConfigApi; // Do not register live HTTP handlers.
  globals.__PICLAW_BROADCAST_EVENT__ = (type: string, data: unknown) => {
    invocation.getStore()!.assertAllowed(); events.push({ type, data });
  };
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  try {
    // Import and invoke the real installed factory, never reproduce Plan logic.
    const actual = await import(resolve(addonDir, "index.ts")) as { default(api: Capture): void };
    const chat = await import(resolve(addonDir, "compat/chat-context.ts")) as {
      withChatContext<T>(jid: string, channel: string, fn: () => Promise<T>): Promise<T>;
    };
    let definition: Definition | undefined, beforeStart: PlanHook | undefined;
    actual.default({
      on(event, handler) { expect(event).toBe("before_agent_start"); expect(beforeStart).toBeUndefined(); beforeStart = handler; },
      registerTool(tool) { expect(definition).toBeUndefined(); definition = tool; },
    });
    if (!definition || !beforeStart) throw new Error("Plan registration missing");
    expect(definition.name).toBe("plan");
    const registeredHook = beforeStart;
    const chats = new Map<ConversationId, string>(); // Private host exact-conversation directory.
    const jidFor = (id: ConversationId) => {
      const jid = chats.get(id); if (!jid) throw new Error("Unmapped host conversation"); return jid;
    };
    const scoped = <T>(jid: string, assertAllowed: () => void, fn: () => Promise<T>) =>
      invocation.run({ jid, assertAllowed }, () => chat.withChatContext(jid, "web", fn));
    const tool = createHostTool(definition, {
      authority: { check }, effectFence: "host-effect-port",
      async invoke(args, call) {
        const local = invocation.getStore();
        if (!local) throw new Error("Missing exact host context");
        const explicit = (args as { chat_jid?: unknown }).chat_jid;
        if (explicit !== undefined && explicit !== local.jid) throw new Error("Cross-chat Plan override denied");
        return scoped(local.jid, call.assertAllowed, () => call.execute(call.toolCallId, args, call.signal, call.onUpdate,
          { sessionManager: { getSessionDir: () => "/synthetic/no-session-dir-inference" } } as ExtensionToolContext));
      },
    });
    // Host-tool bridge deliberately has no session shim. Plan alone binds the
    // real durable invocation's conversationId to a private exact-chat directory.
    const execute = tool.execute;
    tool.execute = (args, api, ctx) => scoped(jidFor(api.conversationId), check, () => execute(args, api, ctx));
    const promptFor = (id: ConversationId) => scoped(jidFor(id), check, () => registeredHook({ systemPrompt: "" },
      { sessionManager: { getSessionDir: () => "/synthetic/no-session-dir-inference" } }));
    const hidden: HiddenMessage[] = [];
    const generation: Pick<GenerationHooks, "beforeRequest"> = {
      async beforeRequest(request, api) {
        const result = await promptFor(api.conversationId);
        if (!result.message) return;
        // Explicit bounded request-only projection. Preserve the returned custom
        // entry JSON separately; do NOT claim this is SDK durable custom history.
        const entry = JSON.parse(JSON.stringify(result.message)) as HiddenMessage;
        hidden.push(entry);
        return { messages: [...request.messages, { role: "user", content: entry.content, timestamp: 1 }] };
      },
    };
    const extension = defineExtension({ name: "actual-plan-qualification", tools: [tool],
      sections: [{ key: "plan-sidebar", tag: false, render: async input => (await promptFor(input.conversationId)).systemPrompt }],
      hooks: [{ task: "pi.generation", handlers: generation }],
    });
    const registry = createRegistry(); registry.install(extension);
    const model: Model<"openai-completions"> = { id: "synthetic-plan", name: "Synthetic Plan", provider: "qualification-plan", api: "openai-completions",
      baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const requests: string[] = [];
    let nextArgs: JsonObject | undefined;
    const stream = (_model: unknown, transcript: unknown) => {
      requests.push(JSON.stringify(transcript));
      const args = nextArgs; nextArgs = undefined;
      const output = new AssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: 1, stopReason: args ? "toolUse" : "stop",
        content: args ? [{ type: "toolCall", id: `plan-${requests.length}`, name: "plan", arguments: args }] : [{ type: "text", text: "done" }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      output.push({ type: "done", reason: args ? "toolUse" : "stop", message }); output.end(); return output;
    };
    const forbidden = async (): Promise<never> => { throw new Error("Ambient credentials forbidden"); };
    const models = createModels({ authContext: { env: forbidden, fileExists: forbidden } });
    models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    harness = await Harness.open(new MemoryStorage(), { models, registry,
      settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    const parent = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } });
    const parentJid = "web:synthetic-existing-plan";
    chats.set(parent.id, parentJid);
    const seed = { chat_jid: parentJid, markdown: "- [ ] EXISTING_PLAN_OLD", updated_at: "2026-01-01T00:00:00Z" };
    db.run("INSERT INTO kv VALUES(?,?,?,?,?)", ["plan-sidebar", "plan", "chat", parentJid, JSON.stringify(seed)]);
    const read = (jid: string) => JSON.parse((db.query("SELECT value FROM kv WHERE chat=?").get(jid) as { value: string }).value);
    const submit = async (conversation: typeof parent, id: string, args?: JsonObject) => {
      nextArgs = args;
      await (await conversation.submit({ type: "input", requestId: id, content: id }, context)).wait(context);
    };
    await submit(parent, "read-existing", { action: "get" }); // Actual prepareArguments alias.
    expect(writes).toBe(0);
    expect(requests[0]).toContain("EXISTING_PLAN_OLD");
    expect(tool.replay).toBe("unsafe"); // read does not authorize replay of mutations.
    await submit(parent, "replace", { plan: [{ step: "FRESH_PLAN_NEW", status: "in_progress" }] }); // Actual inferred action.
    expect(read(parentJid).markdown).toBe("- [-] FRESH_PLAN_NEW"); expect(writes).toBe(1);
    expect(hidden.at(-1)?.content[0]?.text).toContain("FRESH_PLAN_NEW");
    expect(hidden.at(-1)?.content[0]?.text).not.toContain("EXISTING_PLAN_OLD");
    expect(requests.at(-1)).toContain("FRESH_PLAN_NEW");
    const freshPrompt = await promptFor(parent.id);
    expect(freshPrompt.systemPrompt).toContain("## Plan Sidebar");
    expect(freshPrompt.systemPrompt).not.toContain("FRESH_PLAN_NEW");
    expect(hidden.at(-1)).toMatchObject({ customType: "plan_sidebar_context", display: false });
    expect(events).toHaveLength(1);
    const entries = (await parent.entries({ order: "ascending" }, 100, undefined, context)).items;
    const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    expect(results.at(-1)).toMatchObject({ content: [{ type: "text", text: "Plan updated." }],
      details: { chat_jid: parentJid, markdown: "- [-] FRESH_PLAN_NEW", plan: [{ step: "FRESH_PLAN_NEW", status: "in_progress" }] } });
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
    // Precise gap: request hook is not a persisted host custom-entry writer.
    expect(JSON.stringify(entries)).not.toContain("plan_sidebar_context");
    const fork = await parent.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context);
    const forkJid = "web:synthetic-existing-plan:branch:synthetic"; chats.set(fork.id, forkJid);
    await submit(fork, "branch-only", { action: "set", markdown: "- [ ] BRANCH_ONLY" });
    expect(read(forkJid).markdown).toBe("- [ ] BRANCH_ONLY"); expect(read(parentJid).markdown).toBe("- [-] FRESH_PLAN_NEW");
    await submit(parent, "parent-next");
    expect(hidden.at(-1)?.content[0]?.text).toContain("FRESH_PLAN_NEW"); expect(hidden.at(-1)?.content[0]?.text).not.toContain("BRANCH_ONLY");
    const before = writes;
    await submit(parent, "cross-chat", { action: "write", chat_jid: forkJid, markdown: "FORBIDDEN" });
    expect(writes).toBe(before); expect(read(forkJid).markdown).toBe("- [ ] BRANCH_ONLY");
    await submit(parent, "invalid-status", { action: "update", plan: [{ step: "x", status: "invalid" }] });
    expect(writes).toBe(before); // Actual registered schema rejects before execution.
    await submit(parent, "invalid-two-active", { action: "update", plan: [{ step: "x", status: "in_progress" }, { step: "y", status: "in_progress" }] });
    expect(writes).toBe(before); // Actual Plan structured logic, not duplicated here.
    denyAtSink = true;
    await submit(parent, "sink-revoked", { action: "write", markdown: "FORBIDDEN" });
    allowed = true; denyAtSink = false;
    expect(writes).toBe(before); expect(events).toHaveLength(2);
    const finalEntries = (await parent.entries({}, 100, undefined, context)).items;
    expect(JSON.stringify(finalEntries)).not.toContain("SYNTHETIC_PRIVATE");
    expect(JSON.stringify(finalEntries)).toContain("Host tool authority unavailable");
    await parent.configure({ tools: [] }, context);
    await submit(parent, "disabled-next", { action: "write", markdown: "FORBIDDEN" });
    expect(writes).toBe(before);
    await parent.configure({ tools: [tool] }, context);
    await submit(parent, "reactivated-next", { action: "read" });
    expect(writes).toBe(before);
    expect((await parent.agent(context)).tools.map(item => item.name)).toEqual(["plan"]);
  } finally {
    await harness?.close(context); db.close();
    keys.forEach((key, index) => { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globals, key, descriptor); else delete globals[key]; });
  }
});

test("real Pi 1.2.0 Plan hidden history vs public durable late commit: plain commit alone is insufficient", async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclawRuntimeInterop", "__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  const dir = await mkdtemp(resolve(tmpdir(), "plan-lifecycle-"));
  const jid = "web:synthetic-plan-lifecycle";
  let markdown = "- [ ] PERSISTED_OLD_PLAN";
  globals.__piclawRuntimeInterop = { getExtensionKvStore: () => ({
    get(extension: string, key: string, scope: string, chat: string) {
      expect([extension, key, scope, chat]).toEqual(["plan-sidebar", "plan", "chat", jid]);
      return { chat_jid: jid, markdown, updated_at: "2026-01-01T00:00:00Z" };
    },
    set() { throw new Error("Read-only lifecycle fixture"); },
  }) };
  delete globals.__piclaw_registerAddonConfigApi;
  delete globals.__PICLAW_BROADCAST_EVENT__;
  // Isolate Plan's module-local cached KV handle from the first test's closed DB.
  // This still executes the hash-verified original source and its real imports.
  const actual = await import(`${resolve(addonDir, "index.ts")}?plan-lifecycle`) as { default: ExtensionFactory };
  const chat = await import(resolve(addonDir, "compat/chat-context.ts")) as {
    withChatContext<T>(jid: string, channel: string, fn: () => Promise<T>): Promise<T>;
  };
  const scoped = <T>(fn: () => Promise<T>) => chat.withChatContext(jid, "web", fn);
  const model: Model<"openai-completions"> = { id: "plan-lifecycle", name: "Plan lifecycle", provider: "synthetic-plan-lifecycle", api: "openai-completions",
    baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const legacyRequests: LegacyContext[] = [];
  const durableRequests: { messages: readonly unknown[] }[] = [];
  const response = (): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
    timestamp: 1, stopReason: "stop", content: [{ type: "text", text: "done" }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const reply = () => {
    const output = new AssistantMessageEventStream();
    output.push({ type: "done", reason: "stop", message: response() }); output.end(); return output;
  };
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  try {
    const runtime = await ModelRuntime.create({ modelsPath: null, modelsStorePath: resolve(dir, "models-cache.json"),
      allowModelNetwork: false, refreshOnCreate: false,
      credentials: { async read() { return undefined; }, async list() { return []; },
        async modify() { throw new Error("No credential writes"); }, async delete() { throw new Error("No credential writes"); } } });
    const legacyStream = (_model: unknown, request: LegacyContext) => {
      legacyRequests.push(structuredClone(request));
      const output = createLegacyStream();
      output.push({ type: "done", reason: "stop", message: response() }); output.end(); return output;
    };
    runtime.registerNativeProvider(createLegacyProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } },
      api: { stream: legacyStream, streamSimple: legacyStream } }));
    await runtime.refresh({ allowNetwork: false });
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [actual.default] });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    expect(loader.getExtensions().extensions).toHaveLength(1); // Inline actual Plan loads despite no discovery.
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
    const manager = SessionManager.create(dir, resolve(dir, "sessions"));
    ({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model,
      thinkingLevel: "off", noTools: "builtin", tools: ["plan"], resourceLoader: loader,
      settingsManager: settings, sessionManager: manager }));
    expect(session.getActiveToolNames()).toEqual(["plan"]);
    await scoped(() => session!.prompt("original-first"));
    const firstEntries = structuredClone(manager.getEntries());
    const hidden = firstEntries.filter(entry => entry.type === "custom_message");
    expect(hidden).toHaveLength(1);
    const old = hidden[0]!;
    expect(old).toMatchObject({ customType: "plan_sidebar_context", display: false });
    expect(JSON.stringify(old)).toContain("PERSISTED_OLD_PLAN");
    expect(legacyRequests[0]!.messages.filter(message => message.role === "user").map(message => message.content))
      .toEqual([[{ type: "text", text: "original-first" }], old.content]);
    markdown = "- [-] RESTORED_FRESH_PLAN";
    // buildSessionContext is the authoritative pre-hook second-request fixture.
    const beforeSecond = structuredClone(manager.buildSessionContext().messages);
    expect(beforeSecond.filter(message => message.role === "custom")).toHaveLength(1);
    await scoped(() => session!.prompt("original-second"));
    const baseline = structuredClone(manager.getEntries());
    const baselineHidden = baseline.filter(entry => entry.type === "custom_message");
    expect(baselineHidden).toHaveLength(2);
    expect(baselineHidden[0]).toEqual(old); // Plan updates must not rewrite historical snapshots.
    expect(JSON.stringify(baselineHidden[1])).toContain("RESTORED_FRESH_PLAN");
    expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages)
      .toEqual(manager.buildSessionContext().messages);
    session.dispose(); session = undefined;

    let hook: PlanHook | undefined;
    // Plan-specific capture only; never a generic legacy ExtensionAPI adapter.
    (actual.default as unknown as (api: Capture) => void)({ on(_event, handler) { hook = handler; }, registerTool() {} });
    if (!hook) throw new Error("Missing actual Plan hook");
    const planHook = hook;
    const storageAt = () => SqliteStorage.open(new BunSqliteDatabase(resolve(dir, "plan.sqlite")));
    const models = createModels({ authContext: { env: async () => { throw new Error("No ambient auth"); }, fileExists: async () => { throw new Error("No ambient auth"); } } });
    const stream = (_model: unknown, request: { messages: readonly unknown[] }) => { durableRequests.push(structuredClone(request)); return reply(); };
    models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    let conversation: Awaited<ReturnType<NonNullable<typeof harness>["root"]>>;
    const committed: HiddenMessage[] = [];
    const handlers: Pick<GenerationHooks, "beforeRequest"> = {
      async beforeRequest(request) {
        const result = await scoped(() => planHook({ systemPrompt: "" }, { sessionManager: { getSessionDir: () => dir } }));
        if (!result.message) throw new Error("Missing actual Plan context");
        const data = JSON.parse(JSON.stringify(result.message)) as HiddenMessage;
        // Public conversation writer, NOT a cast of HookApi to private runtime.
        // Deliberately do not replace request.messages to hide the pinned cutoff.
        await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: "host.plan.hidden", data,
          model: [{ role: "user", content: data.content, timestamp: 1 }] }), context);
        committed.push(data);
        expect(request.messages.filter(message => message.role === "user")).toHaveLength(committed.length * 2 - 1);
      },
    };
    const extension = defineExtension({ name: "plan-lifecycle-diagnostic", hooks: [{ task: "pi.generation", handlers }] });
    const registry = createRegistry(); registry.install(extension);
    const options = { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } };
    harness = await Harness.open(await storageAt(), options, context);
    conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } });
    markdown = "- [ ] PERSISTED_OLD_PLAN";
    await (await conversation.submit({ type: "input", content: [{ type: "text", text: "original-first" }] }, context)).wait(context);
    const userContents = (messages: readonly unknown[]) => messages.filter((message): message is { role: string; content: unknown } =>
      typeof message === "object" && message !== null && "role" in message && message.role === "user").map(message => message.content);
    const firstContext = await conversation.context(context);
    expect(JSON.stringify(committed[0])).toBe(JSON.stringify({ customType: old.customType, content: old.content, display: old.display }));
    expect(userContents(firstContext.messages)).toEqual(userContents(legacyRequests[0]!.messages));
    expect(userContents(durableRequests[0]!.messages)).not.toEqual(userContents(legacyRequests[0]!.messages));
    expect(userContents(durableRequests[0]!.messages)).toEqual([[{ type: "text", text: "original-first" }]]);
    const entries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    const entry = entries.find(item => item.kind === "host.plan.hidden")!;
    expect(entry.data).toEqual(committed[0]);
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    const fork = await conversation.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context);
    expect(userContents((await fork.context(context)).messages)).toEqual(userContents(firstContext.messages));
    const conversationId = conversation.id;
    await harness.close(context);
    harness = await Harness.open(await storageAt(), options, context);
    conversation = (await harness.conversation(conversationId, context))!;
    expect(userContents((await conversation.context(context)).messages)).toEqual(userContents(firstContext.messages));
    markdown = "- [-] RESTORED_FRESH_PLAN";
    await (await conversation.submit({ type: "input", content: [{ type: "text", text: "original-second" }] }, context)).wait(context);
    expect(JSON.stringify(committed[1])).toBe(JSON.stringify({ customType: baselineHidden[1]!.customType, content: baselineHidden[1]!.content, display: baselineHidden[1]!.display }));
    expect(userContents((await conversation.context(context)).messages)).toEqual(userContents(legacyRequests[1]!.messages));
    expect(userContents(durableRequests[1]!.messages)).toEqual(userContents(legacyRequests[1]!.messages).slice(0, -1));
    expect(userContents(durableRequests[1]!.messages)).not.toEqual(userContents(legacyRequests[1]!.messages));
    expect((await conversation.entries({ order: "ascending" }, 100, undefined, context)).items.find(item => item.id === entry.id)).toEqual(entry);
    // This is a deterministic negative lifecycle receipt, NOT a production bridge:
    // persistence/fork/reopen match, but the automatic request omits this turn's
    // hidden entry. HookApi has no public commit, and submit has no multi-entry
    // atomic input shape. No task internals, scheduler gating, or rewritten user.
  } finally {
    session?.dispose(); await harness?.close(context);
    keys.forEach((key, index) => { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globals, key, descriptor); else delete globals[key]; });
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

// Bounded host adapter: one serial conversation, an explicitly known accepted
// operation, no concurrent submit/compaction. NOT a generic ExtensionAPI shim.
test("actual Plan: public commit + projection, once per accepted run across tool rounds and interrupted-hook reopen", async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclawRuntimeInterop", "__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  const dir = await mkdtemp(resolve(tmpdir(), "plan-positive-"));
  const jid = "web:synthetic-plan-positive";
  let markdown = "- [ ] RUN_ONE_SNAPSHOT", hookCalls = 0;
  globals.__piclawRuntimeInterop = { getExtensionKvStore: () => ({
    get(extension: string, key: string, scope: string, chat: string) {
      expect([extension, key, scope, chat]).toEqual(["plan-sidebar", "plan", "chat", jid]);
      return { chat_jid: jid, markdown, updated_at: "2026-01-01T00:00:00Z" };
    },
    set(_extension: string, _key: string, value: { markdown: string }) { markdown = value.markdown; },
  }) };
  delete globals.__piclaw_registerAddonConfigApi;
  delete globals.__PICLAW_BROADCAST_EVENT__;
  const actual = await import(`${resolve(addonDir, "index.ts")}?plan-positive`) as { default: ExtensionFactory };
  const chat = await import(resolve(addonDir, "compat/chat-context.ts")) as {
    withChatContext<T>(jid: string, channel: string, fn: () => Promise<T>): Promise<T>;
  };
  const scoped = <T>(fn: () => Promise<T>) => chat.withChatContext(jid, "web", fn);
  const model: Model<"openai-completions"> = { id: "plan-positive", name: "Plan positive", provider: "synthetic-plan-positive", api: "openai-completions",
    baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const legacyRequests: LegacyContext[] = [];
  const durableRequests: { messages: readonly unknown[] }[] = [];
  // Each accepted input makes one ACTUAL Plan mutation then a terminal model
  // request. The hidden snapshot must NOT refresh between those requests.
  const response = (index: number): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
    timestamp: 1, stopReason: index % 2 ? "stop" : "toolUse",
    content: index % 2 ? [{ type: "text", text: "done" }] : [{ type: "toolCall", id: `plan-positive-${index}`, name: "plan",
      arguments: { action: "write", markdown: index === 0 ? "- [-] MID_RUN_MUTATION" : "- [x] SECOND_MUTATION" } }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  try {
    const runtime = await ModelRuntime.create({ modelsPath: null, modelsStorePath: resolve(dir, "models-cache.json"),
      allowModelNetwork: false, refreshOnCreate: false,
      credentials: { async read() { return undefined; }, async list() { return []; },
        async modify() { throw new Error("No credentials"); }, async delete() { throw new Error("No credentials"); } } });
    const legacyStream = (_model: unknown, request: LegacyContext) => {
      const message = response(legacyRequests.length); legacyRequests.push(structuredClone(request));
      const output = createLegacyStream(); output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); output.end(); return output;
    };
    runtime.registerNativeProvider(createLegacyProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } },
      api: { stream: legacyStream, streamSimple: legacyStream } }));
    await runtime.refresh({ allowNetwork: false });
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [actual.default] });
    await loader.reload(); expect(loader.getExtensions().errors).toEqual([]);
    const manager = SessionManager.create(dir, resolve(dir, "sessions"));
    ({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off",
      noTools: "builtin", tools: ["plan"], resourceLoader: loader, settingsManager: settings, sessionManager: manager }));
    await scoped(() => session!.prompt("positive-first"));
    expect(markdown).toBe("- [-] MID_RUN_MUTATION");
    const legacyFirst = structuredClone(manager.getEntries().filter(entry => entry.type === "custom_message"));
    expect(legacyFirst).toHaveLength(1);
    await scoped(() => session!.prompt("positive-second"));
    const legacyHidden = structuredClone(manager.getEntries().filter(entry => entry.type === "custom_message"));
    expect(legacyRequests).toHaveLength(4); expect(legacyHidden).toHaveLength(2);
    expect(legacyHidden[0]).toEqual(legacyFirst[0]);
    session.dispose(); session = undefined;

    let hook: PlanHook | undefined, definition: Definition | undefined;
    (actual.default as unknown as (api: Capture) => void)({ on(_event, handler) { hook = handler; }, registerTool(tool) { definition = tool; } });
    if (!hook || !definition) throw new Error("Plan registration missing");
    const planHook = hook;
    const tool = createHostTool(definition, { authority: { check() {} }, effectFence: "host-effect-port",
      async invoke(args, call) {
        return scoped(() => call.execute(call.toolCallId, args, call.signal, call.onUpdate,
          { sessionManager: { getSessionDir: () => dir } } as ExtensionToolContext));
      } });
    let conversation: Awaited<ReturnType<NonNullable<typeof harness>["root"]>>;
    // Host knows this key BEFORE submit. A generation taskId is public, but it
    // identifies a model turn, NOT an accepted run. Never use it for dedup here.
    let activeOperation: string | undefined = "positive-first";
    let interrupt = true, entered!: () => void;
    let requestPrepared = false, hookAttempts = 0, projections = 0, alreadyIncluded = 0;
    const committedBarrier = new Promise<void>(resolve => { entered = resolve; });
    const never = new Promise<void>(() => {});
    const handlers: Pick<GenerationHooks, "beforeRequest"> = {
      async beforeRequest(request, api, hookContext) {
        requestPrepared = false; hookAttempts++;
        if (!activeOperation || api.conversationId !== conversation.id) throw new Error("Unknown accepted operation");
        const operation = activeOperation;
        // Atomic persisted metadata lookup + append: no in-memory dedup map.
        // Bound 100-entry fixture fails closed rather than silently truncating.
        const hidden = await conversation.commit(async tx => {
          const accepted = await tx.submissionByRequest(conversation.id, operation);
          if (!accepted || accepted.type !== "input" || accepted.status === "queued") throw new Error("Operation not placed");
          const history = await tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, 100);
          if (history.items.length >= 100) throw new Error("Fixture history bound exceeded");
          const matches = history.items.filter(entry => entry.kind === "host.plan.operation" &&
            (entry.data as { requestId?: string } | undefined)?.requestId === operation);
          if (matches.length > 1) throw new Error("Duplicate operation mapping");
          if (matches[0]) {
            const id = (matches[0].data as { entryId: number }).entryId;
            const entry = history.items.find(item => item.id === id);
            if (!entry || entry.kind !== "host.plan.hidden") throw new Error("Invalid operation mapping");
            return entry;
          }
          hookCalls++;
          const result = await scoped(() => planHook({ systemPrompt: "" }, { sessionManager: { getSessionDir: () => dir } }));
          if (!result.message) throw new Error("Missing Plan context");
          const data = JSON.parse(JSON.stringify(result.message)) as HiddenMessage;
          const entry = await tx.appendEntry(conversation.id, { kind: "host.plan.hidden", data,
            model: [{ role: "user", content: data.content, timestamp: 1 }] });
          await tx.appendEntry(conversation.id, { kind: "host.plan.operation", data: { requestId: operation, entryId: entry.id } });
          return entry;
        }, hookContext);
        if (interrupt) { entered(); await awaitWithContext(never, hookContext); }
        const history = (await conversation.entries({ order: "ascending" }, 100, undefined, hookContext)).items;
        // Public context hoists system messages (including tool definitions).
        // Verify that this bounded raw-entry reconstruction is exact before use.
        const ordered = (messages: typeof request.messages) => [...messages.filter(message => message.role === "system"), ...messages.filter(message => message.role !== "system")];
        const full = ordered(history.flatMap(entry => entry.model ?? []));
        expect((await conversation.context(hookContext)).messages).toEqual(full);
        // Entry ID, not prompt text, selects the exact projection to remove.
        // Only accept the complete known public context or that context minus
        // THIS committed entry. Unknown cutoffs fail closed, not heuristic dedup.
        if (JSON.stringify(request.messages) === JSON.stringify(full)) {
          requestPrepared = true; alreadyIncluded++; return { messages: request.messages };
        }
        const without = ordered(history.filter(entry => entry.id !== hidden.id).flatMap(entry => entry.model ?? []));
        if (JSON.stringify(request.messages) !== JSON.stringify(without)) throw new Error("Unknown request cutoff");
        requestPrepared = true; projections++;
        return { messages: [...request.messages, ...hidden.model!] };
      },
    };
    const extension = defineExtension({ name: "plan-positive", tools: [tool], hooks: [{ task: "pi.generation", handlers }] });
    const registry = createRegistry(); registry.install(extension);
    const models = createModels({ authContext: { env: async () => { throw new Error("No ambient auth"); }, fileExists: async () => { throw new Error("No ambient auth"); } } });
    const stream = (_model: unknown, request: { messages: readonly unknown[] }, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted();
      // Durable hook failures are isolated by the scheduler. The bounded host
      // provider must also refuse dispatch unless THIS request passed validation.
      if (!requestPrepared) throw new Error("Plan request was not prepared");
      requestPrepared = false;
      const message = response(durableRequests.length); durableRequests.push(structuredClone(request));
      const output = new AssistantMessageEventStream(); output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); output.end(); return output;
    };
    models.setProvider(createProvider({ id: model.provider, models: [model],
      auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {}, source: "fixture" }) } }, api: { stream, streamSimple: stream } }));
    const storageAt = () => SqliteStorage.open(new BunSqliteDatabase(resolve(dir, "plan.sqlite")));
    const options = { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } };
    harness = await Harness.open(await storageAt(), options, context);
    conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id }, extensions: [extension] } });
    markdown = "- [ ] RUN_ONE_SNAPSHOT";
    const submission = await conversation.submit({ type: "input", requestId: activeOperation, content: [{ type: "text", text: "positive-first" }] }, context);
    const waiting = submission.wait(context).catch(() => undefined);
    await committedBarrier;
    expect(durableRequests).toHaveLength(0); expect(hookCalls).toBe(1);
    const firstEntries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    const original = firstEntries.find(entry => entry.kind === "host.plan.hidden")!;
    expect(original).toBeDefined();
    const conversationId = conversation.id, submissionId = submission.id;
    await harness.close(context); await waiting;
    // This simulates cooperative interruption after commit, NOT SIGKILL. The
    // external host retains the EXACT submissionId; no "latest pending" guess.
    activeOperation = undefined; interrupt = false;
    harness = await Harness.open(await storageAt(), options, context);
    conversation = (await harness.conversation(conversationId, context))!;
    const recovered = (await harness.submission(submissionId, context))!;
    const status = await recovered.status(context);
    if (status.conversationId !== conversation.id || status.requestId !== "positive-first" || status.status !== "placed") throw new Error("Ambiguous recovery correlation");
    activeOperation = status.requestId;
    markdown = "- [ ] CHANGED_WHILE_INTERRUPTED";
    await recovered.wait(context);
    expect(hookCalls).toBe(1); expect(durableRequests).toHaveLength(2);
    expect(markdown).toBe("- [-] MID_RUN_MUTATION");
    activeOperation = "positive-second";
    await (await conversation.submit({ type: "input", requestId: activeOperation, content: [{ type: "text", text: "positive-second" }] }, context)).wait(context);
    expect(hookCalls).toBe(2); expect(durableRequests).toHaveLength(4);
    expect(hookAttempts).toBe(5); expect(projections).toBe(2); expect(alreadyIncluded).toBe(2);
    const entries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    const hidden = entries.filter(entry => entry.kind === "host.plan.hidden");
    expect(hidden).toHaveLength(2); expect(hidden[0]).toEqual(original);
    for (let i = 0; i < 2; i++) expect(JSON.stringify(hidden[i]!.data)).toBe(JSON.stringify({ customType: legacyHidden[i]!.customType, content: legacyHidden[i]!.content, display: legacyHidden[i]!.display }));
    const userContents = (messages: readonly unknown[]) => messages.filter((message): message is { role: string; content: unknown } =>
      typeof message === "object" && message !== null && "role" in message && message.role === "user").map(message => message.content);
    for (let i = 0; i < 4; i++) expect(userContents(durableRequests[i]!.messages)).toEqual(userContents(legacyRequests[i]!.messages));
    expect(userContents(durableRequests[1]!.messages)).toHaveLength(2); // no per-tool-turn refresh
    expect(userContents(durableRequests[3]!.messages)).toHaveLength(4);
    const fork = await conversation.fork(hidden[1]!.id, { ownership: { kind: "ownerless" } }, context);
    const forkEntries = (await fork.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(forkEntries.filter(entry => entry.kind === "host.plan.hidden")).toEqual(hidden);
    expect(userContents((await fork.context(context)).messages)).toEqual(userContents(legacyRequests[2]!.messages));
    const finalContext = await conversation.context(context);
    await harness.close(context); harness = await Harness.open(await storageAt(), options, context);
    conversation = (await harness.conversation(conversationId, context))!;
    expect((await conversation.context(context)).messages).toEqual(finalContext.messages);
    expect((await conversation.entries({ order: "ascending" }, 100, undefined, context)).items.filter(entry => entry.kind === "host.plan.hidden")).toEqual(hidden);
    // Qualified: custom JSON + user-model request content and immutable history.
    // Not qualified: system/tool transcript equivalence, ambiguous recovery,
    // multi-input batching, concurrent owners, compaction or production adoption.
  } finally {
    session?.dispose(); await harness?.close(context);
    keys.forEach((key, index) => { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globals, key, descriptor); else delete globals[key]; });
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
