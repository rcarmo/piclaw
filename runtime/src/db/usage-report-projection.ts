import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import type { TokenUsageRecord } from "./usage-report-types.js";
import { applyOwnedMigrations } from "./migrations.js";

/** The existing event owns accounting identity and valuation. These two columns
 * add its immutable report payload; no new event or request identity is created. */
export const budgetUsageEventTableSql = `CREATE TABLE budget_usage_events (
      usage_event_id TEXT PRIMARY KEY,
      token_usage_id INTEGER NOT NULL UNIQUE REFERENCES token_usage(id),
      work_id TEXT REFERENCES budget_work(id),
      chat_jid TEXT NOT NULL,
      invocation_id TEXT,
      accounted_at TEXT NOT NULL,
      api_usd_micros INTEGER CHECK(api_usd_micros IS NULL OR api_usd_micros >= 0),
      api_usd_known INTEGER NOT NULL CHECK(api_usd_known IN (0,1)),
      valuation_provenance TEXT NOT NULL CHECK(valuation_provenance IN ('catalogue_estimate','documented_free','unavailable')),
      usage_source TEXT NOT NULL
    ) STRICT`;
const payloadColumnsSql = `report_payload_json TEXT CHECK(report_payload_json IS NULL OR json_valid(report_payload_json)),
report_payload_sha256 TEXT CHECK((report_payload_json IS NULL AND report_payload_sha256 IS NULL) OR
(report_payload_json IS NOT NULL AND report_payload_sha256 IS NOT NULL AND length(report_payload_sha256)=64
 AND report_payload_sha256 NOT GLOB '*[^0-9a-f]*'))`;
const eventUpdateTrigger = `CREATE TRIGGER budget_usage_events_no_update
      BEFORE UPDATE ON budget_usage_events BEGIN SELECT RAISE(ABORT, 'budget usage events are immutable'); END`;
export const usageReportMigration = Object.freeze({ owner: "host.usage-reports", id: "event-payload-v1", order: 1,
  sql: `ALTER TABLE main.budget_usage_events ADD COLUMN ${payloadColumnsSql.split(",\n")[0]};
ALTER TABLE main.budget_usage_events ADD COLUMN ${payloadColumnsSql.split(",\n")[1]};
DROP TRIGGER main.budget_usage_events_no_update;` });
const checksum = createHash("sha256").update(usageReportMigration.sql).digest("hex");
const sqlKey = (sql: string) => sql.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();

export const tokenReportColumns = ["chat_jid", "run_at", "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
  "cache_read_reported", "cache_write_reported", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total",
  "provider_cost_total", "catalogue_cost_total", "cost_provenance", "model", "response_model", "provider", "api", "usage_source", "turns", "work_id",
  "invocation_id", "usage_event_id", "api_equivalent_cost_microusd", "api_equivalent_cost_known", "valuation_provenance", "api_equivalent_known_subtotal_microusd",
  "api_equivalent_unknown_categories", "pricing_currency", "pricing_source", "pricing_version", "pricing_context_tier", "pricing_cache_fallbacks"] as const;
type Report = Record<typeof tokenReportColumns[number], string | number | null>;
export type UsageReportOrigin = { kind: "recorder_event" } | { kind: "legacy_projection_capture"; captured_at: string }
  | { kind: "host_request"; request_id: string; binding_sha256: string; settlement_sha256: string };
interface Payload { version: 1; origin: UsageReportOrigin; execution_kind: string | null; record: Report }
export interface UsageProjectionEvent {
  usage_event_id: string; token_usage_id: number; work_id: string | null; chat_jid: string; invocation_id: string | null; accounted_at: string;
  api_usd_micros: number | null; api_usd_known: number; valuation_provenance: string; usage_source: string;
  report_payload_json: string | null; report_payload_sha256: string | null;
}
/** Shared accounting/report-retention identity rule. Numeric cache displacement
 * never turns an existing event/request observation into unrelated legacy data. */
