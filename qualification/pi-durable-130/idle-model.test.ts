import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BunSqliteDatabase, HostConversationRuntime } from "../../runtime/durable-engine/src/index.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { TestOwner } from "./src/ownership.js";
import { openFixture, context } from "./src/fixture.js";
import { installServiceWorkSchema } from "../../runtime/src/service-effects/current-piclaw/service-work-schema.js";
import { createDurableConversationAdapter } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { AgentRuntimeFacade } from "../../runtime/src/agent-pool/runtime-facade.js";
import { Harness, defineExtension, defineTool } from "../../runtime/durable-engine/qualification/durable.ts";
import { createProvider, Type } from "../../runtime/durable-engine/qualification/ai.ts";

test("shared DB next-request model controls persist while destructive reset retains global idle/owner/transaction guards", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "idle-model-"));
  const path = join(dir, "shared.db"), owner = TestOwner.acquire(path), root = new Database(path);
  installServiceWorkSchema(root);
  let stale = false;
  let guardHook: (() => void) | undefined;
  let beforeGuard: (() => void) | undefined;
  let sql: BunSqliteDatabase;
  const openStorage = () => { sql = new BunSqliteDatabase(path, { root, assertOwner() { owner.assert(); guardHook?.(); if (stale) throw Error("stale owner"); } }); return SqliteStorage.open(sql); };
  const f = await openFixture({ get acquired() { return owner.acquired; } }, () => {}, openStorage);
  const id = f.root.id;
  const original = f.models.getModels()[0]!;
  f.models.setProvider(createProvider({ id: "alternate", api: { stream() { throw Error("provider execution forbidden"); }, streamSimple() { throw Error("provider execution forbidden"); } }, models: [{ ...original, provider: "alternate", id: "other" },
    { ...original, provider: "alternate", id: "tiny", contextWindow: 100 }],
    auth: { apiKey: { name: "keyless", resolve: async () => ({ auth: {}, source: "synthetic" }) } } }));
  let promptText = "measured optional prompt", promptRenders = 0;
  const promptExtension = defineExtension({name:"optional-prompt",sections:[{key:"optional-prompt",async render(){promptRenders++;return promptText || undefined;}}]});
  f.registry.install(promptExtension);
  await f.root.configure({extensions:{add:[promptExtension]}}, context);
  await f.close();
  const manifest = [{ chatJid: "web:idle", branchId: "main", conversationId: id }];
  const unused = async () => { throw Error("unused effect"); };
  let modelReads = 0, settingsReads = 0;
  const config = { incarnation: "idle", owner: { assert() { owner.assert(); if (stale) throw Error("stale owner"); }, release() {} }, openStorage,
    withIdleModelGuard: <T>(body: () => Promise<T>) => { beforeGuard?.(); return sql.withIdleModelGuard(body); },
    harnessOptions: { models: () => { modelReads++; return f.models; }, registry: f.registry,
      settings: () => { settingsReads++; return undefined; } },
    work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
    terminal: { getTerminal: unused, commitTerminal: unused } as any,
    bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
    conversationFor: () => id, existingConversationIds: [id], authorizeScheduling: unused, putAnswer: unused,
    sessionId: "idle", lane: "idle", generation: 1, now: () => new Date(0).toISOString() };
  let runtime = await HostConversationRuntime.open(config, context);
  const appFor = () => {
    const adapter = createDurableConversationAdapter({ incarnation: "idle", manifest, runtime });
    return new AgentRuntimeFacade({ pool: new Map(), getDurableSession: chat => chat === "web:idle" ? adapter.sessionPosition("web:idle", "main", "idle") : undefined, modelRegistry: { getAll: () => f.models.getModels() } as any, modelRuntime: {} as any,
      authPath: "unused",});
  };
  try {
    let app = appFor();
    const beforeForks = root.query("SELECT COUNT(*) AS n FROM conversations").get();
    for (const modelId of ["tiny", "missing"]) {
      await expect(runtime.allocateScheduledFork(id, () => { throw Error("must not allocate"); }, { provider: "alternate", modelId })).rejects.toThrow();
      expect(root.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual(beforeForks);
    }
    const choice = { provider: "alternate", modelId: "other" };
    let childId: number | undefined;
    const allocation = runtime.allocateScheduledFork(id, child => { childId = child; }, choice);
    choice.modelId = "tiny";
    await allocation;
    expect(childId).toBeDefined();
    // An installed, unselected tool must not inflate model-switch admission.
    // Its declaration alone exceeds the candidate model window.
    const excluded = defineTool({ name: "excluded-schema", description: "x".repeat(original.contextWindow + 10000),
      parameters: Type.Object({}), callers: ["tools"], execute: async () => ({}) });
    f.registry.install(defineExtension({ name: "excluded-context-schema", tools: [excluded] }));
    expect(Buffer.byteLength(excluded.description)).toBeGreaterThan(original.contextWindow);
    expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    const command = { type: "model" as const, modelId: "SYNTHETIC", raw: "/model SYNTHETIC" };
    const other = { ...command, provider: "alternate", modelId: "other" };
    expect((await app.applyControlCommand("web:idle", other)).status).toBe("success");
    expect(await app.getCurrentModelLabel("web:idle")).toBe("alternate/other");
    expect(promptRenders).toBeGreaterThan(0);
    promptText = "界".repeat(100000);
    expect(await app.applyControlCommand("web:idle", command)).toMatchObject({ status: "error", message: expect.stringContaining("estimate exceeded") });
    expect(await app.getCurrentModelLabel("web:idle")).toBe("alternate/other");
    promptText = "";
    expect(await app.applyControlCommand("web:idle", { ...other, modelId: "tiny" })).toMatchObject({ status: "error", message: expect.stringContaining("estimate exceeded") });
    expect(await app.getCurrentModelLabel("web:idle")).toBe("alternate/other");
    expect((await app.applyControlCommand("web:idle", command)).status).toBe("success");
    expect((await app.applyControlCommand("web:idle", { ...command, modelId: "unknown" })).status).toBe("error");
    const results = await Promise.allSettled([app.applyControlCommand("web:idle", command), app.applyControlCommand("web:idle", command)]);
    expect(results.every(r => r.status === "fulfilled" && r.value.status === "success")).toBe(true);
    const resetCommand = { type: "new_session" as const, raw: "/new-session" };
    const beforeReset = await app.saveSessionPosition("web:idle");
    const callsBeforeReset = f.host.modelCalls;
    const reset = await app.applyControlCommand("web:idle", { type: "new_session", raw: "/new-session" });
    expect(reset).toMatchObject({ status: "success", sessionGeneration: "idle", sessionGenerationChanged: false });
    expect(await app.saveSessionPosition("web:idle")).not.toBe(beforeReset);
    expect(f.host.modelCalls).toBe(callsBeforeReset);
    expect((await app.applyControlCommand("web:idle", { type: "new_session", parent: "/legacy.jsonl", raw: "/new-session /legacy.jsonl" })).status).toBe("error");
    root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('pending',NULL)").run();
    root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='pending'").run();
    // Next-request model selection is allowed while work is pending; destructive reset is not.
    root.query("INSERT INTO service_effect_s01_sources VALUES ('pending',1,'source',?,'message','pending','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
    expect(await app.applyControlCommand("web:idle", command)).toMatchObject({ status: "success" });
    expect(await app.applyControlCommand("web:idle", { type: "new_session", raw: "/new-session" })).toMatchObject({ status: "error", message: "Host work is not idle" });
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    const guardedResetPosition = await app.saveSessionPosition("web:idle");
    // WAL lets a valid owner admit work while root retains an older idle read snapshot.
    root.exec("PRAGMA journal_mode=WAL");
    const writer = new Database(path);
    try {
      beforeGuard = () => {
        root.exec("BEGIN");
        expect(root.query("SELECT state FROM service_effect_s01_sources").get()).toEqual({ state: "disposed" });
        expect(root.inTransaction).toBe(true);
        owner.assert();
        writer.query("UPDATE service_effect_s01_sources SET state='pending'").run();
        expect(writer.inTransaction).toBe(false);
        expect(writer.query("SELECT state FROM service_effect_s01_sources").get()).toEqual({ state: "pending" });
        expect(root.query("SELECT state FROM service_effect_s01_sources").get()).toEqual({ state: "disposed" });
      };
      expect(await app.applyControlCommand("web:idle", resetCommand)).toMatchObject({ status: "error", message: expect.stringContaining("Root connection transaction active") });
      expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    } finally {
      beforeGuard = undefined;
      if (root.inTransaction) root.exec("ROLLBACK");
      writer.close();
    }
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    expect(root.inTransaction).toBe(false);
    // A root transaction opened during any check must also fail closed, including
    // the initial/final checks under the candidate's BEGIN IMMEDIATE write lock.
    for (const target of [1, 2, 3]) {
      let checks = 0;
      guardHook = () => {
        if (++checks === target) {
          root.exec("BEGIN");
          root.query("SELECT state FROM service_effect_s01_sources").all();
        }
      };
      try {
        expect(await app.applyControlCommand("web:idle", resetCommand)).toMatchObject({ status: "error", message: expect.stringContaining("Root connection transaction active") });
        expect(checks).toBe(target);
      } finally {
        guardHook = undefined;
        if (root.inTransaction) root.exec("ROLLBACK");
      }
      await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
      app = appFor();
      expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
      expect(root.inTransaction).toBe(false);
      expect(await app.saveSessionPosition("web:idle")).toBe(guardedResetPosition);
    }
    // Work admitted after reset inspection but before the storage guard must deny reset.
    beforeGuard = () => root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    expect(await app.applyControlCommand("web:idle", resetCommand)).toMatchObject({ status: "error", message: expect.stringContaining("not idle") });
    beforeGuard = undefined;
    expect(await app.saveSessionPosition("web:idle")).toBe(guardedResetPosition);
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    // Under BEGIN IMMEDIATE, another connection cannot admit work; loss of owner
    // at the final guard must roll back reset, not just report failure.
    let checks = 0;
    guardHook = () => {
      if (++checks === 2) expect(() => root.query("UPDATE service_effect_s01_sources SET state='pending'").run()).toThrow();
      if (checks === 3) throw Error("final guard lost owner");
    };
    expect(await app.applyControlCommand("web:idle", resetCommand)).toMatchObject({ status: "error", message: expect.stringContaining("final guard lost owner") });
    guardHook = undefined;
    expect(checks).toBe(3);
    // Candidate deliberately seals a session after any storage commit failure.
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    app = appFor();
    expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    expect(await app.saveSessionPosition("web:idle")).toBe(guardedResetPosition);
    stale = true;
    expect(await app.applyControlCommand("web:idle", command)).toMatchObject({ status: "error", message: expect.stringContaining("stale owner") });
    stale = false;
    expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    expect(await appFor().getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    // Public candidate inbox state, without running scheduler/provider code.
    await runtime.close();
    const harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    const conversation = (await harness.conversation(id, context))!;
    await conversation.submit({ type: "input", requestId: "pending-reset", content: "Pending reset qualification fixture" }, context);
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    expect(await appFor().applyControlCommand("web:idle", other)).toMatchObject({ status: "success" });
    expect(await appFor().applyControlCommand("web:idle", resetCommand)).toMatchObject({ status: "error", message: expect.stringContaining("not idle") });
    expect(await appFor().getCurrentModelLabel("web:idle")).toBe("alternate/other");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.credentialLookups).toBe(0);
    expect(modelReads).toBeGreaterThan(0); expect(settingsReads).toBeGreaterThan(0);
  } finally { await runtime.close(); root.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true }); }
});

