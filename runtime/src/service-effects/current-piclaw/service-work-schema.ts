import type Database from "bun:sqlite";
import { applyOwnedMigrations } from "../../db/migrations.js";

const SCHEMA_PREFIX = "service_effect_s01_";


// Original operational rows keep their rowids/FKs. Only exclusive SDK observations
// are archived; accepted-source membership, binding, cancellation and delivery stay.
const HISTORICAL_OPERATIONS_SQL = `CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}operations (
      operation_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      phase TEXT NOT NULL CHECK(phase IN ('accepted','claimed','starting_harness','executing','suspended','cancelling','settling','terminal')),
      primary_source_seq INTEGER NOT NULL,
      cancellation_source_id TEXT,
      cancellation_source_seq INTEGER,
      cancellation_cause TEXT,
      cancellation_requested_at TEXT,
      harness_session_id TEXT,
      harness_lane TEXT,
      harness_operation_id TEXT,
      harness_state TEXT CHECK(harness_state IS NULL OR harness_state IN ('not_started','running','suspended','aborting','finished')),
      harness_watch_generation INTEGER CHECK(harness_watch_generation IS NULL OR harness_watch_generation >= 0),
      terminal_disposition TEXT CHECK(terminal_disposition IS NULL OR terminal_disposition IN ('completed','cancelled','failed','skipped','superseded')),
      terminal_message_row_id INTEGER,
      terminal_error_code TEXT,
      terminal_committed_at TEXT,
      UNIQUE(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, primary_source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;`;
const OPERATIONS_SQL = `CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}operations (
      operation_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      phase TEXT NOT NULL CHECK(phase IN ('accepted','claimed','starting_harness','executing','suspended','cancelling','settling','terminal')),
      primary_source_seq INTEGER NOT NULL,
      cancellation_source_id TEXT,
      cancellation_source_seq INTEGER,
      cancellation_cause TEXT,
      cancellation_requested_at TEXT,
      harness_session_id TEXT,
      harness_operation_id TEXT,
      terminal_disposition TEXT CHECK(terminal_disposition IS NULL OR terminal_disposition IN ('completed','cancelled','failed','skipped','superseded')),
      terminal_message_row_id INTEGER,
      terminal_error_code TEXT,
      terminal_committed_at TEXT,
      UNIQUE(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, primary_source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;`;
const HARNESS_ARCHIVE = `${SCHEMA_PREFIX}legacy_harness_v1`;
const HARNESS_ARCHIVE_SQL = `CREATE TABLE ${HARNESS_ARCHIVE} (
  operation_id TEXT PRIMARY KEY, operation_rowid INTEGER NOT NULL UNIQUE,
  harness_lane TEXT, harness_state TEXT, harness_watch_generation INTEGER
) STRICT;`;
const HARNESS_RETIREMENT = {owner:"service_effect_s01",id:"retire-harness-mirrors-v1",order:2,sql:`
${HARNESS_ARCHIVE_SQL}
INSERT INTO ${HARNESS_ARCHIVE}(operation_id,operation_rowid,harness_lane,harness_state,harness_watch_generation)
  SELECT operation_id,rowid,harness_lane,harness_state,harness_watch_generation FROM ${SCHEMA_PREFIX}operations ORDER BY rowid;
ALTER TABLE ${SCHEMA_PREFIX}operations DROP COLUMN harness_lane;
ALTER TABLE ${SCHEMA_PREFIX}operations DROP COLUMN harness_state;
ALTER TABLE ${SCHEMA_PREFIX}operations DROP COLUMN harness_watch_generation;
`};
const FRESH_BINDING = {owner:"service_effect_s01",id:"native-harness-binding-v1",order:2,sql:OPERATIONS_SQL};
const ACTIVE_OPERATION_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}one_active_operation
      ON ${SCHEMA_PREFIX}operations(chat_jid) WHERE phase <> 'terminal';`;
// SDK-scheduled rows retain the existing S07 FK/source identity but own no
// host execution slot. Any harness/cancellation/other phase remains exclusive.
const SDK_ACTIVE_OPERATION_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}one_active_operation
      ON ${SCHEMA_PREFIX}operations(chat_jid) WHERE phase <> 'terminal' AND NOT (
        operation_id GLOB 'native-scheduled:*' AND phase='claimed'
        AND harness_session_id IS NULL AND harness_operation_id IS NULL AND cancellation_source_id IS NULL);`;
