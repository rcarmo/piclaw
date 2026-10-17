import "./src/test-guard.js";
import { test, expect, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BunSqliteDatabase, HostConversationRuntime } from "../../runtime/durable-engine/src/index.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { Harness, InboxDoc } from "../../runtime/durable-engine/qualification/durable.ts";
import { TestOwner } from "./src/ownership.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { installServiceWorkSchema } from "../../runtime/src/service-effects/current-piclaw/service-work-schema.js";
import { createDurableConversationAdapter } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { AgentRuntimeFacade } from "../../runtime/src/agent-pool/runtime-facade.js";

test("public manual compact: real model summary, idle admission, observer detach, host acceptance, facade and reopen continuation", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "compact-"));
  const path = join(dir, "shared.db"), owner = TestOwner.acquire(path), root = new Database(path);
  installServiceWorkSchema(root);
  let sql!: BunSqliteDatabase, stale = false, beforeGuard: (() => void) | undefined;
  const openStorage = () => { sql = new BunSqliteDatabase(path, { root, assertOwner() { owner.assert(); if (stale) throw Error("stale owner"); } }); return SqliteStorage.open(sql); };
  const f = await openFixture(owner, () => {}, openStorage), id = f.root.id;
  await f.close();
  const unused = async () => { throw Error("legacy/effect forbidden"); };
  const binding = { incarnation: "compact", chatJid: "web:compact", branchId: "main", conversationId: id };
  let runtime!: HostConversationRuntime, approvals = 0;
  const config = { incarnation: "compact", owner: { assert: () => owner.assert(), release() {} }, openStorage,
    withIdleModelGuard: <T>(body: () => Promise<T>) => { beforeGuard?.(); return sql.withIdleModelGuard(body); },
    harnessOptions: { models: f.models, registry: f.registry, settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } },
    work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
    terminal: { getTerminal: unused, commitTerminal: unused } as any,
    bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
    conversationFor: () => id, existingConversationIds: [id],
    authorizeScheduling: async () => { approvals++; expect((await runtime.inspectAuthority()).inspection.tasks).toHaveLength(0); },
    putAnswer: unused, sessionId: "original-session", lane: "compact", generation: 1, now: () => new Date(0).toISOString() };
  const app = () => {
    const adapter = createDurableConversationAdapter({ incarnation: "compact", manifest: [binding], runtime });
    return new AgentRuntimeFacade({ pool: new Map(), durableSessions: new Map([[binding.chatJid, adapter.sessionPosition(binding.chatJid, "main", "original-session")]]),
      getOrCreateRuntime: unused, modelRegistry: { getAll: () => f.models.getModels() } as any, modelRuntime: {} as any,
      authPath: "unused", clearAttachments() {}, refreshRuntime: unused });
  };
  const command = { type: "compact" as const, raw: "/compact" };
  try {
    runtime = await HostConversationRuntime.open(config, context);
    expect((await app().applyControlCommand(binding.chatJid, command)).message).toBe("Nothing to compact.");
    expect(f.host.modelCalls).toBe(0);
    stale = true;
    expect(() => runtime.compactSession(binding)).toThrow(); stale = false;
    root.exec("BEGIN");
    await expect(runtime.compactSession(binding)).rejects.toThrow("Root connection transaction active");
    root.exec("ROLLBACK");
    // A failed guard transaction seals the public storage; reopen before continuing.
    await runtime.close(); runtime = await HostConversationRuntime.open(config, context);
    root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('pending',NULL)").run();
    root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='pending'").run();
    root.query("INSERT INTO service_effect_s01_sources VALUES ('pending',1,'source',?,'message','disposed','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
    beforeGuard = () => root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    await expect(runtime.compactSession(binding)).rejects.toThrow("not idle"); beforeGuard = undefined;
    expect(f.host.modelCalls).toBe(0);
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    await runtime.close();
    let harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    let conversation = (await harness.conversation(id, context))!;
    for (let i = 0; i < 3; i++) {
      const submission = await conversation.submit({ type: "input", content: `history-${i} ` + "detail ".repeat(100), requestId: `history-${i}` }, context);
      expect((await submission.wait(context)).status).toBe("done");
    }
    const before = await conversation.context(context);
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    const entered = barrier(); f.host.modelHold = barrier(); f.host.onModelEnter = () => entered.release();
    f.host.finalContent = [{ type: "text", text: "REAL MODEL CHECKPOINT: retain history and continue" }];
    const abort = new AbortController();
    const observer = runtime.compactSession(binding, "retain decisions", abort.signal);
    await entered.promise;
    abort.abort(); await expect(observer).rejects.toThrow();
    expect(() => runtime.compactSession(binding)).toThrow("not idle");
    await expect(runtime.setSessionModel(binding, { provider: "qualification", modelId: "synthetic" })).rejects.toThrow("not idle");
    // Host acceptance remains writable after task admission. It must not poison SDK summary writes.
    root.query("UPDATE service_effect_s01_sources SET state='pending'").run();
    const accepted = { incarnation: "compact", conversationId: id, chatJid: binding.chatJid, branchId: "main",
      operationId: "accepted-during-compact", sourceSeq: 1, sourceId: "same-source", payloadRef: "same-payload",
      requestId: "same-request", requestHash: "a".repeat(64) };
    // Neither entry may escape when only the compact observer was cancelled.
    let admissionsFinished = 0;
    const waiting = [runtime.submit(accepted), runtime.submitIntent(accepted)].map(p => p.then(
      () => { admissionsFinished++; return "submitted"; }, error => { admissionsFinished++; return error.message; }));
    await Bun.sleep(10);
    expect(admissionsFinished).toBe(0);
    const closing = runtime.close(); // Seals waiting admissions before joining compaction.
    f.host.modelHold.release();
    await closing; // Joins actual maintenance, not the cancelled observer.
    expect(await Promise.all(waiting)).toEqual(["Runtime closed", "Runtime closed"]);
    expect(root.query("SELECT state FROM service_effect_s01_sources").get()).toEqual({ state: "pending" });
    root.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
    f.host.modelHold = undefined; f.host.onModelEnter = undefined;
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    conversation = (await harness.conversation(id, context))!;
    const after = await conversation.context(context);
    expect(after.head?.kind).toBe("pi.compaction");
    expect(JSON.stringify(after.messages)).toContain("REAL MODEL CHECKPOINT");
    expect(after.entries.length).toBeLessThan(before.entries.length);
    const rows = await conversation.entries({ order: "ascending" }, 100, undefined, context);
    expect(rows.items.filter(e => e.kind === "pi.compaction")).toHaveLength(1);
    const follow = await conversation.submit({ type: "input", content: "continue", requestId: "follow" }, context);
    await follow.wait(context);
    expect(JSON.stringify(f.host.admissions.at(-1))).toContain("requestHash");
    await harness.close(context);
    runtime = await HostConversationRuntime.open(config, context);
    expect(await runtime.readSessionModel(binding)).toBe("qualification/synthetic");
    // Provider failure is terminal failure, never a false success.
    f.host.modelAllowed = false;
    await expect(runtime.compactSession(binding)).rejects.toThrow("did not complete");
    f.host.modelAllowed = true;
    const result = await app().applyControlCommand(binding.chatJid, command);
    expect(result.status).toBe("success"); expect(result.sessionGeneration).toBe("original-session");
    expect(result.contextUsage?.tokens).toBeNull();
    expect(f.host.credentialLookups).toBe(0); expect(approvals).toBeGreaterThan(0);
    await runtime.close();
    harness = await Harness.open(await openStorage(), config.harnessOptions, context);
    conversation = (await harness.conversation(id, context))!;
    await conversation.commit(async tx => { (await tx.doc(InboxDoc, id)).items.push({ id: 999 as any, mode: "write", entry: { kind: "qualification.pending" } }); }, context);
    await harness.close(context); runtime = await HostConversationRuntime.open(config, context);
    await expect(runtime.compactSession(binding)).rejects.toThrow("not idle");
  } finally { if (root.inTransaction) root.exec("ROLLBACK"); if (runtime) await runtime.close(); root.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true }); }
}, 20000);

