import { afterEach, beforeEach, expect, test } from "bun:test";

import { buildCompactionLatencyEstimate, compactionInputTokenBucket } from "../../src/agent-pool/compaction-prefill-estimate.js";
import { initDatabase, storeCompactionTelemetry } from "../../src/db.js";
import { getCompactionRuntimeConfig, resetCompactionRuntimeConfigForTests, setCompactionRuntimeConfigForTests } from "../../src/core/config.js";

process.env.PICLAW_DB_IN_MEMORY = "1";
beforeEach(() => { initDatabase(); resetCompactionRuntimeConfigForTests(); });
afterEach(resetCompactionRuntimeConfigForTests);

function sample(index: number, inputTokens: number, durationMs: number, recordedAt: string, outcome: "success" | "partial" | "timeout" = "success", model = "summary") {
  storeCompactionTelemetry({
    generation_id: `estimate-${model}-${index}-${inputTokens}-${outcome}`,
    recorded_at: recordedAt,
    trigger: "manual",
    method: "selective",
    execution: outcome === "partial" ? "progressive_partial" : "single_pass",
    outcome,
    provider: "local",
    model,
    timeout_stage: outcome === "timeout" ? "first_token" : null,
    input_tokens: inputTokens,
    total_duration_ms: durationMs,
    deterministic_duration_ms: 100,
    time_to_first_token_ms: Math.floor(durationMs * 0.7),
    provider_generation_ms: Math.floor(durationMs * 0.2),
    provider_request_count: 1,
    processed_chunk_count: null,
    total_chunk_count: null,
    settlement_timed_out: false,
  });
}

const now = Date.parse("2026-08-30T12:00:00Z");

test("power-of-two token buckets are deterministic and bounded", () => {
  expect(compactionInputTokenBucket(48_000)).toEqual({ min: 32_768, max: 65_536 });
  expect(compactionInputTokenBucket(65_536)).toEqual({ min: 65_536, max: 131_072 });
  expect(compactionInputTokenBucket(0)).toEqual({ min: 1, max: 2 });
});

test("requires three fresh successful/partial exact-model samples", () => {
  sample(1, 48_000, 40_000, "2026-08-30T09:00:00Z");
  sample(2, 48_000, 50_000, "2026-08-30T10:00:00Z");
  expect(buildCompactionLatencyEstimate({ provider: "local", model: "summary", inputTokens: 48_000, deadlineMs: 60_000, now })).toBeNull();
  sample(3, 48_000, 55_000, "2026-08-30T11:00:00Z", "partial");
  sample(4, 70_000, 999_000, "2026-08-30T11:30:00Z");
  sample(5, 48_000, 999_000, "2026-08-01T11:30:00Z");
  sample(6, 48_000, 999_000, "2026-08-30T11:45:00Z", "timeout");

  const estimate = buildCompactionLatencyEstimate({ provider: "local", model: "summary", inputTokens: 48_000, deadlineMs: 60_000, now });
  expect(estimate).toMatchObject({ sampleCount: 3, medianDurationMs: 50_000, p90DurationMs: 55_000, warning: true });
  expect(estimate?.warningText).toContain("3 recent samples");
  expect(estimate?.warningText).toContain("configured deadline is 60s");
});

test("warning uses conservative p90 at eighty percent without changing deadline", () => {
  const model = "summary-threshold";
  for (const [index, duration] of [20_000, 30_000, 79_999].entries()) sample(index + 10, 48_000, duration, `2026-08-30T0${index + 7}:00:00Z`, "success", model);
  setCompactionRuntimeConfigForTests({ timeoutMs: 100_000 });
  const before = getCompactionRuntimeConfig().timeoutMs;
  const safe = buildCompactionLatencyEstimate({ provider: "local", model, inputTokens: 48_000, deadlineMs: before, now });
  expect(safe?.warning).toBe(false);
  sample(20, 48_000, 80_000, "2026-08-30T11:55:00Z", "success", model);
  const warning = buildCompactionLatencyEstimate({ provider: "local", model, inputTokens: 48_000, deadlineMs: before, now });
  expect(warning).toMatchObject({ warning: true, medianDurationMs: 54_999.5, p90DurationMs: 80_000 });
  expect(getCompactionRuntimeConfig().timeoutMs).toBe(before);
});
