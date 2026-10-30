import "./src/test-guard.js";
import { expect, test, spyOn } from "bun:test";
import { watch } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentRuntimeFacade } from "../../runtime/src/agent-pool/runtime-facade.js";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { TestOwner } from "./src/ownership.js";
import { context } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { CURRENT_SQLITE_SCHEMA_VERSION } from "../../runtime/durable-engine/qualification/sqlite.ts";
import type { DocumentId } from "../../runtime/durable-engine/qualification/durable.ts";
import type { DurableConversationOperation } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";

// Multiple owned connections to ONE physical file. This is NOT a claim that host
// and SDK transactions are atomic together; binding ACK recovery remains necessary.
test("single physical database: accepted primary + attached intent, terminal idempotence and new-owner reopen", async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "single-database-"));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const f = await acceptedSteerFixture(dir, "before-submit", undefined, false, { sharedDatabase: true });
  const factories = ["create", "open", "continueRecent"] as const;
  const spies = factories.map(name => spyOn(SessionManager, name).mockImplementation(() => { throw new Error("JSONL session factory forbidden"); }));
  const fileEvents: string[] = [];
  const watcher = watch(dirname(f.hostPath), { recursive: true }, (_event, name) => { if (name?.endsWith(".jsonl")) fileEvents.push(name); });
  function facade(adapter: Awaited<ReturnType<typeof f.open>>) {
    const position = adapter.sessionPosition(f.chatJid, "main", "preserved-session-id");
    const app = new AgentRuntimeFacade({
      pool: new Map(), getDurableSession: chat => chat === f.chatJid ? position : undefined,
      modelRegistry: {} as ConstructorParameters<typeof AgentRuntimeFacade>[0]["modelRegistry"],
      modelRuntime: {} as ConstructorParameters<typeof AgentRuntimeFacade>[0]["modelRuntime"],
      authPath: "unused",
    });
    return app;
  }
  try {
    expect(resolve(f.path)).toBe(resolve(f.hostPath));
    expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
    const rootLedger = () => f.db.query("SELECT * FROM core_schema_migrations ORDER BY name").all();
    const ledger = f.rootSchemaMigrations;
    expect(rootLedger()).toEqual(ledger);
    expect(ledger.length).toBeGreaterThan(0);
    const checkConnections = async () => {
      f.owner.assert();
      const sdk = f.candidateDatabase;
        for (const rows of [f.db.query("PRAGMA database_list").all(), await sdk.all("SELECT * FROM pragma_database_list")]) {
          const databases = rows as { name: string; file: string }[];
          expect(databases.filter(r => r.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.hostPath }]);
        }
        expect(f.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
        expect(await sdk.get("SELECT * FROM pragma_foreign_keys")).toEqual({ foreign_keys: 1 });
        expect(f.db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
        expect(await sdk.all("SELECT * FROM pragma_integrity_check")).toEqual([{ integrity_check: "ok" }]);
        expect(f.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(await sdk.all("SELECT * FROM pragma_foreign_key_check")).toEqual([]);
    };
    const { primary, primaryId, b, adapter } = await f.prepare();
    const captured = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as { input: string }).input) as DurableConversationOperation;
    const app = facade(adapter);
    expect(app.getSessionGenerationForChat(f.chatJid)).toBe("preserved-session-id");
    // The root fixture persists this choice through the candidate's public AgentDoc API.
    const persistedModel = await app.getCurrentModelLabel(f.chatJid);
    expect(persistedModel).toBe("qualification/synthetic");
    const beforePosition = await app.saveSessionPosition(f.chatJid);
    expect(app).not.toHaveProperty("restoreSessionPosition");
    expect("applySlashCommand" in app).toBe(false);
    const sid = await adapter.submitIntent(captured);
    expect(await adapter.submitIntent(captured)).toBe(sid);
    expect(await f.runtime!.submit(primary)).toBe(primaryId);
    f.base.host.finalContent = [{ type: "text", text: "single database answer" }];
    f.base.host.modelHold!.release();
    await f.runtime!.resume(primary, primaryId);
    let terminal = await f.runtime!.settle(primary);
    for (let n = 0; !terminal && n < 200; n++) { await Bun.sleep(5); terminal = await f.runtime!.settle(primary); }
    expect(terminal?.disposition).toBe("completed");
    const tree = await app.getSessionTreeForChat(f.chatJid);
    expect(tree.version).toBe(1);
    expect(tree.flat).toBe(true);
    expect(tree.leafId).toBe(await app.saveSessionPosition(f.chatJid));
    expect(tree.nodes.some(node => node.role === "assistant" && node.detail === "single database answer")).toBe(true);
    expect(tree.nodes.every(node => typeof node.id === "string")).toBe(true);
    expect(JSON.stringify(tree)).not.toContain("thinking");
    const treeCommand = await app.applyControlCommand(f.chatJid, { type: "tree" });
    expect(treeCommand.status).toBe("success");
    expect((await app.applyControlCommand(f.chatJid, { type: "tree", targetId: tree.leafId! })).status).toBe("error");
    expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(b.sourceSeq);
    const docId = await f.candidateStorage!.mintId<DocumentId>();
    await f.candidateStorage!.commit([{ type: "document.create", record: { id: docId, kind: "qualification.single-database", scope: { kind: "session" } }, content: { kind: "base", version: 1, value: { outcome: "same-file" } } }], context);
    for (const table of ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits", "piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"]) {
      expect((f.db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBeGreaterThan(0);
    }
    expect(f.db.query("SELECT version FROM durable_schema").get()).toEqual({ version: CURRENT_SQLITE_SCHEMA_VERSION });
    expect(rootLedger()).toEqual(ledger);
    await checkConnections();
    const position = await app.saveSessionPosition(f.chatJid);
    expect(position).not.toBeNull();
    const snapshot = f.snapshot();
    const bindings = { primary: await f.ports.bindings.get(primary), intents: await f.ports.bindings.intents!.list(primary) };
    const generation = f.owner.token.generation;
    const calls = f.base.host.modelCalls;
    await f.runtime!.close();
    closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
    f.owner = TestOwner.acquire(f.hostPath); // Same file, fresh exclusive owner; no live-writer takeover.
    expect(f.owner.token.generation).toBe(generation + 1);
    f.owner.assert(); initDatabase(); f.db = getDb(); f.ports = f.stores();
    const reopened = await f.open();
    const reopenedApp = facade(reopened);
    expect(await reopenedApp.saveSessionPosition(f.chatJid)).toBe(position);
    expect(await reopenedApp.getSessionTreeForChat(f.chatJid)).toEqual(tree);
    await expect(app.getSessionTreeForChat(f.chatJid)).rejects.toThrow("Runtime closed");
    expect(await reopenedApp.getCurrentModelLabel(f.chatJid)).toBe(persistedModel);
    await expect(app.getCurrentModelLabel(f.chatJid)).rejects.toThrow("Runtime closed");
    expect(reopenedApp.getSessionGenerationForChat(f.chatJid)).toBe("preserved-session-id");
    await expect(app.saveSessionPosition(f.chatJid)).rejects.toThrow("Runtime closed");
    expect(await f.candidateStorage!.conversation(f.base.root.id, context)).toBeDefined();
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context))?.id).toBe(primaryId);
    expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context))?.id).toBe(sid);
    expect((await f.candidateStorage!.document(docId, "current", context))?.value.outcome).toBe("same-file");
    expect(await f.ports.bindings.get(primary)).toEqual(bindings.primary);
    expect(await f.ports.bindings.intents!.list(primary)).toEqual(bindings.intents);
    expect(await reopened.submitIntent(captured)).toBe(sid);
    expect(await f.runtime!.submit(primary)).toBe(primaryId);
    expect((await f.runtime!.settle(primary))?.disposition).toBe("completed");
    expect(f.snapshot()).toEqual(snapshot);
    expect(f.base.host.modelCalls).toBe(calls);
    expect(f.base.host.effects).toBe(0);
    expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([{ content: "single database answer" }]);
    expect(f.db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(f.incarnation)).toHaveLength(1);
    expect(rootLedger()).toEqual(ledger);
    await checkConnections();
    const files: string[] = [];
    async function scan(path: string) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const next = join(path, entry.name);
        if (entry.isDirectory()) await scan(next); else files.push(next);
      }
    }
    await scan(dir); await scan(dirname(f.hostPath));
    expect(files.filter(p => /\.jsonl$/i.test(p))).toEqual([]);
    // WAL/SHM are SQLite sidecars, not additional stores. Ownership is a table
    // in this very file: no separate lease DB or session files are permitted.
    expect(files.filter(p => ![f.hostPath, `${f.hostPath}-wal`, `${f.hostPath}-shm`].includes(p))).toEqual([]);
    expect((await stat(f.path)).ino).toBe((await stat(f.hostPath)).ino);
    expect(fileEvents).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    watcher.close();
    for (const spy of spies) spy.mockRestore();
    await f.close(); process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
