import "./test-guard.js";
import check from "node:assert/strict";
import { join, basename } from "node:path";
import { STORE_DIR } from "../../../runtime/src/core/config.js";
import { SqliteStorage, SQLITE_MIGRATIONS } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import { HostConversationRuntime, initializeHostDurableBindings, createHostDurableBindings, type AcceptedInput } from "../../../runtime/durable-engine/src/index.js";
import { TestOwner, OwnedSqlite } from "./ownership.js";
import { openFixture, context, barrier } from "./fixture.js";
import { at, effect, sealed, value } from "./host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups, storeChatMetadata } from "../../../runtime/src/db.js";
import { installTerminalSettlementCompositionSchema } from "../../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { hashCanonicalRequest } from "../../../runtime/src/service-effects/contracts/common.js";
import { createDurableConversationAdapter, type DurableConversationOperation } from "../../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { createDurableQueuedSteering } from "../../../runtime/src/agent-pool/durable-queued-steering.js";
import { storeWebMessage } from "../../../runtime/src/channels/web/messaging/message-store.js";


// Test-only forensic reads of the actual SDK tables; never write lifecycle state.
// Normalize both sides before stdout JSON transport (SQLite BLOBs are Uint8Arrays).
export async function sdkRecoverySnapshot(database: OwnedSqlite) {
  const rows = await Promise.all(["entries", "submissions"].map(table => database.all(`SELECT rowid AS snapshot_rowid, * FROM ${table} ORDER BY id`)));
  return JSON.parse(JSON.stringify(rows, (_key, value) => value instanceof Uint8Array
    ? { sqliteBlobHex: Buffer.from(value).toString("hex") }
    : typeof value === "bigint" ? { sqliteInteger: value.toString() } : value)) as Record<string, unknown>[][];
}

