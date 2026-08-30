import type { PiclawCompactionTriggerMetadata } from "./compaction-trigger-context.js";
import { storeCompactionTelemetry, type CompactionTelemetryOutcome, type CompactionTelemetryRecord } from "../db.js";
import { parsePiclawCompactionResultDetails } from "../extensions/smart-compaction/result-details.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("agent-pool.compaction-telemetry");

function classifyOutcome(ok: boolean, errorMessage: string | null, execution: string): CompactionTelemetryOutcome {
  if (ok) return execution === "progressive_partial" ? "partial" : "success";
  const error = String(errorMessage ?? "").toLowerCase();
  if (/cancel|abort/.test(error)) return "cancelled";
  if (/timed? out|timeout/.test(error)) return "timeout";
  if (/invalid|validation|summary too short|finish_reason|stop reason/.test(error)) return "validation_error";
  return "provider_error";
}

export function buildCompactionTelemetryRecord(input: {
  metadata: PiclawCompactionTriggerMetadata;
  startedAt: number;
  completedAt?: number;
  outcome: { ok: true; result: unknown } | { ok: false; errorMessage: string };
  settlementTimedOut?: boolean;
}): CompactionTelemetryRecord {
  const completedAt = input.completedAt ?? Date.now();
  const result = input.outcome.ok && input.outcome.result && typeof input.outcome.result === "object"
    ? input.outcome.result as { details?: unknown }
    : null;
  const details = parsePiclawCompactionResultDetails(result?.details);
  const smart = details?.kind === "piclaw.smart_compaction" ? details : null;
  const providerModel = smart?.model ?? input.metadata.providerModel ?? null;
  const slash = providerModel?.indexOf("/") ?? -1;
  const provider = slash > 0 ? providerModel!.slice(0, slash) : null;
  const model = slash > 0 ? providerModel!.slice(slash + 1) : providerModel;
  const totalDurationMs = Math.max(0, completedAt - input.startedAt);
  const ttft = smart?.timeToFirstTokenMs ?? input.metadata.timeToFirstTokenMs ?? null;
  const requestCount = smart?.providerRequestCount ?? input.metadata.providerRequestCount ?? 0;
  const requestStartedAt = input.metadata.providerRequestStartedAtMs;
  const firstTokenAt = input.metadata.providerFirstTokenAtMs;
  const lastOutputAt = input.metadata.providerLastOutputAtMs;
  const singleRequest = requestCount === 1;
  const providerIntervalMs = singleRequest && requestStartedAt !== undefined
    ? Math.max(0, Math.min(completedAt, lastOutputAt ?? completedAt) - requestStartedAt)
    : null;
  const providerGenerationMs = singleRequest && firstTokenAt !== undefined && lastOutputAt !== undefined
    ? Math.max(0, lastOutputAt - firstTokenAt)
    : null;
  const execution = smart?.execution ?? (details?.kind === "piclaw.remote_compaction" ? "provider_native" : input.metadata.compactionExecution ?? "unknown");
  const method = smart?.method ?? (details?.kind === "piclaw.remote_compaction" ? "provider_native" : input.metadata.compactionMethod ?? "unknown");
  const timeoutStage = smart?.timeoutStage ?? input.metadata.executionStage ?? null;
  return {
    generation_id: input.metadata.generationId ?? "unknown",
    recorded_at: new Date(completedAt).toISOString(),
    trigger: input.metadata.trigger,
    method,
    execution,
    outcome: classifyOutcome(input.outcome.ok, input.outcome.ok ? null : input.outcome.errorMessage, execution),
    provider,
    model,
    timeout_stage: timeoutStage,
    input_tokens: input.metadata.compactionInputTokens ?? null,
    total_duration_ms: totalDurationMs,
    deterministic_duration_ms: providerIntervalMs === null ? null : Math.max(0, totalDurationMs - providerIntervalMs),
    time_to_first_token_ms: ttft,
    provider_generation_ms: providerGenerationMs,
    provider_request_count: requestCount,
    processed_chunk_count: smart?.processedChunkCount ?? null,
    total_chunk_count: smart?.totalChunkCount ?? null,
    settlement_timed_out: Boolean(input.settlementTimedOut),
  };
}

export function recordCompactionTelemetry(input: Parameters<typeof buildCompactionTelemetryRecord>[0]): void {
  try {
    const record = buildCompactionTelemetryRecord(input);
    if (!storeCompactionTelemetry(record)) return;
    log.info("Compaction telemetry recorded", {
      operation: "compaction.telemetry",
      generationId: record.generation_id,
      trigger: record.trigger,
      method: record.method,
      execution: record.execution,
      outcome: record.outcome,
      provider: record.provider,
      model: record.model,
      timeoutStage: record.timeout_stage,
      inputTokens: record.input_tokens,
      totalDurationMs: record.total_duration_ms,
      deterministicDurationMs: record.deterministic_duration_ms,
      timeToFirstTokenMs: record.time_to_first_token_ms,
      providerGenerationMs: record.provider_generation_ms,
      providerRequestCount: record.provider_request_count,
      processedChunkCount: record.processed_chunk_count,
      totalChunkCount: record.total_chunk_count,
      settlementTimedOut: record.settlement_timed_out,
    });
  } catch (error) {
    debugSuppressedError(log, "Failed to record compaction telemetry", error, { operation: "compaction.telemetry.persist_failed" });
  }
}