for (const failure of ["wait", "summary", "close", "close-reconcile"] as const) test(`maintenance ${failure} observation failure retains command protection until verified settlement`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "compact-observation-"));
  const path = join(dir, "shared.db"), owner = TestOwner.acquire(path), root = new Database(path);
  installServiceWorkSchema(root);
  let sql!: BunSqliteDatabase;
  const openStorage = () => {
    sql = new BunSqliteDatabase(path, { root, assertOwner: () => owner.assert() });
    return SqliteStorage.open(sql);
  };
  const f = await openFixture(owner, () => {}, openStorage), id = f.root.id;
  for (let n = 0; n < 3; n++) await (await f.submit(`history-${n}`, "detail ".repeat(100))).wait(context);
  await f.close();
  const unused = async () => { throw Error("legacy/effect forbidden"); };
  const binding = { incarnation: "observations", chatJid: "web:observations", branchId: "main", conversationId: id };
  let releases = 0, protections = 0, completed = false;
  let ownedHarness!: Harness;
  const originalOpen = Harness.open;
  const openSpy = spyOn(Harness, "open").mockImplementation(async (...args) => {
    ownedHarness = await originalOpen(...args); return ownedHarness;
  });
  let runtime!: HostConversationRuntime;
  try {
    runtime = await HostConversationRuntime.open({ incarnation: binding.incarnation,
      owner: { assert: () => owner.assert(), release() { releases++; } }, openStorage,
      withIdleModelGuard: body => sql.withIdleModelGuard(body),
      harnessOptions: { models: f.models, registry: f.registry,
        settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } },
      work: { getOperation: unused, acceptCancellation: unused, bindHarness: unused } as any,
      terminal: { getTerminal: unused, commitTerminal: unused } as any,
      bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
      conversationFor: () => id, existingConversationIds: [id], authorizeScheduling() {},
      putAnswer: unused, sessionId: "original", lane: "observations", generation: 1, now: () => new Date(0).toISOString(),
    }, context);
  } finally { openSpy.mockRestore(); }
  const closeSpy = spyOn(ownedHarness, "close");
  const adapter = createDurableConversationAdapter({ incarnation: binding.incarnation, manifest: [binding], runtime });
  const position = adapter.sessionPosition(binding.chatJid, binding.branchId, "original");
  const facade = new AgentRuntimeFacade({ pool: new Map(), durableSessions: new Map([[binding.chatJid, position]]),
    getOrCreateRuntime: unused, modelRegistry: { getAll: () => f.models.getModels() } as any, modelRuntime: {} as any,
    authPath: "unused", clearAttachments() {}, refreshRuntime: unused,
    acquireCommandProtection() { protections++; return () => { protections--; }; } });
  const hold = barrier(), entered = barrier(), readFailed = barrier();
  f.host.modelHold = hold; f.host.onModelEnter = () => entered.release();
  f.host.finalContent = [{ type: "text", text: "one verified checkpoint" }];
  const originalWait = ownedHarness.waitForTask.bind(ownedHarness);
  let underlying!: Promise<unknown>;
  const waitSpy = spyOn(ownedHarness, "waitForTask").mockImplementationOnce((...args) => {
    const observation = originalWait(...args);
    underlying = observation;
    if (failure === "summary") return observation;
    void observation.catch(() => {});
    readFailed.release();
    return Promise.reject(Error("wait infrastructure failed"));
  });
  const conversation = (await ownedHarness.conversation(id, context))!;
  const conversationSpy = spyOn(ownedHarness, "conversation").mockResolvedValue(conversation);
  const contextSpy = failure === "summary" ? spyOn(conversation, "context").mockImplementationOnce(() => {
    readFailed.release(); return Promise.reject(Error("context read failed"));
  }) : undefined;
  try {
    const result = facade.applyControlCommand(binding.chatJid, { type: "compact", raw: "/compact" }).then(value => { completed = true; return value; });
    await entered.promise; await Bun.sleep(10);
    expect(protections).toBe(1); expect(completed).toBe(false);
    expect(() => runtime.compactSession(binding)).toThrow("not idle");
    await expect(runtime.setSessionModel(binding, { provider: "qualification", modelId: "synthetic" })).rejects.toThrow("not idle");
    if (failure === "close" || failure === "close-reconcile") {
      await readFailed.promise;
      let repair: Promise<void> | undefined;
      if (failure === "close-reconcile") {
        const repairing = barrier();
        waitSpy.mockImplementationOnce((...args) => {
          const observation = originalWait(...args);
          repairing.release();
          return observation;
        });
        repair = position.reconcileMaintenance!();
        await repairing.promise; // Repair is inside the real public wait, provider held.
      }
      const closing = runtime.close();
      expect(runtime.close()).toBe(closing);
      const closed = closing.then(() => "resolved", error => error.message);
      // A deterministic microtask barrier, not a wall-clock shutdown deadline.
      const barrierReached = (async () => {
        for (let n = 0; n < 32; n++) await Promise.resolve();
        return "still waiting for held provider";
      })();
      expect(await Promise.race([closed, barrierReached])).toContain("settlement uncertain");
      await expect(closing).rejects.toThrow("settlement uncertain");
      expect(releases).toBe(0); owner.assert();
      expect(protections).toBe(1); expect(completed).toBe(false);
      expect(() => runtime.reconcileMaintenance(binding)).toThrow("Runtime closed");
      hold.release(); await underlying;
      if (repair) {
        await repair;
        expect(await result).toMatchObject({ status: "success", message: "Context compacted." });
        expect(protections).toBe(0); expect(completed).toBe(true);
        expect(waitSpy.mock.calls).toHaveLength(2);
        expect(waitSpy.mock.calls[0][0]).toBe(waitSpy.mock.calls[1][0]);
      }
      // Even a completed in-flight repair cannot reopen this sealed runtime or
      // turn the memoized close rejection into permission for resource cleanup.
      expect(runtime.close()).toBe(closing);
      await expect(runtime.close()).rejects.toThrow("settlement uncertain");
      expect(() => runtime.reconcileMaintenance(binding)).toThrow("Runtime closed");
      expect(releases).toBe(0); owner.assert();
      expect(closeSpy).not.toHaveBeenCalled();
      expect(() => TestOwner.acquire(path)).toThrow("owner busy");
      return;
    }
    hold.release(); await underlying; await readFailed.promise; await Bun.sleep(10);
    expect(protections).toBe(1); expect(completed).toBe(false);
    for (const wrong of [{ incarnation: "other-domain" }, { chatJid: "web:other" },
      { branchId: "wrong" }, { conversationId: id + 1 }]) {
      expect(() => runtime.reconcileMaintenance({ ...binding, ...wrong })).toThrow("binding conflict");
    }
    // The data-only position captured its method/receiver before caller mutation.
    const redirected = spyOn(runtime, "reconcileMaintenance").mockImplementation(() => {
      throw Error("Replaced reconciliation must not run");
    });
    try {
      // Concurrent repairs share the same public wait and settle the original command once.
      const first = position.reconcileMaintenance!(), second = position.reconcileMaintenance!();
      expect(first).toBe(second);
      await first;
      expect(redirected).not.toHaveBeenCalled();
    } finally { redirected.mockRestore(); }
    expect(await result).toMatchObject({ status: "success", message: "Context compacted." });
    expect(protections).toBe(0);
    const calls = waitSpy.mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0][0]).toBe(calls[1][0]);
    await position.reconcileMaintenance!(); expect(waitSpy.mock.calls).toHaveLength(2);
    const rows = await conversation.entries({ order: "ascending" }, 100, undefined, context);
    expect(rows.items.filter(entry => entry.kind === "pi.compaction")).toHaveLength(1);
    expect(f.host.modelCalls).toBe(4); // Three history turns and exactly one summary.
    await runtime.close(); expect(releases).toBe(1);
  } finally {
    hold.release(); waitSpy.mockRestore(); contextSpy?.mockRestore(); conversationSpy.mockRestore(); closeSpy.mockRestore();
    // Test-only teardown of the deliberately sealed/uncertain runtime; production
    // close must NOT use this bypass or release its owner on unverified settlement.
    if (failure === "close" || failure === "close-reconcile") await ownedHarness.close(context); else await runtime.close();
    root.close(); owner.releaseAfterClose(); owner.closeConnection(); await rm(dir, { recursive: true, force: true });
  }
}, 20000);
