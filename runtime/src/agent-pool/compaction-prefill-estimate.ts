import { getCompactionTelemetrySamples, getLatestCompactionTelemetryInput } from "../db.js";

const MIN_SAMPLES = 3;
const FRESHNESS_MS = 14 * 24 * 60 * 60_000;
const WARN_DEADLINE_RATIO = 0.8;

export interface CompactionLatencyEstimate {
  provider: string;
  model: string;
  inputBucketMin: number;
  inputBucketMax: number;
  sampleCount: number;
  oldestSampleAt: string;
  newestSampleAt: string;
  medianDurationMs: number;
  p90DurationMs: number;
  medianTtftMs: number | null;
  p90TtftMs: number | null;
  warning: boolean;
  warningText: string | null;
}

export function compactionInputTokenBucket(inputTokens: number): { min: number; max: number } {
  const tokens = Math.max(1, Math.floor(Number(inputTokens) || 1));
  const exponent = Math.floor(Math.log2(tokens));
  const min = 2 ** exponent;
  return { min, max: min * 2 };
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2 : sorted[midpoint]!;
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index]!;
}

function duration(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function buildLatestCompactionLatencyEstimate(input: {
  provider: string;
  model: string;
  deadlineMs: number;
  now?: number;
}): CompactionLatencyEstimate | null {
  const now = input.now ?? Date.now();
  try {
    const latest = getLatestCompactionTelemetryInput(input.provider, input.model, new Date(now - FRESHNESS_MS).toISOString());
    return latest ? buildCompactionLatencyEstimate({ ...input, inputTokens: latest.input_tokens, now }) : null;
  } catch (error) {
    if (error instanceof Error && /Database not initialized|closed database|no such table/i.test(error.message)) return null;
    throw error;
  }
}

export function buildCompactionLatencyEstimate(input: {
  provider: string;
  model: string;
  inputTokens: number;
  deadlineMs: number;
  now?: number;
}): CompactionLatencyEstimate | null {
  const now = input.now ?? Date.now();
  const bucket = compactionInputTokenBucket(input.inputTokens);
  const samples = getCompactionTelemetrySamples({
    provider: input.provider,
    model: input.model,
    minInputTokens: bucket.min,
    maxInputTokens: bucket.max,
    recordedAfter: new Date(now - FRESHNESS_MS).toISOString(),
  });
  if (samples.length < MIN_SAMPLES) return null;
  const durations = samples.map(sample => sample.total_duration_ms).filter(value => Number.isFinite(value) && value >= 0);
  if (durations.length < MIN_SAMPLES) return null;
  const ttfts = samples.flatMap(sample => sample.time_to_first_token_ms == null ? [] : [sample.time_to_first_token_ms]);
  const medianDurationMs = median(durations);
  const p90DurationMs = percentile(durations, 0.9);
  const warning = input.deadlineMs > 0 && p90DurationMs >= input.deadlineMs * WARN_DEADLINE_RATIO;
  const oldestSampleAt = samples.at(-1)!.recorded_at;
  const newestSampleAt = samples[0]!.recorded_at;
  return {
    provider: input.provider,
    model: input.model,
    inputBucketMin: bucket.min,
    inputBucketMax: bucket.max,
    sampleCount: samples.length,
    oldestSampleAt,
    newestSampleAt,
    medianDurationMs,
    p90DurationMs,
    medianTtftMs: ttfts.length >= MIN_SAMPLES ? median(ttfts) : null,
    p90TtftMs: ttfts.length >= MIN_SAMPLES ? percentile(ttfts, 0.9) : null,
    warning,
    warningText: warning
      ? `Observed compaction time for ${input.provider}/${input.model} at ${bucket.min.toLocaleString()}–${(bucket.max - 1).toLocaleString()} input tokens is typically ${duration(medianDurationMs / 1000)} and up to ${duration(p90DurationMs / 1000)} across ${samples.length} recent samples; the configured deadline is ${duration(input.deadlineMs / 1000)}. Consider a faster/smaller compaction model, progressive compaction, or a longer deadline.`
      : null,
  };
}
