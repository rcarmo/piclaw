import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { getCompactionRuntimeConfig } from "../core/config.js";
import { buildLatestCompactionLatencyEstimate, type CompactionLatencyEstimate } from "./compaction-prefill-estimate.js";

const PROBE_TIMEOUT_MAX_MS = 30_000;
const PROBE_PROMPT = "Reply with exactly: compaction probe ready";

export interface CompactionModelProbeResult {
  ok: boolean;
  model: string;
  contextWindow: number | null;
  timeoutMs: number;
  responseReceived: boolean;
  credentialStatus: "verified" | "unverified";
  stage: "completed" | "provider_connect" | "first_token" | "streaming";
  timeToFirstTokenMs: number | null;
  durationMs: number;
  compactionLatencyEstimate: CompactionLatencyEstimate | null;
  error: string | null;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return Array.from(message
    .replace(/\b(?:sk|pk|api|key|token|secret)-[A-Za-z0-9._-]+\b/gi, "[redacted]")
    .replace(/(authorization|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]"))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 31 && code !== 127 || char === "\t" || char === "\n" || char === "\r";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || "Compaction model probe failed";
}

function failureStage(responseReceived: boolean, firstTokenAt: number | null): CompactionModelProbeResult["stage"] {
  return !responseReceived ? "provider_connect" : firstTokenAt === null ? "first_token" : "streaming";
}

export async function probeCompactionModel(
  modelRuntime: Pick<ModelRuntime, "getModel" | "streamSimple">,
  modelLabel: string,
): Promise<CompactionModelProbeResult> {
  const configured = modelLabel.trim();
  const separator = configured.indexOf("/");
  if (separator <= 0 || separator === configured.length - 1) {
    throw new Error("Provide an exact provider/model compaction model");
  }
  const provider = configured.slice(0, separator);
  const modelId = configured.slice(separator + 1);
  const model = modelRuntime.getModel(provider, modelId) as Model<any> | undefined;
  if (!model) throw new Error(`Compaction model is unavailable: ${configured}`);

  const compactionDeadlineMs = getCompactionRuntimeConfig().timeoutMs;
  const timeoutMs = Math.max(1, Math.min(PROBE_TIMEOUT_MAX_MS, compactionDeadlineMs));
  const compactionLatencyEstimate = buildLatestCompactionLatencyEstimate({ provider: model.provider, model: model.id, deadlineMs: compactionDeadlineMs });
  const controller = new AbortController();
  const startedAt = Date.now();
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const timeout = setTimeout(() => {
    const error = new Error(`Compaction model probe timed out after ${timeoutMs}ms`);
    controller.abort(error);
    rejectDeadline(error);
  }, timeoutMs);
  let responseReceived = false;
  let firstTokenAt: number | null = null;
  try {
    const result = await Promise.race([deadline, (async () => {
      const stream = await modelRuntime.streamSimple(model, {
        systemPrompt: "You are a connectivity probe. Do not call tools.",
        messages: [{ role: "user", content: [{ type: "text", text: PROBE_PROMPT }], timestamp: startedAt }],
      }, {
        maxTokens: 32,
        signal: controller.signal,
        timeoutMs,
        maxRetries: 0,
        cacheRetention: "none",
        onResponse: () => { responseReceived = true; },
      });
      for await (const event of stream) {
        if (firstTokenAt === null && (event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string" && event.delta.length > 0) {
          firstTokenAt = Date.now();
        }
      }
      return await stream.result();
    })()]);
    const durationMs = Math.max(0, Date.now() - startedAt);
    if (result.stopReason === "error" || result.stopReason === "aborted") {
      throw new Error(result.errorMessage || `Probe ended with ${result.stopReason}`);
    }
    return {
      ok: true,
      model: `${model.provider}/${model.id}`,
      contextWindow: Number.isFinite(model.contextWindow) && model.contextWindow > 0 ? model.contextWindow : null,
      timeoutMs,
      responseReceived,
      credentialStatus: "verified",
      stage: "completed",
      timeToFirstTokenMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
      durationMs,
      compactionLatencyEstimate,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      model: `${model.provider}/${model.id}`,
      contextWindow: Number.isFinite(model.contextWindow) && model.contextWindow > 0 ? model.contextWindow : null,
      timeoutMs,
      responseReceived,
      credentialStatus: "unverified",
      stage: failureStage(responseReceived, firstTokenAt),
      timeToFirstTokenMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
      durationMs: Math.max(0, Date.now() - startedAt),
      compactionLatencyEstimate,
      error: safeError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
