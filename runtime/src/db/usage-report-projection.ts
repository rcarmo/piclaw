import type Database from "bun:sqlite";
import type { TokenUsageRecord } from "./usage-report-types.js";

export const tokenReportColumns = ["chat_jid", "run_at", "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
  "cache_read_reported", "cache_write_reported", "total_tokens", "cost_input", "cost_output", "cost_cache_read", "cost_cache_write", "cost_total",
  "provider_cost_total", "provider_cost_currency", "catalogue_cost_total", "cost_provenance", "model", "response_model", "provider", "api", "usage_source", "turns", "work_id",
  "invocation_id", "usage_event_id", "api_equivalent_cost_microusd", "api_equivalent_cost_known", "valuation_provenance", "api_equivalent_known_subtotal_microusd",
  "api_equivalent_unknown_categories", "pricing_currency", "pricing_source", "pricing_version", "pricing_context_tier", "pricing_cache_fallbacks"] as const;
type Report = Record<typeof tokenReportColumns[number], string | number | null>;

/** Historical references protect report rows only when their original tables
 * exist. No financial schema, migration or execution owner is materialised. */
export function unlinkedUsageReportPredicate(database: Database, alias: "t" | "token_usage"): string {
  const present = new Set((database.query("SELECT name FROM main.sqlite_schema WHERE name IN ('budget_usage_events','budget_request_reservations')").all() as {name:string}[]).map(row=>row.name));
  const clauses: string[] = [];
  if(present.has('budget_usage_events'))clauses.push(`NOT EXISTS (SELECT 1 FROM main.budget_usage_events e WHERE e.token_usage_id=${alias}.id OR e.usage_event_id=${alias}.usage_event_id)`);
  if(present.has('budget_request_reservations'))clauses.push(`NOT EXISTS (SELECT 1 FROM main.budget_request_reservations r WHERE r.id=${alias}.invocation_id OR r.usage_event_id=${alias}.usage_event_id)`);
  return clauses.join(' AND ') || '1';
}

export function usageReportRecord(record: TokenUsageRecord): Report {
  const values = Object.fromEntries(tokenReportColumns.map(column => [column, record[column] ?? null])) as Report;
  values.reasoning_tokens = record.reasoning_tokens ?? 0;
  values.usage_source = record.usage_source ?? "assistant";
  for (const column of ["cache_read_reported", "cache_write_reported", "api_equivalent_cost_known"] as const) {
    const value = record[column as keyof TokenUsageRecord];
    values[column] = value == null ? null : Number(value);
  }
  return values;
}
