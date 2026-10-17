import "./src/test-guard.js";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ExtensionToolContext } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { AssistantMessage, CredentialStore, TranscriptContext } from "../../node_modules/@earendil-works/pi-ai";
import type { JsonValue } from "../../runtime/durable-engine/qualification/chord.ts";
import type { TSchema, Message } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantEntry, Harness, createRegistry, defineExtension, type Conversation, type GenerationHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { TestOwner } from "./src/ownership.js";
import { barrier, context } from "./src/fixture.js";
import { createHostModels } from "../../runtime/durable-engine/src/index.js";
import { createHostTool } from "../../runtime/durable-engine/src/index.js";
import { createHostBashTool } from "../../runtime/durable-engine/src/index.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";

const root = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime, SessionManager } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", root)) as typeof import("../../node_modules/@earendil-works/pi-coding-agent");
const { createAssistantMessageEventStream } = await import(import.meta.resolve("@earendil-works/pi-ai", root)) as typeof import("../../node_modules/@earendil-works/pi-ai");
type Hidden = { customType: string; content: { type: "text"; text: string }[]; display: boolean };
type Hook = (event: { systemPrompt: string }, ctx: { sessionManager: { getSessionDir(): string } }) => Promise<{ message?: Hidden }>;

// One bounded composition, not a production importer/plugin adapter. The native
// provider below cooperatively fences its OWN synthetic admission; host 1.2's
// public dispatch await-gap remains an activation blocker for real providers.
test("vertical: copied existing chat -> host 1.2 models + actual Plan + guarded local bash -> EF terminal; cancelled auth admits no further effects", async () => {
  const addonRoot = process.env.DURABLE_ADDONS_ROOT;
  if (!addonRoot) throw new Error("DURABLE_ADDONS_ROOT required (pinned Plan 0.1.25 checkout)");
  const addon = resolve(addonRoot, "addons/plan-sidebar");
  for (const [file, hash] of Object.entries({
    "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
    "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
    "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
  })) expect(createHash("sha256").update(await Bun.file(resolve(addon, file)).bytes()).digest("hex")).toBe(hash);
  expect((await Bun.file(resolve(addon, "package.json")).json()).version).toBe("0.1.25");
  const dir = await mkdtemp(resolve(process.env.PICLAW_WORKSPACE!, "vertical-"));
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase(); getDb().query("VACUUM INTO ?").run(resolve(dir, "host.sqlite")); closeDatabase();
  // Acquire host ownership BEFORE constructing the candidate sidecar or harness.
  const owner = TestOwner.acquire(resolve(dir, "host.sqlite"));
  const db = new Database(owner.path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); installTerminalSettlementCompositionSchema(db);
  db.exec("CREATE TABLE vertical_kv (chat TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const jid = "web:vertical-existing", branch = "existing-main", token = "SYNTHETIC_VERTICAL_HOST_ONLY_TOKEN";
  db.query("INSERT INTO chats (jid,name,last_message_time) VALUES (?,?,?)").run(jid, "Existing vertical chat", at);
  db.query("INSERT INTO chat_branches (branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(branch, jid, jid, "host-selected-agent", at, at);
  for (const [id, content, bot] of [["prior-user", "PRIOR_USER_CONTEXT", 0], ["prior-assistant", "PRIOR_ASSISTANT_CONTEXT", 1]] as const) {
    db.query("INSERT INTO messages (id,chat_jid,sender,content,timestamp,is_bot_message) VALUES (?,?,?,?,?,?)").run(id, jid, bot ? "host-selected-agent" : "user", content, at, bot);
  }
  const priorTimeline = db.query("SELECT * FROM messages ORDER BY id").all();
  const priorBranch = db.query("SELECT * FROM chat_branches").all();
  let allowed = true, prepared = false, active = "happy", planWrites = 0, shellCalls = 0, admissions = 0;
  const assertAllowed = () => { owner.assert(); if (!allowed) throw new Error("Private host authority revoked"); };
  const local = new AsyncLocalStorage<{ assertAllowed(): void }>();
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["__piclawRuntimeInterop", "__piclaw_planSidebarApi", "__piclaw_registerAddonConfigApi", "__PICLAW_BROADCAST_EVENT__"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  const authEntered = barrier(), authRelease = barrier();
  let holdAuth = false;
  try {
    const kvScope = (extension: string, key: string, scope: string, chat: string) => {
      expect([extension, key, scope, chat]).toEqual(["plan-sidebar", "plan", "chat", jid]);
      if (!local.getStore()) throw new Error("Missing invocation scope");
      local.getStore()!.assertAllowed();
    };
    globals.__piclawRuntimeInterop = { getExtensionKvStore: () => ({
      get(extension: string, key: string, scope: string, chat: string) {
        kvScope(extension, key, scope, chat);
        return JSON.parse((db.query("SELECT value FROM vertical_kv WHERE chat=?").get(chat) as { value: string }).value);
      },
      set(extension: string, key: string, data: unknown, scope: string, chat: string) {
        kvScope(extension, key, scope, chat); // synchronous SQL effect fence
        db.query("INSERT OR REPLACE INTO vertical_kv VALUES (?,?)").run(chat, JSON.stringify(data)); planWrites++;
      },
    }) };
    delete globals.__piclaw_registerAddonConfigApi;
    globals.__PICLAW_BROADCAST_EVENT__ = () => local.getStore()!.assertAllowed();
    db.query("INSERT INTO vertical_kv VALUES (?,?)").run(jid, JSON.stringify({ chat_jid: jid, markdown: "- [ ] EXISTING_PLAN", updated_at: at }));
    const actual = await import(`${resolve(addon, "index.ts")}?vertical-1650`);
    const chat = await import(resolve(addon, "compat/chat-context.ts")) as { withChatContext<T>(jid: string, channel: string, fn: () => Promise<T>): Promise<T> };
    const scoped = <T>(check: () => void, fn: () => Promise<T>) => local.run({ assertAllowed: check }, () => chat.withChatContext(jid, "web", fn));
    let definition: ToolDefinition<TSchema, JsonValue> | undefined, hook: Hook | undefined;
    actual.default({ on(event: string, fn: Hook) { expect(event).toBe("before_agent_start"); hook = fn; }, registerTool(tool: ToolDefinition<TSchema, JsonValue>) { definition = tool; } });
    if (!definition || !hook) throw new Error("Actual Plan registration missing");
    const planHook = hook;
    const plan = createHostTool(definition, { authority: { check: assertAllowed }, effectFence: "host-effect-port",
      invoke(args, call) {
        if ((args as { chat_jid?: string }).chat_jid && (args as { chat_jid?: string }).chat_jid !== jid) throw new Error("Cross-chat override");
        return scoped(call.assertAllowed, () => call.execute(call.toolCallId, args, call.signal, call.onUpdate,
          { sessionManager: { getSessionDir: () => dir } } as ExtensionToolContext));
      } });
    const bash = createHostBashTool({ cwd: dir, authority: { assertAllowed }, shellPath: () => { assertAllowed(); shellCalls++; return "/bin/bash"; } });
    let conversation: Conversation;
    const handlers: Pick<GenerationHooks, "beforeRequest"> = { async beforeRequest(request, api, ctx) {
      prepared = false; assertAllowed();
      if (api.conversationId !== conversation.id) throw new Error("Unmapped conversation");
      const hidden = await conversation.commit(async tx => {
        const accepted = await tx.submissionByRequest(conversation.id, active);
        if (!accepted || accepted.type !== "input" || accepted.status === "queued") throw new Error("Unplaced operation");
        const history = await tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, 100);
        if (history.items.length >= 100) throw new Error("Bound exceeded");
        const mapping = history.items.find(e => e.kind === "host.plan.operation" && (e.data as { requestId?: string })?.requestId === active);
        if (mapping) {
          const entry = history.items.find(e => e.id === (mapping.data as { entryId: number }).entryId);
          if (!entry || entry.kind !== "host.plan.hidden") throw new Error("Invalid mapping");
          return entry;
        }
        const result = await scoped(assertAllowed, () => planHook({ systemPrompt: "" }, { sessionManager: { getSessionDir: () => dir } }));
        if (!result.message) throw new Error("Missing Plan snapshot");
        const data = JSON.parse(JSON.stringify(result.message)) as Hidden;
        const entry = await tx.appendEntry(conversation.id, { kind: "host.plan.hidden", data, model: [{ role: "user", content: data.content, timestamp: 1 }] });
        await tx.appendEntry(conversation.id, { kind: "host.plan.operation", data: { requestId: active, entryId: entry.id } });
        return entry;
      }, ctx);
      // Exact known public-context cutoff, not string/content-based dedup.
      const history = (await conversation.entries({ order: "ascending" }, 100, undefined, ctx)).items;
      const ordered = (messages: readonly Message[]) => [...messages.filter(m => m.role === "system"), ...messages.filter(m => m.role !== "system")];
      const full = ordered(history.flatMap(e => e.model ?? []));
      expect((await conversation.context(ctx)).messages).toEqual(full);
      const without = ordered(history.filter(e => e.id !== hidden.id).flatMap(e => e.model ?? []));
      const included = JSON.stringify(request.messages) === JSON.stringify(full);
      if (!included && JSON.stringify(request.messages) !== JSON.stringify(without)) throw new Error("Unknown request cutoff");
      prepared = true;
      return { messages: included ? request.messages : [...request.messages, ...hidden.model!] };
    } };
    const extension = defineExtension({ name: "vertical-host", tools: [plan, bash], hooks: [{ task: "pi.generation", handlers }] });
    const registry = createRegistry(); registry.install(extension);
    const ref = { provider: "synthetic-vertical", id: "host-selected" };
    const model = { ...ref, name: "Vertical", api: "openai-completions" as const, baseUrl: "https://fixture.invalid", input: ["text" as const], reasoning: false,
      contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const credentials: CredentialStore = {
      async read(id) { expect(id).toBe(ref.provider); return { type: "api_key", key: token }; },
      async list() { return [{ providerId: ref.provider, type: "api_key" }]; },
      async modify() { throw new Error("No credential writes"); }, async delete() { throw new Error("No credential deletion"); },
    };
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
    const requests: TranscriptContext[] = [];
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const answer = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({ role: "assistant", api: model.api, provider: ref.provider, model: ref.id, content, stopReason, timestamp: 1, usage });
    const stream = (_model: unknown, request: TranscriptContext, options?: { signal?: AbortSignal; apiKey?: string; maxRetries?: number }) => {
      // Cooperative SYNTHETIC admission, not a private patch or real-provider guarantee.
      options?.signal?.throwIfAborted(); assertAllowed();
      if (!prepared) throw new Error("Plan request not prepared"); prepared = false;
      expect(options?.apiKey).toBe(token); expect(options?.maxRetries).toBe(0);
      admissions++; requests.push(structuredClone(request));
      const index = requests.length - 1;
      const message = index === 0 ? answer([{ type: "toolCall", id: "plan-read", name: "plan", arguments: { action: "get" } }], "toolUse")
        : index === 1 ? answer([{ type: "toolCall", id: "plan-write", name: "plan", arguments: { action: "write", markdown: "- [x] VERTICAL_DONE" } }], "toolUse")
        : index === 2 ? answer([{ type: "toolCall", id: "local-bash", name: "bash", arguments: { command: "printf vertical-fixture > result.txt; printf vertical-fixture" } }], "toolUse")
        : answer([{ type: "text", text: "vertical answer" }]);
      const output = createAssistantMessageEventStream(); output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); output.end(message); return output;
    };
    runtime.registerNativeProvider({ id: ref.provider, name: "Synthetic vertical", getModels: () => [model],
      auth: { apiKey: { name: "Synthetic", resolve: async ({ credential }) => {
        if (holdAuth) { authEntered.release(); await authRelease.promise; }
        return { auth: { apiKey: credential!.key! } };
      } } }, stream, streamSimple: stream });
    const generation = new AbortController();
    const models = createHostModels(runtime, [ref], { signal: generation.signal, authorize: async () => assertAllowed(), assertCurrent: assertAllowed });
    owner.assert();
    const storage = await SqliteStorage.open(new BunSqliteDatabase(resolve(dir, "durable.sqlite")));
    harness = await Harness.open(storage, { models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    conversation = await harness.root(context, { agent: { model: { provider: ref.provider, modelId: ref.id }, extensions: [extension], tools: [plan, bash] } });
    // Public legacy fixture generation + public append only. These TWO known
    // messages are data-copy evidence, not a general legacy importer.
    const legacy = SessionManager.create(dir, resolve(dir, "legacy-sessions"));
    legacy.appendMessage({ role: "user", content: "PRIOR_USER_CONTEXT", timestamp: 1 });
    legacy.appendMessage(answer([{ type: "text", text: "PRIOR_ASSISTANT_CONTEXT" }]));
    const copied = JSON.parse(JSON.stringify(legacy.buildSessionContext().messages)) as Message[];
    expect(copied).toHaveLength(2);
    await conversation.commit(async tx => {
      for (const message of copied) await tx.appendEntry(conversation.id, { kind: "host.copied-message", data: { chatJid: jid, branch, sourceSessionId: legacy.getSessionId() }, model: [message] });
    }, context);
    const identity = { chatJid: jid, branch, sourceSessionId: legacy.getSessionId(), conversationId: conversation.id };
    const payloads = new InMemoryEffectPayloadResolver();
    const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
    let commitChecks = 0;
    const terminal = value(createCurrentPiclawTerminalSettlementStore(db, payloads, { hitFault: () => false, recordTrace() {}, validateOwnership() {
      expect(db.inTransaction).toBe(true); owner.assert(); commitChecks++; return true;
    } }));
    const accept = async (id: string) => {
      const source = value(await work.acceptSource(sealed({ effect: effect(`accept:${id}`), chatJid: jid, sourceId: id, kind: "message" as const,
        payloadRef: `input:${id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      const claim = value(await work.claimNext(sealed({ effect: effect(`claim:${id}`), chatJid: jid, expectedFrontier: source.sourceSeq - 1, newOperationId: `host:${id}`, claimedAt: at })))!;
      return { source, operation: claim.operation };
    };
    const settle = async (id: string, sourceSeq: number, submission: Awaited<ReturnType<Conversation["submit"]>>) => {
      const status = await submission.status(context);
      let operation = value(await work.getOperation(`host:${id}`))!;
      if (status.type !== "input" || status.conversationId !== identity.conversationId || status.requestId !== id) throw new Error("Wrong submission owner");
      if (status.status !== "done" && !(operation.cancellation && status.status === "unanswered")) throw new Error("No committed terminal evidence");
      const entry = status.status === "done" ? await conversation.commit(tx => tx.entry(AssistantEntry, status.answer), context) : undefined;
      if (status.status === "done" && (!entry || entry.conversationId !== identity.conversationId)) throw new Error("Wrong answer owner");
      if (status.status === "unanswered") expect(status.reason.length).toBeGreaterThan(0);
      operation = value(await work.bindHarness(sealed({ effect: effect(`bind:${id}`, operation.operationId, sourceSeq), expectedVersion: operation.version,
        sessionId: identity.sourceSessionId, lane: "main", harnessOperationId: String(submission.id), state: "finished" as const, watchGeneration: owner.token.generation })));
      const cancelled = operation.cancellation !== null;
      const text = (entry?.model ?? []).filter(m => m.role === "assistant").flatMap(m => m.content.filter(p => p.type === "text").map(p => p.text)).join("");
      payloads.putText(`answer:${id}`, text);
      const request = sealed({ effect: effect(`terminal:${id}`, operation.operationId, sourceSeq), expectedChatJid: jid, expectedVersion: operation.version, expectedHarness: operation.harness,
        disposition: cancelled ? "cancelled" as const : "completed" as const, errorCode: null, terminalAuthorityRef: null,
        timeline: cancelled
          ? { mode: "none" as const, placeholderRowId: null, chatJid: jid, contentRef: null, threadId: null, mediaIds: [] as const, contentBlocksRef: null }
          : { mode: "insert" as const, placeholderRowId: null, chatJid: jid, contentRef: `answer:${id}`, threadId: null, mediaIds: [], contentBlocksRef: null },
        sourceDispositions: [{ sourceSeq, state: "consumed" as const, reason: "vertical settled" }], outboxIntents: [], committedAt: at });
      const result = value(await terminal.commitTerminal(request));
      expect(value(await terminal.commitTerminal(request))).toEqual(result); // exactly-once commit, not delivery
      return result;
    };
    const happy = await accept(active);
    const submitted = await conversation.submit({ type: "input", requestId: active, content: "Continue this existing chat" }, context);
    await submitted.wait(context);
    expect((await settle(active, happy.source.sourceSeq, submitted)).disposition).toBe("completed");
    expect(admissions).toBe(4); expect(planWrites).toBe(1); expect(shellCalls).toBe(1);
    expect(await Bun.file(resolve(dir, "result.txt")).text()).toBe("vertical-fixture");
    expect(JSON.stringify(requests[0])).toContain("PRIOR_USER_CONTEXT"); expect(JSON.stringify(requests[0])).toContain("PRIOR_ASSISTANT_CONTEXT");
    for (const request of requests) {
      const userContext = JSON.stringify(request.messages.filter(message => message.role === "user"));
      expect(userContext).toContain("EXISTING_PLAN"); expect(userContext).not.toContain("VERTICAL_DONE");
    }
    expect(JSON.stringify(requests.at(-1))).toContain("vertical-fixture");
    const before = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(before.filter(e => e.kind === "host.plan.hidden")).toHaveLength(1);
    expect(JSON.stringify(before)).toContain('"display":false');
    const toolResults = before.flatMap(entry => entry.model ?? []).filter(message => message.role === "toolResult");
    expect(toolResults.map(message => message.toolName)).toEqual(["plan", "plan", "bash"]);
    expect(toolResults.every(message => !message.isError)).toBe(true);
    expect(toolResults.at(-1)?.content).toEqual([{ type: "text", text: "vertical-fixture" }]);
    expect(JSON.parse((db.query("SELECT value FROM vertical_kv WHERE chat=?").get(jid) as { value: string }).value).markdown).toBe("- [x] VERTICAL_DONE");
    expect((await conversation.agent(context)).tools.map(tool => tool.name).sort()).toEqual(["bash", "plan"]);
    expect(models.getAllModels().map(model => [model.provider, model.id])).toEqual([[ref.provider, ref.id]]);
    expect(plan.replay).toBe("unsafe"); expect(bash.replay).toBe("unsafe");
    // Second accepted source is cancelled DURING host credential resolution.
    active = "cancelled"; holdAuth = true;
    const cancellation = await accept(active);
    const pending = await conversation.submit({ type: "input", requestId: active, content: "Must not run another shell" }, context);
    const waiting = pending.wait(context);
    await authEntered.promise;
    const cancel = value(await work.acceptSource(sealed({ effect: effect("accept-cancel"), chatJid: jid, sourceId: "cancel-source", kind: "cancellation" as const,
      payloadRef: "cancel:payload", targetOperationId: cancellation.operation.operationId, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    value(await work.acceptCancellation(sealed({ effect: effect("cancel", cancellation.operation.operationId, cancel.sourceSeq), expectedVersion: cancellation.operation.version,
      sourceId: "cancel-source", sourceSeq: cancel.sourceSeq, cause: "user", requestedAt: at })));
    allowed = false; generation.abort(); authRelease.release(); await waiting;
    expect((await settle(active, cancellation.source.sourceSeq, pending)).disposition).toBe("cancelled");
    expect(admissions).toBe(4); expect(shellCalls).toBe(1); expect(planWrites).toBe(1);
    expect(await Bun.file(resolve(dir, "result.txt")).text()).toBe("vertical-fixture");
    expect(db.query("SELECT content FROM messages WHERE is_bot_message=1 AND id NOT IN ('prior-user','prior-assistant')").all()).toEqual([{ content: "vertical answer" }]);
    expect(db.query("SELECT * FROM messages WHERE id IN ('prior-user','prior-assistant') ORDER BY id").all()).toEqual(priorTimeline);
    expect(db.query("SELECT * FROM chat_branches").all()).toEqual(priorBranch);
    expect(db.query("SELECT count(*) AS n FROM service_effect_s02_commits").get()).toEqual({ n: 2 });
    expect(db.query("SELECT * FROM service_effect_s05_outbox").all()).toEqual([]); // no delivery claim
    expect(commitChecks).toBeGreaterThanOrEqual(2);
    const entries = (await conversation.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(entries.filter(e => e.kind === "host.copied-message")).toEqual(before.filter(e => e.kind === "host.copied-message"));
    const snapshots = entries.filter(e => e.kind === "host.plan.hidden");
    expect(snapshots).toHaveLength(2);
    const originalSnapshot = before.find(e => e.kind === "host.plan.hidden");
    assert(originalSnapshot, "Original Plan snapshot missing");
    expect(snapshots[0]).toEqual(originalSnapshot);
    expect(JSON.stringify(snapshots[1]?.data)).toContain("VERTICAL_DONE");
    for (const value of [entries, await conversation.context(context), models.getAllModels(), await models.getAuth(models.getModel(ref.provider, ref.id)!)]) {
      expect(JSON.stringify(value)).not.toContain(token); expect(JSON.stringify(value)).not.toContain(owner.token.nonce);
    }
  } finally {
    authRelease.release(); await harness?.close(context);
    keys.forEach((key, index) => { const descriptor = saved[index]; if (descriptor) Object.defineProperty(globals, key, descriptor); else delete globals[key]; });
    db.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true });
  }
}, 20000);
