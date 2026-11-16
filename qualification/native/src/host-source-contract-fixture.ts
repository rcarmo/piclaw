import "./test-guard.js";
import { createInputHandoffCompletion } from "../../../runtime/durable-engine/src/host-bindings.js";
import check from "node:assert/strict";
import { join, basename } from "node:path";
import { STORE_DIR } from "../../../runtime/src/core/config.js";
import { SqliteStorage, SQLITE_MIGRATIONS } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import { HostConversationRuntime, initializeHostDurableBindings, createHostDurableBindings, type AcceptedInput } from "../../../runtime/durable-engine/src/index.js";
import { TestOwner, OwnedSqlite } from "./ownership.js";
import { openFixture, context, barrier } from "./fixture.js";
import { at, value } from "./host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { createDurableConversationAdapter } from "../../../runtime/src/agent-pool/durable-runtime-adapter.js";


/** Explicit legacy/noninteractive source-contract setup only. No queue, steering,
 * materialisation or recovered input preparation. Ordinary inputs use the real
 * native fixture; retained ServiceWork facts never grant a new SDK submit. */
export async function hostSourceContractFixture(dir: string, boundary: "before-submit" | "committed-ack-lost", queuePrimary = false, testConfig: { withPromptContextGuard?: import("../../../runtime/durable-engine/src/host-runtime.js").RuntimeOptions["withPromptContextGuard"]; withIdleModelGuard?: import("../../../runtime/durable-engine/src/host-runtime.js").RuntimeOptions["withIdleModelGuard"]; loseIntentBindingAck?: boolean; sharedDatabase?: boolean; httpPrimary?: boolean; allowRequest?: (requestId: string) => boolean; prepareTerminalEffect?: import("../../../runtime/durable-engine/src/host-runtime.js").RuntimeOptions["prepareTerminalEffect"] } = {}) {
    process.env.PICLAW_DB_IN_MEMORY = "0";
    const chatJid = `web:recovery:${basename(dir)}:${boundary}`;
    const hostPath = join(STORE_DIR, "messages.db");
    const path = testConfig.sharedDatabase ? hostPath : join(dir, "candidate.sqlite");
    let owner = TestOwner.acquire(path); // Shared mode owns the root file BEFORE either runtime connection opens.
    owner.assert();
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
    const generation = owner.token.generation; // Persisted operation watch generation, NOT replacement owner token.
    let runtime: HostConversationRuntime | undefined;
    let candidateStorage: SqliteStorage;
    let providerEntries = 0, toolEntries = 0;
    base.host.onToolEnter = () => { toolEntries++; };
    let entryObserved: ReturnType<typeof barrier> | undefined;
    base.host.onModelEnter = () => { providerEntries++; entryObserved?.release(); };
    let ackLost = false;
    let committedIntentId: number | undefined;
    const payloads = new InMemoryEffectPayloadResolver();
    let permit = false, authorizations = 0;
    const intentSourceId = `source-${crypto.randomUUID()}`;
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
      // Reused real controllers own scheduling admission; permit belongs only
      // to this fixture's open() callback, not their execution authority.
      const complete = createInputHandoffCompletion(db, { domain: incarnation, incarnation, sessionId: incarnation,
        bindings, work, assertCurrent: assert });
      return { work, terminal, bindings: faultBindings,
        async completeInputHandoff(...args: Parameters<typeof complete>) {
          const [input, id, , intent] = args;
          if (testConfig.loseIntentBindingAck && intent && !ackLost) {
            committedIntentId = id; ackLost = true;
            throw Error(`ACK lost before host binding write for ${input.requestId}: ${id}`);
          }
          await complete(...args);
        } };
    }
    installTerminalSettlementCompositionSchema(db); initializeHostDurableBindings(db, assert);
    let ports = stores();
    async function open() {
      runtime = await HostConversationRuntime.open({ incarnation, owner: { assert, release() {} }, openStorage: async () => { assert(); candidateStorage = await openStorage(); return candidateStorage; }, harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, prepareTerminalEffect: testConfig.prepareTerminalEffect, withIdleModelGuard: testConfig.withIdleModelGuard, withPromptContextGuard: testConfig.withPromptContextGuard, ...ports, existingConversationIds: [base.root.id], conversationFor(chat, branch) {
          if (chat !== chatJid || branch !== "main") throw Error("Manifest conflict"); return base.root.id;
        }, authorizeScheduling(inspection) {
          assert(); authorizations++;
          if (!permit) throw Error("Host scheduling gate closed");
          const httpRow = testConfig.httpPrimary ? db.query('SELECT rowid, id FROM messages WHERE chat_jid=? AND is_bot_message=0 ORDER BY rowid LIMIT 1').get(chatJid) as { rowid: number; id: string } | null : null;
          const allowedPrimary = httpRow ? `message:${httpRow.rowid}:${httpRow.id}` : primaryRequestId;
          if (inspection.submissions.some(s => s.conversationId !== base.root.id || (![allowedPrimary, `queued-steer:${intentSourceId}`].includes(s.requestId!) && !testConfig.allowRequest?.(s.requestId!)))) throw Error("Unknown recovered authority");
        }, putAnswer(ref, text) { payloads.putText(ref, text); }, sessionId: incarnation, now: () => testConfig.httpPrimary ? new Date().toISOString() : at }, context);
      return createDurableConversationAdapter({ incarnation, manifest, runtime });
    }
    const snapshot = () => ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits"].map(t => db.query(`SELECT * FROM ${t}`).all());

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
async close() { base.host.modelHold?.release(); await runtime?.close(); await base.close(); await closeDatabase(); owner.releaseAfterClose(); owner.closeConnection(); } };
}