const SDK_SOURCE_INDEX = {owner:'service_effect_s01',id:'sdk-scheduled-admission-index-v1',order:3,
  sql:`DROP INDEX main.${SCHEMA_PREFIX}one_active_operation;
${SDK_ACTIVE_OPERATION_INDEX_SQL}`};
const OPEN_OPERATION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}open_operations
      ON ${SCHEMA_PREFIX}operations(chat_jid, phase, operation_id);`;

// Keep the historical declarations exact: unrecognised constraints must not be
// erased by the narrow queue rebuild. The membership parent is never rebuilt
// (EF-S07 source_bindings also references it).
const OPERATION_SOURCES_SQL = `CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}operation_sources (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(operation_id, source_seq),
      UNIQUE(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;`;
const HISTORICAL_QUEUE_SQL = `CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}queued_inputs (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      queue_kind TEXT NOT NULL CHECK(queue_kind IN ('steer','follow_up','next_run')),
      harness_entry_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('accepted','queued','consumed','disposed')),
      PRIMARY KEY(operation_id, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}operation_sources(chat_jid, source_seq)
    ) STRICT;`;
const FINAL_QUEUE_SQL = HISTORICAL_QUEUE_SQL.replace(
  /\n    \) STRICT;/,
  `,
      FOREIGN KEY(chat_jid, operation_id, source_seq)
        REFERENCES ${SCHEMA_PREFIX}operation_sources(chat_jid, operation_id, source_seq)
    ) STRICT;`,
);
const PARENT_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}operation_source_membership
  ON ${SCHEMA_PREFIX}operation_sources(chat_jid, operation_id, source_seq);`;