test("scoped reset preserves sibling SDK inbox and host sources while refusing its own pending work", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "scoped-reset-"));
  const path = join(dir, "shared.db"), owner = TestOwner.acquire(path), root = new Database(path);
  root.exec("PRAGMA busy_timeout=5000"); // Root fixture writes use the root role lock-wait policy.
  installServiceWorkSchema(root);
  let sql!: BunSqliteDatabase;
  let resetHook: (() => void) | undefined, ownerHook: (() => void) | undefined;
  const openStorage = () => {
    sql = new BunSqliteDatabase(path, { root, assertOwner: () => { owner.assert(); ownerHook?.(); } });
    return SqliteStorage.open(sql);
  };
  const f = await openFixture(owner, () => {}, openStorage), id = f.root.id;
  await f.close();
  const unused = async () => { throw Error("unexpected host effect"); };
  const binding = { incarnation: "scoped", chatJid: "web:idle", branchId: "main", conversationId: id };
  const config = { incarnation: "scoped", owner: { assert: () => owner.assert(), release() {} }, openStorage,
    withIdleModelGuard: <T>(body: () => Promise<T>) => sql.withIdleModelGuard(body),
    withSessionResetGuard: <T>(chatJid: string, body: () => Promise<T>) => { resetHook?.(); return sql.withSessionResetGuard(chatJid, body); },
    harnessOptions: { models: f.models, registry: f.registry },
    work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
    terminal: { getTerminal: unused, commitTerminal: unused } as any,
    bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
    conversationFor: () => id, existingConversationIds: [id], authorizeScheduling: unused, putAnswer: unused,
    sessionId: "scoped", lane: "scoped", generation: 1, now: () => new Date(0).toISOString() };
  let runtime = await HostConversationRuntime.open(config, context);
  let siblingId!: number;
  try {
    await runtime.allocateScheduledFork(id, child => { siblingId = child; });
    await runtime.close();
    let harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    const sibling = (await harness.conversation(siblingId as any, context))!;
    const siblingInput = await sibling.submit({ type: "input", requestId: "sibling-pending", content: "untouched sibling" }, context);
    const siblingSubmissionId = siblingInput.id;
    await harness.close(context);
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    const siblingStatus = await (await harness.submission(siblingSubmissionId, context))!.status(context);
    await harness.close(context);
    root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('other',NULL),('web:idle',NULL)").run();
    root.query("UPDATE service_effect_s01_chats SET next_source_seq=2").run();
    const insert = root.query("INSERT INTO service_effect_s01_sources VALUES (?,1,?,?,'message',?,'payload',NULL,NULL,'now',NULL,'provenance',0)");
    insert.run("other", "other-source", "a".repeat(64), "pending");
    insert.run("web:idle", "own-source", "b".repeat(64), "disposed");
    const beforeSources = root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid").all();
    runtime = await HostConversationRuntime.open(config, context);
    const beforeReset = await runtime.readSessionPosition(binding);
    await runtime.resetSession(binding);
    expect(await runtime.readSessionPosition(binding)).not.toBe(beforeReset);
    expect(root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid").all()).toEqual(beforeSources);
    await expect(sql.withIdleModelGuard(async () => {})).rejects.toThrow("Host work is not idle");
    const afterReset = await runtime.readSessionPosition(binding);
    root.query("UPDATE service_effect_s01_sources SET state='pending' WHERE chat_jid='web:idle'").run();
    await expect(runtime.resetSession(binding)).rejects.toThrow("Host work is not idle");
    expect(await runtime.readSessionPosition(binding)).toBe(afterReset);
    root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE chat_jid='web:idle'").run();
    resetHook = () => root.query("UPDATE service_effect_s01_sources SET state='pending' WHERE chat_jid='web:idle'").run();
    await expect(runtime.resetSession(binding)).rejects.toThrow("Host work is not idle");
    resetHook = undefined;
    expect(await runtime.readSessionPosition(binding)).toBe(afterReset);
    root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE chat_jid='web:idle'").run();
    root.exec("BEGIN");
    await expect(runtime.resetSession(binding)).rejects.toThrow("Root connection transaction active");
    root.exec("ROLLBACK");
    let checks = 0;
    ownerHook = () => { if (++checks === 3) throw Error("scoped final guard lost owner"); };
    await expect(runtime.resetSession(binding)).rejects.toThrow("scoped final guard lost owner");
    ownerHook = undefined;
    expect(checks).toBe(3);
    await runtime.close();
    runtime = await HostConversationRuntime.open(config, context);
    expect(await runtime.readSessionPosition(binding)).toBe(afterReset);
    await runtime.close();
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    expect(await (await harness.submission(siblingSubmissionId, context))!.status(context)).toEqual(siblingStatus);
    const own = (await harness.conversation(id, context))!;
    await own.submit({ type: "input", requestId: "own-pending", content: "must not reset" }, context);
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    await expect(runtime.resetSession(binding)).rejects.toThrow("Conversation is not idle");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.credentialLookups).toBe(0);
  } finally {
    await runtime.close(); root.close(); owner.releaseAfterClose(); owner.closeConnection();
    await rm(dir, { recursive: true, force: true });
  }
});
