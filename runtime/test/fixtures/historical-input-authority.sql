-- Original already-native input authority objects from cdc214fcc; fixture only.
CREATE TABLE message_execution_authorities (
    message_rowid INTEGER PRIMARY KEY,
    message_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    thread_id INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id, request_id)
  ) STRICT;
CREATE TABLE message_recovery_authorities (
    id INTEGER PRIMARY KEY,
    message_rowid INTEGER NOT NULL REFERENCES message_execution_authorities(message_rowid),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('retry','skip')),
    failure_created_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id,request_id)
  ) STRICT;
CREATE TABLE migration_input_dismissals (
    id INTEGER PRIMARY KEY, message_rowid INTEGER NOT NULL UNIQUE REFERENCES migration_input_holds(message_rowid),
    owner_user_id TEXT NOT NULL REFERENCES users(id), login_session_id TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(owner_user_id,request_id)
  ) STRICT;
CREATE TABLE migration_input_holds (
    message_rowid INTEGER PRIMARY KEY, message_id TEXT NOT NULL, chat_jid TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id), message_timestamp TEXT NOT NULL,
    content_hash TEXT NOT NULL, source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
CREATE INDEX idx_message_recovery_latest ON message_recovery_authorities(message_rowid,id);
CREATE TRIGGER message_execution_authority_immutable
    BEFORE UPDATE ON message_execution_authorities
    BEGIN SELECT RAISE(ABORT, 'Message execution authority is immutable'); END;
CREATE TRIGGER message_recovery_authority_immutable
    BEFORE UPDATE ON message_recovery_authorities
    BEGIN SELECT RAISE(ABORT, 'Message recovery authority is immutable'); END;
CREATE TRIGGER migration_input_dismissal_immutable BEFORE UPDATE ON migration_input_dismissals
    BEGIN SELECT RAISE(ABORT,'Migration input dismissal is immutable'); END;
CREATE TRIGGER migration_input_hold_immutable BEFORE UPDATE ON migration_input_holds
    BEGIN SELECT RAISE(ABORT,'Migration input hold is immutable'); END;