export type RecoveryCheckpoint = { sdkSnapshot?: Awaited<ReturnType<typeof sdkRecoverySnapshot>>; generation: number; intentSourceId: string; primary: AcceptedInput; primaryId: number; b: { sourceId: string; sourceSeq: number }; committedIntentId?: number; intent: DurableConversationOperation; candidate?: { id: number; requestId?: string }; modelCalls: number; effects: number; };
export async function acceptedSteerFixture(dir: string, boundary: "before-submit" | "committed-ack-lost", recovered?: RecoveryCheckpoint, queuePrimary = false, testConfig: { loseIntentBindingAck?: boolean; sharedDatabase?: boolean; httpPrimary?: boolean } = {}) {
    process.env.PICLAW_DB_IN_MEMORY = "0";
    const chatJid = `web:recovery:${basename(dir)}:${boundary}`;
    const hostPath = join(STORE_DIR, "messages.db");
    const path = testConfig.sharedDatabase ? hostPath : join(dir, "candidate.sqlite");
    let owner = TestOwner.acquire(path); // Shared mode owns the root file BEFORE either runtime connection opens.
    owner.assert();
    if (testConfig.sharedDatabase && recovered) {
      check.throws(() => getDb(), /Database not initialized/);
      check.equal(owner.token.generation, recovered.generation + 1); // New owner BEFORE host or SDK initialization.
    }
    initDatabase();
    let db = getDb();
    if (testConfig.sharedDatabase) {
      db.exec("PRAGMA foreign_keys=ON");
      // Inspect the published default DDL, including index names, against the actual root schema.
      const sdkNames = SQLITE_MIGRATIONS.flatMap(m => m.statements.flatMap(sql => {
        const match = /^CREATE (?:TABLE|INDEX) (\w+)/.exec(sql);
        return match ? [match[1]!] : [];
      })).concat("durable_schema");
      const rootNames = new Set((db.query("SELECT name FROM sqlite_master").all() as { name: string }[]).map(r => r.name));
      // A same-file restart (or an earlier shared fixture) already has the SDK schema.
      if (!rootNames.has("durable_schema")) check.deepEqual(sdkNames.filter(name => rootNames.has(name)), [], "Public SDK default schema collides with root schema; use public SqliteStorageOptions.prefix before opening");
    }
    const rootSchemaMigrations = db.query("SELECT * FROM core_schema_migrations ORDER BY name").all();
    let candidateDatabase: OwnedSqlite;
    const openStorage = () => {
      candidateDatabase = new OwnedSqlite(owner, { foreignKeys: testConfig.sharedDatabase });
      return SqliteStorage.open(candidateDatabase);
    };
    const primaryRow = (db.query('SELECT COALESCE(MAX(rowid),0)+1 AS id FROM messages').get() as { id: number }).id;
    const incarnation = queuePrimary ? `message:${primaryRow}:1` : `recovery:${basename(dir)}:${boundary}`;
    const base = await openFixture({ get acquired() { return owner.acquired; } }, () => {}, openStorage);
    await base.close();
    const manifest = [{ chatJid, branchId: "main", conversationId: base.root.id }];
    const generation = recovered?.generation ?? owner.token.generation; // Persisted operation watch generation, NOT replacement owner token.
    let runtime: HostConversationRuntime | undefined;
    let candidateStorage: SqliteStorage;
    let providerEntries = 0, toolEntries = 0;
    void base.host.toolEntered.promise.then(() => { toolEntries++; });
    let entryObserved: ReturnType<typeof barrier> | undefined;
    base.host.onModelEnter = () => { providerEntries++; entryObserved?.release(); };
    let ackLost = false;
    let committedIntentId: number | undefined;
    const payloads = new InMemoryEffectPayloadResolver();
    let permit = false, authorizations = 0;
    const intentSourceId = recovered?.intentSourceId ?? `source-${crypto.randomUUID()}`;
    const primaryRequestId = queuePrimary ? `message:${primaryRow}:${incarnation}:A` : `primary:${incarnation}`;
    const assert = () => owner.assert();
    function stores() {
      db.exec("PRAGMA foreign_keys=ON");
      const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance() { assert(); return true; } }));
      const terminal = value(createCurrentPiclawTerminalSettlementStore(db, payloads, { hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return true; } }));
      const bindings = createHostDurableBindings(db, { domain: incarnation, incarnation, manifest, assertOwner: assert,
        async resolveContent(ref) {
          const row = (ref.startsWith('message-row:')
            ? db.query('SELECT content FROM messages WHERE rowid=? AND chat_jid=?').get(Number(ref.slice('message-row:'.length)), chatJid)
            : db.query("SELECT content FROM messages WHERE id=? AND chat_jid=?").get(ref.replace(/^queued-source:/, ""), chatJid)) as { content: string } | null;
          if (!row) throw Error("Missing payload"); return row.content;
        } });
      const intents = bindings.intents!;
      const faultBindings = testConfig.loseIntentBindingAck ? {
        get: bindings.get.bind(bindings), bind: bindings.bind.bind(bindings),
        getOrBind: bindings.getOrBind.bind(bindings), recordSubmission: bindings.recordSubmission.bind(bindings),
        findSource: bindings.findSource.bind(bindings),
        intents: {
          get: intents.get.bind(intents), bind: intents.bind.bind(intents),
          getOrBind: intents.getOrBind.bind(intents), list: intents.list.bind(intents),
          async recordSubmission(input: AcceptedInput, id: Parameters<typeof intents.recordSubmission>[1]) {
            if (!ackLost) {
              committedIntentId = id;
              ackLost = true;
              throw Error(`ACK lost before host binding write for ${input.requestId}: ${id}`);
            }
            await intents.recordSubmission(input, id);
          },
        },
      } : bindings;
      return { work, terminal, bindings: faultBindings };
    }
    installTerminalSettlementCompositionSchema(db); initializeHostDurableBindings(db, assert);
    db.exec("CREATE TABLE IF NOT EXISTS recovery_fixture_identity (id TEXT PRIMARY KEY, input TEXT NOT NULL)");
    let ports = stores();
    async function open() {
      runtime = await HostConversationRuntime.open({ incarnation, owner: { assert, release() {} },
        openStorage: async () => { assert(); candidateStorage = await openStorage(); return candidateStorage; },
        harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
        ...ports, existingConversationIds: [base.root.id], conversationFor(chat, branch) {
          if (chat !== chatJid || branch !== "main") throw Error("Manifest conflict"); return base.root.id;
        }, authorizeScheduling(inspection) {
          assert(); authorizations++;
          if (!permit) throw Error("Host scheduling gate closed");
          const httpRow = testConfig.httpPrimary ? db.query('SELECT rowid, id FROM messages WHERE chat_jid=? AND is_bot_message=0 ORDER BY rowid LIMIT 1').get(chatJid) as { rowid: number; id: string } | null : null;
          const allowedPrimary = httpRow ? `message:${httpRow.rowid}:${httpRow.id}` : primaryRequestId;
          if (inspection.submissions.some(s => s.conversationId !== base.root.id || ![allowedPrimary, `queued-steer:${intentSourceId}`].includes(s.requestId!))) throw Error("Unknown recovered authority");
        }, putAnswer(ref, text) { payloads.putText(ref, text); }, sessionId: incarnation, lane: "main", generation, now: () => testConfig.httpPrimary ? new Date().toISOString() : at }, context);
      return createDurableConversationAdapter({ incarnation, manifest, runtime });
    }
    const snapshot = () => ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits", "recovery_fixture_identity"].map(t => db.query(`SELECT * FROM ${t}`).all());

