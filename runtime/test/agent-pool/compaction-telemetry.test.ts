import { expect, test } from "bun:test";

import { buildCompactionTelemetryRecord } from "../../src/agent-pool/compaction-telemetry.js";

const metadata = {
  chatJid: "web:secret-chat-not-persisted",
  trigger: "manual",
  willRetry: false,
  source: "test",
  generationId: "generation-1",
  executionStage: "streaming" as const,
  compactionInputTokens: 48_000,
  providerModel: "local/fast-summary",
  providerRequestCount: 1,
  providerRequestStartedAtMs: 1_100,
  providerFirstTokenAtMs: 1_500,
  providerLastOutputAtMs: 1_900,
  timeToFirstTokenMs: 400,
};

test("builder derives truthful single-request phase durations and success metadata", () => {
  const record = buildCompactionTelemetryRecord({
    metadata,
    startedAt: 1_000,
    completedAt: 2_000,
    outcome: { ok: true, result: { details: {
      kind: "piclaw.smart_compaction",
      version: 1,
      method: "selective",
      execution: "single_pass",
      remoteCompaction: { outcome: "disabled" },
      modelCallCount: 1,
      model: "local/fast-summary",
      providerRequestCount: 1,
      timeToFirstTokenMs: 400,
      durationMs: 1_000,
    } } },
  });
  expect(record).toMatchObject({
    outcome: "success",
    provider: "local",
    model: "fast-summary",
    input_tokens: 48_000,
    total_duration_ms: 1_000,
    deterministic_duration_ms: 200,
    time_to_first_token_ms: 400,
    provider_generation_ms: 400,
    provider_request_count: 1,
  });
  expect(JSON.stringify(record)).not.toContain("secret-chat");
});

test("builder leaves ambiguous progressive phase durations null and classifies partial", () => {
  const record = buildCompactionTelemetryRecord({
    metadata: { ...metadata, providerRequestCount: 3 },
    startedAt: 1_000,
    completedAt: 2_500,
    outcome: { ok: true, result: { details: {
      kind: "piclaw.smart_compaction",
      version: 1,
      method: "pipelined",
      execution: "progressive_partial",
      remoteCompaction: { outcome: "disabled" },
      modelCallCount: 3,
      model: "local/fast-summary",
      providerRequestCount: 3,
      processedChunkCount: 2,
      totalChunkCount: 4,
    } } },
  });
  expect(record).toMatchObject({
    outcome: "partial",
    deterministic_duration_ms: null,
    provider_generation_ms: null,
    processed_chunk_count: 2,
    total_chunk_count: 4,
  });
});

test("builder classifies timeout, cancellation, validation, and provider failures without storing errors", () => {
  const cases = [
    ["Compaction timed out during first_token secret=private", "timeout"],
    ["Compaction cancelled by operator secret=private", "cancelled"],
    ["Smart compaction output invalid secret=private", "validation_error"],
    ["Provider unavailable secret=private", "provider_error"],
  ] as const;
  for (const [errorMessage, outcome] of cases) {
    const record = buildCompactionTelemetryRecord({ metadata, startedAt: 1_000, completedAt: 2_000, outcome: { ok: false, errorMessage } });
    expect(record.outcome).toBe(outcome);
    expect(JSON.stringify(record)).not.toContain("private");
  }
});
