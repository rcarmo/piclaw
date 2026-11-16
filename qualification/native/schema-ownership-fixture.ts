import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installApprovedAddonsFixture } from "./installed-addons-fixture.js";
import { initDatabase, getDb, closeDatabase, initializeDatabaseSchema } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createHash } from "node:crypto";
const rootUrl = new URL("../../package.json", import.meta.url).href;
const { ModelRuntime } = await import(import.meta.resolve("@earendil-works/pi-coding-agent", rootUrl));

export async function openNativeSchemaFixture(addons: boolean) {
  if (addons) installApprovedAddonsFixture(process.env.PICLAW_WORKSPACE!);
  const credentials = {
    async read() { throw Error("Schema fixture forbids credential reads"); },
    async list() { return []; },
    async modify() { throw Error("Schema fixture forbids credential writes"); },
    async delete() { throw Error("Schema fixture forbids credential deletion"); },
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null,
    modelsStore: { async read() { return undefined; }, async write() {}, async delete() {} }, allowModelNetwork: false, refreshOnCreate: false });
  const model = { provider: "schema-fixture", id: "synthetic", name: "Synthetic", api: "openai-completions" as const,
    baseUrl: "https://fixture.invalid", input: ["text" as const], reasoning: false, contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model],
    auth: { apiKey: { name: "Synthetic", async resolve() { return { auth: { apiKey: "synthetic-only" } }; } } },
    streamSimple() { throw Error("Schema fixture forbids model calls"); } });
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const owner = acquireRuntimeLock({ lockPath: join(process.env.PICLAW_WORKSPACE!, "schema-owner.lock"), strictOwnership: true, disabled: false });
  const backend = await createDefaultApplicationRuntime(owner, async () => ({ modelRuntime: runtime, modelRegistry: { getAvailable: () => [model] } }) as never, {
    transportFactory: () => ({ id: "synthetic", status: () => ({ active: false }), ticket: () => "",
      async start() { throw Error("Schema fixture forbids peer start"); }, async request() { throw Error("Schema fixture forbids peer network"); }, async close() {} }),
    discoveryFactory() { throw Error("Schema fixture forbids discovery"); },
  });
  return { database: getDb(), async close() { await backend.close(); owner.release(); await closeDatabase(); } };
}

/** Test-only already-native archive/history data. No old source reader, import
 * constructor, conversion, automatic backup or archive writer participates. */
