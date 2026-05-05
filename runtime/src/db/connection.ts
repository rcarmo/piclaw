/**
 * db/connection.ts – SQLite database initialisation and schema management.
 *
 * Opens (or creates) the main SQLite database at `<STORE_DIR>/messages.db`,
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
import fs from "fs";
import path from "path";

import { STORE_DIR, WORKSPACE_DIR } from "../core/config.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { recompressExistingMedia } from "./media-recompress.js";

const log = createLogger("db.connection");

/** Singleton database handle; set by initDatabase(), accessed via getDb(). */
let db: Database | null = null;
let dbMode: "memory" | "file" | null = null;
/** Cache key for the currently-open database target or in-memory test identity. */
let dbPathCache: string | null = null;

const CANONICAL_WORKSPACE_DIR = path.resolve("/workspace");
const CANONICAL_LIVE_DB_PATH = path.join(CANONICAL_WORKSPACE_DIR, ".piclaw", "store", "messages.db");

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
    allowLiveDbInTests = process.env.PICLAW_ALLOW_LIVE_DB_IN_TESTS === "1" || process.env.PICLAW_ALLOW_LIVE_DB_IN_TESTS === "true",
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
 *   - messages_fts – FTS5 index over message content for full-text search
 *   - media – binary file storage for attachments
 *   - message_media – join table linking messages to media records
 *   - tool_outputs – large tool invocation results (bash output, file reads)
 *   - tool_outputs_fts – FTS5 index for searching tool output content
 *   - scheduled_tasks – cron/interval/once task definitions
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_branches_agent_name_active_unique
      ON chat_branches(agent_name)
      WHERE archived_at IS NULL;
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
    -- Indexes for common timeline queries and thread operations.
    -- idx_messages_chat_jid_timestamp covers both chat and time ordering.
    -- idx_messages_chat_jid_bot_timestamp is used for agent/user filters.
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
    CREATE INDEX IF NOT EXISTS idx_message_media_message_rowid ON message_media(message_rowid);
    CREATE INDEX IF NOT EXISTS idx_message_media_media_id ON message_media(media_id);

    CREATE TABLE IF NOT EXISTS tool_outputs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source TEXT,
      size_bytes INTEGER,
      line_count INTEGER,
      summary TEXT,
      path TEXT
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
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
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

    -- Remote interop peer registry.
    CREATE TABLE IF NOT EXISTS remote_peers (
      instance_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'mediated',
      profile TEXT NOT NULL DEFAULT 'restricted',
      trust_epoch INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT,
      blocked_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_remote_peers_status ON remote_peers(status);

    -- Pending inbound pairing requests.
    CREATE TABLE IF NOT EXISTS remote_pair_requests (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      display_name TEXT,
      callback_url TEXT,
      protocol_version TEXT,
      nonce TEXT,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_remote_pair_requests_instance ON remote_pair_requests(instance_id);
    CREATE INDEX IF NOT EXISTS idx_remote_pair_requests_status ON remote_pair_requests(status);

    -- Remote request ledger (proposals, executes).
    CREATE TABLE IF NOT EXISTS remote_requests (
      id TEXT PRIMARY KEY,
      peer_instance_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT,
      created_at TEXT NOT NULL,
      decision TEXT,
      remote_mode TEXT,
      error TEXT,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_remote_requests_peer ON remote_requests(peer_instance_id, created_at);

    -- Remote audit logs for interop requests.
    CREATE TABLE IF NOT EXISTS remote_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_instance_id TEXT,
      endpoint TEXT NOT NULL,
      decision TEXT,
      status TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remote_audit_created_at ON remote_audit_logs(created_at);

    -- Received result callbacks (requesting side) for mediated proposals.
    CREATE TABLE IF NOT EXISTS remote_result_callbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negotiation_id TEXT NOT NULL,
      peer_instance_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      result TEXT,
      reason TEXT,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remote_result_callbacks_neg ON remote_result_callbacks(negotiation_id);

    -- Pending outbound pairing requests (initiator side).
    CREATE TABLE IF NOT EXISTS remote_pair_outbound_requests (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      base_url TEXT NOT NULL,
      nonce TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remote_pair_outbound_instance ON remote_pair_outbound_requests(instance_id);
    CREATE INDEX IF NOT EXISTS idx_remote_pair_outbound_status ON remote_pair_outbound_requests(status);

    -- Simple key-value store for the router's per-chat cursor positions.
    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Per-chat cursor, preflight, and inflight-run tracking.
    -- cursor_ts        : ISO timestamp of the last fully-processed message.
    -- preflight_*      : set while pre-prompt work (like compaction) is running
    --                    before the user message is consumed into inflight state.
    --                    If still set on startup the message remains pending and
    --                    the marker can be cleared without cursor rollback.
    -- inflight_*       : set atomically with the cursor advance immediately
    --                    before prompt execution begins; cleared by endChatRun /
    --                    endChatRunWithError after the run. If still set on
    --                    startup the process died mid-run and the cursor must be
    --                    rolled back to inflight_prev_ts.
    -- failed_*         : set atomically by endChatRunWithError when a run errors;
    --                    cleared atomically by endChatRun on success, or by
    --                    clearFailedRun on model switch. Because these columns
    --                    share a row with inflight_*, every completion path is
    --                    a single UPDATE with no intermediate inconsistent state.
    -- compaction_active_* : durable marker for an in-flight compaction phase.
    --                    If the process is killed by the external watchdog
    --                    during recovery compaction, startup recovery can mark
    --                    the chat as failed/backed off instead of replaying the
    --                    same compaction loop.
    CREATE TABLE IF NOT EXISTS chat_cursors (
      chat_jid             TEXT PRIMARY KEY,
      cursor_ts            TEXT NOT NULL DEFAULT '',
      preflight_prev_ts    TEXT,
      preflight_message_id TEXT,
      preflight_started_at TEXT,
      inflight_prev_ts     TEXT,
      inflight_message_id  TEXT,
      inflight_started_at  TEXT,
      failed_prev_ts       TEXT,
      failed_ts            TEXT,
      failed_message_id    TEXT,
      failed_thread_root   INTEGER,
      failed_created_at    TEXT,
      queued_followups_json TEXT,
      compaction_active_started_at TEXT,
      compaction_active_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      run_at TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_input REAL DEFAULT 0,
      cost_output REAL DEFAULT 0,
      cost_cache_read REAL DEFAULT 0,
      cost_cache_write REAL DEFAULT 0,
      cost_total REAL DEFAULT 0,
      model TEXT,
      response_model TEXT,
      provider TEXT,
      api TEXT,
      turns INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat_jid ON token_usage(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_token_usage_run_at ON token_usage(run_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_chat_jid_run_at ON token_usage(chat_jid, run_at);

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
  const columns = database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  const ensureColumn = (name: string, type = "TEXT") => {
    if (existing.has(name)) return;
    try {
      database.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
    } catch (err) {
      debugSuppressedError(log, "Message-column migration raced an already-updated schema state.", err, {
        operation: "db.ensure_message_columns.add_column",
        name,
        type,
      });
    }
  };
  ensureColumn("content_blocks");
  ensureColumn("link_previews");
  ensureColumn("screen_hint");
  ensureColumn("thread_id", "INTEGER");
  ensureColumn("is_terminal_agent_reply", "INTEGER DEFAULT 0");
  ensureColumn("is_steering_message", "INTEGER DEFAULT 0");
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
  const columns = database.prepare("PRAGMA table_info(keychain_entries)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  const ensureColumn = (name: string) => {
    if (existing.has(name)) return;
    try {
      database.exec(`ALTER TABLE keychain_entries ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
      debugSuppressedError(log, "Keychain-note column migration raced an already-updated schema state.", err, {
        operation: "db.ensure_keychain_note_columns.add_column",
        name,
      });
    }
  };
  ensureColumn("user_note");
  ensureColumn("agent_note");
}

function ensureTokenUsageColumns(database: Database): void {
  const columns = database.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  if (existing.has("response_model")) return;
  try {
    database.exec("ALTER TABLE token_usage ADD COLUMN response_model TEXT");
  } catch (err) {
    debugSuppressedError(log, "Token-usage response_model migration raced an already-updated schema state.", err, {
      operation: "db.ensure_token_usage_columns.add_response_model",
    });
  }
}

function ensureScheduledTaskColumns(database: Database): void {
  const columns = database.prepare("PRAGMA table_info(scheduled_tasks)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  const ensureColumn = (name: string, type: string) => {
    if (existing.has(name)) return;
    try {
      database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN ${name} ${type}`);
    } catch (err) {
      debugSuppressedError(log, "Scheduled-task column migration raced an already-updated schema state.", err, {
        operation: "db.ensure_scheduled_task_columns.add_column",
        name,
        type,
      });
    }
  };

  ensureColumn("model", "TEXT");
  ensureColumn("task_kind", "TEXT DEFAULT 'agent'");
  ensureColumn("command", "TEXT");
  ensureColumn("cwd", "TEXT");
  ensureColumn("timeout_sec", "INTEGER");
}

function ensureWebSessionColumns(database: Database): void {
  const columns = database.prepare("PRAGMA table_info(web_sessions)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((col) => col.name));
  if (!existing.has("auth_method")) {
    try {
      database.exec("ALTER TABLE web_sessions ADD COLUMN auth_method TEXT");
    } catch (err) {
      debugSuppressedError(log, "Web-session auth_method migration raced an already-updated schema state.", err, {
        operation: "db.ensure_web_session_columns.add_auth_method",
      });
    }
  }
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

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_branches_agent_name_active_unique
      ON chat_branches(agent_name)
      WHERE archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_chat_branches_root_chat_jid ON chat_branches(root_chat_jid);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_parent_branch_id ON chat_branches(parent_branch_id);
    CREATE INDEX IF NOT EXISTS idx_chat_branches_archived_at ON chat_branches(archived_at);
  `);
}

/**
 * Add newer per-chat state columns to chat_cursors for databases created
 * before they were introduced. ALTER TABLE ADD COLUMN is safe to run
 * repeatedly – SQLite ignores the statement if the column already exists
 * (we catch the error).
 */
function ensureChatCursorColumns(database: Database): void {
  const cols = new Set(
    (database.prepare("PRAGMA table_info(chat_cursors)").all() as Array<{ name: string }>)
      .map((r) => r.name)
  );
  const toAdd: Array<[string, string]> = [
    ["preflight_prev_ts",         "TEXT"],
    ["preflight_message_id",      "TEXT"],
    ["preflight_started_at",      "TEXT"],
    ["failed_prev_ts",            "TEXT"],
    ["failed_ts",                 "TEXT"],
    ["failed_message_id",         "TEXT"],
    ["failed_thread_root",        "INTEGER"],
    ["failed_created_at",         "TEXT"],
    ["queued_followups_json",     "TEXT"],
    ["compaction_failure_count",  "INTEGER"],
    ["compaction_last_failed_at", "TEXT"],
    ["compaction_backoff_until",  "TEXT"],
    ["compaction_last_error",     "TEXT"],
    ["compaction_active_started_at", "TEXT"],
    ["compaction_active_reason",     "TEXT"],
  ];
  for (const [col, type] of toAdd) {
    if (!cols.has(col)) {
      try {
        database.exec(`ALTER TABLE chat_cursors ADD COLUMN ${col} ${type}`);
      } catch (err) {
        debugSuppressedError(log, "Chat-cursor migration raced an already-updated schema state.", err, {
          operation: "db.ensure_chat_cursor_columns.add_column",
          column: col,
          type,
        });
      }
    }
  }
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
 * Must be called once at application startup before any other db/* function.
 *
 * Called by index.ts (the application entry point).
 */
export function initDatabase(): void {
  const useMemory =
    process.env.PICLAW_DB_IN_MEMORY === "1" ||
    process.env.PICLAW_DB_IN_MEMORY === "true" ||
    process.env.PICLAW_STORE === ":memory:";
  const nextMode: "memory" | "file" = useMemory ? "memory" : "file";
  const nextPath = useMemory ? ":memory:" : path.join(STORE_DIR, "messages.db");
  const nextCacheKey = useMemory
    ? `memory:${process.env.PICLAW_WORKSPACE ?? ""}:${process.env.PICLAW_STORE ?? ""}:${process.env.PICLAW_DATA ?? ""}`
    : nextPath;

  if (shouldBlockLiveDatabaseOpenInTests({ useMemory, nextPath })) {
    throw new Error(
      `Refusing to open live database from a test process: ${nextPath}. ` +
      `Set PICLAW_DB_IN_MEMORY=1 or isolate PICLAW_WORKSPACE/PICLAW_STORE, ` +
      `or override with PICLAW_ALLOW_LIVE_DB_IN_TESTS=1 if this is truly intentional.`
    );
  }

  let reuse = false;
  if (db && dbMode === nextMode && dbPathCache === nextCacheKey) {
    try {
      db.prepare("SELECT 1;").get();
      reuse = true;
    } catch (err) {
      debugSuppressedError(log, "Detected a stale SQLite handle; reopening the database.", err, {
        operation: "init_database.detect_stale_handle",
        mode: nextMode,
        path: nextPath,
      });
      reuse = false;
    }
  }

  if (!reuse) {
    if (db) {
      try {
        db.close();
      } catch (error) {
        log.warn("Failed to close previous database handle before reinitializing", {
          operation: "init_database.close_previous_handle",
          err: error,
        });
      }
    }

    if (useMemory) {
      db = new Database(":memory:");
    } else {
      fs.mkdirSync(path.dirname(nextPath), { recursive: true });
      db = new Database(nextPath);
    }
    dbMode = nextMode;
    dbPathCache = nextCacheKey;
    log.info("Opened database connection", {
      operation: "init_database.open",
      mode: nextMode,
      path: nextPath,
      reusedConnection: false,
    });
  }

  if (!db) {
    log.error("Database initialization failed", { operation: "init_database" });
    throw new Error("Database initialization failed");
  }

  db.exec(useMemory ? "PRAGMA journal_mode = MEMORY;" : "PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA secure_delete = ON;");
  migrateLegacyConfigTables(db);
  createSchema(db);
  ensureChatBranchConstraints(db);
  ensureMessageColumns(db);
  ensureKeychainNoteColumns(db);
  ensureTokenUsageColumns(db);
  ensureScheduledTaskColumns(db);
  ensureWebSessionColumns(db);
  ensureFts(db);
  ensureChatCursorColumns(db);
  migrateChatCursors(db);
  dropChatBranchDisplayName(db);
  ensureRemotePeerBaseUrl(db);
  ensureOutboundPairRequestsTable(db);
  ensureMediaCompression(db);
}

/**
 * Idempotent migration: ensure the outbound pair requests table exists.
 * Needed for instances that were initialised before this table was added.
 */
function ensureOutboundPairRequestsTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_pair_outbound_requests (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      base_url TEXT NOT NULL,
      nonce TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_pair_outbound_instance ON remote_pair_outbound_requests(instance_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_pair_outbound_status ON remote_pair_outbound_requests(status)`);
}

/**
 * One-time migration: compress existing uncompressed text-based media.
 * Uses PRAGMA user_version >= 2 as a migration marker.
 */
function ensureMediaCompression(database: Database): void {
  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const version = typeof row?.user_version === "number" ? row.user_version : 0;
  if (version >= 2) return;

  try {
    const result = recompressExistingMedia();
    if (result.compressed > 0) {
      log.info("Media compression migration completed", {
        operation: "migration.media_compression",
        scanned: result.scanned,
        compressed: result.compressed,
        savedBytes: result.savedBytes,
        skipped: result.skipped,
        errors: result.errors,
      });
    }
  } catch (err) {
    debugSuppressedError(log, "Media compression migration failed (non-fatal).", err, {
      operation: "migration.media_compression",
    });
  }

  database.exec("PRAGMA user_version = 2;");
}

/**
 * Add nullable base_url column to remote_peers if it doesn't already exist.
 * Required for bidirectional pairing and /unpair routing.
 */
function ensureRemotePeerBaseUrl(database: Database): void {
  const cols = database.prepare("PRAGMA table_info(remote_peers)").all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === "base_url")) return;
  try {
    database.exec("ALTER TABLE remote_peers ADD COLUMN base_url TEXT");
  } catch (err) {
    debugSuppressedError(log, "remote_peers base_url column may already exist.", err, {});
  }
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

export function closeDatabase(options?: { shrinkMemory?: boolean }): void {
  if (!db) return;

  const database = db;
  db = null;
  dbMode = null;
  dbPathCache = null;

  if (options?.shrinkMemory !== false) {
    try {
      database.exec("PRAGMA optimize;");
    } catch (error) {
      debugSuppressedError(log, "Failed to optimize SQLite before closing the database.", error, {
        operation: "close_database.optimize",
      });
    }
    try {
      database.exec("PRAGMA shrink_memory;");
    } catch (error) {
      debugSuppressedError(log, "Failed to shrink SQLite page-cache memory before closing the database.", error, {
        operation: "close_database.shrink_memory",
      });
    }
  }

  try {
    database.close();
  } catch (error) {
    log.warn("Failed to close database handle", {
      operation: "close_database.close",
      err: error,
    });
  }
}
