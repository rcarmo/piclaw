export type CompactionTimeoutStage = "provider_connect" | "first_token" | "streaming" | "deterministic" | "settlement";

export interface CompactionProviderTiming {
  model: string;
  requestCount: number;
  requestStartedAt: number | null;
  waitingForFirstTokenSince: number | null;
  firstTokenAt: number | null;
  timeToFirstTokenMs: number | null;
  timeoutStage: CompactionTimeoutStage | null;
}

export function inferCompactionTimeoutStage(timing: CompactionProviderTiming): CompactionTimeoutStage {
  return timing.waitingForFirstTokenSince !== null
    ? "first_token"
    : timing.firstTokenAt !== null
      ? "streaming"
      : timing.requestStartedAt !== null
        ? "provider_connect"
        : "deterministic";
}

export function formatCompactionProviderTimeout(message: string, timing: CompactionProviderTiming): string {
  const stage = inferCompactionTimeoutStage(timing);
  timing.timeoutStage = stage;
  const timingDetail = timing.timeToFirstTokenMs === null ? "" : `; first token after ${timing.timeToFirstTokenMs}ms`;
  return `Compaction provider timed out during ${stage} using ${timing.model}${timingDetail}: ${message}`;
}

export function formatFirstTokenWaitStatus(
  timing: Pick<CompactionProviderTiming, "model" | "waitingForFirstTokenSince">,
  now: number,
  deadlineAtMs?: number,
): string | null {
  if (timing.waitingForFirstTokenSince === null) return null;
  const elapsedSec = Math.max(0, Math.round((now - timing.waitingForFirstTokenSince) / 1000));
  const remaining = deadlineAtMs === undefined ? "" : `, ${Math.ceil(Math.max(0, deadlineAtMs - now) / 1000)}s remaining`;
  return `waiting for first token from ${timing.model} — ${elapsedSec}s elapsed${remaining}`;
}

export function createCompactionProviderTiming(model: { provider?: unknown; id?: unknown }): CompactionProviderTiming {
  return {
    model: `${String(model?.provider || "unknown")}/${String(model?.id || "unknown")}`,
    requestCount: 0,
    requestStartedAt: null,
    waitingForFirstTokenSince: null,
    firstTokenAt: null,
    timeToFirstTokenMs: null,
    timeoutStage: null,
  };
}