export function unlinkedUsageReportPredicate(alias: "t" | "token_usage"): string {
  return `NOT EXISTS (SELECT 1 FROM main.budget_usage_events e WHERE e.token_usage_id=${alias}.id OR e.usage_event_id=${alias}.usage_event_id)
    AND NOT EXISTS (SELECT 1 FROM main.budget_request_reservations r WHERE r.id=${alias}.invocation_id OR r.usage_event_id=${alias}.usage_event_id)`;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const keys = (value: object) => Object.keys(value).sort().join(",");
const tokenColumns = new Set(["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "turns", "api_equivalent_cost_microusd", "api_equivalent_known_subtotal_microusd"]);
const costs = new Set(["cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total", "provider_cost_total", "catalogue_cost_total"]);
const flags = new Set(["cache_read_reported", "cache_write_reported", "api_equivalent_cost_known"]);
function validateRecord(value: Report): void {
  if (!value || keys(value) !== [...tokenReportColumns].sort().join(",")) throw Error("Invalid usage report fields");
  for (const column of tokenReportColumns) {
    const item = value[column];
    if (tokenColumns.has(column) || costs.has(column)) {
      if (item !== null && (typeof item !== "number" || !Number.isFinite(item) || item < 0 || tokenColumns.has(column) && !Number.isSafeInteger(item))) throw Error("Invalid usage report number");
    } else if (flags.has(column)) {
      if (item !== null && item !== 0 && item !== 1) throw Error("Invalid usage report flag");
    } else if (item !== null && typeof item !== "string") throw Error("Invalid usage report text");
  }
  for (const column of ["chat_jid", "run_at", "usage_event_id", "usage_source"] as const) if (typeof value[column] !== "string" || !value[column]) throw Error("Missing usage report identity");
  for (const column of ["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total"] as const)
    if (value[column] === null) throw Error("Missing usage report number");
  if (!Number.isFinite(Date.parse(String(value.run_at)))) throw Error("Invalid usage report time");
  if (value.api_equivalent_cost_known === 1 && (value.api_equivalent_cost_microusd === null || !Number.isSafeInteger(value.api_equivalent_cost_microusd))) throw Error("Missing known usage valuation");
  if (value.cost_provenance !== null && !["provider_reported", "catalogue_estimate", "unavailable"].includes(String(value.cost_provenance))) throw Error("Invalid usage cost provenance");
  if (value.cost_provenance === "provider_reported" && (value.provider_cost_total === null || value.cost_total !== value.provider_cost_total)
    || value.cost_provenance === "catalogue_estimate" && (value.catalogue_cost_total === null || value.cost_total !== value.catalogue_cost_total)) throw Error("Contradictory usage cost provenance");
}
export function usageReportRecord(record: TokenUsageRecord): Report {
  const values = Object.fromEntries(tokenReportColumns.map(column => [column, record[column] ?? null])) as Report;
  values.reasoning_tokens = record.reasoning_tokens ?? 0;
  values.usage_source = record.usage_source ?? "assistant";
  for (const column of flags) { const value = record[column as keyof TokenUsageRecord]; values[column as keyof Report] = value == null ? null : Number(value); }
  return values;
}
export function encodeUsageReport(record: TokenUsageRecord, origin: UsageReportOrigin) {
  const normalized = usageReportRecord(record); validateRecord(normalized);
  const json = JSON.stringify({ version: 1, origin, execution_kind: record.execution_kind ?? null, record: normalized } satisfies Payload);
  return { json, hash: digest(json) };
}
export function readUsageProjectionEvent(database: Database, eventId: string): UsageProjectionEvent | null {
  return database.query("SELECT * FROM main.budget_usage_events WHERE usage_event_id=?").get(eventId) as UsageProjectionEvent | null;
}
export function decodeUsageReport(event: UsageProjectionEvent): Payload | null {
  if (event.report_payload_json === null && event.report_payload_sha256 === null) return null;
  if (typeof event.report_payload_json !== "string" || digest(event.report_payload_json) !== event.report_payload_sha256) throw Error("Usage report payload hash mismatch");
  const body = JSON.parse(event.report_payload_json) as Payload;
  if (!body || keys(body) !== "execution_kind,origin,record,version" || body.version !== 1 || !body.origin || typeof body.origin !== "object") throw Error("Unsupported usage report payload");
  const origin = body.origin;
  if (origin.kind === "recorder_event") { if (keys(origin) !== "kind") throw Error("Invalid usage origin"); }
  else if (origin.kind === "legacy_projection_capture") { if (keys(origin) !== "captured_at,kind" || !Number.isFinite(Date.parse(origin.captured_at))) throw Error("Invalid usage origin"); }
  else if (origin.kind === "host_request") {
    if (keys(origin) !== "binding_sha256,kind,request_id,settlement_sha256" || typeof origin.request_id !== "string" || !origin.request_id
      || !/^[a-f0-9]{64}$/.test(origin.binding_sha256) || !/^[a-f0-9]{64}$/.test(origin.settlement_sha256)) throw Error("Invalid usage request origin");
  } else throw Error("Unsupported usage origin");
  if (body.execution_kind !== null && !["interactive", "goal", "scheduled", "background", "delegate", "side_prompt"].includes(body.execution_kind)) throw Error("Invalid usage execution kind");
  validateRecord(body.record);
  const r = body.record;
  if (r.usage_event_id !== event.usage_event_id || r.work_id !== event.work_id || r.invocation_id !== event.invocation_id || r.chat_jid !== event.chat_jid || r.run_at !== event.accounted_at
    || r.api_equivalent_cost_microusd !== event.api_usd_micros || Number(r.api_equivalent_cost_known === 1) !== event.api_usd_known
    || (r.valuation_provenance ?? "unavailable") !== event.valuation_provenance || r.usage_source !== event.usage_source) throw Error("Usage report event binding mismatch");
  if (origin.kind === "host_request" && (origin.request_id !== event.invocation_id || event.usage_event_id !== `usage:invocation:${origin.request_id}` || event.api_usd_known !== 1)) throw Error("Usage request identity mismatch");
  return body;
}

/** Check owned state before the older additive budget initializer can recreate
 * a missing immutable-event trigger. Old untouched schemas upgrade afterwards. */
export function verifyExistingUsageReportProjection(database: Database): void {
  const table = database.query("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name='budget_usage_events'").get() as { sql: string } | null;
  const ledger = database.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='piclaw_schema_migrations'").get();
  const receipt = ledger && database.query("SELECT 1 FROM main.piclaw_schema_migrations WHERE owner=? AND id=?").get(usageReportMigration.owner, usageReportMigration.id);
  if (receipt || /report_payload_(json|sha256)/.test(table?.sql ?? "")) initializeUsageReportProjection(database);
}

/** Cutover captures existing report bytes with a weaker, explicit origin. Old
 * identities/accounting columns never change. Missing/malformed rows stay unknown.
 * Trigger removal/capture/receipt/restoration are one synchronous owner frame. */
export function initializeUsageReportProjection(database: Database): void {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN ('budget_usage_events','token_usage','budget_usage_events_no_update','piclaw_schema_migrations')").get()) throw Error("Usage report schema shadow");
    const table = database.query("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name='budget_usage_events'").get() as { sql: string } | null;
    const trigger = database.query("SELECT sql FROM main.sqlite_schema WHERE type='trigger' AND name='budget_usage_events_no_update'").get() as { sql: string } | null;
    const ledger = database.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='piclaw_schema_migrations'").get();
    const receipt = ledger ? database.query("SELECT migration_order,checksum FROM main.piclaw_schema_migrations WHERE owner=? AND id=?").get(usageReportMigration.owner, usageReportMigration.id) as { migration_order: number; checksum: string } | null : null;
    const upgraded = budgetUsageEventTableSql.replace(/\) STRICT$/, `, ${payloadColumnsSql}) STRICT`);
    if (receipt) {
      if (receipt.migration_order !== 1 || receipt.checksum !== checksum || !table || sqlKey(table.sql) !== sqlKey(upgraded) || !trigger || sqlKey(trigger.sql) !== sqlKey(eventUpdateTrigger)) throw Error("Unsupported usage report schema or receipt");
      return;
    }
    if (!table || sqlKey(table.sql) !== sqlKey(budgetUsageEventTableSql) || !trigger || sqlKey(trigger.sql) !== sqlKey(eventUpdateTrigger)) throw Error("Unowned usage report schema");
    applyOwnedMigrations(database, [usageReportMigration]);
    const capturedAt = new Date().toISOString();
    const rows = database.query("SELECT e.*,t.id AS existing_projection_id FROM main.budget_usage_events e LEFT JOIN main.token_usage t ON t.id=e.token_usage_id").iterate() as Iterable<UsageProjectionEvent & { existing_projection_id: number | null }>;
    for (const event of rows) {
      if (event.existing_projection_id === null) continue;
      const raw = database.query("SELECT * FROM main.token_usage WHERE id=?").get(event.token_usage_id) as TokenUsageRecord;
      let payload;
      try {
        payload = encodeUsageReport(raw, { kind: "legacy_projection_capture", captured_at: capturedAt });
        decodeUsageReport({ ...event, report_payload_json: payload.json, report_payload_sha256: payload.hash });
      } catch { continue; /* Preserve malformed/mismatched legacy evidence without adopting it. */ }
      database.query("UPDATE main.budget_usage_events SET report_payload_json=?,report_payload_sha256=? WHERE usage_event_id=?").run(payload.json, payload.hash, event.usage_event_id);
    }
    database.exec(eventUpdateTrigger);
    initializeUsageReportProjection(database);
  }).immediate();
}