async function prepare() {
      storeChatMetadata(chatJid, at);
      const source = value(await ports.work.acceptSource(sealed({ effect: effect(`${incarnation}:A`), chatJid, sourceId: `${incarnation}:A`, kind: "message" as const,
        payloadRef: queuePrimary ? `message-row:${primaryRow}` : `${incarnation}:A`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      db.query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)").run(source.sourceId, chatJid, "primary A", at);
      if (queuePrimary) check.equal((db.query('SELECT rowid AS id FROM messages WHERE id=?').get(source.sourceId) as { id: number }).id, primaryRow);
      const claimed = value(await ports.work.claimNext(sealed({ effect: effect(`${incarnation}:claim`), chatJid, expectedFrontier: 0, newOperationId: incarnation, claimedAt: at })))!;
      const primary: AcceptedInput = { incarnation, conversationId: base.root.id, chatJid, branchId: "main", operationId: incarnation,
        sourceId: source.sourceId, sourceSeq: source.sourceSeq, payloadRef: source.payloadRef, requestId: primaryRequestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId: primaryRequestId, content: "primary A" }) };
      let adapter = await open(); permit = true;
      const primaryId = await runtime!.submit(primary);
      await runtime!.wait(primary, primaryId); // Primary is committed before the restart; never replay it.
      const operation = value(await ports.work.getOperation(claimed.operation.operationId))!;
      value(await ports.work.bindHarness(sealed({ effect: effect(`${incarnation}:running`, incarnation, source.sourceSeq), expectedVersion: operation.version,
        sessionId: incarnation, lane: "main", harnessOperationId: String(primaryId), state: "running" as const, watchGeneration: generation })));
      const b = value(await ports.work.acceptSource(sealed({ effect: effect(`${incarnation}:B`), chatJid, sourceId: intentSourceId, kind: "message" as const,
        payloadRef: `queued-source:${intentSourceId}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
      setDeferredQueuedFollowups(chatJid, [{ rowId: 1650, threadId: null, source_id: b.sourceId, source_accepted: true, queuedContent: "accepted B", queuedAt: at }]);
      const coordinator = createDurableQueuedSteering({ work: ports.work, chatJid, branchId: "main", assertCurrentWriter: assert,
        runningBinding: { sessionId: incarnation, lane: "main", watchGeneration: generation },
        adapter: { ...adapter, validateIntent(input) {
          adapter.validateIntent(input);
          // Fixture controller's captured identity is persisted in the SAME materialization transaction.
          db.query("INSERT INTO recovery_fixture_identity VALUES (?,?)").run(incarnation, JSON.stringify(input));
        }, async submitIntent(input) {
          if (testConfig.loseIntentBindingAck) return adapter.submitIntent(input);
          committedIntentId = await adapter.submitIntent(input);
          ackLost = true; // Reached only AFTER the public runtime submission succeeds.
          throw Error(`ACK lost after ${committedIntentId}`);
        } },
        readQueued: id => getDeferredQueuedFollowups(chatJid).find(x => x.rowId === id),
        validatePayload({ item }) { check.equal(item.source_id, b.sourceId); check.equal(item.queuedContent, "accepted B"); },
        materialize: (item, accept) => storeWebMessage({ broadcastEvent() {}, pendingLinkPreviews: new Set<number>() } as Parameters<typeof storeWebMessage>[0],
          { chatJid, content: item.queuedContent, isBot: false, mediaIds: [], agentId: "default", agentName: "Fixture" },
          { consumeDeferredFollowupRowId: item.rowId, materializeQueuedSource: accept, isSteeringMessage: true }) });
      const accepted = await coordinator.accept(1650);
      check.deepEqual(getDeferredQueuedFollowups(chatJid), []);
      check.equal(ports.work.getAcceptedSource(chatJid, b.sourceId)?.state, "claimed");
      check.equal(await runtime!.settle(primary), null);
      base.host.modelHold = barrier();
      if (boundary === "committed-ack-lost") {
        await accepted.dispatch(); // Coordinator intentionally catches the simulated lost ACK.
        const committed = await candidateStorage!.submissionByRequest(base.root.id, `queued-steer:${intentSourceId}`, context);
        check.equal(ackLost, true);
        check.notEqual(committedIntentId, undefined);
        check.equal(committed?.id, committedIntentId);
        check.equal(committed?.type, "input");
      } else {
        check.equal(ackLost, false);
        check.equal(await candidateStorage!.submissionByRequest(base.root.id, `queued-steer:${intentSourceId}`, context), undefined);
      }
      check.equal((await candidateStorage!.submissionByRequest(base.root.id, primaryRequestId, context))?.id, primaryId);

 return { adapter, primary, primaryId, b };
}
return { get toolEntries() { return toolEntries; }, get db() { return db; }, set db(v) { db = v; },
get owner() { return owner; }, set owner(v) { owner = v; },
get ports() { return ports; }, set ports(v) { ports = v; },
get runtime() { return runtime; }, set runtime(v) { runtime = v; },
get candidateStorage() { return candidateStorage; }, set candidateStorage(v) { candidateStorage = v; },
get candidateDatabase() { return candidateDatabase; },
rootSchemaMigrations,
get providerEntries() { return providerEntries; }, set providerEntries(v) { providerEntries = v; },
get entryObserved() { return entryObserved; }, set entryObserved(v) { entryObserved = v; },
get ackLost() { return ackLost; }, set ackLost(v) { ackLost = v; },
get committedIntentId() { return committedIntentId; }, set committedIntentId(v) { committedIntentId = v; },
get permit() { return permit; }, set permit(v) { permit = v; },
get authorizations() { return authorizations; }, set authorizations(v) { authorizations = v; },
base,
putAnswer(ref: string, text: string) { payloads.putText(ref, text); },
path,
hostPath,
generation,
intentSourceId,
primaryRequestId,
incarnation,
chatJid,
open,
stores,
snapshot,
prepare,
async close() { base.host.modelHold?.release(); await runtime?.close(); await base.close(); owner.releaseAfterClose(); owner.closeConnection(); closeDatabase(); } };
}
