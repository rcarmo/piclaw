import type Database from "bun:sqlite";
import { applyOwnedMigrations } from "./migrations.js";

/** Receipt retention only: no charge, status change, legacy backfill or recovery scan. */
export const budgetTerminalReceiptMigration = Object.freeze({
  owner: "host.budget-request-reservations", id: "terminal-receipt-v1", order: 1,
  sql: `ALTER TABLE main.budget_request_reservations ADD COLUMN terminal_receipt_json TEXT;
ALTER TABLE main.budget_request_reservations ADD COLUMN terminal_receipt_sha256 TEXT;
ALTER TABLE main.budget_request_reservations ADD COLUMN terminal_received_at TEXT CHECK (
  (terminal_receipt_json IS NULL AND terminal_receipt_sha256 IS NULL AND terminal_received_at IS NULL)
  OR (terminal_receipt_json IS NOT NULL AND terminal_receipt_sha256 IS NOT NULL AND terminal_received_at IS NOT NULL
    AND length(terminal_received_at)=24
    AND length(terminal_receipt_sha256)=64 AND terminal_receipt_sha256 NOT GLOB '*[^0-9a-f]*'
    AND CASE WHEN json_valid(terminal_receipt_json) THEN
      json_type(terminal_receipt_json)='object'
      AND json_extract(terminal_receipt_json,'$.version') IS 1
      AND json_extract(terminal_receipt_json,'$.requestId') IS id
      AND json_extract(terminal_receipt_json,'$.requestBindingSha256') IS binding_sha256
      AND json_type(terminal_receipt_json,'$.projectedOutcome') IS 'object'
    ELSE 0 END)
);
CREATE TRIGGER main.budget_request_receipt_insert_state BEFORE INSERT ON budget_request_reservations
  WHEN NEW.terminal_receipt_json IS NOT NULL AND NEW.state NOT IN ('dispatched','unresolved')
  BEGIN SELECT RAISE(ABORT,'invalid terminal receipt state'); END;
CREATE TRIGGER main.budget_request_receipt_capture_state BEFORE UPDATE ON budget_request_reservations
  WHEN OLD.terminal_receipt_json IS NULL AND NEW.terminal_receipt_json IS NOT NULL
    AND (OLD.state NOT IN ('dispatched','unresolved') OR NEW.state IS NOT OLD.state)
  BEGIN SELECT RAISE(ABORT,'invalid terminal receipt state'); END;
-- REPLACE deletes need not fire DELETE triggers; cover every conflict key.
CREATE TRIGGER main.budget_request_receipt_no_replace BEFORE INSERT ON budget_request_reservations
  WHEN EXISTS (SELECT 1 FROM budget_request_reservations WHERE terminal_receipt_json IS NOT NULL
    AND (id=NEW.id OR rowid=NEW.rowid OR usage_event_id=NEW.usage_event_id))
  BEGIN SELECT RAISE(ABORT,'terminal receipts are immutable'); END;
CREATE TRIGGER main.budget_request_receipt_no_update BEFORE UPDATE ON budget_request_reservations
  WHEN EXISTS (SELECT 1 FROM budget_request_reservations WHERE terminal_receipt_json IS NOT NULL
    AND rowid<>OLD.rowid AND (id=NEW.id OR rowid=NEW.rowid OR usage_event_id=NEW.usage_event_id))
  OR OLD.terminal_receipt_json IS NOT NULL AND (
    NEW.state NOT IN ('dispatched','unresolved','settled')
    OR (OLD.state='settled' AND (NEW.state IS NOT OLD.state
      OR NEW.settlement_sha256 IS NOT OLD.settlement_sha256 OR NEW.usage_event_id IS NOT OLD.usage_event_id))
    OR NEW.terminal_receipt_json IS NOT OLD.terminal_receipt_json
    OR NEW.terminal_receipt_sha256 IS NOT OLD.terminal_receipt_sha256
    OR NEW.terminal_received_at IS NOT OLD.terminal_received_at
    OR NEW.id IS NOT OLD.id OR NEW.work_id IS NOT OLD.work_id OR NEW.chat_jid IS NOT OLD.chat_jid
    OR NEW.provider_id IS NOT OLD.provider_id OR NEW.model_id IS NOT OLD.model_id
    OR NEW.account_ref IS NOT OLD.account_ref OR NEW.amount_microusd IS NOT OLD.amount_microusd
    OR NEW.binding_sha256 IS NOT OLD.binding_sha256)
  BEGIN SELECT RAISE(ABORT,'terminal receipts are immutable'); END;
CREATE TRIGGER main.budget_request_receipt_no_delete BEFORE DELETE ON budget_request_reservations
  WHEN OLD.terminal_receipt_json IS NOT NULL
  BEGIN SELECT RAISE(ABORT,'terminal receipts are immutable'); END;`,
});