const QUEUE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}queued_source
  ON ${SCHEMA_PREFIX}queued_inputs(chat_jid, source_seq);`;
const QUEUE_UPGRADE = {
  owner: "service_effect_s01",
  id: "exact-queued-source-membership",
  order: 1,
  sql: `
    ${PARENT_INDEX_SQL}
    ${FINAL_QUEUE_SQL.replace("IF NOT EXISTS ", "").replace(
      `${SCHEMA_PREFIX}queued_inputs (`, `${SCHEMA_PREFIX}queued_inputs_upgrade (`,
    )}
    INSERT INTO ${SCHEMA_PREFIX}queued_inputs_upgrade
      (rowid, chat_jid, operation_id, source_seq, queue_kind, harness_entry_id, state)
      SELECT rowid, chat_jid, operation_id, source_seq, queue_kind, harness_entry_id, state
      FROM ${SCHEMA_PREFIX}queued_inputs ORDER BY rowid;
    DROP TABLE ${SCHEMA_PREFIX}queued_inputs;
    ALTER TABLE ${SCHEMA_PREFIX}queued_inputs_upgrade RENAME TO ${SCHEMA_PREFIX}queued_inputs;
    ${QUEUE_INDEX_SQL}
  `,
};

// Ignore formatting, not SQL semantics (in particular, preserve string literals).
function normaliseSql(sql: string): string {
  return sql
    .replace(`"${SCHEMA_PREFIX}queued_inputs"`, `${SCHEMA_PREFIX}queued_inputs`)
    .split(/('(?:''|[^'])*')/).map((part, i) => i % 2 ? part : part.replace(/\bIF NOT EXISTS\b/gi, "").replace(/\s+/g, "").toLowerCase())
    .join("").replace(/;$/, "");
}

function schemaSql(database: Database, name: string): string | null {
  const row = database.query("SELECT sql FROM sqlite_schema WHERE name = ? COLLATE NOCASE").get(name) as { sql: string | null } | null;
  return row?.sql ?? null;
}

function invalidUpgrade(): never {
  // No historical identifiers or row bytes cross this setup error boundary.
  throw new Error("EF-S01 queue upgrade requires recognised schema and valid source membership.");
}

/** Read-only preflight, before even ledger/base DDL. Never reassign bad history. */
function preflightQueueUpgrade(database: Database): void {
  // Inspect an existing temp schema without allocating one on a main-only root.
  const hasTemp = (database.query("PRAGMA database_list").all() as {name:string}[]).some(row => row.name === "temp");
  // Unqualified installer/helper SQL must not resolve to a temporary shadow.
  if (hasTemp && database.query(`SELECT 1 FROM sqlite_temp_schema WHERE
      lower(name) LIKE 'service_effect_s01_%' OR name='piclaw_schema_migrations' COLLATE NOCASE LIMIT 1`).get()) invalidUpgrade();
  const parent = schemaSql(database, `${SCHEMA_PREFIX}operation_sources`);
  const queue = schemaSql(database, `${SCHEMA_PREFIX}queued_inputs`);
  if (parent !== null && normaliseSql(parent) !== normaliseSql(OPERATION_SOURCES_SQL)) invalidUpgrade();
  if (queue !== null && ![HISTORICAL_QUEUE_SQL, FINAL_QUEUE_SQL].some(sql => normaliseSql(sql) === normaliseSql(queue))) invalidUpgrade();
  for (const [name, expected] of [
    [`${SCHEMA_PREFIX}operation_source_membership`, PARENT_INDEX_SQL],
    [`${SCHEMA_PREFIX}queued_source`, QUEUE_INDEX_SQL],
  ] as const) {
    const sql = schemaSql(database, name);
    if (sql !== null && normaliseSql(sql) !== normaliseSql(expected)) invalidUpgrade();
  }
  if (database.query("SELECT 1 FROM sqlite_schema WHERE name = ? COLLATE NOCASE").get(`${SCHEMA_PREFIX}queued_inputs_upgrade`)) invalidUpgrade();
  if (queue === null) return;
  if (parent === null) invalidUpgrade();
  // Queue-owned objects would disappear on DROP TABLE; reject rather than guess
  // how to recreate them. Other parent indexes/triggers remain untouched.
  if (database.query(`SELECT 1 FROM sqlite_schema WHERE tbl_name = ? COLLATE NOCASE AND
      (type = 'trigger' OR (type = 'index' AND sql IS NOT NULL AND name <> ? COLLATE NOCASE)) LIMIT 1`)
    .get(`${SCHEMA_PREFIX}queued_inputs`, `${SCHEMA_PREFIX}queued_source`)
    || hasTemp && database.query("SELECT 1 FROM sqlite_temp_schema WHERE type='trigger' AND tbl_name=? COLLATE NOCASE LIMIT 1")
      .get(`${SCHEMA_PREFIX}queued_inputs`)) invalidUpgrade();
  // Even empty child tables are unsafe: DROP may cascade, or invalidate their FK.
  const child = database.query(`SELECT 1 FROM sqlite_schema AS s, pragma_foreign_key_list(s.name, 'main') AS f
    WHERE s.type='table' AND f."table"=? COLLATE NOCASE LIMIT 1`).get(`${SCHEMA_PREFIX}queued_inputs`);
  const tempChild = hasTemp && database.query(`SELECT 1 FROM sqlite_temp_schema AS s, pragma_foreign_key_list(s.name, 'temp') AS f
    WHERE s.type='table' AND f."table"=? COLLATE NOCASE LIMIT 1`).get(`${SCHEMA_PREFIX}queued_inputs`);
  if (child || tempChild) invalidUpgrade();
  if (database.query(`SELECT 1 FROM ${SCHEMA_PREFIX}queued_inputs AS q WHERE
      q.queue_kind NOT IN ('steer','follow_up','next_run') OR q.state NOT IN ('accepted','queued','consumed','disposed')
      OR NOT EXISTS (SELECT 1 FROM ${SCHEMA_PREFIX}operation_sources AS p
        WHERE p.chat_jid=q.chat_jid AND p.operation_id=q.operation_id AND p.source_seq=q.source_seq)
      LIMIT 1`).get()) invalidUpgrade();
  for (const table of ["queued_inputs", "operation_sources"]) {
    if (database.query(`PRAGMA foreign_key_check('${SCHEMA_PREFIX}${table}')`).get()) invalidUpgrade();
  }
}



function invalidHarnessSchema(): never {throw Error("EF-S01 harness retirement requires recognised schema and receipts");}
/** Before base/ledger DDL, recognise only the original/target declarations.
 * Mirror-free native state without its receipt is NOT legacy input.
 * DROP COLUMN keeps every inbound FK attached to the original parent table. */
function preflightHarnessRetirement(database: Database): typeof HARNESS_RETIREMENT | typeof FRESH_BINDING {
  const operation = schemaSql(database, `${SCHEMA_PREFIX}operations`), archive = schemaSql(database,HARNESS_ARCHIVE);
  const old = operation !== null && normaliseSql(operation) === normaliseSql(HISTORICAL_OPERATIONS_SQL);
  const current = operation !== null && normaliseSql(operation) === normaliseSql(OPERATIONS_SQL);
  if (operation !== null && !old && !current || archive !== null && normaliseSql(archive) !== normaliseSql(HARNESS_ARCHIVE_SQL)) invalidHarnessSchema();
  const receipts = schemaSql(database,"piclaw_schema_migrations") === null ? [] : database.query(
    "SELECT id,migration_order FROM main.piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order>=2 ORDER BY migration_order").all() as {id:string;migration_order:number}[];
  const sdkIndex=receipts.find(receipt=>receipt.id===SDK_SOURCE_INDEX.id&&receipt.migration_order===3);
  if (receipts.length) {
    const expected = archive === null ? FRESH_BINDING : HARNESS_RETIREMENT;
    if (receipts.length !== (sdkIndex?2:1) || receipts[0]?.id !== expected.id || receipts[0]?.migration_order !== 2 || !current) invalidHarnessSchema();
  } else if (archive !== null || current) invalidHarnessSchema();
  if (database.query(`SELECT 1 FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND
      (type='trigger' OR type='index' AND sql IS NOT NULL AND lower(name) NOT IN (?,?)) LIMIT 1`)
      .get(`${SCHEMA_PREFIX}operations`,`${SCHEMA_PREFIX}one_active_operation`,`${SCHEMA_PREFIX}open_operations`)) invalidHarnessSchema();
  if (database.query("SELECT 1 FROM sqlite_schema WHERE tbl_name=? COLLATE NOCASE AND type='index' AND sql IS NOT NULL LIMIT 1").get(HARNESS_ARCHIVE)) invalidHarnessSchema();
  for (const [name,expected] of [[`${SCHEMA_PREFIX}one_active_operation`,sdkIndex?SDK_ACTIVE_OPERATION_INDEX_SQL:ACTIVE_OPERATION_INDEX_SQL],[`${SCHEMA_PREFIX}open_operations`,OPEN_OPERATION_INDEX_SQL]]) {
    const actual=schemaSql(database,name!);if(sdkIndex&&name===`${SCHEMA_PREFIX}one_active_operation`&&actual===null||actual!==null&&normaliseSql(actual)!==normaliseSql(expected!))invalidHarnessSchema();
  }
  // Views/triggers could otherwise retain a deleted observation or change meaning.
  const schemas = (database.query('PRAGMA database_list').all() as {name:string}[]).some(row=>row.name==='temp') ? ['main','temp'] : ['main'];
  for (const schema of schemas) {
    const catalog = schema === "main" ? "main.sqlite_schema" : "sqlite_temp_schema";
    if (database.query(`SELECT 1 FROM ${catalog} WHERE type IN ('view','trigger') AND
      (lower(tbl_name)=? OR instr(lower(coalesce(sql,'')),?)>0 OR instr(lower(coalesce(sql,'')),?)>0) LIMIT 1`)
      .get(`${SCHEMA_PREFIX}operations`,`${SCHEMA_PREFIX}operations`,HARNESS_ARCHIVE)) invalidHarnessSchema();
    if (database.query(`SELECT 1 FROM ${catalog} s,pragma_foreign_key_list(s.name,?) f
      WHERE s.type='table' AND lower(f."table")=? AND lower(f."to") IN ('harness_lane','harness_state','harness_watch_generation') LIMIT 1`)
      .get(schema,`${SCHEMA_PREFIX}operations`)) invalidHarnessSchema();
  }
  return old || archive !== null ? HARNESS_RETIREMENT : FRESH_BINDING;
}

/**
 * Install the latent EF-S01 schema on an explicitly supplied isolated database.
 * The caller owns the connection. Production startup composes this schema with
 * EF-S07 in Piclaw's message store; isolated contract tests may use a fixture DB.
 * This setup-only installer may throw bounded or raw infrastructure exceptions;
 * callers must complete it before exposing a store at the effector boundary.
 */
export function installServiceWorkSchema(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S01 requires SQLite foreign-key enforcement.");
  }

  const install = () => {
    preflightQueueUpgrade(database);
    const harnessRetirement = preflightHarnessRetirement(database);
    database.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}chats (
      chat_jid TEXT PRIMARY KEY,
      next_source_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_source_seq >= 1),
      consumed_through_source_seq INTEGER NOT NULL DEFAULT 0 CHECK(consumed_through_source_seq >= 0),
      active_operation_id TEXT,
      UNIQUE(chat_jid, active_operation_id),
      FOREIGN KEY(chat_jid, active_operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}sources (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL CHECK(source_seq >= 1),
      source_id TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64 AND source_hash = lower(source_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('message','steer','follow_up','continuation','control','cancellation','scheduled_agent','internal')),
      state TEXT NOT NULL CHECK(state IN ('pending','claimed','queued','consumed','disposed')),
      payload_ref TEXT NOT NULL,
      target_operation_id TEXT,
      parent_source_seq INTEGER,
      accepted_at TEXT NOT NULL,
      disposition_reason TEXT,
      provenance_ref TEXT NOT NULL,
      create_wake_intent INTEGER NOT NULL CHECK(create_wake_intent IN (0,1)),
      PRIMARY KEY(chat_jid, source_seq),
      UNIQUE(chat_jid, source_id),
      FOREIGN KEY(chat_jid) REFERENCES ${SCHEMA_PREFIX}chats(chat_jid),
      FOREIGN KEY(chat_jid, parent_source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, target_operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    ${OPERATIONS_SQL}


    ${ACTIVE_OPERATION_INDEX_SQL}

    ${OPERATION_SOURCES_SQL}

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}intents (
      operation_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL CHECK(length(intent_hash) = 64 AND intent_hash = lower(intent_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('open_harness','prompt','queue_input','abort','resume','settle','maintenance')),
      payload_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(operation_id, intent_id),
      FOREIGN KEY(operation_id) REFERENCES ${SCHEMA_PREFIX}operations(operation_id)
    ) STRICT;

    ${HISTORICAL_QUEUE_SQL}

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}wake_intents (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}decisions (
      idempotency_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash = lower(request_hash)),
      result_json TEXT NOT NULL CHECK(json_valid(result_json))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}pending_sources
      ON ${SCHEMA_PREFIX}sources(chat_jid, state, source_seq);
    ${OPEN_OPERATION_INDEX_SQL}
  `);
    applyOwnedMigrations(database, [QUEUE_UPGRADE,harnessRetirement,SDK_SOURCE_INDEX]);
    if (normaliseSql(schemaSql(database,`${SCHEMA_PREFIX}operations`) ?? "") !== normaliseSql(OPERATIONS_SQL)) invalidHarnessSchema();
    if (harnessRetirement.id === HARNESS_RETIREMENT.id && normaliseSql(schemaSql(database,HARNESS_ARCHIVE) ?? "") !== normaliseSql(HARNESS_ARCHIVE_SQL)) invalidHarnessSchema();
    // A receipt must not hide schema drift or a missing prerequisite index.
    if (normaliseSql(schemaSql(database, `${SCHEMA_PREFIX}queued_inputs`) ?? "") !== normaliseSql(FINAL_QUEUE_SQL)
      || normaliseSql(schemaSql(database, `${SCHEMA_PREFIX}operation_source_membership`) ?? "") !== normaliseSql(PARENT_INDEX_SQL)
      || normaliseSql(schemaSql(database, `${SCHEMA_PREFIX}queued_source`) ?? "") !== normaliseSql(QUEUE_INDEX_SQL)) invalidUpgrade();
  };
  // Bun uses a savepoint when nested: a caller may catch setup failure and still
  // commit unrelated outer work without leaking DDL, copied rows, or receipts.
  database.transaction(install).immediate();
}
