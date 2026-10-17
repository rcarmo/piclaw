import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { prepareCopiedApplicationUpgrade } from "../../runtime/durable-engine/src/copied-upgrade.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { __setRuntimeModelExecutorForTests } from "../../runtime/src/extensions/model-execution-runtime.js";
import { resetAddonRuntimeContributionsForTests } from "../../runtime/src/addons/runtime-contributions.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { bootstrapRuntime, createDefaultRuntimeBootstrapDeps } from "../../runtime/src/runtime/bootstrap.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { Harness } from "../../runtime/durable-engine/qualification/durable.ts";
import { openFixture, context, barrier } from "./src/fixture.js";
import { resetRateLimiterStateForTests } from "../../runtime/src/channels/web/http/rate-limit.js";
import { upgradeApplication } from "../../runtime/durable-engine/src/application-upgrade.js";
import { HostCutoverController, initializeCutoverManifest } from "../../runtime/durable-engine/src/host-cutover.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";

// The runtime acquires the actual strict lock BEFORE root/SDK initialization. No TestOwner.
for (const [failWait, forks, deferred] of [[false, false, undefined], [false, true, undefined],
  [false, false, "success"], [false, false, "failure"],
  [false, false, "uncertain-success"], [false, false, "uncertain-failure"], [true, false, undefined]] as const) {
  const scenario = `${failWait}:${forks}:${deferred}`;
  if (process.env.PICLAW_APPLICATION_CASE && process.env.PICLAW_APPLICATION_CASE !== scenario) continue;
  test(`application bundle binds real pool/channel; lost wait ACK=${failWait}; preserved forks=${forks}; deferred=${deferred}`, async () => {
  if (!process.env.PICLAW_APPLICATION_CASE) {
    // A cold application start owns process-global runtime registries and its whole
    // database. Never delete messages alone: reused rowids collide with retained
    // durable operation IDs (message:<rowid>:<sourceSeq>) from the previous case.
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE; delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolation = ensureTestFilesystemIsolation(env);
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        cwd: import.meta.dir, env: { ...env, PICLAW_APPLICATION_CASE: scenario }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code !== 0) throw Error(`Isolated application ${scenario}:\n${out}\n${err}`);
      expect(code).toBe(0);
    } finally { isolation.cleanup(); }
    return;
  }
  const compactSucceeds = deferred === "success" || deferred === "uncertain-success";
  const uncertain = deferred?.startsWith("uncertain-");
  const compactHold = barrier(), compactEntered = barrier(), waitLost = barrier();
  let taskObservation: Promise<unknown> | undefined;
  let compactHarness: Harness | undefined;
  let compactWaitSpy: ReturnType<typeof spyOn<Harness, "waitForTask">> | undefined;
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "application-bundle-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "runtime.lock"), strictOwnership: true, disabled: false });
  const ownership = applicationOwnership(lock);
  const borrowed = ownership.borrow(); borrowed.release();
  expect(() => borrowed.assertCurrentOwner()).toThrow("sealed"); lock.assertCurrentOwner();
  process.env.PICLAW_DB_IN_MEMORY = "0";
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  lock.assertCurrentOwner(); initDatabase();
  const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
  const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
  const storage = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(storage));
  const chat = `web:bundle:${crypto.randomUUID()}`;
  const incarnation = `application-${crypto.randomUUID()}`;
  const manager = SessionManager.inMemory(dir, { id: "preserved-session" });
  manager.appendMessage({ role: "system", content: "original baseline", timestamp: 1 });
  const shared = manager.getLeafId()!;
  const leaf = manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never",
    content: [{ type: "text", text: "original answer" }], stopReason: "stop", timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const sibling = `${chat}:sibling`;
  if (forks) {
    storeChatMetadata(chat, new Date().toISOString());
    storeChatMetadata(sibling, new Date().toISOString());
  }
  const originalBranch = (jid: string) => (db.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(jid) as { branch_id: string }).branch_id;
  const branchId = forks ? originalBranch(chat) : "main";
  const siblingBranchId = forks ? originalBranch(sibling) : "unused";
  let siblingLeaf: string | undefined;
  if (forks) {
    manager.branch(shared);
    siblingLeaf = manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "never", model: "never",
      content: [{ type: "text", text: "sibling original answer" }], stopReason: "stop", timestamp: 3,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  }
  const source = Buffer.from([manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join("\n") + "\n");
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const manifest = Buffer.from(JSON.stringify({ version: 1, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
    hostBranchBindings: { [leaf]: { chatJid: chat, chatIncarnation: incarnation, branchId, hostBaseline: "original baseline" },
      ...(siblingLeaf ? { [siblingLeaf]: { chatJid: sibling, chatIncarnation: incarnation, branchId: siblingBranchId, hostBaseline: "original baseline" } } : {}) } }));
  const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const upgrade = prepareCopiedApplicationUpgrade(source, manifest, { sourceSHA256: sha(source), manifestSHA256: sha(manifest) }, (entries, leaf) => ({
    messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
    projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })),
  }));
  const importedRoot = await base.harness.createConversation({ ownership: { kind: "ownerless" },
    agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  await upgrade.importCopied(importedRoot, () => lock.assertCurrentOwner(), context);
  const importedBindings = await upgrade.verifyBindings(base.harness, importedRoot.id, context);
  if (!forks) expect(importedBindings.manifest[0]).toEqual({ chatJid: chat, branchId, conversationId: importedRoot.id });
  expect(importedBindings.manifest).toHaveLength(forks ? 2 : 1);
  if (forks) expect(importedBindings.manifest.map(b => b.branchId).sort()).toEqual([branchId, siblingBranchId].sort());
  await base.close(); installTerminalSettlementCompositionSchema(db);
  const unbound = `${chat}:unbound`;
  storeChatMetadata(chat, new Date().toISOString());
  storeChatMetadata(unbound, new Date().toISOString());
  // Disposable durable application payload port: real bytes on disk, not InMemory fixture.
  const payloadPath = (ref: string) => join(dir, createHash("sha256").update(ref).digest("hex"));
  const answers = { put(ref: string, text: string) { lock.assertCurrentOwner(); writeFileSync(payloadPath(ref), text); },
    resolver: { async resolve(ref: string) {
      lock.assertCurrentOwner(); const bytes = new Uint8Array(readFileSync(payloadPath(ref)));
      return { ref, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
    } } };
  const failed = barrier();
  const options = { root: db, path, ownership,
    wrapWait: failWait ? wait => async (...args) => { await wait(...args); failed.release(); throw Error("lost wait ACK"); } : undefined,
    ...importedBindings, sessions: new Map(importedBindings.sessions),
    offlineInitialize: true, answers,
    runtime: { incarnation, sessionId: "preserved-session", lane: "main", generation: 1, now: () => new Date().toISOString(),
      harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } } },
  } satisfies Parameters<typeof createApplicationBootstrapBundle>[0];
  if (!failWait && !forks) {
    let published = 0;
    const invalidScopes = [
      { sessions: new Map([[chat, "preserved-session"], [unbound, "extra-session"]]) },
      { sessions: new Map<string, string>() },
      { sessions: new Map([[unbound, "wrong-key"]]) },
      { sessions: new Map([[chat, " "]]) },
      { sessions: new Map([[chat, 123 as unknown as string]]) },
      { manifest: [{ ...options.manifest[0], chatJid: 123 as unknown as string }], sessions: new Map([[123 as unknown as string, "session"]]) },
      { manifest: [{ ...options.manifest[0], chatJid: ` ${chat}` }], sessions: new Map([[` ${chat}`, "session"]]) },
      { manifest: [options.manifest[0], options.manifest[0]] },
      { manifest: [{ ...options.manifest[0], branchId: "other" }] },
    ];
    for (const invalid of invalidScopes) {
      await expect(createApplicationBootstrapBundle({ ...options, ...invalid }, context).then(bundle => {
        published++; return bundle.close();
      })).rejects.toThrow("Exact application branch manifest required");
      expect(published).toBe(0);
      expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid IN (?,?)").get(chat, unbound)).toEqual({ n: 0 });
      expect(db.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid IN (?,?)").get(chat, unbound)).toEqual({ n: 0 });
      lock.assertCurrentOwner();
      expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    }
    const wrongPath = join(dir, "wrong.db");
    const wrong = new Database(wrongPath); wrong.close();
    await expect(createApplicationBootstrapBundle({ ...options, path: wrongPath }, context)).rejects.toThrow("Shared database identity required");
    const disabled = acquireRuntimeLock({ lockPath: join(dir, "disabled.lock"), disabled: true });
    expect(() => applicationOwnership(disabled)).toThrow("Strict application ownership required");
    const stale = acquireRuntimeLock({ lockPath: join(dir, "stale.lock"), strictOwnership: true, disabled: false });
    const staleOwnership = applicationOwnership(stale); stale.release();
    await expect(createApplicationBootstrapBundle({ ...options, ownership: staleOwnership }, context)).rejects.toThrow("ownership lost");
    await expect(createApplicationBootstrapBundle({ ...options,
      manifest: [{ chatJid: chat, branchId: "main", conversationId: 999999 as typeof base.root.id }] }, context)).rejects.toThrow();
    expect(base.host.modelCalls).toBe(0);
    expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(chat)).toEqual({ n: 0 });
    lock.assertCurrentOwner();
    expect(db.inTransaction).toBe(false);
    await rm(wrongPath);
  }
  initializeCutoverManifest(db, () => lock.assertCurrentOwner());
  const identity = { domain: incarnation, incarnation, ownerGeneration: 7,
    sourceEngineId: "legacy", candidateStoreRef: "candidate" };
  const cutover = new HostCutoverController(db, identity, {
    assertOwner(actual) { lock.assertCurrentOwner(); expect(actual).toEqual(identity); },
    assertCurrentWriter(writer) {
      const row = db.query("SELECT manifest FROM qualification_cutover_v1 WHERE domain=?").get(identity.domain) as { manifest: string } | null;
      expect(writer).toBe(row ? JSON.parse(row.manifest).writer : "legacy");
    },
    checkDrained() { return { sourceDigest: sha(source), pending: 0, inflight: 0 }; },
  });
  const { manifest: _manifest, sessions: _sessions, ...application } = options;
  async function importer() {
    lock.assertCurrentOwner();
    const database = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
    const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(database));
    const conversation = (await fixture.harness.conversation(importedRoot.id, context))!;
    return { database, harness: fixture.harness, conversation, close: fixture.close };
  }
  if (!failWait && !forks) {
    for (const runtime of [{ ...application.runtime, incarnation: "wrong-domain" },
      { ...application.runtime, sessionId: "invented-session" }]) {
      await expect(upgradeApplication({ plan: upgrade, cutover, application: { ...application, runtime },
        importer: await importer() }, context)).rejects.toThrow("Copied application identity conflict");
      expect(cutover.inspect()).toBeNull(); lock.assertCurrentOwner();
    }
    const importerCloseFailure = Error("importer close failed");
    const closingImporter = await importer();
    let importerCloseCalls = 0;
    const realImporterClose = closingImporter.close;
    closingImporter.close = async () => { importerCloseCalls++; await realImporterClose(); throw importerCloseFailure; };
    await expect(upgradeApplication({ plan: upgrade, cutover, application, importer: closingImporter }, context))
      .rejects.toBe(importerCloseFailure);
    expect(importerCloseCalls).toBe(1);
    expect(cutover.inspect()?.phase).toBe("verified");
    const cleanupImporter = await importer();
    let cleanupCloseCalls = 0;
    const realCleanupClose = cleanupImporter.close;
    cleanupImporter.close = async () => { cleanupCloseCalls++; await realCleanupClose(); throw importerCloseFailure; };
    let cleanupError: unknown;
    try {
      await upgradeApplication({ plan: upgrade, cutover,
        application: { ...application, runtime: { ...application.runtime, incarnation: "wrong-domain" } },
        importer: cleanupImporter }, context);
    } catch (error) { cleanupError = error; }
    expect(cleanupError).toBeInstanceOf(AggregateError);
    const cleanupErrors = (cleanupError as AggregateError).errors;
    expect(cleanupErrors).toHaveLength(2);
    expect(cleanupErrors[0].message).toBe("Copied application identity conflict");
    expect(cleanupErrors[1]).toBe(importerCloseFailure);
    expect(cleanupCloseCalls).toBe(1);
    const wrongPath = join(dir, "bootstrap-failure.db");
    new Database(wrongPath).close();
    let escaped = 0;
    await expect(upgradeApplication({ plan: upgrade, cutover, application: { ...application, path: wrongPath },
      importer: await importer() }, context).then(async result => { escaped++; await result.close(); })).rejects.toThrow("Shared database identity required");
    expect(escaped).toBe(0);
    expect(cutover.inspect()?.phase).toBe("verified");
    expect(cutover.inspect()?.writer).toBe("legacy");
    lock.assertCurrentOwner(); expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    await rm(wrongPath);
    const open = SqliteStorage.open.bind(SqliteStorage);
    const opened: unknown[] = [];
    const openSpy = spyOn(SqliteStorage, "open").mockImplementation(async (...args) => {
      const result = await open(...args); opened.push(result); return result;
    });
    const commit = cutover.commitWriter.bind(cutover);
    const close = BunSqliteDatabase.prototype.close;
    const closed: BunSqliteDatabase[] = [];
    const primaryFailure = Error("lost writer commit ACK");
    const bundleCloseFailure = Error("candidate bundle close failed");
    let committed: ReturnType<typeof cutover.inspect> = null;
    let failedCandidate: BunSqliteDatabase | undefined;
    const closeSpy = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(async function (this: BunSqliteDatabase) {
      if (committed && !failedCandidate) {
        failedCandidate = this;
        // Fail BEFORE the actual close so teardown proves the real resource is released.
        throw bundleCloseFailure;
      }
      await close.call(this); closed.push(this);
    });
    const commitSpy = spyOn(cutover, "commitWriter").mockImplementation(revision => {
      // Two actual SDK opens: importer, then unpublished paused application.
      expect(opened).toHaveLength(2); expect(closed).toHaveLength(1);
      const active = commit(revision); expect(active.writer).toBe("candidate");
      committed = cutover.inspect();
      throw primaryFailure;
    });
    try {
      let failure: unknown;
      try {
        await upgradeApplication({ plan: upgrade, cutover, application, importer: await importer() }, context)
          .then(async result => { escaped++; await result.close(); });
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(2);
      expect((failure as AggregateError).errors[0]).toBe(primaryFailure);
      expect((failure as AggregateError).errors[1]).toBe(bundleCloseFailure);
      expect(escaped).toBe(0); expect(closed).toHaveLength(1);
      expect(failedCandidate).toBeDefined();
      expect(cutover.inspect()).toEqual(committed);
      lock.assertCurrentOwner();
      expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
      expect(cutover.inspect()?.phase).toBe("active");
      expect(cutover.inspect()?.writer).toBe("candidate");
      expect(base.host.modelCalls).toBe(0);
    } finally {
      commitSpy.mockRestore(); openSpy.mockRestore(); closeSpy.mockRestore();
      if (failedCandidate) await close.call(failedCandidate);
    }
  }
  if (forks) {
    const captured = db.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(chat);
    db.query("UPDATE chat_branches SET branch_id=? WHERE chat_jid=?").run("wrong-original-branch", chat);
    await expect(upgradeApplication({ plan: upgrade, cutover, application, importer: await importer() }, context))
      .rejects.toThrow("Exact application branch manifest required");
    expect(cutover.inspect()).toBeNull();
    db.query("UPDATE chat_branches SET branch_id=? WHERE chat_jid=?").run((captured as { branch_id: string }).branch_id, chat);
  }
  const beforeRetry = cutover.inspect();
  if (!failWait && !forks) {
    const alteredManifest = Buffer.from(manifest.toString() + "\n");
    const other = prepareCopiedApplicationUpgrade(source, alteredManifest,
      { sourceSHA256: sha(source), manifestSHA256: sha(alteredManifest) }, (entries, leaf) => ({
        messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
        projected: entries.map(entry => ({ sourceEntryId: entry.id, messages: json(convertToLlm(sessionEntryToContextMessages(entry))) })),
      }));
    await expect(upgradeApplication({ plan: other, cutover, application, importer: await importer() }, context)).rejects.toThrow("Cutover rejected");
    expect(cutover.inspect()).toEqual(beforeRetry);
  }
  const originalOpen = Harness.open;
  const openSpy = spyOn(Harness, "open").mockImplementation(async (...args) => {
    compactHarness = await originalOpen(...args);
    return compactHarness;
  });
  const spies = (["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL forbidden"); }));
  let bundle!: Awaited<ReturnType<typeof createApplicationBootstrapBundle>>;
  let pool!: AgentPool, channel!: WebChannel;
  const runtimeBase = createRuntimeBaseServices({ dataDir: dir });
  const ready = barrier();
  let shutdown!: (signal: string) => Promise<void>;
  const startSpy = spyOn(WebChannel.prototype, "start").mockImplementation(async function(this: WebChannel) {
    channel = this; // No listener: exercise ordinary HTTP handler in-process.
  });
  const runtimeDeps = createDefaultRuntimeBootstrapDeps(runtimeBase, async owner => {
    expect(owner).toBe(lock); owner.assertCurrentOwner();
    return bundle = await createApplicationBootstrapBundle(options, context);
  });
  __setRuntimeModelExecutorForTests(null);
  resetAddonRuntimeContributionsForTests();
  const running = bootstrapRuntime({ ...runtimeDeps,
    initializeRuntimeEnvironment: () => {}, hydrateMcpCredentials: async () => [], clearMcpCredentials: () => {},
    startBackgroundModelRefresh: () => {}, startOptionalPushoverChannel: async () => null,
    registerRuntimeShutdownSignals: (_registrar, handler) => { shutdown = handler; }, startRuntimeWorkers: () => {},
    stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
    startRuntimeLoop: async ({ agentPool, signal }) => {
      pool = agentPool as AgentPool; ready.release();
      await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
    },
  }, lock);
  try { await Promise.race([ready.promise, running.then(() => { throw Error("Bootstrap ended before ready"); })]); }
  finally { openSpy.mockRestore(); startSpy.mockRestore(); }
  // Let the existing deferred startup recovery scan finish before new input.
  await Bun.sleep(10);
  lock.assertCurrentOwner();
  expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(chat)).toEqual({ n: 0 });
  const queue = runtimeBase.queue;
  try {
    const readSummary = async () => {
      channel.setContextUsage(chat, { tokens: 999, contextWindow: 10000, percent: 9.99, sessionGeneration: "preserved-session" });
      const response = await channel.handleRequest(new Request(`http://fixture/agent/context?chat_jid=${encodeURIComponent(chat)}`));
      expect(response.status).toBe(200);
      const payload = await response.json() as { sessionTree: { leafId: string | null; total: number }; sessionGeneration: string };
      const tree = await pool.getSessionTreeForChat(chat);
      expect(payload.sessionTree).toEqual({ leafId: tree.leafId, total: tree.total });
      expect(payload.sessionTree.total).toBeGreaterThan(0);
      expect(payload.sessionGeneration).toBe("preserved-session");
      expect(payload).toMatchObject({ tokens: null, percent: null });
      return payload.sessionTree;
    };
    const initialSummary = await readSummary();
    const events: { type: string; data: any }[] = [];
    channel.broadcastEvent = (type, data) => { events.push({ type, data }); };
    // The selected backend rejects chats outside its exact manifest before admission.
    expect(() => channel.getInputSourceAdmission?.(unbound)).toThrow("Unbound application conversation");
    await expect(pool.getSessionForIntrospection(unbound)).rejects.toThrow("Durable application does not construct legacy sessions");
    const unboundResponse = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(unbound)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "must not fall back" }),
    }));
    expect(unboundResponse.status).toBeGreaterThanOrEqual(400);
    expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(unbound)).toEqual({ n: 0 });
    expect(!!bundle.sessionOptions.getDurableSession(unbound)).toBe(false);
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(unbound)).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid=?").get(unbound)).toEqual({ n: 0 });
    expect(() => bundle.bind({ queue, agentPool: pool })).toThrow("already bound");
    const hold = barrier(); base.host.modelHold = hold;
    const entered = barrier(); base.host.onModelEnter = () => entered.release();
    const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "normal application input" }),
    }));
    expect(response.status).toBe(201);
    await entered.promise;
    const row = db.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? AND is_bot_message=0").get(chat) as { rowid: number; id: string; content: string };
    expect(row.content).toBe("normal application input");
    expect(db.query("SELECT payload_ref FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get(chat, row.id)).toEqual({ payload_ref: `message-row:${row.rowid}` });
    expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
    if (deferred) {
      const queued = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "/compact" }),
      }));
      expect(queued.status).toBe(201);
      expect(await queued.json()).toMatchObject({ queued: "followup" });
      expect(db.query("SELECT * FROM service_effect_s01_sources WHERE chat_jid=?").all(chat)).toHaveLength(1);
      if (uncertain) {
        const originalWait = compactHarness!.waitForTask.bind(compactHarness!);
        let failures = 2;
        compactWaitSpy = spyOn(compactHarness!, "waitForTask").mockImplementation((...args) => {
          if (failures-- > 0) {
            const observation = originalWait(...args);
            taskObservation = observation;
            void observation.catch(() => {});
            waitLost.release();
            return Promise.reject(Error("task observation unavailable"));
          }
          return originalWait(...args);
        });
      }
      base.host.onModelEnter = () => {
        if (uncertain) { base.host.modelHold = compactHold; compactEntered.release(); }
        expect(db.query("SELECT phase FROM service_effect_s01_operations WHERE chat_jid=?").all(chat)).toEqual([{ phase: "terminal" }]);
        expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([{ content: "synthetic answer" }]);
        base.host.finalContent = [{ type: "text", text: "deferred application summary" }];
        base.host.modelAllowed = compactSucceeds;
      };
    }
    hold.release();
    if (uncertain) {
      await waitLost.promise; await compactEntered.promise; await Bun.sleep(10);
      const cursor = db.query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat);
      const assertPending = () => {
        expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
        expect(channel.getAgentStatus(chat)?.type).toBe("intent");
        expect(events.filter(e => e.type === "agent_status" && ["done", "error"].includes(e.data.type))).toHaveLength(0);
        expect(db.query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual(cursor);
        expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([{ content: "synthetic answer" }]);
        expect(base.host.modelCalls).toBe(1);
      };
      assertPending();
      await expect(bundle.reconcileMaintenance(chat)).rejects.toThrow("task observation unavailable");
      assertPending(); // Another read failure is still not a command failure.
      compactHold.release();
      await taskObservation;
      await Bun.sleep(10);
      // Even terminal task state is not a receipt until public summary reconciliation.
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
      expect(channel.getAgentStatus(chat)?.type).toBe("intent");
      expect(db.query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual(cursor);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toHaveLength(1);
      await bundle.reconcileMaintenance(chat);
      expect(compactWaitSpy!.mock.calls).toHaveLength(3);
      expect(new Set(compactWaitSpy!.mock.calls.map(args => args[0])).size).toBe(1);
      compactWaitSpy!.mockRestore(); compactWaitSpy = undefined;
    }
    if (failWait) {
      await failed.promise; await Bun.sleep(20);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
      expect(db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual({ inflight_message_id: row.id });
      expect(db.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toHaveLength(0);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat)).toEqual([]);
    } else {
      for (let n = 0; n < 500 && queue.isLaneBusy(`chat:${chat}`); n++) await Bun.sleep(5);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(false);
      const answers = db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1 ORDER BY rowid").all(chat) as { content: string }[];
      expect(answers[0]).toEqual({ content: "synthetic answer" });
      expect(answers).toHaveLength(deferred ? 2 : 1);
      if (deferred) expect(answers[1].content).toContain(compactSucceeds ? "Context compacted" : "did not complete");
      expect(db.query("SELECT operation_id FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toEqual([{ operation_id: `message:${row.rowid}:1` }]);
    }
    expect(await pool.getCurrentModelLabel(chat)).toBe("qualification/synthetic");
    expect(pool.getSessionGenerationForChat(chat)).toBe("preserved-session");
    expect(await pool.saveSessionPosition(chat)).not.toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(base.host.modelCalls).toBe(compactSucceeds ? 2 : 1); expect(base.host.credentialLookups).toBe(0);
    if (deferred) {
      base.host.modelAllowed = true; base.host.onModelEnter = undefined; base.host.modelHold = undefined;
      base.host.finalContent = [{ type: "text", text: "followup answer" }];
      const follow = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "continue after deferred compact" }),
      }));
      expect(follow.status).toBe(201);
      for (let n = 0; n < 500 && queue.isLaneBusy(`chat:${chat}`); n++) await Bun.sleep(5);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(false);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1 ORDER BY rowid DESC LIMIT 1").get(chat)).toEqual({ content: "followup answer" });
      // Prove the NEXT provider actually receives the checkpoint, not a UI tree projection.
      expect(base.host.transcripts.at(-1)?.includes("deferred application summary")).toBe(compactSucceeds);
      expect(base.host.modelCalls).toBe(compactSucceeds ? 3 : 2);
      expect(db.query("SELECT phase FROM service_effect_s01_operations WHERE chat_jid=?").all(chat))
        .toEqual([{ phase: "terminal" }, { phase: "terminal" }]);
      expect(db.query("SELECT operation_id FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toHaveLength(2);
      const compactEvents = events.filter(e => e.type === "agent_status" && e.data.title === "Compacting context");
      expect(compactEvents).toHaveLength(1);
      expect(events.filter(e => e.type === "agent_status" && e.data.turn_id === compactEvents[0].data.turn_id).at(-1)?.data.type)
        .toBe(compactSucceeds ? "done" : "error");
      expect(channel.getQueuedFollowupCount(chat)).toBe(0);

      // A following accepted input already queued behind maintenance must get ONE
      // provider answer and terminal settlement, including after provider failure.
      const holdAgain = barrier(), enteredAgain = barrier();
      base.host.modelHold = holdAgain;
      base.host.onModelEnter = () => enteredAgain.release();
      const post = (content: string) => channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content }),
      }));
      const callsBefore = base.host.modelCalls;
      expect((await post("held primary again")).status).toBe(201);
      await enteredAgain.promise;
      let nextEntry = 0;
      const compactEnteredAgain = barrier(), compactHoldAgain = barrier();
      if (uncertain) {
        const originalWait = compactHarness!.waitForTask.bind(compactHarness!);
        compactWaitSpy = spyOn(compactHarness!, "waitForTask").mockImplementationOnce((...args) => {
          const observation = originalWait(...args);
          taskObservation = observation;
          void observation.catch(() => {});
          return Promise.reject(Error("second task observation unavailable"));
        });
      }
      base.host.onModelEnter = () => {
        nextEntry++;
        if (nextEntry === 1 && uncertain) { base.host.modelHold = compactHoldAgain; compactEnteredAgain.release(); }
        base.host.modelAllowed = nextEntry !== 1 || compactSucceeds;
        base.host.finalContent = [{ type: "text", text: nextEntry === 1 ? "second deferred summary" : "accepted followup answer" }];
      };
      try {
        expect(await (await post("/compact")).json()).toMatchObject({ queued: "followup" });
        expect(await (await post("accepted behind compact")).json()).toMatchObject({ queued: "followup" });
      } finally { holdAgain.release(); }
      if (uncertain) {
        try {
          await compactEnteredAgain.promise; await Bun.sleep(10);
          const cursor = db.query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat);
          expect(channel.getQueuedFollowupCount(chat)).toBe(1);
          expect(channel.getAgentStatus(chat)?.type).toBe("intent");
          expect(queue.isLaneBusy(`chat:${chat}`)).toBe(true);
          expect(nextEntry).toBe(1);
          expect(base.host.modelCalls - callsBefore).toBe(1); // Only the primary, not the held summary/follow-up.
          compactHoldAgain.release();
          await taskObservation; await Bun.sleep(10);
          expect(nextEntry).toBe(1);
          expect(channel.getQueuedFollowupCount(chat)).toBe(1);
          expect(channel.getAgentStatus(chat)?.type).toBe("intent");
          expect(db.query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual(cursor);
          await bundle.reconcileMaintenance(chat);
        } finally { compactHoldAgain.release(); compactWaitSpy!.mockRestore(); compactWaitSpy = undefined; }
      }
      for (let n = 0; n < 500 && queue.isLaneBusy(`chat:${chat}`); n++) await Bun.sleep(5);
      expect(queue.isLaneBusy(`chat:${chat}`)).toBe(false);
      expect(nextEntry).toBe(2); // one compaction attempt, ONE following provider answer
      expect(base.host.modelCalls - callsBefore).toBe(compactSucceeds ? 3 : 2);
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1 ORDER BY rowid").all(chat)).toEqual([
        { content: "synthetic answer" },
        { content: compactSucceeds ? "Context compacted." : "Compaction did not complete" },
        { content: "followup answer" }, { content: "followup answer" },
        { content: compactSucceeds ? "Context compacted." : "Compaction did not complete" },
        { content: "accepted followup answer" },
      ]);
      expect(base.host.transcripts.at(-1)?.includes("second deferred summary")).toBe(compactSucceeds);
      expect(db.query("SELECT phase FROM service_effect_s01_operations WHERE chat_jid=?").all(chat))
        .toEqual(Array.from({ length: 4 }, () => ({ phase: "terminal" })));
      expect(db.query("SELECT operation_id FROM service_effect_s02_commits WHERE chat_jid=?").all(chat)).toHaveLength(4);
      expect(db.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=?").all(chat))
        .toEqual(Array.from({ length: 4 }, () => ({ state: "consumed" })));
      const reader = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() })), options.runtime.harnessOptions, context);
      try {
        const conversation = (await reader.conversation(importedRoot.id, context))!;
        const view = await conversation.context(context);
        // Candidate messages may wrap content in typed blocks; compare text
        // semantics rather than assuming the legacy content:string shape.
        const texts = (value: unknown): string[] => typeof value === "string" ? [value]
          : Array.isArray(value) ? value.flatMap(texts)
          : value && typeof value === "object" ? Object.values(value).flatMap(texts) : [];
        expect(texts(view.messages).join("\n")).toContain("accepted followup answer");
      } finally { await reader.close(context); }
      const allCompactTurns = events.filter(e => e.type === "agent_status" && e.data.title === "Compacting context");
      expect(allCompactTurns).toHaveLength(2);
      for (const intent of allCompactTurns) {
        expect(events.filter(e => e.type === "agent_status" && e.data.turn_id === intent.data.turn_id).map(e => e.data.type))
          .toEqual(["intent", compactSucceeds ? "done" : "error"]);
      }
      expect(channel.getQueuedFollowupCount(chat)).toBe(0);
    }
    if (!failWait && !forks && !deferred) {
      base.host.modelHold = undefined;
      base.host.finalContent = [{ type: "text", text: "application summary checkpoint" }];
      const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "/compact" }),
      }));
      expect(response.status).toBe(201);
      expect(JSON.stringify(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(chat))).toContain("Context compacted");
      expect(base.host.modelCalls).toBe(2);
      expect(pool.getSessionGenerationForChat(chat)).toBe("preserved-session");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    }
    if (forks) {
      // REAL shared-runtime regression: A's HTTP compact holds maintenance while
      // B's normal HTTP input is accepted and claimed by its existing queue worker.
      const compactEntered = barrier(), compactHold = barrier();
      base.host.modelHold = compactHold;
      base.host.onModelEnter = () => compactEntered.release();
      const compactResponse = channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "/compact" }),
      }));
      await compactEntered.promise;
      // Caller-owned maps/options cannot redirect captured routes after publication.
      options.sessions.set(chat, "redirected-session");
      const route = importedBindings.manifest.find(b => b.chatJid === sibling)!;
      const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(sibling)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "sibling input" }),
      }));
      expect(response.status).toBe(201);
      try {
        for (let n = 0; n < 500 && !(db.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=?").get(sibling)); n++) await Bun.sleep(5);
        expect(db.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=?").all(sibling)).toHaveLength(1);
        expect(queue.isLaneBusy(`chat:${sibling}`)).toBe(true);
        expect(db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(sibling)).not.toEqual({ inflight_message_id: null });
        expect(db.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid=?").all(sibling)).toHaveLength(0);
        expect(base.host.modelCalls).toBe(1);
      } finally { compactHold.release(); }
      expect((await compactResponse).status).toBe(201);
      for (let n = 0; n < 500 && queue.isLaneBusy(`chat:${sibling}`); n++) await Bun.sleep(5);
      expect(queue.isLaneBusy(`chat:${sibling}`)).toBe(false);
      expect(pool.getSessionGenerationForChat(sibling)).toBe("preserved-session");
      expect(pool.getSessionGenerationForChat(chat)).toBe("preserved-session");
      expect(db.query("SELECT chat_jid,branch_id,conversation_id FROM piclaw_durable_bindings_v1 WHERE domain=? ORDER BY chat_jid").all(incarnation))
        .toEqual(importedBindings.manifest.map(b => ({ chat_jid: b.chatJid, branch_id: b.branchId, conversation_id: b.conversationId })).sort((a,b) => a.chat_jid.localeCompare(b.chat_jid)));
      expect(route.branchId).not.toBe("main");
      const tree = await pool.getSessionTreeForChat(chat);
      expect(tree.nodes.some(n => n.detail === "original answer")).toBe(true);
      expect(tree.nodes.some(n => n.detail === "sibling original answer")).toBe(true);
      expect((await pool.applyControlCommand(sibling, { type: "tree", raw: "/tree" })).status).toBe("success");
      expect(base.host.modelCalls).toBe(3); // original A, compact A, exactly one B
      expect(db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(sibling)).toEqual([{ content: "synthetic answer" }]);
      expect(db.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid=?").all(sibling)).toHaveLength(1);
      expect(db.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=?").all(sibling)).toEqual([{ state: "consumed" }]);
      expect(db.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?").get(sibling)).toEqual({ inflight_message_id: null });
      expect(db.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE domain=? AND chat_jid=?").all(incarnation, sibling)).toHaveLength(1);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    }
    expect((await readSummary()).total).toBeGreaterThan(initialSummary.total);
    const files = readdirSync(process.env.PICLAW_WORKSPACE!, { recursive: true }).map(String);
    expect(files.filter(p => /\.jsonl$/i.test(p))).toEqual([]);
    expect(files.filter(p => /\.(db|sqlite)$/i.test(p))).toEqual([".piclaw/store/messages.db"]);
  } finally {
    compactWaitSpy?.mockRestore(); compactHold.release();
    const exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
    try { await shutdown("fixture"); await running; }
    finally { exit.mockRestore(); }
    lock.assertCurrentOwner(); // Other application components are still live.
    expect(() => bundle.bind({ queue, agentPool: pool })).toThrow("sealed");
    expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    closeDatabase(); lock.release();
    for (const spy of spies) spy.mockRestore(); resetRateLimiterStateForTests();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
}