export async function seedHistoricalSchemaFixture() {
  const store = process.env.PICLAW_STORE!;
  mkdirSync(store, { recursive: true });
  // Prepare an already-native disposable store. No current v3 converter or
  // legacy branch/cursor rewrite participates in this preservation fixture.
  const database = new Database(":memory:"); initializeDatabaseSchema(database);
  database.exec(`
    INSERT INTO chats VALUES('web:historical','Retained label','2026-01-01T00:00:00.000Z');
    INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at) VALUES('retained-branch','web:historical','web:historical',NULL,'retained-agent','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL);
    INSERT INTO token_usage(chat_jid,run_at,input_tokens,output_tokens,total_tokens,model,provider) VALUES('web:historical','2026-01-01T00:00:00.000Z',100,20,120,'retained-model','retained-provider');
  `);
  // Match the already-native archive's historical quoted table declaration,
  // without running the retired ALTER/rename converter.
  database.exec(readFileSync(new URL('../../runtime/test/fixtures/legacy-chat-cursors.sql', import.meta.url), 'utf8').replaceAll(/\bchat_cursors\b/g,'host_legacy_chat_cursor_state_v1').replace('CREATE TABLE IF NOT EXISTS host_legacy_chat_cursor_state_v1','CREATE TABLE "host_legacy_chat_cursor_state_v1"'));
  database.exec("INSERT INTO host_legacy_chat_cursor_state_v1(rowid,chat_jid,cursor_ts,inflight_message_id,preflight_message_id,failed_message_id,compaction_last_error,queued_followups_json) VALUES(81,'web:historical','unacknowledged-position','old-input','old-preflight','old-failure','old-compaction','{malformed historical payload')");
  const cursors=database.query('SELECT rowid,* FROM host_legacy_chat_cursor_state_v1 ORDER BY rowid').all();
  const polling=database.query('SELECT rowid,* FROM chat_cursors ORDER BY rowid').all();
  const historySchema=JSON.parse(readFileSync(new URL("../../runtime/test/fixtures/historical-session-archive.json",import.meta.url),"utf8")) as {historicalSchemaSql:string;ownedForkSchemaSql:string};
  const archiveSql=historySchema.historicalSchemaSql;
  database.exec(historySchema.ownedForkSchemaSql);
  const oldOwner=(database.query('SELECT id FROM users ORDER BY id LIMIT 1').get() as {id:string}).id;
  database.query('INSERT INTO chats VALUES(?,?,?)').run('web:historical:fork','Retained child','2026-01-01T00:00:00.000Z');
  database.query('INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,NULL)').run('retained-fork','web:historical:fork','web:historical','retained-branch','retained-child','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  database.query('INSERT INTO owned_fork_operations VALUES(?,?,?,?,?,?,?)').run(oldOwner,'retained-request','retained-branch','retained-fork',' { "original" : "seed bytes" } ','2026-01-01T00:00:00.000Z',null);
  const ownedForks=database.query('SELECT * FROM owned_fork_operations ORDER BY request_id').all();
  database.exec(archiveSql);
  database.query("INSERT INTO piclaw_schema_migrations(owner,id,migration_order,checksum,applied_at) VALUES(?,?,?,?,?)").run("piclaw-agent-sessions","001-namespaced-session-import",1,createHash("sha256").update(archiveSql).digest("hex"),"2026-01-01T00:00:00.000Z");
  const source = join(process.env.PICLAW_WORKSPACE!, "retained-history.jsonl");
  const bytes = '{"type": "session", "version": 3, "id": "schema-history", "timestamp": "2026-01-01T00:00:00.000Z"}\n' +
    '{"type": "message", "id": "history-1", "parentId": null, "timestamp": "2026-01-01T00:00:00.000Z", "message": {"role": "user", "content": [{"type":"text","text":"preserve archived bytes"}]}}\n';
  writeFileSync(source, bytes);
  const [header,raw]=bytes.trimEnd().split('\n'),stamp='2026-01-01T00:00:00.000Z';
  const imported={importId:createHash('sha256').update(source).digest('hex'),sessionId:'schema-history',sourcePath:source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceBytes:Buffer.byteLength(bytes),entryCount:1,activeLeafId:'history-1',imported:true};
  database.query('INSERT INTO piclaw_agent_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(imported.importId,imported.sessionId,source,imported.sourceSha256,imported.sourceBytes,1,header,null,null,stamp,stamp,1,imported.activeLeafId);
  database.query('INSERT INTO piclaw_agent_entries VALUES(?,?,?,?,?,?,?,?)').run(imported.importId,1,'history-1',null,'message',stamp,raw,'preserve archived bytes');
  const sessions = database.query("SELECT * FROM piclaw_agent_sessions").all();
  const entries = database.query("SELECT * FROM piclaw_agent_entries ORDER BY entry_seq").all();
  const receipts = database.query("SELECT * FROM piclaw_schema_migrations WHERE owner='piclaw-agent-sessions'").all();
  const exported=[(sessions[0] as {header_json:string}).header_json,...entries.map(row=>(row as {raw_json:string}).raw_json)].join("\n")+"\n";
  if(exported!==bytes)throw Error("Synthetic historical archive bytes differ");
  writeFileSync(join(store,"messages.db"),database.serialize(),{flag:"wx"});
  database.close();
  return { bytes, imported, sessions, entries, receipts, cursors, polling, ownedForks };
}
