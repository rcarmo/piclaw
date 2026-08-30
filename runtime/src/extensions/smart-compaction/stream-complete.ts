/**
 * Streaming-aware LLM completion for smart-compaction.
 *
 * Replaces direct `completeSimple` calls with a streaming approach that:
 * 1. Accepts an optional `StreamFn` for proxy/custom provider routing
 * 2. Reports streaming progress (generated tokens) via callback
 * 3. Falls back to standard `streamSimple` when no custom fn is provided
 *
 * This mirrors the upstream pi-coding-agent 0.75.0 fix (#4484) that routes
 * compaction summary calls through custom agent stream functions.
 */

import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, ProviderHeaders, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { normalizeLlmContext } from "../../agent-pool/llm-context-normalizer.js";
import { getRemainingPiclawCompactionMs, updatePiclawCompactionExecution } from "../../agent-pool/compaction-trigger-context.js";
import { SMART_COMPACTION_PROGRESS_INTERVAL_MS } from "./config.js";

/**
 * A stream function compatible with the upstream StreamFn type.
 * Accepts the same arguments as `streamSimple` and returns an async iterable
 * that yields AssistantMessageEvent objects with a `.result()` promise.
 */
export type CompactionStream = {
  result(): Promise<AssistantMessage>;
  [Symbol.asyncIterator](): AsyncIterator<any>;
};

export type CompactionStreamFn = (
  model: any,
  context: { systemPrompt?: string; messages: any[] },
  options?: SimpleStreamOptions,
) => CompactionStream | Promise<CompactionStream>;

export interface StreamCompleteOptions {
  model: any;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  signal: AbortSignal;
  apiKey?: string;
  headers?: ProviderHeaders;
  env?: SimpleStreamOptions["env"];
  reasoning?: "minimal" | "low" | "medium" | "high";
  /** Optional provider-payload transform (used to rehydrate native compaction state). */
  onPayload?: SimpleStreamOptions["onPayload"];
  /** Custom stream function for proxy-routed providers. Falls back to streamSimple. */
  streamFn?: CompactionStreamFn;
  /** Called after provider response headers arrive and before any response token. */
  onResponseHeaders?: () => void;
  /** Called when the provider stream is created, before any response token arrives. */
  onWaitingForFirstToken?: (timing: { requestStartedAt: number; timeoutMs?: number }) => void;
  /** Called on the first provider stream event with request timing. */
  onFirstToken?: (timing: { requestStartedAt: number; firstTokenAt: number; timeToFirstTokenMs: number }) => void;
  /** Called periodically with the number of text characters generated so far. */
  onProgress?: (generatedChars: number) => void;
  /** Interval in ms between progress reports (default: 5000ms). */
  progressIntervalMs?: number;
}

/**
 * Complete an LLM request using streaming, collecting the response and
 * optionally reporting progress. Uses the provided `streamFn` for custom
 * provider routing, falling back to the standard `streamSimple`.
 */
export async function streamComplete(opts: StreamCompleteOptions): Promise<AssistantMessage> {
  const {
    model, systemPrompt, userPrompt, maxTokens, signal,
    apiKey, headers, env, reasoning, onPayload, streamFn, onResponseHeaders, onWaitingForFirstToken, onFirstToken, onProgress,
    progressIntervalMs = SMART_COMPACTION_PROGRESS_INTERVAL_MS,
  } = opts;

  if (signal.aborted) throw new Error("Compaction cancelled");

  const context = {
    systemPrompt,
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: userPrompt }], timestamp: Date.now() }],
  };

  const requestTimeoutMs = getRemainingPiclawCompactionMs();
  const requestStartedAt = Date.now();
  updatePiclawCompactionExecution({ executionStage: "provider_connect", providerModel: `${String(model?.provider || "unknown")}/${String(model?.id || "unknown")}`, providerRequestStartedAtMs: requestStartedAt });
  const onResponse = () => {
    updatePiclawCompactionExecution({ executionStage: "first_token" });
    onResponseHeaders?.();
  };
  const streamOptions: SimpleStreamOptions = reasoning
    ? { maxTokens, signal, apiKey, headers, env, reasoning, onPayload, onResponse, cacheRetention: "none", ...(requestTimeoutMs ? { timeoutMs: requestTimeoutMs } : {}) }
    : { maxTokens, signal, apiKey, headers, env, onPayload, onResponse, cacheRetention: "none", ...(requestTimeoutMs ? { timeoutMs: requestTimeoutMs } : {}) };

  const normalizedContext = normalizeLlmContext(context);

  // Use custom stream function if provided, otherwise standard streamSimple
  let stream: CompactionStream;
  try {
    stream = await (streamFn
      ? streamFn(model, normalizedContext, streamOptions)
      : streamSimple(model, normalizedContext, streamOptions));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Compaction provider request failed before streaming: ${message}`, { cause: error });
  }
  onWaitingForFirstToken?.({ requestStartedAt, timeoutMs: requestTimeoutMs });

  // If no progress callback, just collect the result directly. Check the
  // caller signal again even if a custom provider resolves after cancellation.
  if (!onProgress) {
    const result = await stream.result();
    if (signal.aborted) throw new Error("Compaction cancelled");
    updatePiclawCompactionExecution({ executionStage: "deterministic" });
    return result;
  }

  // Stream with progress reporting
  let generatedChars = 0;
  let firstEventObserved = false;
  let lastReportTime = 0;

  for await (const event of stream) {
    if (signal.aborted) throw new Error("Compaction cancelled");
    if (!firstEventObserved && (event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string" && event.delta.length > 0) {
      firstEventObserved = true;
      const firstTokenAt = Date.now();
      const timeToFirstTokenMs = Math.max(0, firstTokenAt - requestStartedAt);
      updatePiclawCompactionExecution({ executionStage: "streaming", providerFirstTokenAtMs: firstTokenAt, providerLastOutputAtMs: firstTokenAt, timeToFirstTokenMs });
      onFirstToken?.({ requestStartedAt, firstTokenAt, timeToFirstTokenMs });
    }
    if ((event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string" && event.delta.length > 0) {
      updatePiclawCompactionExecution({ providerLastOutputAtMs: Date.now() });
    }
    if (event.type === "text_delta") {
      generatedChars += event.delta.length;
      const now = Date.now();
      if (now - lastReportTime >= progressIntervalMs) {
        onProgress(generatedChars);
        lastReportTime = now;
      }
    }
  }

  if (signal.aborted) throw new Error("Compaction cancelled");

  // Final progress report
  if (generatedChars > 0) {
    onProgress(generatedChars);
  }

  const result = await stream.result();
  if (signal.aborted) throw new Error("Compaction cancelled");
  updatePiclawCompactionExecution({ executionStage: "deterministic" });
  return result;
}
