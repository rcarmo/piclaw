import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { snapshotLegacyHostFrontier } from "../../runtime/src/agent-pool/legacy-host-frontier.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync, symlinkSync, watch } from "node:fs";
import { join } from "node:path";
import { SessionManager, createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { bootstrapRuntime, type RuntimeBootstrapContext, type RuntimeBootstrapDeps } from "../../runtime/src/runtime/bootstrap.js";
import * as shutdownRegistry from "../../runtime/src/runtime/shutdown-registry.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { AgentQueue } from "../../runtime/src/queue.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { createAgentPoolModelOptions } from "../../runtime/test/model-services-fixture.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { SESSIONS_DIR } from "../../runtime/src/core/config.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { applicationOwnership } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { HostCutoverController, initializeCutoverManifest } from "../../runtime/durable-engine/src/host-cutover.js";
import { copiedInstallationSourceDigest } from "../../runtime/durable-engine/src/copied-installation.js";
import { LegacyTreeImportManifest } from "../../runtime/durable-engine/src/legacy-import.js";
import { upgradeCapturedRuntime } from "../../runtime/durable-engine/src/runtime-upgrade-workflow.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { openFixture, context } from "./src/fixture.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";

const mutations = {
  rowid: "UPDATE messages SET rowid=rowid+100000 WHERE id='frontier-known-message'",
  router: "INSERT OR REPLACE INTO router_state(key,value) VALUES ('frontier-probe','changed')",
  preferences: "INSERT INTO user_preferences(user_id,revision,theme,response_guidance,updated_at) VALUES ('default',1,'dark','changed','now') ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,response_guidance='changed'",
  security: "INSERT INTO web_sessions(token,user_id,created_at,expires_at) VALUES ('frontier-probe','default','now','later')",
  terminal: "INSERT INTO service_effect_s01_chats(chat_jid) VALUES ('frontier-probe')",
};
const scenarios = ["happy", "happy-forks", "happy-multiple", "happy-multiple-retry", "zero", "unselected", "multiple", "released", "changed-after-open", "released-after-open",
  ...Object.keys(mutations).flatMap(name => [`host-${name}-open`, `host-${name}-close`])];
for (const scenario of scenarios.filter(name => !process.env.PICLAW_WORKFLOW_CASE || name === process.env.PICLAW_WORKFLOW_CASE))
  test(`actual runtime capture → owned upgrade: ${scenario}`, async () => {
    if (!process.env.PICLAW_WORKFLOW_CASE) {
      const env = { ...process.env };
      delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE; delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
      const isolation = ensureTestFilesystemIsolation(env);
      try {
        const child = Bun.spawn([process.execPath, "test", import.meta.path], {
          cwd: import.meta.dir, env: { ...env, PICLAW_WORKFLOW_CASE: scenario }, stdout: "pipe", stderr: "pipe",
        });
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (code !== 0) throw Error(`Isolated workflow ${scenario}:\n${out}\n${err}`);
        expect(code).toBe(0);
      } finally { isolation.cleanup(); }
      return;
    }
    process.env.PICLAW_DB_IN_MEMORY = "0";
    const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "workflow-"));
    const lock = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true, disabled: false });
    initDatabase(); const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
    const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
    installTerminalSettlementCompositionSchema(db);
    const policy = await openFixture({ acquired: true }); await policy.close();
    const model = { id: "synthetic", name: "Synthetic", provider: "qualification", api: "openai-completions" as const, baseUrl: "https://invalid.invalid", reasoning: false, input: ["text" as const], contextWindow: 100000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const modelOptions = createAgentPoolModelOptions([model]);
    const queue = new AgentQueue(), pool = new AgentPool({ ...modelOptions, createSession: async (chat, sessionDir) => {
      const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        appendSystemPromptOverride: () => [], agentsFilesOverride: () => ({ agentsFiles: [] }),
        disabledBuiltinExtensions: ["codemode", "tool-search", "mcp"], systemPromptOverride: () => "original baseline" });
      await loader.reload();
      const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
      const manager = SessionManager.open(join(sessionDir, "resident.jsonl"));
      manager.branch(chat.endsWith(":0") ? leaves[0]! : leaves[1] ?? leaves[0]!);
      return createAgentSessionRuntime(async ({ sessionManager }) => ({ ...await createAgentSession({ cwd: dir, agentDir: dir,
        modelRuntime: modelOptions.modelRuntime, model, settingsManager, resourceLoader: loader, sessionManager, tools: [], noTools: "all" }),
        services: { cwd: dir, agentDir: dir, modelRuntime: modelOptions.modelRuntime!, settingsManager, resourceLoader: loader, diagnostics: [] }, diagnostics: [] }),
        { cwd: dir, agentDir: dir, sessionManager: manager });
    } });
    const leaves: string[] = [];
    const web = new WebChannel({ queue, agentPool: pool });
    const ready = Promise.withResolvers<RuntimeBootstrapContext>(); let complete!: () => void;
    const registration = spyOn(shutdownRegistry, "registerShutdownHandler").mockImplementation(() => {});
    const deps: RuntimeBootstrapDeps = {
      base: { queue, state: { lastTimestamp: "", cursors: {} } as any }, assistantName: "Pi", triggerPattern: /@pi/, pollIntervalMs: 1,
      signalRegistrar: { on() {} }, initializeRuntimeEnvironment() {}, hydrateMcpCredentials: async () => [], clearMcpCredentials() {},
      createAgentPool: async () => pool, startWebChannel: async () => web, startBackgroundModelRefresh() {}, startOptionalPushoverChannel: async () => null,
      createShutdownHandler: value => { complete = value.onShutdownComplete!; return async () => {}; }, registerRuntimeShutdownSignals() {},
      createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }), startRuntimeWorkers() {}, queueStartupResumePendingIpc() {},
      startRuntimeLoop: async value => new Promise<void>(resolve => value.signal!.addEventListener("abort", () => resolve(), { once: true })),
      log() {}, stopIpcWatcher: async () => {}, stopSchedulerLoop() {}, stopOptionalProviders() {}, migrationInspection: { onReady: value => ready.resolve(value) },
    };
    const running = bootstrapRuntime(deps, lock);
    let bundle: Awaited<ReturnType<typeof upgradeCapturedRuntime>> | undefined;
    let importer: Awaited<ReturnType<typeof openFixture>> | undefined;
    const files: string[] = [];
    let jsonl: ReturnType<typeof spyOn>[] = [];
    const writes: string[] = [];
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      const runtime = await ready.promise;
      for (let index = 0; index < (scenario === "zero" ? 0 : scenario.includes("multiple") ? 2 : 1); index++) {
        const chat = `web:workflow:${index}`; storeChatMetadata(chat, new Date().toISOString());
        const manager = SessionManager.inMemory(dir, { id: `original-${index}` });
        manager.appendMessage({ role: "system", content: `original baseline\n\n<cwd>\n${dir}\n</cwd>`, timestamp: 1 });
        manager.appendThinkingLevelChange("off");
        const shared = manager.getLeafId()!;
        const answer = () => manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "qualification", model: "synthetic", content: [{ type: "text", text: "original answer" }], stopReason: "stop", timestamp: 2,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
        leaves[0] = answer();
        if (scenario === "happy-forks") { manager.branch(shared); leaves[1] = answer(); }
        const sessionDir = join(SESSIONS_DIR, chat.replace(/[^a-zA-Z0-9._-]/g, "_")); mkdirSync(sessionDir, { recursive: true });
        const file = join(sessionDir, "resident.jsonl"); files.push(file);
        writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(v => JSON.stringify(v)).join("\n") + "\n");
        await pool.getSessionForIntrospection(chat);
        if (scenario === "happy-forks") {
          const sibling = "web:workflow:1"; storeChatMetadata(sibling, new Date().toISOString());
          const siblingDir = join(SESSIONS_DIR, sibling.replace(/[^a-zA-Z0-9._-]/g, "_")); mkdirSync(siblingDir, { recursive: true });
          symlinkSync(file, join(siblingDir, "resident.jsonl"));
          await pool.getSessionForIntrospection(sibling);
        }
      }
      if (scenario.startsWith("host-rowid-")) db.query("INSERT INTO messages(id,chat_jid,content,timestamp,is_bot_message) VALUES (?,?,?,?,1)")
        .run("frontier-known-message", "web:workflow:0", "original timeline message", "now");
      if (scenario === "unselected") writeFileSync(join(SESSIONS_DIR, "unknown.jsonl"), readFileSync(files[0]!));
      mkdirSync(SESSIONS_DIR, { recursive: true });
      watcher = watch(SESSIONS_DIR, { recursive: true }, (_event, name) => { if (name?.endsWith(".jsonl")) writes.push(name); });
      jsonl = (["create", "open", "continueRecent"] as const).map(name => spyOn(SessionManager, name).mockImplementation(() => { throw Error("JSONL factories forbidden after preparation"); }));
      const preparation = await runtime.prepareLegacyMigration("workflow-next");
      const captured = await preparation.capture();
      if (scenario.startsWith("happy-multiple")) {
        expect(captured.inputs).toHaveLength(2); expect(captured.unselectedSourcePaths).toEqual([]);
        expect([...new Set(captured.identities.map(i => i.originalSessionId))].sort()).toEqual(["original-0", "original-1"]);
        expect(captured.inputs.map(i => JSON.parse(i.sourceJSONL.split("\n")[0]!).id).sort()).toEqual(["original-0", "original-1"]);
      }
      const roots = new Map<string, import("../../runtime/durable-engine/qualification/durable.js").ConversationId>();
      if (scenario.startsWith("happy-multiple")) {
        const database = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
        importer = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(database));
        for (const input of captured.inputs) roots.set(input.expected.sourceSHA256,
          (await importer.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context)).id);
        await importer.close();
      }
      initializeCutoverManifest(db, () => lock.assertCurrentOwner());
      const identity = { domain: "workflow-next", incarnation: "workflow-next", ownerGeneration: 7, sourceEngineId: "legacy", candidateStoreRef: "candidate" };
      const cutover = new HostCutoverController(db, identity, { assertOwner() { lock.assertCurrentOwner(); }, assertCurrentWriter(writer) {
        const row = db.query("SELECT manifest FROM qualification_cutover_v1 WHERE domain=?").get(identity.domain) as { manifest: string } | null;
        expect(writer).toBe(row ? JSON.parse(row.manifest).writer : "legacy");
      }, checkDrained() { preparation.assertAdmissionGuard(); return { sourceDigest: roots.size ? copiedInstallationSourceDigest(captured.inputs) : captured.inputs[0]?.expected.sourceSHA256 ?? "empty", pending: 0, inflight: 0 }; } });
      const flip = spyOn(cutover, "commitWriter");
      const before = db.serialize(), bytes = files[0] ? readFileSync(files[0]) : Buffer.alloc(0); let opens = 0;
      const jsonlBefore = readdirSync(SESSIONS_DIR, { recursive: true }).map(String).filter(p => p.endsWith(".jsonl")).sort();
      if (scenario === "released") preparation.release();
      const answers = new Map<string, string>();
      let failedOnce = false;
      let firstReceipt: string | undefined;
      let firstEntries: string | undefined;
      let secondReceipt: string | undefined;
      let allocations = 0;
      const performUpgrade = () => upgradeCapturedRuntime({ preparation, cutover, importRoots: roots.size ? roots : undefined, application: { root: db, path, ownership: applicationOwnership(lock), offlineInitialize: true,
        answers: { put(ref: string, text: string) { answers.set(ref, text); }, resolver: { async resolve(ref: string) {
          const bytes = new TextEncoder().encode(answers.get(ref)!);
          return { ref, bytes, byteLength: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
        } } },
        runtime: { incarnation: identity.incarnation, lane: "main", generation: 1, now: () => new Date().toISOString(), harnessOptions: { models: policy.models, registry: policy.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } } } },
        async openImporter() {
          opens++; const database = new BunSqliteDatabase(path, { root: db, assertOwner: () => lock.assertCurrentOwner() });
          importer = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(database));
          if (scenario === "changed-after-open") writeFileSync(files[0]!, bytes.toString() + "\n");
          if (scenario === "released-after-open") preparation.release();
          const mutation = mutations[scenario.split("-")[1] as keyof typeof mutations];
          if (scenario.startsWith("host-") && scenario.endsWith("-open")) db.exec(mutation);
          const create = importer.harness.createConversation.bind(importer.harness);
          spyOn(importer.harness, "createConversation").mockImplementation((...args) => { allocations++; return create(...args); });
          const ordered = [...captured.inputs].sort((a, b) => JSON.parse(a.sourceJSONL.split("\n")[0]!).id.localeCompare(JSON.parse(b.sourceJSONL.split("\n")[0]!).id));
          const rootId = roots.get(ordered[0]!.expected.sourceSHA256);
          const conversation = rootId ? (await importer.harness.conversation(rootId, context))! : importer.root;
          if (scenario === "happy-multiple-retry" && !failedOnce) {
            const original = importer.harness.conversation.bind(importer.harness);
            spyOn(importer.harness, "conversation").mockImplementation(async (id, ctx) => {
              const handle = await original(id, ctx);
              if (handle && id === roots.get(ordered[1]!.expected.sourceSHA256)) {
                const commit = handle.commit.bind(handle);
                spyOn(handle, "commit").mockImplementation(async (...args) => {
                  const result = await commit(...args);
                  const receipt = await importer!.harness.snapshot(LegacyTreeImportManifest, id, context);
                  if (!failedOnce && receipt?.binding) {
                    secondReceipt = JSON.stringify(receipt); failedOnce = true; throw Error("lost import ACK");
                  }
                  return result;
                });
              }
              return handle;
            });
          }
          return { database, harness: importer.harness, conversation, async close() {
            if (scenario === "happy-multiple-retry" && failedOnce) {
              const currentReceipt = JSON.stringify(await importer!.harness.snapshot(LegacyTreeImportManifest, conversation.id, context));
              if (!firstReceipt) firstReceipt = currentReceipt;
              else expect(currentReceipt).toEqual(firstReceipt);
              const entries = JSON.stringify(await conversation.commit(tx => tx.scanEntries({ conversationId: conversation.id, order: "ascending" }, 100), context));
              if (!firstEntries) firstEntries = entries;
              else expect(entries).toEqual(firstEntries); // First source not replayed.
              expect(JSON.stringify(await importer!.harness.snapshot(LegacyTreeImportManifest, roots.get(ordered[1]!.expected.sourceSHA256)!, context))).toEqual(secondReceipt!);
            }
            await importer!.close();
            if (scenario.startsWith("host-") && scenario.endsWith("-close")) db.exec(mutation);
          } };
        } }, context);
      let upgrade = performUpgrade();
      if (scenario === "happy-multiple-retry") {
        await expect(upgrade).rejects.toThrow();
        expect(cutover.inspect()?.phase).toBe("copying");
        lock.assertCurrentOwner(); preparation.assertAdmissionGuard();
        // Retry must use the same persisted assignments, never fresh root allocation.
        expect(cutover.inspect()?.request.installation?.sources.map(s => s.rootId).sort()).toEqual([...roots.values()].sort());
        upgrade = performUpgrade();
      }
      if (!scenario.startsWith("happy")) {
        await expect(upgrade).rejects.toThrow(scenario.startsWith("host-") ? "Legacy host frontier changed" : scenario === "changed-after-open" ? "Legacy source changed" : scenario.includes("released") ? "released" : "Unsupported runtime upgrade inventory");
        if (scenario.startsWith("host-")) {
          const tables: Record<string, string> = { rowid: "messages", router: "router_state", preferences: "user_preferences", security: "web_sessions", terminal: "service_effect_s01_chats" };
          const table = tables[scenario.split("-")[1]!]!;
          expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toMatchObject({ n: expect.any(Number) });
          expect((db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBeGreaterThan(0);
        }
        if (scenario.endsWith("-close")) expect(cutover.inspect()?.phase).not.toBe("active");
        else expect(cutover.inspect()).toBeNull();
        if (scenario === "zero" || scenario === "unselected" || scenario === "multiple" || scenario === "released") { expect(opens).toBe(0); expect(db.serialize()).toEqual(before); }
      } else {
        bundle = await upgrade; expect(cutover.inspect()?.phase).toBe("active");
        expect(flip).toHaveBeenCalledTimes(1);
        expect(db.query("SELECT count(*) AS n FROM qualification_cutover_v1").get()).toEqual({ n: 1 });
        if (scenario === "happy-multiple-retry") {
          expect(failedOnce).toBe(true); expect(firstReceipt).toBeDefined(); expect(secondReceipt).toBeDefined();
          expect(allocations).toBe(0);
          expect(cutover.inspect()?.revision).toBe(5);
        }
        expect(readFileSync(files[0]!)).toEqual(bytes);
        expect(importer!.host.modelCalls).toBe(0);
        const candidateQueue = new AgentQueue();
        const candidatePool = new AgentPool({ ...createAgentPoolModelOptions(), ...bundle.sessionOptions,
          createSession: async () => { throw Error("Legacy fallback forbidden"); } });
        try {
          const channel = new WebChannel(bundle.bind({ queue: candidateQueue, agentPool: candidatePool })); channel.broadcastEvent = () => {};
          const response = await channel.handleRequest(new Request("http://fixture/agent/default/message?chat_jid=web%3Aworkflow%3A0", {
            method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "continue original chat" }),
          }));
          expect(response.status).toBe(201);
          for (let i = 0; i < 500 && candidateQueue.isLaneBusy("chat:web:workflow:0"); i++) await Bun.sleep(5);
          expect(candidateQueue.isLaneBusy("chat:web:workflow:0")).toBe(false);
          expect(db.query("SELECT content FROM messages WHERE chat_jid='web:workflow:0' AND is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
          const row = db.query("SELECT rowid,id FROM messages WHERE chat_jid='web:workflow:0' AND is_bot_message=0").get() as { rowid: number; id: string };
          expect(db.query("SELECT operation_id FROM service_effect_s02_commits WHERE chat_jid='web:workflow:0'").all()).toEqual([{ operation_id: `message:${row.rowid}:1` }]);
          expect(db.query("SELECT payload_ref FROM service_effect_s01_sources WHERE source_id=?").get(row.id)).toEqual({ payload_ref: `message-row:${row.rowid}` });
          expect(candidatePool.getSessionGenerationForChat("web:workflow:0")).toBe("original-0");
          expect(await candidatePool.getCurrentModelLabel("web:workflow:0")).toBe("qualification/synthetic");
          if (scenario === "happy-forks" || scenario.startsWith("happy-multiple")) {
            const siblingResponse = await channel.handleRequest(new Request("http://fixture/agent/default/message?chat_jid=web%3Aworkflow%3A1", {
              method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "continue sibling chat" }),
            }));
            expect(siblingResponse.status).toBe(201);
            for (let i = 0; i < 500 && candidateQueue.isLaneBusy("chat:web:workflow:1"); i++) await Bun.sleep(5);
            expect(candidateQueue.isLaneBusy("chat:web:workflow:1")).toBe(false);
            expect(candidatePool.getSessionGenerationForChat("web:workflow:1")).toBe(scenario.startsWith("happy-multiple") ? "original-1" : "original-0");
            expect(db.query("SELECT content FROM messages WHERE chat_jid='web:workflow:1' AND is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
            expect(db.query("SELECT 1 FROM service_effect_s02_commits WHERE chat_jid='web:workflow:1'").all()).toHaveLength(1);
          }
          expect(policy.host.modelCalls).toBe(scenario === "happy-forks" || scenario.startsWith("happy-multiple") ? 2 : 1);
          expect(policy.host.credentialLookups).toBe(0);
          expect(readdirSync(SESSIONS_DIR, { recursive: true }).map(String).filter(p => p.endsWith(".jsonl")).sort()).toEqual(jsonlBefore);
          preparation.assertAdmissionGuard();
          await Bun.sleep(20);
          expect(writes).toEqual([]);
          expect(!!bundle.sessionOptions.getDurableSession("web:workflow:0")).toBe(true);
          expect(readFileSync(files[0]!)).toEqual(bytes);
          for (const spy of jsonl) expect(spy).not.toHaveBeenCalled();
          await channel.stop();
        } finally { await candidateQueue.shutdown(); await candidatePool.shutdown(); }
      }
      lock.assertCurrentOwner(); await expect(web.runInternalDispatch(() => {})).rejects.toThrow("sealed");
    } finally {
      watcher?.close(); jsonl.forEach(spy => spy.mockRestore());
      await bundle?.close(); await importer?.close();
      await queue.shutdown(); await pool.shutdown(); await web.stop();
      complete(); await running; registration.mockRestore();
      closeDatabase(); lock.release(); rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
