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
import { getNativeCommandCatalogue } from "../../runtime/src/agent-control/native-control-capabilities.js";
import { parseControlCommand } from "../../runtime/src/agent-control/agent-control-parser.js";

// The runtime acquires the actual strict lock BEFORE root/SDK initialization. No TestOwner.
for (const forks of [false, true]) {
  const failWait = false, deferred = undefined;
  test(`application bootstrap preserves exact imported branch bindings; forks=${forks}`, async () => {

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
  const manifest = Buffer.from(JSON.stringify({ version: 2, sourceCopied: true, expectedSourceSHA256: sha(source), pending: 0, inflight: 0,
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
  const terminalEffects: string[] = [];
  let settlementRuntime: import("../../runtime/durable-engine/src/host-runtime.js").HostConversationRuntime | undefined;
  const options = { root: db, path, ownership,
    onRuntime(runtime) { settlementRuntime = runtime; },
    async dispatchHostCommand(chat, text) {
      expect(chat).toBe(importedBindings.manifest[0]!.chatJid);
      expect(text).toBe("/native-probe");
      return { status: "success", message: "Native command without legacy session" };
    },
    async prepareTerminalEffect(input) {
      const receipts = await settlementRuntime!.readSettledUsage(input);
      expect(receipts!.length).toBeGreaterThan(0);
      return (commit, scope) => {
        scope(commit); expect(db.inTransaction).toBe(true);
        expect(commit.operationId).toBe(input.operationId);
        terminalEffects.push(commit.operationId);
        return undefined;
      };
    },
    wrapWait: failWait ? wait => async (...args) => { await wait(...args); failed.release(); throw Error("lost wait ACK"); } : undefined,
    ...importedBindings, sessions: new Map(importedBindings.sessions),
    offlineInitialize: true, answers,
    runtime: { incarnation, sessionId: "preserved-session", now: () => new Date().toISOString(),
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
  const legacyUiBinder = spyOn(AgentPool.prototype, "setSessionBinder").mockImplementation(() => {
    throw Error("Native channel construction must not install a legacy UI session binder");
  });
  const running = bootstrapRuntime({ ...runtimeDeps,
    initializeRuntimeEnvironment: () => {}, hydrateMcpCredentials: async () => [], clearMcpCredentials: () => {},
    startBackgroundModelRefresh: () => {}, startOptionalPushoverChannel: async () => null,
    registerRuntimeShutdownSignals: (_registrar, handler) => { shutdown = handler; }, startRuntimeWorkers: (_queue, activePool) => { pool = activePool as AgentPool; },
    stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
    startRuntimeLoop: async ({ signal }) => {
      ready.release();
      await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
    },
  }, lock);
  try {
    await Promise.race([ready.promise, running.then(() => { throw Error("Bootstrap ended before ready"); })]);
    expect(legacyUiBinder).not.toHaveBeenCalled();
    expect("bindSession" in channel.uiBridge).toBe(false);
  } finally { openSpy.mockRestore(); startSpy.mockRestore(); legacyUiBinder.mockRestore(); }
  // Let the existing deferred startup recovery scan finish before new input.
  await Bun.sleep(10);
  lock.assertCurrentOwner();
  expect(db.query("SELECT count(*) AS n FROM messages WHERE chat_jid=?").get(chat)).toEqual({ n: 0 });
  const queue = runtimeBase.queue;
  try {
    const readSummary = async () => {
      db.query("INSERT INTO router_state(key,value) VALUES('last_agent_timestamp_web',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({contextUsages:{[chat]:{tokens:999,contextWindow:10000,percent:9.99,sessionGeneration:'preserved-session'}}}));
      const treeReader = spyOn(pool, "getSessionTreeSummaryForChat");
      let payload: Record<string, unknown>;
      try {
        const response = await channel.handleRequest(new Request(`http://fixture/agent/context?chat_jid=${encodeURIComponent(chat)}`));
        expect(response.status).toBe(200);
        payload = await response.json() as Record<string, unknown>;
        expect(treeReader).not.toHaveBeenCalled();
        expect(payload).not.toHaveProperty("sessionTree");
      } finally { treeReader.mockRestore(); }
      const usage = await pool.getContextUsageForChat(chat);
      expect(payload).toMatchObject({ tokens: usage!.tokens, contextWindow: usage!.contextWindow, percent: usage!.percent,
        sessionGeneration: "preserved-session", contextUpdate: "replace" });
      expect(payload).not.toHaveProperty("tokensAreAuthoritative");
      const response = await channel.handleRequest(new Request(`http://fixture/agent/context?chat_jid=${encodeURIComponent(chat)}&include_tree=1`));
      const explicit = await response.json() as { sessionTree: { leafId: string | null; total: number } };
      const tree = await pool.getSessionTreeForChat(chat);
      expect(explicit.sessionTree).toEqual({ leafId: tree.leafId, total: tree.total });
      expect(explicit.sessionTree.total).toBeGreaterThan(0);
      return explicit.sessionTree;
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
    if (!failWait && !forks && !deferred) {
      expect(await pool.applySlashCommand(chat, "/native-probe")).toMatchObject({ status: "success", message: "Native command without legacy session" });
      const before = await pool.getSessionTreeForChat(chat);
      const port = bundle.sessionOptions.getDurableSession(chat)!;
      const unavailable = getNativeCommandCatalogue(port).filter(command => command.status === "unavailable");
      expect(unavailable.length).toBeGreaterThan(0);
      for (const definition of unavailable) {
        for (const raw of new Set([definition.name, definition.name.replace(/-/g, "_"), ...(definition.aliases ?? [])])) {
          const command = parseControlCommand(raw);
          expect(command).not.toBeNull();
          const result = await pool.applyControlCommand(chat, command!);
          expect(result.status).toBe("error");
          expect(result.message).toMatch(/unavailable|No legacy session was opened/);
        }
      }
      expect(await pool.getSessionTreeForChat(chat)).toEqual(before);
      for (const table of ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits"])
        expect(db.query(`SELECT count(*) AS n FROM ${table} WHERE chat_jid=?`).get(chat)).toEqual({ n: 0 });
      expect(base.host.modelCalls).toBe(0);
      expect(base.host.credentialLookups).toBe(0);
    }
    expect(base.host.modelCalls).toBe(0);
    expect(await channel.readNativeQueue!(chat)).toEqual([]);
  } catch (error) {
    // Preserve the original assertion if cleanup of a deliberately uncertain
    // operation also times out. These fixtures contain synthetic data only.
    console.error("Application qualification failed before shutdown", error);
    throw error;
  } finally {
    compactHold.release();
    const exit = spyOn(process, "exit").mockImplementation(() => undefined as never);
    const held = barrier(), entered = barrier();
    const control = !failWait && !forks && deferred === undefined ? bundle.sessionOptions.getDurableSession(chat) : undefined;
    const operation = control?.runOwnedControl?.(async () => { entered.release(); await held.promise; return "joined"; });
    try {
      if (control) { expect(operation).toBeDefined(); await entered.promise; }
      let stopped = false;
      const stopping = shutdown("fixture").then(() => { stopped = true; });
      if (control) {
        for (let n = 0; n < 200 && !control.lifetimeSignal?.aborted; n++) await Bun.sleep(5);
        expect(control.lifetimeSignal?.aborted).toBe(true);
        await Bun.sleep(25);
        expect(stopped).toBe(false);
        expect(() => control.assertCurrent?.()).toThrow();
        held.release(); expect(await operation).toBe("joined");
      }
      await stopping; await running;
    } finally { held.release(); await operation; exit.mockRestore(); }
    lock.assertCurrentOwner(); // Other application components are still live.
    expect(() => bundle.bind({ queue, agentPool: pool })).toThrow("sealed");
    expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    await closeDatabase(); lock.release();
    for (const spy of spies) spy.mockRestore(); resetRateLimiterStateForTests();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
}
