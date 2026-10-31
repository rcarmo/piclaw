/**
 * db/connection.ts – SQLite database initialisation and schema management.
 *
 * Opens (or creates) the SQLite target from one explicit bootstrap path snapshot,
 * sets pragmas for WAL mode and busy timeout, and ensures all required tables,
 * indexes, FTS virtual tables, and triggers exist.
 *
 * This is the first module that must be called at startup (via `initDatabase()`)
 * before any other db/* module can function. The singleton `Database` instance
 * is then retrieved elsewhere with `getDb()`.
 *
 * Consumers:
 *   - db.ts re-exports initDatabase/getDb as the public entry point.
 *   - All db/* modules (messages, media, tasks, token-usage, tool-outputs,
 *     router-state, web-content, auto-compaction) call getDb() internally.
 *   - index.ts / runtime.ts calls initDatabase() during application startup.
 */

import Database from "bun:sqlite";
import { initializeChatCursorStorage } from "./chat-cursor-storage.js";
import { initializeAccessSchema } from "./access-state.js";
import { initializeSessionOwnershipSchema } from "./session-ownership.js";
import { initializeSessionHandleSchema } from "./session-handles.js";
import { initializeOwnedForkSchema } from "./owned-forks.js";
import { initializeAuthLabelsSchema } from "./auth-labels-schema.js";
import { initializePickerPins } from './picker-pins.js';
import { initializeToolOutputOwnership } from './tool-output-ownership-schema.js';
import { initializeBudgetLimitsSchema } from './budget-limits-schema.js';
import { initializeAddonOperationsSchema } from './addon-operations-schema.js';
import { initializeChatProjects } from './chat-project-schema.js';
import { initializeScheduledHistorySchema } from './scheduled-history-schema.js';
import fs from "fs";
import path from "path";

import { WORKSPACE_DIR, getRuntimeConfigPaths } from "../core/config.js";
import type { RuntimeConfigPaths } from "../core/config-paths.js";
import { createLogger } from "../utils/logger.js";
import { migrateMediaCompression } from "./media-recompress.js";
import { ensureLegacyColumns } from "./legacy-columns.js";
import { createVerifiedSqliteBackup, type SqliteBackupManifest } from "./backup.js";
import { registerSqliteCheckpoint } from "./sqlite-checkpoint.js";
import { openSqliteRole } from "./sqlite-role-policy.js";
import { RuntimeStartupCleanupError } from "../runtime/startup-cleanup-error.js";
import { applyOwnedMigrations } from "./migrations.js";
import { retireAttachmentRowidIndex } from "./attachment-index-retirement.js";
import { migrateScheduledTaskAuthorities } from "./scheduled-task-authority.js";
import { installScheduledRunCompositionSchema } from "../service-effects/current-piclaw/scheduled-run-schema.js";

const log = createLogger("db.connection");

/** Singleton database handle; set by initDatabase(), accessed via getDb(). */
let db: Database | null = null;
/** Cache key for the currently-open database target or in-memory test identity. */
let dbPathCache: string | null = null;
let stopCheckpoint: (() => void) | undefined;
let dbFileIdentity: string | null = null;
let dbInstance = 0;
let dbRole: "root" | "index-worker" | undefined;
let cleanupFailure: RuntimeStartupCleanupError | undefined;
function currentFileIdentity(pathname: string): string {
  const stat = fs.statSync(pathname);
  return `${stat.dev}:${stat.ino}`;
}
export function getDatabaseBinding(): { path: string; identity: string; instance: number } | null {
  if (!db || !dbPathCache || !dbFileIdentity) return null;
  return { path: dbPathCache, identity: dbFileIdentity, instance: dbInstance };
}

const CANONICAL_WORKSPACE_DIR = path.resolve("/workspace");
const CANONICAL_LIVE_DB_PATH = path.join(CANONICAL_WORKSPACE_DIR, ".piclaw", "store", "messages.db");
let allowLiveDbInTestsOverride = false;

/** Explicit test-only safety bypass; returns a restore callback. */
export function setAllowLiveDbInTestsForTests(allow: boolean): () => void {
  if (process.env.PICLAW_DB_IN_MEMORY !== "1" && process.env.NODE_ENV !== "test") {
    throw new Error("setAllowLiveDbInTestsForTests requires a test runtime");
  }
  const previous = allowLiveDbInTestsOverride;
  allowLiveDbInTestsOverride = allow;
  return () => { allowLiveDbInTestsOverride = previous; };
}