/** The later tool pair shares all original validation; order2 emits identical SQL. */
function modelInvocationInsertSql(tools: boolean): string {
  return `CREATE TRIGGER main.budget_request_invocation_insert BEFORE INSERT ON budget_request_reservations
  WHEN NEW.model_invocation_json IS NOT NULL
  BEGIN
    SELECT CASE WHEN CASE WHEN json_valid(NEW.model_invocation_json) THEN
      json_type(NEW.model_invocation_json)='object'
      AND (SELECT count(*) FROM json_each(NEW.model_invocation_json))=8
      AND (SELECT count(DISTINCT key) FROM json_each(NEW.model_invocation_json)
        WHERE key IN ('version','domain','operationId','conversationId','taskId','taskKind','phase','checkpointHash'))=8
      AND json_type(NEW.model_invocation_json,'$.version')='integer'
      AND json_extract(NEW.model_invocation_json,'$.version')=1
      AND json_type(NEW.model_invocation_json,'$.conversationId')='integer'
      AND json_extract(NEW.model_invocation_json,'$.conversationId') BETWEEN 1 AND 9007199254740991
      AND json_type(NEW.model_invocation_json,'$.taskId')='integer'
      AND json_extract(NEW.model_invocation_json,'$.taskId') BETWEEN 1 AND 9007199254740991
      AND ((json_extract(NEW.model_invocation_json,'$.taskKind')='pi.generation' AND json_extract(NEW.model_invocation_json,'$.phase')='request')
        OR (json_extract(NEW.model_invocation_json,'$.taskKind')='pi.compaction' AND json_extract(NEW.model_invocation_json,'$.phase')='summarize')${tools ? "\n        OR (json_extract(NEW.model_invocation_json,'$.taskKind')='pi.tool' AND json_extract(NEW.model_invocation_json,'$.phase')='call')" : ""})
      AND json_type(NEW.model_invocation_json,'$.checkpointHash')='text'
      AND length(CAST(json_extract(NEW.model_invocation_json,'$.checkpointHash') AS BLOB))=64
      AND json_extract(NEW.model_invocation_json,'$.checkpointHash') NOT GLOB '*[^0-9a-f]*'
      AND NOT EXISTS (SELECT 1 FROM json_each(NEW.model_invocation_json) WHERE key IN ('domain','operationId') AND (
        type!='text' OR length(value) NOT BETWEEN 1 AND 256
        OR length(trim(value,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))=0
        OR instr(value,char(0))>0 OR value GLOB ('*[' || char(1) || '-' || char(31) || char(127) || '-' || char(159) || ']*')))
    ELSE 0 END IS NOT 1 THEN RAISE(ABORT,'invalid model invocation') END;
  END;`;
}

/** Same reservation owner, next order after receipt retention. No legacy backfill. */
export const budgetModelInvocationMigration = Object.freeze({
  owner: budgetTerminalReceiptMigration.owner, id: "model-invocation-v1", order: 2,
  sql: `ALTER TABLE main.budget_request_reservations ADD COLUMN model_invocation_json TEXT;
ALTER TABLE main.budget_request_reservations ADD COLUMN model_invocation_key_sha256 TEXT CHECK (
  (model_invocation_json IS NULL AND model_invocation_key_sha256 IS NULL)
  OR (model_invocation_json IS NOT NULL AND model_invocation_key_sha256 IS NOT NULL
    AND length(CAST(model_invocation_key_sha256 AS BLOB))=64 AND model_invocation_key_sha256 NOT GLOB '*[^0-9a-f]*')
);
CREATE UNIQUE INDEX main.idx_budget_requests_model_invocation ON budget_request_reservations(model_invocation_key_sha256);
${modelInvocationInsertSql(false)}
-- REPLACE can bypass DELETE triggers unless recursive_triggers is enabled.
CREATE TRIGGER main.budget_request_invocation_no_replace BEFORE INSERT ON budget_request_reservations
  WHEN EXISTS (SELECT 1 FROM budget_request_reservations WHERE
    ((id=NEW.id OR rowid=NEW.rowid OR usage_event_id=NEW.usage_event_id)
      AND (model_invocation_json IS NOT NULL OR NEW.model_invocation_json IS NOT NULL))
    OR model_invocation_key_sha256=NEW.model_invocation_key_sha256)
  BEGIN SELECT RAISE(ABORT,'model invocation conflict'); END;
CREATE TRIGGER main.budget_request_invocation_no_update BEFORE UPDATE ON budget_request_reservations
  WHEN EXISTS (SELECT 1 FROM budget_request_reservations WHERE model_invocation_json IS NOT NULL
    AND rowid<>OLD.rowid AND (id=NEW.id OR rowid=NEW.rowid OR usage_event_id=NEW.usage_event_id))
    OR NEW.model_invocation_json IS NOT OLD.model_invocation_json
    OR NEW.model_invocation_key_sha256 IS NOT OLD.model_invocation_key_sha256
    OR (OLD.model_invocation_json IS NOT NULL AND (
      NEW.id IS NOT OLD.id OR NEW.work_id IS NOT OLD.work_id OR NEW.chat_jid IS NOT OLD.chat_jid
      OR NEW.provider_id IS NOT OLD.provider_id OR NEW.model_id IS NOT OLD.model_id
      OR NEW.account_ref IS NOT OLD.account_ref OR NEW.amount_microusd IS NOT OLD.amount_microusd
      OR NEW.binding_sha256 IS NOT OLD.binding_sha256))
  BEGIN SELECT RAISE(ABORT,'model invocation bindings are immutable'); END;
CREATE TRIGGER main.budget_request_invocation_no_delete BEFORE DELETE ON budget_request_reservations
  WHEN OLD.model_invocation_json IS NOT NULL
  BEGIN SELECT RAISE(ABORT,'model invocation bindings are immutable'); END;`,
});
import { budgetUsageEventTableSql, initializeUsageReportProjection, verifyExistingUsageReportProjection } from "./usage-report-projection.js";

