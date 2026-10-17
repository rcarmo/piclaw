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
import { Harness, InboxDoc } from "../../runtime/durable-engine/qualification/durable.ts";
import { createProvider } from "../../runtime/durable-engine/qualification/ai.ts";

test("shared DB actual facade resolves, persists/reopens and fails closed for pending/stale/concurrent model changes", async () => {
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
  await f.close();
  const manifest = [{ chatJid: "web:idle", branchId: "main", conversationId: id }];
  const unused = async () => { throw Error("unused effect"); };
  const config = { incarnation: "idle", owner: { assert: () => owner.assert(), release() {} }, openStorage,
    withIdleModelGuard: <T>(body: () => Promise<T>) => { beforeGuard?.(); return sql.withIdleModelGuard(body); },
    harnessOptions: { models: f.models, registry: f.registry },
    work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
    terminal: { getTerminal: unused, commitTerminal: unused } as any,
    bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
    conversationFor: () => id, existingConversationIds: [id], authorizeScheduling: unused, putAnswer: unused,
    sessionId: "idle", lane: "idle", generation: 1, now: () => new Date(0).toISOString() };
  let runtime = await HostConversationRuntime.open(config, context);
  const appFor = () => {
    const adapter = createDurableConversationAdapter({ incarnation: "idle", manifest, runtime });
    return new AgentRuntimeFacade({ pool: new Map(), durableSessions: new Map([["web:idle", adapter.sessionPosition("web:idle", "main", "idle")]]),
      getOrCreateRuntime: unused, modelRegistry: { getAll: () => f.models.getModels() } as any, modelRuntime: {} as any,
      authPath: "unused", clearAttachments() {}, refreshRuntime: unused });
  };
  try {
    let app = appFor();
    const command = { type: "model" as const, modelId: "SYNTHETIC", raw: "/model SYNTHETIC" };
    const other = { ...command, provider: "alternate", modelId: "other" };
    expect((await app.applyControlCommand("web:idle", other)).status).toBe("success");
    expect(await app.getCurrentModelLabel("web:idle")).toBe("alternate/other");
    await expect(app.applyControlCommand("web:idle", { ...other, modelId: "tiny" })).rejects.toThrow("bound exceeded");
    expect(await app.getCurrentModelLabel("web:idle")).toBe("alternate/other");
    expect((await app.applyControlCommand("web:idle", command)).status).toBe("success");
    expect((await app.applyControlCommand("web:idle", { ...command, modelId: "unknown" })).status).toBe("error");
    const results = await Promise.allSettled([app.applyControlCommand("web:idle", command), app.applyControlCommand("web:idle", command)]);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('pending',NULL)").run();
    root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='pending'").run();
    // An accepted source anywhere in the shared file denies SET, even without an active operation.
    root.query("INSERT INTO service_effect_s01_sources VALUES ('pending',1,'source',?,'message','pending','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
    await expect(app.applyControlCommand("web:idle", command)).rejects.toThrow("not idle");
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
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
      await expect(app.applyControlCommand("web:idle", other)).rejects.toThrow("Root connection transaction active");
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
        await expect(app.applyControlCommand("web:idle", other)).rejects.toThrow("Root connection transaction active");
        expect(checks).toBe(target);
      } finally {
        guardHook = undefined;
        if (root.inTransaction) root.exec("ROLLBACK");
      }
      await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
      app = appFor();
      expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
      expect(root.inTransaction).toBe(false);
    }
    // Work admitted after candidate inspection but before the storage guard must deny SET.
    beforeGuard = () => root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    await expect(app.applyControlCommand("web:idle", other)).rejects.toThrow("not idle");
    beforeGuard = undefined;
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    // Under BEGIN IMMEDIATE, another connection cannot admit work; loss of owner
    // at the final guard must roll back the actual changed model, not just report failure.
    let checks = 0;
    guardHook = () => {
      if (++checks === 2) expect(() => root.query("UPDATE service_effect_s01_sources SET state='pending'").run()).toThrow();
      if (checks === 3) throw Error("final guard lost owner");
    };
    await expect(app.applyControlCommand("web:idle", other)).rejects.toThrow("final guard lost owner");
    guardHook = undefined;
    expect(checks).toBe(3);
    // Candidate deliberately seals a session after any storage commit failure.
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    app = appFor();
    expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    stale = true;
    await expect(app.applyControlCommand("web:idle", command)).rejects.toThrow("stale owner");
    stale = false;
    expect(await app.getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    expect(await appFor().getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    // Public candidate inbox state, without running scheduler/provider code.
    await runtime.close();
    const harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    const conversation = (await harness.conversation(id, context))!;
    await conversation.commit(async tx => {
      (await tx.doc(InboxDoc, id)).items.push({ id: 999 as any, mode: "write", entry: { kind: "qualification.pending" } });
    }, context);
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    await expect(appFor().applyControlCommand("web:idle", other)).rejects.toThrow("not idle");
    expect(await appFor().getCurrentModelLabel("web:idle")).toBe("qualification/synthetic");
    expect(f.host.modelCalls).toBe(0);
    expect(f.host.credentialLookups).toBe(0);
  } finally { await runtime.close(); root.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true }); }
});
