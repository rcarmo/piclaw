import { getDb } from "./connection.js";

export type CompactionTelemetryOutcome = "success" | "cancelled" | "timeout" | "provider_error" | "validation_error" | "partial";
export type CompactionTelemetryStage = "deterministic" | "provider_connect" | "first_token" | "streaming" | "settlement" | null;

export interface CompactionTelemetryRecord {
  generation_id: string;
  recorded_at: string;
  trigger: string;
  method: string;
  execution: string;
  outcome: CompactionTelemetryOutcome;
  provider: string | null;
  model: string | null;
  timeout_stage: CompactionTelemetryStage;
  input_tokens: number | null;
  total_duration_ms: number;
  deterministic_duration_ms: number | null;
  time_to_first_token_ms: number | null;
  provider_generation_ms: number | null;
  provider_request_count: number;
  processed_chunk_count: number | null;
  total_chunk_count: number | null;
  settlement_timed_out: boolean;
}

const cleanDimension = (value: unknown, fallback: string, max = 96): string => {
  const source = String(value ?? "").trim().toLowerCase().split(/[?#]/, 1)[0]!.split(/[=;]/, 1)[0]!;
  return source.replace(/[^a-z0-9._/-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max) || fallback;
};
const finiteMs = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
const finiteCount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

export function normalizeCompactionTelemetryRecord(input: CompactionTelemetryRecord): CompactionTelemetryRecord {
  const modelLabel = String(input.model ?? "").trim();
  const slash = modelLabel.indexOf("/");
  const provider = cleanDimension(input.provider ?? (slash > 0 ? modelLabel.slice(0, slash) : ""), "unknown", 48);
  const model = cleanDimension(slash > 0 ? modelLabel.slice(slash + 1) : modelLabel, "unknown", 96);
  const outcomes = new Set<CompactionTelemetryOutcome>(["success", "cancelled", "timeout", "provider_error", "validation_error", "partial"]);
  const stages = new Set(["deterministic", "provider_connect", "first_token", "streaming", "settlement"]);
  return {
    generation_id: cleanDimension(input.generation_id, "unknown", 80),
    recorded_at: Number.isFinite(Date.parse(input.recorded_at)) ? input.recorded_at : new Date().toISOString(),
    trigger: cleanDimension(input.trigger, "unknown", 40),
    method: cleanDimension(input.method, "unknown", 40),
    execution: cleanDimension(input.execution, "unknown", 40),
    outcome: outcomes.has(input.outcome) ? input.outcome : "provider_error",
    provider,
    model,
    timeout_stage: input.timeout_stage && stages.has(input.timeout_stage) ? input.timeout_stage : null,
    input_tokens: finiteCount(input.input_tokens),
    total_duration_ms: finiteMs(input.total_duration_ms) ?? 0,
    deterministic_duration_ms: finiteMs(input.deterministic_duration_ms),
    time_to_first_token_ms: finiteMs(input.time_to_first_token_ms),
    provider_generation_ms: finiteMs(input.provider_generation_ms),
    provider_request_count: finiteCount(input.provider_request_count) ?? 0,
    processed_chunk_count: finiteCount(input.processed_chunk_count),
    total_chunk_count: finiteCount(input.total_chunk_count),
    settlement_timed_out: Boolean(input.settlement_timed_out),
  };
}

export function pruneCompactionTelemetry(maxRows = 10_000): number {
  const limit = Math.max(1, Math.floor(maxRows));
  return getDb().prepare(`DELETE FROM compaction_telemetry WHERE id NOT IN (SELECT id FROM compaction_telemetry ORDER BY id DESC LIMIT ?)`).run(limit).changes;
}

export function storeCompactionTelemetry(input: CompactionTelemetryRecord): boolean {
  const record = normalizeCompactionTelemetryRecord(input);
  const db = getDb();
  const result = db.prepare(`INSERT OR IGNORE INTO compaction_telemetry (
    generation_id, recorded_at, trigger, method, execution, outcome, provider, model, timeout_stage, input_tokens,
    total_duration_ms, deterministic_duration_ms, time_to_first_token_ms, provider_generation_ms,
    provider_request_count, processed_chunk_count, total_chunk_count, settlement_timed_out
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.generation_id, record.recorded_at, record.trigger, record.method, record.execution, record.outcome,
    record.provider, record.model, record.timeout_stage, record.input_tokens, record.total_duration_ms, record.deterministic_duration_ms,
    record.time_to_first_token_ms, record.provider_generation_ms, record.provider_request_count,
    record.processed_chunk_count, record.total_chunk_count, Number(record.settlement_timed_out),
  );
  if (result.changes > 0) {
    pruneCompactionTelemetry();
  }
  return result.changes > 0;
}

export function getLatestCompactionTelemetryInput(provider: string, model: string, recordedAfter: string): { input_tokens: number; recorded_at: string } | null {
  return getDb().prepare(`SELECT input_tokens, recorded_at FROM compaction_telemetry
    WHERE provider = ? AND model = ? AND input_tokens IS NOT NULL AND recorded_at >= ?
      AND outcome IN ('success', 'partial')
    ORDER BY recorded_at DESC, id DESC LIMIT 1`
  ).get(provider, model, recordedAfter) as { input_tokens: number; recorded_at: string } | null;
}

export function getCompactionTelemetrySamples(input: {
  provider: string;
  model: string;
  minInputTokens: number;
  maxInputTokens: number;
  recordedAfter: string;
  limit?: number;
}): Array<Pick<CompactionTelemetryRecord, "recorded_at" | "total_duration_ms" | "time_to_first_token_ms" | "provider_generation_ms" | "input_tokens" | "outcome">> {
  const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 100)));
  return getDb().prepare(`SELECT recorded_at, total_duration_ms, time_to_first_token_ms, provider_generation_ms, input_tokens, outcome
    FROM compaction_telemetry
    WHERE provider = ? AND model = ? AND input_tokens >= ? AND input_tokens < ? AND recorded_at >= ?
      AND outcome IN ('success', 'partial')
    ORDER BY recorded_at DESC, id DESC LIMIT ?`
  ).all(input.provider, input.model, input.minInputTokens, input.maxInputTokens, input.recordedAfter, limit) as ReturnType<typeof getCompactionTelemetrySamples>;
}

export function listCompactionTelemetryAfter(id: number, limit = 500): Array<CompactionTelemetryRecord & { id: number }> {
  const bounded = Math.min(2_000, Math.max(1, Math.floor(limit)));
  return getDb().prepare(`SELECT * FROM compaction_telemetry WHERE id > ? ORDER BY id LIMIT ?`).all(id, bounded) as Array<CompactionTelemetryRecord & { id: number }>;
}