/** Same owner; bound phase preparation to this domain's outstanding facts. */
export const budgetAccountingScopeMigration = Object.freeze({
  owner: budgetTerminalReceiptMigration.owner, id: 'accounting-scope-index-v1', order: 3,
  sql: `CREATE INDEX main.idx_budget_requests_domain_state ON budget_request_reservations(
    json_extract(model_invocation_json,'$.domain'),state)
    WHERE model_invocation_json IS NOT NULL;
  CREATE INDEX main.idx_budget_work_status ON budget_work(status,chat_jid);`,
});

/** Extend attribution to actual SDK tool/controller calls; no legacy backfill. */
export const budgetToolInvocationMigration = Object.freeze({
  owner: budgetTerminalReceiptMigration.owner, id: "tool-model-invocation-v1", order: 4,
  sql: `DROP TRIGGER main.budget_request_invocation_insert;
${modelInvocationInsertSql(true)}`,
});

/** Additive budget tables. Every cap is absent until the user creates one. */
export function initializeBudgetLimitsSchema(database: Database): void {
  database.transaction(() => {
    verifyExistingUsageReportProjection(database);
    database.exec(`
    CREATE TABLE IF NOT EXISTS budget_caps (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('task','instance_daily','instance_monthly','scheduled_run','provider_window')),
      metric TEXT NOT NULL CHECK(metric IN ('api_usd_micros','provider_percent_used_micros','provider_credits_remaining_micros','provider_key_usd_micros')),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      work_id TEXT,
      scheduled_task_id TEXT,
      provider_id TEXT,
      quota_dimension TEXT,
      account_ref TEXT,
      timezone TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_caps_enabled_scope ON budget_caps(enabled, scope);
    CREATE INDEX IF NOT EXISTS idx_budget_caps_work ON budget_caps(work_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_budget_caps_scheduled_task ON budget_caps(scheduled_task_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_budget_caps_provider ON budget_caps(provider_id, enabled);

    CREATE TABLE IF NOT EXISTS budget_cap_revisions (
      cap_id TEXT NOT NULL REFERENCES budget_caps(id),
      revision INTEGER NOT NULL CHECK(revision >= 1),
      scope TEXT NOT NULL CHECK(scope IN ('task','instance_daily','instance_monthly','scheduled_run','provider_window')),
      metric TEXT NOT NULL CHECK(metric IN ('api_usd_micros','provider_percent_used_micros','provider_credits_remaining_micros','provider_key_usd_micros')),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      work_id TEXT,
      scheduled_task_id TEXT,
      provider_id TEXT,
      quota_dimension TEXT,
      account_ref TEXT,
      timezone TEXT,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY(cap_id, revision)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_cap_revisions_recorded ON budget_cap_revisions(recorded_at, cap_id);
    INSERT OR IGNORE INTO budget_cap_revisions (
      cap_id,revision,scope,metric,amount,enabled,work_id,scheduled_task_id,provider_id,quota_dimension,account_ref,timezone,recorded_at
    ) SELECT id,revision,scope,metric,amount,enabled,work_id,scheduled_task_id,provider_id,quota_dimension,account_ref,timezone,updated_at
      FROM budget_caps;

    CREATE TABLE IF NOT EXISTS budget_cap_windows (
      cap_id TEXT NOT NULL REFERENCES budget_caps(id),
      cap_revision INTEGER NOT NULL,
      window_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(cap_id, cap_revision, window_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_cap_windows_range ON budget_cap_windows(cap_id, starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS budget_work (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      execution_kind TEXT NOT NULL CHECK(execution_kind IN ('interactive','goal','scheduled','background','delegate','side_prompt')),
      parent_work_id TEXT REFERENCES budget_work(id),
      scheduled_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','stopped','completed','cancelled')),
      blocking_json TEXT,
      last_boundary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_work_chat_status ON budget_work(chat_jid, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_budget_work_parent ON budget_work(parent_work_id);
    CREATE INDEX IF NOT EXISTS idx_budget_work_scheduled_task ON budget_work(scheduled_task_id, created_at);

    CREATE TABLE IF NOT EXISTS budget_request_reservations (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES budget_work(id),
      chat_jid TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      account_ref TEXT NOT NULL,
      binding_sha256 TEXT NOT NULL,
      amount_microusd INTEGER CHECK(amount_microusd IS NULL OR amount_microusd >= 0),
      state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','unresolved','settled','released')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settlement_sha256 TEXT,
      usage_event_id TEXT UNIQUE,
      CHECK((state='settled') = (settlement_sha256 IS NOT NULL AND usage_event_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_requests_work_state ON budget_request_reservations(work_id,state);
    CREATE INDEX IF NOT EXISTS idx_budget_requests_state ON budget_request_reservations(state);

    ${budgetUsageEventTableSql.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};
    CREATE INDEX IF NOT EXISTS idx_budget_usage_work_time ON budget_usage_events(work_id, accounted_at);
    CREATE INDEX IF NOT EXISTS idx_budget_usage_time ON budget_usage_events(accounted_at);
    CREATE INDEX IF NOT EXISTS idx_budget_usage_chat_time ON budget_usage_events(chat_jid, accounted_at);

    CREATE TABLE IF NOT EXISTS budget_allowances (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES budget_work(id),
      cap_id TEXT NOT NULL REFERENCES budget_caps(id),
      cap_revision INTEGER NOT NULL,
      window_id TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_allowances_work_cap ON budget_allowances(work_id, cap_id, expires_at);

    CREATE TABLE IF NOT EXISTS budget_overrides (
      work_id TEXT PRIMARY KEY REFERENCES budget_work(id),
      chat_jid TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode = 'warnings_only'),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_overrides_chat ON budget_overrides(chat_jid, expires_at);

    CREATE TABLE IF NOT EXISTS budget_decisions (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES budget_work(id),
      boundary TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allow','warn','pause','stop')),
      blockers_json TEXT NOT NULL,
      continuation_json TEXT,
      notification_key TEXT,
      notification_status TEXT CHECK(notification_status IS NULL OR notification_status IN ('pending','delivered')),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_decisions_work_time ON budget_decisions(work_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS budget_provider_evidence (
      evidence_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      account_ref TEXT NOT NULL,
      quota_dimension TEXT NOT NULL,
      unit TEXT NOT NULL,
      used_micros INTEGER,
      remaining_micros INTEGER,
      limit_micros INTEGER,
      window_id TEXT NOT NULL,
      resets_at TEXT,
      fetched_at TEXT NOT NULL,
      stale INTEGER NOT NULL CHECK(stale IN (0,1)),
      availability TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(provider_id, account_ref, quota_dimension, window_id, fetched_at)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_budget_provider_evidence_lookup
      ON budget_provider_evidence(provider_id, account_ref, quota_dimension, fetched_at DESC);

    CREATE TRIGGER IF NOT EXISTS budget_cap_revisions_no_update
      BEFORE UPDATE ON budget_cap_revisions BEGIN SELECT RAISE(ABORT, 'budget cap revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS budget_cap_revisions_no_delete
      BEFORE DELETE ON budget_cap_revisions BEGIN SELECT RAISE(ABORT, 'budget cap revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS budget_usage_events_no_update
      BEFORE UPDATE ON budget_usage_events BEGIN SELECT RAISE(ABORT, 'budget usage events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS budget_usage_events_no_delete
      BEFORE DELETE ON budget_usage_events BEGIN SELECT RAISE(ABORT, 'budget usage events are immutable'); END;
    `);
    applyOwnedMigrations(database, [budgetTerminalReceiptMigration, budgetModelInvocationMigration, budgetAccountingScopeMigration, budgetToolInvocationMigration]);
    initializeUsageReportProjection(database);
  }).immediate();
}
