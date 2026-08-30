import { beforeEach, expect, test } from "bun:test";

import { initDatabase, listCompactionTelemetryAfter, normalizeCompactionTelemetryRecord, pruneCompactionTelemetry, storeCompactionTelemetry } from "../../src/db.js";

beforeEach(initDatabase);

const record = {
  generation_id: "gen-1",
  recorded_at: "2026-08-30T00:00:00.000Z",
  trigger: "manual",
  method: "selective",
  execution: "single_pass",
  outcome: "success" as const,
  provider: "local",
  model: "fast-summary",
  timeout_stage: null,
  input_tokens: 48_000,
  total_duration_ms: 1200,
  deterministic_duration_ms: 200,
  time_to_first_token_ms: 700,
  provider_generation_ms: 300,
  provider_request_count: 1,
  processed_chunk_count: null,
  total_chunk_count: null,
  settlement_timed_out: false,
};

test("compaction telemetry stores one bounded row per generation", () => {
  expect(storeCompactionTelemetry(record)).toBe(true);
  expect(storeCompactionTelemetry({ ...record, outcome: "timeout" })).toBe(false);
  expect(listCompactionTelemetryAfter(0)).toEqual([expect.objectContaining({ id: 1, ...record, settlement_timed_out: 0 })]);
});

test("compaction telemetry retention is bounded", () => {
  for (let index = 1; index <= 5; index += 1) storeCompactionTelemetry({ ...record, generation_id: `gen-${index}` });
  expect(pruneCompactionTelemetry(2)).toBe(3);
  expect(listCompactionTelemetryAfter(0).map((row) => row.generation_id)).toEqual(["gen-4", "gen-5"]);
});

test("compaction telemetry normalizes dimensions without retaining sensitive free text", () => {
  const normalized = normalizeCompactionTelemetryRecord({
    ...record,
    generation_id: "gen secret/token=private",
    trigger: "manual with spaces and secret=private",
    method: "Custom Method",
    execution: "Unknown/Execution",
    provider: "Provider With Spaces",
    model: "Provider With Spaces/model?token=private",
    total_duration_ms: Number.POSITIVE_INFINITY,
  });
  expect(normalized.generation_id).toBe("gen_secret/token");
  expect(normalized.trigger).toBe("manual_with_spaces_and_secret");
  expect(normalized.provider).toBe("provider_with_spaces");
  expect(normalized.model).toBe("model");
  expect(normalized.total_duration_ms).toBe(0);
  expect(JSON.stringify(normalized)).not.toContain("secret=");
  expect(JSON.stringify(normalized)).not.toContain("token=");
});