export function isLikelyTestHarnessProcess(argv: string[] = [...process.argv, ...(globalThis.Bun?.argv ?? [])]): boolean {
  return argv.some((value) => {
    if (typeof value !== "string") return false;
    return /\.test\.[cm]?[jt]sx?$/.test(value) || /(?:^|[/\\])test(?:[/\\]|$)/.test(value);
  });
}

export function shouldBlockLiveDatabaseOpenInTests(options: {
  useMemory: boolean;
  nextPath: string;
  workspaceDir?: string;
  allowLiveDbInTests?: boolean;
  argv?: string[];
}): boolean {
  const {
    useMemory,
    nextPath,
    workspaceDir = WORKSPACE_DIR,
    allowLiveDbInTests = allowLiveDbInTestsOverride,
    argv,
  } = options;

  if (useMemory || allowLiveDbInTests) return false;
  if (!isLikelyTestHarnessProcess(argv)) return false;
  return path.resolve(workspaceDir) === CANONICAL_WORKSPACE_DIR && path.resolve(nextPath) === CANONICAL_LIVE_DB_PATH;
}

/**
 * Create all tables, indexes, FTS virtual tables, and triggers if they do
 * not already exist. Called once during initDatabase().
 *
 * Tables created:
 *   - chats – known chat endpoints (jid, name, last_message_time)
 *   - messages – individual messages with sender/content/timestamp
 *   - thinking_content – persisted reasoning text keyed by stored message row id
 *   - messages_fts – FTS5 index over message content for full-text search
 *   - media – binary file storage for attachments
 *   - message_media – join table linking messages to media records
 *   - tool_outputs – large tool invocation results (bash output, file reads)
 *   - tool_outputs_fts – FTS5 index for searching tool output content
 *   - scheduled_tasks – compatibility/UI projection of versioned S07 definitions
 *   - task_run_logs – execution history for scheduled tasks
 *   - router_state – key-value store for router cursor positions
 *   - token_usage – per-run LLM token and cost accounting
 *   - keychain_entries – encrypted credential storage (secure/keychain.ts)
 *   - workspace_files – file metadata cache for workspace search
 *   - workspace_fts – FTS5 index over workspace file contents
 */
function renameLegacyConfigTable(database: Database, fromName: string, toName: string): void {
  const rows = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?) ORDER BY name"
  ).all(fromName, toName) as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  if (!names.has(fromName) || names.has(toName)) return;
  try {
    database.exec(`ALTER TABLE ${fromName} RENAME TO ${toName}`);
  } catch (error) {
    log.warn("Failed to rename legacy config table", {
      operation: "rename_legacy_config_table",
      fromName,
      toName,
      err: error,
    });
  }
}

function migrateLegacyConfigTables(database: Database): void {
  renameLegacyConfigTable(database, "chat_ssh_configs", "ssh_configs");
  renameLegacyConfigTable(database, "chat_proxmox_configs", "proxmox_configs");
  renameLegacyConfigTable(database, "chat_portainer_configs", "portainer_configs");
}

function createSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chats_last_message_time ON chats(last_message_time);

    CREATE TABLE IF NOT EXISTS chat_branches (
      branch_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL UNIQUE,
      root_chat_jid TEXT NOT NULL,
      parent_branch_id TEXT,
      agent_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_branches_root_chat_jid ON chat_branches(root_chat_jid);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_parent_branch_id ON chat_branches(parent_branch_id);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_archived_at ON chat_branches(archived_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      screen_hint TEXT,
      content_blocks TEXT,
      link_previews TEXT,
      thread_id INTEGER,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      is_terminal_agent_reply INTEGER DEFAULT 0,
      is_steering_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    -- The chat-only index implicitly orders each chat by rowid for timeline pagination.
    -- Timestamp and bot/timestamp indexes serve time-ordered and agent/user queries.
    CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_jid_timestamp ON messages(chat_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_jid_bot_timestamp ON messages(chat_jid, is_bot_message, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(chat_jid, thread_id);

    -- FTS5 virtual table for full-text search over message content.
    -- Kept in sync via insert/delete/update triggers below.
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      chat_jid UNINDEXED,
      sender UNINDEXED,
      sender_name UNINDEXED,
      timestamp UNINDEXED,
      is_bot_message UNINDEXED,
      content='messages',
      content_rowid='rowid'
    );

    -- Trigger: populate FTS on message insert.
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES (new.rowid, new.content, new.chat_jid, new.sender, new.sender_name, new.timestamp, new.is_bot_message);
    END;

    -- Trigger: remove FTS entry on message delete.
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES ('delete', old.rowid, old.content, old.chat_jid, old.sender, old.sender_name, old.timestamp, old.is_bot_message);
    END;

    -- Trigger: update FTS entry on message update (delete old + insert new).
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES ('delete', old.rowid, old.content, old.chat_jid, old.sender, old.sender_name, old.timestamp, old.is_bot_message);
      INSERT INTO messages_fts(rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES (new.rowid, new.content, new.chat_jid, new.sender, new.sender_name, new.timestamp, new.is_bot_message);
    END;

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      thumbnail BLOB,
      metadata TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_media_created_at ON media(created_at);

    CREATE TABLE IF NOT EXISTS link_preview_image_cache (
      source_url TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL UNIQUE,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE INDEX IF NOT EXISTS idx_link_preview_image_cache_expires_at ON link_preview_image_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_link_preview_image_cache_last_used_at ON link_preview_image_cache(last_used_at);

    -- Join table linking message rows to their media attachments.
    CREATE TABLE IF NOT EXISTS message_media (
      message_rowid INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (message_rowid, media_id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_media_media_id ON message_media(media_id);

    CREATE TABLE IF NOT EXISTS thinking_content (
      message_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      lines INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      truncated INTEGER NOT NULL DEFAULT 0,
      -- Use ISO 8601 with millisecond precision and trailing Z so created_at
      -- is lexicographically comparable to messages.timestamp (which is also
      -- ISO Z). Old rows from before this change keep their sqlite-default
      -- 'YYYY-MM-DD HH:MM:SS' format — those won't sort correctly against
      -- messages.timestamp but no query currently makes that comparison.
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    -- Index on created_at lets retention/purge queries (e.g. DELETE WHERE
    -- created_at < cutoff) skip the full table scan once row counts grow.
    CREATE INDEX IF NOT EXISTS idx_thinking_content_created_at
      ON thinking_content(created_at);

    CREATE TABLE IF NOT EXISTS tool_outputs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source TEXT,
      size_bytes INTEGER,
      line_count INTEGER,
      summary TEXT,
      path TEXT,
      owner_user_id TEXT,
      root_branch_id TEXT,
      source_branch_id TEXT,
      chat_jid TEXT,
      execution_kind TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_created_at ON tool_outputs(created_at);

    -- FTS5 index for searching tool output content by text.
    CREATE VIRTUAL TABLE IF NOT EXISTS tool_outputs_fts USING fts5(
      content,
      output_id UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT,
      task_kind TEXT NOT NULL DEFAULT 'agent',
      command TEXT,
      cwd TEXT,
      timeout_sec INTEGER,
      notify_on_complete INTEGER NOT NULL DEFAULT 1,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created_at ON scheduled_tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_last_run ON scheduled_tasks(last_run);

    CREATE TABLE IF NOT EXISTS ssh_configs (
      chat_jid TEXT PRIMARY KEY,
      ssh_target TEXT NOT NULL,
      ssh_port INTEGER NOT NULL DEFAULT 22,
      private_key_keychain TEXT NOT NULL,
      known_hosts_keychain TEXT,
      strict_host_key_checking TEXT NOT NULL DEFAULT 'yes',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_ssh_configs_updated_at ON ssh_configs(updated_at);

    CREATE TABLE IF NOT EXISTS proxmox_configs (
      chat_jid TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      api_token_keychain TEXT NOT NULL,
      allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_proxmox_configs_updated_at ON proxmox_configs(updated_at);

    CREATE TABLE IF NOT EXISTS portainer_configs (
      chat_jid TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      api_token_keychain TEXT NOT NULL,
      allow_insecure_tls INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_portainer_configs_updated_at ON portainer_configs(updated_at);

    CREATE TABLE IF NOT EXISTS extension_kv (
      extension_id TEXT NOT NULL,
      scope        TEXT NOT NULL DEFAULT 'chat',
      scope_key    TEXT NOT NULL DEFAULT '',
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (extension_id, scope, scope_key, key)
    );
    CREATE INDEX IF NOT EXISTS idx_extension_kv_ext_scope ON extension_kv(extension_id, scope, scope_key);
    CREATE INDEX IF NOT EXISTS idx_extension_kv_updated ON extension_kv(updated_at);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    -- Simple key-value store for the router's per-chat cursor positions.
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      run_at TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      cache_read_reported INTEGER,
      cache_write_reported INTEGER,
      total_tokens INTEGER DEFAULT 0,
      cost_input REAL DEFAULT 0,
      cost_output REAL DEFAULT 0,
      cost_cache_read REAL DEFAULT 0,
      cost_cache_write REAL DEFAULT 0,
      cost_total REAL DEFAULT 0,
      provider_cost_total REAL,
      catalogue_cost_total REAL,
      cost_provenance TEXT,
      model TEXT,
      response_model TEXT,
      provider TEXT,
      api TEXT,
      usage_source TEXT DEFAULT 'assistant',
      turns INTEGER DEFAULT 0,
      work_id TEXT,
      invocation_id TEXT,
      usage_event_id TEXT,
      api_equivalent_cost_microusd INTEGER,
      api_equivalent_cost_known INTEGER,
      valuation_provenance TEXT,
      api_equivalent_known_subtotal_microusd INTEGER,
      api_equivalent_unknown_categories TEXT,
      pricing_currency TEXT,
      pricing_source TEXT,
      pricing_version TEXT,
      pricing_context_tier TEXT,
      pricing_cache_fallbacks TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat_jid ON token_usage(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_token_usage_run_at ON token_usage(run_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat_jid_run_at ON token_usage(chat_jid, run_at);

    CREATE TABLE IF NOT EXISTS compaction_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id TEXT NOT NULL UNIQUE,
      recorded_at TEXT NOT NULL,
      trigger TEXT NOT NULL,
      method TEXT NOT NULL,
      execution TEXT NOT NULL,
      outcome TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      timeout_stage TEXT,
      input_tokens INTEGER,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      deterministic_duration_ms INTEGER,
      time_to_first_token_ms INTEGER,
      provider_generation_ms INTEGER,
      provider_request_count INTEGER NOT NULL DEFAULT 0,
      processed_chunk_count INTEGER,
      total_chunk_count INTEGER,
      settlement_timed_out INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_compaction_telemetry_recorded_at ON compaction_telemetry(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_compaction_telemetry_model ON compaction_telemetry(provider, model, recorded_at);

    -- Encrypted credential storage for the keychain (secure/keychain.ts).
    CREATE TABLE IF NOT EXISTS keychain_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      ciphertext BLOB NOT NULL,
      nonce BLOB NOT NULL,
      salt BLOB NOT NULL,
      kdf TEXT NOT NULL,
      kdf_iterations INTEGER NOT NULL,
      user_note TEXT NOT NULL DEFAULT '',
      agent_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_keychain_entries_type ON keychain_entries(type);

    -- WebAuthn passkey credentials and enrolment tokens.
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_rp_id ON webauthn_credentials(rp_id);

    CREATE TABLE IF NOT EXISTS webauthn_enrollments (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_enrollments_expires_at ON webauthn_enrollments(expires_at);

    -- Web auth sessions (TOTP + passkey). Stored for persistence across restarts.
    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      auth_method TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at ON web_sessions(expires_at);

    -- File metadata cache for workspace-search.ts full-text indexing.
    CREATE TABLE IF NOT EXISTS workspace_files (
      path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_files_indexed_at ON workspace_files(indexed_at);

    -- Persisted lifecycle snapshot for workspace FTS indexing by scope.
    CREATE TABLE IF NOT EXISTS workspace_index_status (
      scope TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      last_indexed_at TEXT,
      last_error TEXT,
      indexed_file_count INTEGER NOT NULL DEFAULT 0,
      roots_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- FTS5 index over workspace file contents for fast grep-like search.
    CREATE VIRTUAL TABLE IF NOT EXISTS workspace_fts USING fts5(
      content,
      path UNINDEXED,
      mtime_ms UNINDEXED,
      size_bytes UNINDEXED
    );
  `);
}

/**
 * Add columns that were introduced after the initial schema.
 * Safe to call repeatedly – skips columns that already exist.
 * Handles the `content_blocks`, `link_previews`, and `thread_id` columns
 * added for the web channel's rich-message support.
 */
function ensureMessageColumns(database: Database): void {
  ensureLegacyColumns(database, "messages", [
    { name: "content_blocks", type: "TEXT" },
    { name: "link_previews", type: "TEXT" },
    { name: "screen_hint", type: "TEXT" },
    { name: "thread_id", type: "INTEGER" },
    { name: "is_terminal_agent_reply", type: "INTEGER", defaultSql: "0" },
    { name: "is_steering_message", type: "INTEGER", defaultSql: "0" },
    { name: "annotations", type: "TEXT" },
  ]);
}

/**
 * One-time FTS rebuild for databases created before the FTS triggers existed.
 * Uses PRAGMA user_version as a migration marker so it only runs once.
 */
function ensureFts(database: Database): void {
  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const version = typeof row?.user_version === "number" ? row.user_version : 0;
  if (version >= 1) return;
  database.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild');");
  database.exec("PRAGMA user_version = 1;");
}

/**
 * Ensure the `model` column exists on `scheduled_tasks` (added in a later
 * version to allow per-task model overrides).
 */
function ensureKeychainNoteColumns(database: Database): void {
  ensureLegacyColumns(database, "keychain_entries", [
    { name: "user_note", type: "TEXT", notNull: true, defaultSql: "''" },
    { name: "agent_note", type: "TEXT", notNull: true, defaultSql: "''" },
  ]);
}

// These historical columns have presence-only compatibility contracts (some
// released schemas differ in nullability). Keep the stricter selected-column
// bridge separate. The schema transaction owns the writer: ALTER errors are
// failures, not evidence of a concurrent migration to suppress.
function addMissingLegacyColumns(database: Database, table: 'token_usage' | 'scheduled_tasks' | 'thinking_content',
  columns: ReadonlyArray<readonly [string, string]>): void {
  const existing = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function ensureTokenUsageColumns(database: Database): void {
  addMissingLegacyColumns(database, 'token_usage', [
    ['response_model', 'TEXT'],
    ['reasoning_tokens', 'INTEGER DEFAULT 0'],
    ['usage_source', "TEXT DEFAULT 'assistant'"],
    ['cache_read_reported', 'INTEGER'],
    ['cache_write_reported', 'INTEGER'],
    ['provider_cost_total', 'REAL'],
    ['catalogue_cost_total', 'REAL'],
    ['cost_provenance', 'TEXT'],
    ['work_id', 'TEXT'],
    ['invocation_id', 'TEXT'],
    ['usage_event_id', 'TEXT'],
    ['api_equivalent_cost_microusd', 'INTEGER'],
    ['api_equivalent_cost_known', 'INTEGER'],
    ['valuation_provenance', 'TEXT'],
    ['api_equivalent_known_subtotal_microusd', 'INTEGER'],
    ['api_equivalent_unknown_categories', 'TEXT'],
    ['pricing_currency', 'TEXT'],
    ['pricing_source', 'TEXT'],
    ['pricing_version', 'TEXT'],
    ['pricing_context_tier', 'TEXT'],
    ['pricing_cache_fallbacks', 'TEXT'],
  ]);
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_token_usage_usage_event_id ON token_usage(usage_event_id) WHERE usage_event_id IS NOT NULL");
}

function ensureScheduledTaskColumns(database: Database): void {
  addMissingLegacyColumns(database, 'scheduled_tasks', [
    ['model', 'TEXT'],
    ['task_kind', "TEXT DEFAULT 'agent'"],
    ['command', 'TEXT'],
    ['cwd', 'TEXT'],
    ['timeout_sec', 'INTEGER'],
    ['notify_on_complete', 'INTEGER NOT NULL DEFAULT 1'],
    ['revision', 'INTEGER NOT NULL DEFAULT 1'],
  ]);
}

function ensureChatBranchConstraints(database: Database): void {
  const tableRow = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_branches'"
  ).get() as { sql?: string | null } | undefined;
  const tableSql = String(tableRow?.sql || "");
  const hasInlineAgentNameUnique = /agent_name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql);

  if (hasInlineAgentNameUnique) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE chat_branches__migrated (
          branch_id TEXT PRIMARY KEY,
          chat_jid TEXT NOT NULL UNIQUE,
          root_chat_jid TEXT NOT NULL,
          parent_branch_id TEXT,
          agent_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY (chat_jid) REFERENCES chats(jid)
        );
        INSERT INTO chat_branches__migrated (
          branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
        )
        SELECT
          branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
        FROM chat_branches;
        DROP TABLE chat_branches;
        ALTER TABLE chat_branches__migrated RENAME TO chat_branches;
      `);
    })();
  }

  initializeSessionHandleSchema(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_branches_root_chat_jid ON chat_branches(root_chat_jid);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_parent_branch_id ON chat_branches(parent_branch_id);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_archived_at ON chat_branches(archived_at);
  `);
}

/**
 * One-time migration: seed chat_cursors from the old lastAgentTimestamp JSON
 * blob stored in router_state under key "last_agent_timestamp_web".
 * Runs inside a transaction so all rows land together or not at all.
 * Safe to call on every startup – exits immediately if the table already
 * has rows (migration already ran).
 */
function migrateChatCursors(database: Database): void {
  const count = (
    database.prepare("SELECT COUNT(*) as n FROM chat_cursors").get() as { n: number }
  ).n;
  if (count > 0) return;

  const row = database
    .prepare("SELECT value FROM router_state WHERE key = ?")
    .get("last_agent_timestamp_web") as { value: string } | undefined;
  if (!row) return;

  try {
    const state = JSON.parse(row.value);
    const timestamps: Record<string, string> = state?.lastAgentTimestamp ?? {};
    const insert = database.prepare(
      "INSERT OR IGNORE INTO chat_cursors (chat_jid, cursor_ts) VALUES (?, ?)"
    );
    database.transaction(() => {
      for (const [jid, ts] of Object.entries(timestamps)) {
        if (typeof ts === "string" && ts) insert.run(jid, ts);
      }
    })();
  } catch (error) {
    log.warn("Failed to migrate legacy chat cursors; starting with empty cursors", {
      operation: "migrate_chat_cursors",
      err: error,
    });
  }
}

/**
 * Open (or create) the SQLite database and run all schema migrations.
 * Call once at startup before any other db/* function. Reuse verifies binding
 * and liveness without reconfiguring or migrating; explicit offline schema
 * work uses initializeDatabaseSchema on a caller-owned idle handle.
 */
export function initDatabase(paths: Readonly<RuntimeConfigPaths> = getRuntimeConfigPaths()): void {
  openDatabase(paths, "root");
}

/** Borrow ready state or open an existing index store; never acquire core migration ownership. */
export function openWorkspaceIndexDatabase(paths: Readonly<RuntimeConfigPaths> = getRuntimeConfigPaths(),
  assertCurrent: () => void = () => {}, expectedIdentity?: string): void {
  openDatabase(paths, "index-worker", assertCurrent, expectedIdentity);
}

function assertIndexStore(database: Database): void {
  for (const sql of [
    "SELECT path,mtime_ms,size_bytes,indexed_at FROM main.workspace_files LIMIT 0",
    "SELECT scope,state,last_indexed_at,last_error,indexed_file_count,roots_json,updated_at FROM main.workspace_index_status LIMIT 0",
    "SELECT content,path,mtime_ms,size_bytes FROM main.workspace_fts LIMIT 0",
  ]) database.query(sql).all();
}

function openDatabase(paths: Readonly<RuntimeConfigPaths>, role: "root" | "index-worker",
  assertCurrent: () => void = () => {}, expectedIdentity?: string): void {
  assertCurrent();
  if (cleanupFailure) throw cleanupFailure;
  const useMemory = paths.databasePath === ":memory:";
  const nextMode: "memory" | "file" = useMemory ? "memory" : "file";
  const nextPath = paths.databasePath;
  const nextCacheKey = useMemory
    ? `memory:${JSON.stringify([paths.workspaceDir, paths.storeDir, paths.dataDir])}`
    : nextPath;

  if (shouldBlockLiveDatabaseOpenInTests({ useMemory, nextPath, workspaceDir: paths.workspaceDir })) {
    throw new Error(
      `Refusing to open live database from a test process: ${nextPath}. ` +
      `Set PICLAW_DB_IN_MEMORY=1 or isolate PICLAW_WORKSPACE/PICLAW_STORE, ` +
      `or use the explicit test-only live DB override if this is truly intentional.`
    );
  }

  const isolatedMemoryChange = useMemory && dbPathCache?.startsWith("memory:") === true && isLikelyTestHarnessProcess();
  if (db && dbPathCache !== nextCacheKey && !isolatedMemoryChange) {
    throw Error("Database bootstrap target changed; close the database before selecting another target.");
  }
  if (db && dbPathCache === nextCacheKey) {
    if (role === "root" && dbRole !== "root") throw Error("Index worker connection cannot become a migration owner; close it first.");
    if (expectedIdentity && dbFileIdentity !== expectedIdentity) throw Error("SQLite role database identity changed");
    if (!useMemory) {
      try {
        if (dbFileIdentity !== currentFileIdentity(nextPath)) throw Error("Database file identity changed.");
      } catch (error) {
        const failure = new Error("Database file identity changed.", { cause: error });
        try { closeDatabase({ shrinkMemory: false }); }
        catch (cleanup) { throw new RuntimeStartupCleanupError([failure, cleanup], "Database replacement cleanup uncertain"); }
        throw failure;
      }
    }
    try { db.prepare("SELECT 1;").get(); }
    catch (error) {
      // Only the pinned Bun liveness probe may classify a closed handle.
      if (!(error instanceof RangeError) || error.message !== "Cannot use a closed database") throw error;
      closeDatabase({ shrinkMemory: false });
    }
    if (db) {
      if (role === "index-worker") assertIndexStore(db);
      assertCurrent(); return;
    }
  }
  if (role === "index-worker" && useMemory) throw Error("Index worker requires an existing file-backed database.");
  closeDatabase({ shrinkMemory: false });
  if (role === "root" && !useMemory) fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  let database: Database | undefined, releaseCheckpoint: (() => void) | undefined;
  try {
    database = openSqliteRole(nextPath, { role, create: role === "root", assertOwner: assertCurrent, expectedIdentity,
      expectedPath: role === "index-worker" ? nextPath : undefined });
    const identity = useMemory ? null : currentFileIdentity(nextPath);
    if (role === "root") {
      initializeDatabaseSchema(database);
      if (!useMemory) releaseCheckpoint = registerSqliteCheckpoint(database, nextPath);
    } else assertIndexStore(database);
    if (!useMemory && identity !== currentFileIdentity(nextPath)) throw Error("Database file identity changed.");
    assertCurrent();
    log.info("Opened database connection", {
      operation: "init_database.open", mode: nextMode, role, path: nextPath, reusedConnection: false,
    });
    // Readiness is published together, only after all owned startup work succeeds.
    db = database; dbPathCache = nextCacheKey; dbFileIdentity = identity;
    stopCheckpoint = releaseCheckpoint; dbRole = role; dbInstance += 1;
  } catch (error) {
    const cleanup = database ? disposeDatabase(database, releaseCheckpoint) : [];
    if (cleanup.length) throw cleanupFailure = new RuntimeStartupCleanupError([error, ...cleanup], "Database initialization cleanup uncertain");
    if (!database && error instanceof RuntimeStartupCleanupError) cleanupFailure = error;
    throw error;
  }
}

/** Explicit offline schema boundary for an idle, caller-owned handle; no publication or maintenance. */
export function initializeDatabaseSchema(database: Database): void {
  if (database.inTransaction) throw Error("Database schema initialization requires an idle connection.");
  const foreignKeys = (database.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
  const failures: unknown[] = [];
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    if ((database.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1)
      throw Error("Database schema requires foreign_keys ON.");
    database.transaction(() => initializeSchema(database)).immediate();
  } catch (error) { failures.push(error); }
  if (!foreignKeys) {
    try { database.exec("PRAGMA foreign_keys = OFF;"); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new RuntimeStartupCleanupError(failures, "Database schema and policy restoration failed");
}

/** One ordered schema batch; the explicit schema boundary owns its transaction. */
function initializeSchema(database: Database): void {
  migrateLegacyConfigTables(database);
  createSchema(database);
  retireAttachmentRowidIndex(database);
  ensureChatBranchConstraints(database);
  initializeChatProjects(database);
  ensureMessageColumns(database);
  ensureKeychainNoteColumns(database);
  ensureTokenUsageColumns(database);
  initializeBudgetLimitsSchema(database);
  initializeAddonOperationsSchema(database);
  ensureScheduledTaskColumns(database);
  installScheduledRunCompositionSchema(database);
  initializeScheduledHistorySchema(database);
  migrateScheduledTaskAuthorities(database);
  ensureLegacyColumns(database, "web_sessions", [
    { name: "auth_method", type: "TEXT" },
    { name: "session_id", type: "TEXT" },
  ]);
  const sessionIdentitySql = "CREATE UNIQUE INDEX IF NOT EXISTS idx_web_sessions_session_id ON web_sessions(session_id) WHERE session_id IS NOT NULL";
  applyOwnedMigrations(database, [
    { owner: "host.web-sessions", id: "session-identity-index-v1", order: 1, sql: sessionIdentitySql },
  ]);
  const sessionIdentity = database.prepare("SELECT sql FROM main.sqlite_schema WHERE type='index' AND tbl_name='web_sessions' AND name='idx_web_sessions_session_id'")
    .get() as { sql: string } | null;
  if (sessionIdentity?.sql.replace(/\s+/g, " ").trim().toUpperCase() !== sessionIdentitySql.replace(" IF NOT EXISTS", "").toUpperCase()) {
    throw Error("Web session identity index postcondition failed.");
  }
  ensureFts(database);
  initializeChatCursorStorage(database);
  migrateChatCursors(database);
  dropChatBranchDisplayName(database);
  dropObsoleteRemoteInteropSchema(database);
  ensureMediaCompression(database);
  ensureThinkingContentDuration(database);
  initializeAccessSchema(database);
  initializeSessionOwnershipSchema(database);
  initializeToolOutputOwnership(database);
  initializeOwnedForkSchema(database);
  initializeAuthLabelsSchema(database);
  initializePickerPins(database);
}

/** Add duration_ms column to thinking_content for databases created before it was introduced. */
function ensureThinkingContentDuration(database: Database): void {
  addMissingLegacyColumns(database, 'thinking_content', [['duration_ms', 'INTEGER NOT NULL DEFAULT 0']]);
}

const REMOTE_INTEROP_CLEANUP_MIGRATION = "drop-core-remote-interop-v1";

/** Drop obsolete core-owned remote interop state once, transactionally. */
export function dropObsoleteRemoteInteropSchema(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS core_schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = database.prepare("SELECT 1 FROM core_schema_migrations WHERE name = ?").get(REMOTE_INTEROP_CLEANUP_MIGRATION);
  if (applied) return;
  database.transaction(() => {
    for (const table of [
      "remote_result_callbacks",
      "remote_requests",
      "remote_pair_outbound_requests",
      "remote_pair_requests",
      "remote_audit_logs",
      "remote_peers",
    ]) database.exec(`DROP TABLE IF EXISTS ${table}`);
    database.prepare("INSERT INTO core_schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(REMOTE_INTEROP_CLEANUP_MIGRATION, new Date().toISOString());
  }).immediate();
}

/**
 * One-time migration: compress existing uncompressed text-based media.
 * Uses PRAGMA user_version >= 2 as a migration marker.
 */
function ensureMediaCompression(database: Database): void {
  const result = migrateMediaCompression(database);
  if (result.status === "already_complete") return;
  const fields = { operation: "migration.media_compression", ...result };
  if (result.status === "complete") {
    if (result.compressed > 0) log.info("Media compression migration completed", fields);
  } else log.warn("Media compression migration incomplete; retained marker permits retry", fields);
}

/**
 * One-time migration: drop the legacy display_name column from chat_branches.
 * Branch identity is now defined entirely by agent_name.
 * Safe to re-run: checks column existence via PRAGMA table_info first.
 */
function dropChatBranchDisplayName(database: Database): void {
  const cols = database.prepare("PRAGMA table_info(chat_branches)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "display_name")) return;
  database.exec("ALTER TABLE chat_branches DROP COLUMN display_name");
}

/**
 * Return the singleton Database instance.
 * Throws if called before initDatabase().
 *
 * Used by every db/* module to obtain the shared connection.
 */
export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

/** Create a verified online snapshot of the initialized file-backed messages database. */
export function backupDatabase(destinationPath: string): SqliteBackupManifest {
  if (!db || !dbFileIdentity || !dbPathCache) {
    throw new Error("Database backup requires an initialized file-backed database.");
  }
  return createVerifiedSqliteBackup(db, dbPathCache, destinationPath);
}

function disposeDatabase(database: Database, releaseCheckpoint?: () => void): unknown[] {
  const failures: unknown[] = [];
  try { releaseCheckpoint?.(); } catch (error) { failures.push(error); }
  try { database.close(true); } catch (error) { failures.push(error); }
  return failures;
}

/** Certifying close releases statements/cache; the legacy shrinkMemory option needs no SQL. */
export function closeDatabase(_options?: { shrinkMemory?: boolean }): void {
  if (!db) return;

  const database = db, releaseCheckpoint = stopCheckpoint;
  // Unpublish before cleanup; a throwing disposer cannot leave a usable singleton.
  db = null; dbPathCache = null; dbFileIdentity = null; stopCheckpoint = undefined; dbRole = undefined;

  const failures = disposeDatabase(database, releaseCheckpoint);
  if (failures.length) throw cleanupFailure = new RuntimeStartupCleanupError(failures, "Database close cleanup uncertain");
}

/**
 * A3: Release SQLite's internal page-cache allocations back to the OS.
 * Safe to call periodically (e.g. after session eviction) without closing the DB.
 */
export function shrinkDatabaseMemory(): void {
  if (!db) return;
  try {
    db.exec("PRAGMA shrink_memory;");
  } catch (e) { void e; /* best-effort */ }
}

/**
 * D3: Reclaim freelist pages without a full VACUUM.
 * Only useful when auto_vacuum = INCREMENTAL (mode 2). Reclaims up to `maxPages`
 * freelist pages, shrinking the DB file. Safe to call on startup after bulk deletes.
 *
 * @returns Number of freelist pages remaining (0 = fully reclaimed).
 */
export function reclaimFreelistPages(maxPages = 1000): number {
  if (!db) return 0;
  try {
    db.exec(`PRAGMA incremental_vacuum(${maxPages});`);
    const row = db.prepare("PRAGMA freelist_count").get() as { freelist_count: number } | undefined;
    return row?.freelist_count ?? 0;
  } catch (e) { void e; return 0; }
}
