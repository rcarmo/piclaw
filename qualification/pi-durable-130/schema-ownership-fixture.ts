import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installApprovedAddonsFixture } from "./installed-addons-fixture.js";
import { initDatabase, getDb, closeDatabase, initializeDatabaseSchema } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { SqliteSessionStore } from "../../runtime/scripts/lib/sqlite-session-archive.js";
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

/** Actual historical producers on an owned fixture, before current core init.
 * This deliberately retains archival data outside fresh native initialisation. */
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
  const archive = new SqliteSessionStore(database);
  const source = join(process.env.PICLAW_WORKSPACE!, "retained-history.jsonl");
  const bytes = '{"type": "session", "version": 3, "id": "schema-history", "timestamp": "2026-01-01T00:00:00.000Z"}\n' +
    '{"type": "message", "id": "history-1", "parentId": null, "timestamp": "2026-01-01T00:00:00.000Z", "message": {"role": "user", "content": [{"type":"text","text":"preserve archived bytes"}]}}\n';
  writeFileSync(source, bytes);
  const imported = await archive.importJsonl(source);
  const sessions = database.query("SELECT * FROM piclaw_agent_sessions").all();
  const entries = database.query("SELECT * FROM piclaw_agent_entries ORDER BY entry_seq").all();
  const receipts = database.query("SELECT * FROM piclaw_schema_migrations WHERE owner='piclaw-agent-sessions'").all();
  if (archive.exportJsonl(imported.importId) !== bytes) throw Error("Historical fixture round trip failed");
  writeFileSync(join(store,"messages.db"),database.serialize(),{flag:"wx"});
  database.close();
  return { bytes, imported, sessions, entries, receipts, cursors, polling };
}
