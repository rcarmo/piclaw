import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installApprovedAddonsFixture } from "./installed-addons-fixture.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
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
  const database = new Database(join(store, "messages.db"));
  database.exec(`
    CREATE TABLE chats(jid TEXT PRIMARY KEY,name TEXT,last_message_time TEXT);
    CREATE TABLE chat_branches(branch_id TEXT PRIMARY KEY,chat_jid TEXT NOT NULL UNIQUE,root_chat_jid TEXT NOT NULL,parent_branch_id TEXT,agent_name TEXT NOT NULL UNIQUE,display_name TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,FOREIGN KEY(chat_jid) REFERENCES chats(jid));
    INSERT INTO chats VALUES('web:historical','Retained label','2026-01-01T00:00:00.000Z');
    INSERT INTO chat_branches VALUES('retained-branch','web:historical','web:historical',NULL,'retained-agent','Retained branch','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL);
    CREATE TABLE token_usage(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_jid TEXT NOT NULL,run_at TEXT NOT NULL,input_tokens INTEGER DEFAULT 0,output_tokens INTEGER DEFAULT 0,cache_read_tokens INTEGER DEFAULT 0,cache_write_tokens INTEGER DEFAULT 0,total_tokens INTEGER DEFAULT 0,cost_input REAL DEFAULT 0,cost_output REAL DEFAULT 0,cost_cache_read REAL DEFAULT 0,cost_cache_write REAL DEFAULT 0,cost_total REAL DEFAULT 0,model TEXT,provider TEXT,api TEXT,turns INTEGER DEFAULT 0);
    INSERT INTO token_usage(chat_jid,run_at,input_tokens,output_tokens,total_tokens,model,provider) VALUES('web:historical','2026-01-01T00:00:00.000Z',100,20,120,'retained-model','retained-provider');
  `);
  // A real pre-retirement cursor root, including malformed queued bytes. The
  // owned upgrade must preserve its execution evidence without consulting it.
  database.exec(readFileSync(new URL('../../runtime/test/fixtures/legacy-chat-cursors.sql', import.meta.url), 'utf8'));
  database.exec("INSERT INTO chat_cursors(rowid,chat_jid,cursor_ts,inflight_message_id,preflight_message_id,failed_message_id,compaction_last_error,queued_followups_json) VALUES(81,'web:historical','unacknowledged-position','old-input','old-preflight','old-failure','old-compaction','{malformed historical payload')");
  const cursors = database.query('SELECT rowid,* FROM chat_cursors ORDER BY rowid').all();
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
  database.close();
  return { bytes, imported, sessions, entries, receipts, cursors };
}
