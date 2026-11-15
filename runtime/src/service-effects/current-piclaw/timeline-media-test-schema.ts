import type Database from "bun:sqlite";

/** Private WP-1A test schema. Never register this with Piclaw migrations/startup. */
export function installTimelineMediaAdapterTestSchema(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S03/EF-S04 requires SQLite foreign-key enforcement.");
  }
  const install = () => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      screen_hint TEXT,
      content_blocks TEXT,
      link_previews TEXT,
      annotations TEXT,
      thread_id INTEGER,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      is_terminal_agent_reply INTEGER DEFAULT 0,
      is_steering_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
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
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES (new.rowid, new.content, new.chat_jid, new.sender, new.sender_name, new.timestamp, new.is_bot_message);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, chat_jid, sender, sender_name, timestamp, is_bot_message)
      VALUES ('delete', old.rowid, old.content, old.chat_jid, old.sender, old.sender_name, old.timestamp, old.is_bot_message);
    END;
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
    CREATE TABLE IF NOT EXISTS message_media (
      message_rowid INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (message_rowid, media_id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE IF NOT EXISTS message_inline_media (
      message_rowid INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (message_rowid, kind, ref),
      FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS service_effect_timeline_writes (
      idempotency_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      write_type TEXT NOT NULL CHECK(write_type IN ('draft', 'notice')),
      operation_id TEXT,
      draft_kind TEXT,
      revision INTEGER,
      notice_kind TEXT,
      source_id TEXT,
      message_rowid INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      written_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS service_effect_draft_revision
      ON service_effect_timeline_writes(operation_id, draft_kind, revision)
      WHERE write_type = 'draft';
    CREATE UNIQUE INDEX IF NOT EXISTS service_effect_notice_source
      ON service_effect_timeline_writes(notice_kind, source_id)
      WHERE write_type = 'notice';

    CREATE TABLE IF NOT EXISTS service_effect_media_upload_history (
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      upload_id TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      data_ref TEXT NOT NULL,
      thumbnail_ref TEXT,
      metadata_ref TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_effect_media_uploads (
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      upload_id TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      data_ref TEXT NOT NULL,
      thumbnail_ref TEXT,
      metadata_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE IF NOT EXISTS service_effect_operation_media (
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      PRIMARY KEY (operation_id, media_id, role),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE IF NOT EXISTS service_effect_outbox_media_refs (
      outbox_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      PRIMARY KEY (outbox_id, media_id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    CREATE TABLE IF NOT EXISTS service_effect_media_deletions (
      idempotency_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      expected_sha256 TEXT NOT NULL,
      deleted INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS service_effect_timeline_operation
      ON service_effect_timeline_writes(operation_id, draft_kind, revision);
    CREATE INDEX IF NOT EXISTS service_effect_operation_media_id
      ON service_effect_operation_media(media_id);
    CREATE INDEX IF NOT EXISTS service_effect_outbox_media_id
      ON service_effect_outbox_media_refs(media_id);
  `);
    const fts = database
      .query("SELECT type,sql FROM sqlite_master WHERE name='messages_fts'")
      .get() as { type?: unknown; sql?: unknown } | undefined;
    if (
      fts?.type !== "table" ||
      typeof fts.sql !== "string" ||
      !/CREATE VIRTUAL TABLE[\s\S]*USING fts5/i.test(fts.sql)
    ) {
      throw new Error("EF-S03 requires the supported messages_fts virtual table.");
    }
  };
  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}
