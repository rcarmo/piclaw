import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import type { TokenUsageRecord } from "./usage-report-types.js";

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
/** Historical references protect report rows only when their original tables
 * exist. No financial schema, migration or execution owner is materialised. */
export function unlinkedUsageReportPredicate(database: Database, alias: "t" | "token_usage"): string {
  const present = new Set((database.query("SELECT name FROM main.sqlite_schema WHERE name IN ('budget_usage_events','budget_request_reservations')").all() as {name:string}[]).map(row=>row.name));
  const clauses: string[] = [];
  if(present.has('budget_usage_events'))clauses.push(`NOT EXISTS (SELECT 1 FROM main.budget_usage_events e WHERE e.token_usage_id=${alias}.id OR e.usage_event_id=${alias}.usage_event_id)`);
  if(present.has('budget_request_reservations'))clauses.push(`NOT EXISTS (SELECT 1 FROM main.budget_request_reservations r WHERE r.id=${alias}.invocation_id OR r.usage_event_id=${alias}.usage_event_id)`);
  return clauses.join(' AND ') || '1';
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
  if (!database.query("SELECT 1 FROM main.sqlite_schema WHERE name='budget_usage_events'").get()) return null;
  const row=database.query("SELECT * FROM main.budget_usage_events WHERE usage_event_id=?").get(eventId) as UsageProjectionEvent | null;
  // Older history may predate payload columns. Absence is unknown evidence,
  // never permission to backfill it from a mutable report or repair the ledger.
  return row ? {...row,report_payload_json:row.report_payload_json??null,report_payload_sha256:row.report_payload_sha256??null} : null;
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
