/** Single-pass provider execution, lossless repair retry, and terminal validation. */
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { createLogger } from "../../utils/logger.js";
import { estimateCompactionPromptTokens } from "./context.js";
import { isCompactionInputOverflow } from "./boundary-policy.js";
import { getCompactionReasoningEffort, getSafeCompactionMaxTokens } from "./safety.js";
import { SYSTEM_PROMPT } from "./selective-prompt.js";
import { streamComplete, type CompactionStreamFn } from "./stream-complete.js";
import { buildCompactionRepairInstruction, validateCompactionSummaryResponse } from "./summary-validation.js";
import { updatePiclawCompactionExecution } from "../../agent-pool/compaction-trigger-context.js";
import { formatCompactionProviderTimeout, type CompactionProviderTiming } from "./provider-timing.js";

const log = createLogger("ext.smart-compaction.model-execution");

export type CompactionModelStage = "generating" | "output_repair_retry";

export type CompactionModelExecutionResult =
  | { ok: true; summary: string; modelCallCount: number }
  | { ok: false; cancelled: boolean; error: string; modelCallCount: number };

export async function runCompactionModelExecution(input: {
  model: any;
  auth: { apiKey?: string; headers?: ProviderHeaders; env?: Record<string, string> };
  promptText: string;
  requestedMaxTokens: number;
  abortSignal: AbortSignal;
  streamFn?: CompactionStreamFn;
  onPayload?: (payload: unknown, model: any) => unknown | undefined | Promise<unknown | undefined>;
  onStage?: (stage: CompactionModelStage, promptTokens: number) => void;
  onProgress?: () => void;
  providerTiming?: CompactionProviderTiming;
}): Promise<CompactionModelExecutionResult> {
  let activePromptText = input.promptText;
  let modelCallCount = 0;

  const runCompletion = async (prompt: string) => {
    modelCallCount += 1;
    const safeOutput = getSafeCompactionMaxTokens(input.model, prompt, input.requestedMaxTokens);
    const response = await streamComplete({
      model: input.model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens: safeOutput.maxTokens,
      signal: input.abortSignal,
      apiKey: input.auth.apiKey,
      headers: input.auth.headers,
      env: input.auth.env,
      reasoning: input.model?.reasoning ? getCompactionReasoningEffort(input.model, "selective") : undefined,
      onPayload: input.onPayload,
      streamFn: input.streamFn,
      onWaitingForFirstToken: ({ requestStartedAt }) => {
        if (!input.providerTiming) return;
        input.providerTiming.requestCount += 1;
        updatePiclawCompactionExecution({ providerRequestCount: input.providerTiming.requestCount });
        input.providerTiming.requestStartedAt = requestStartedAt;
        input.providerTiming.waitingForFirstTokenSince = requestStartedAt;
      },
      onFirstToken: ({ firstTokenAt, timeToFirstTokenMs }) => {
        if (!input.providerTiming) return;
        input.providerTiming.waitingForFirstTokenSince = null;
        input.providerTiming.firstTokenAt ??= firstTokenAt;
        input.providerTiming.timeToFirstTokenMs ??= timeToFirstTokenMs;
      },
      onProgress: input.onProgress,
    });
    return { response, maxOutputChars: safeOutput.maxTokens * 4 };
  };

  try {
    input.onStage?.("generating", estimateCompactionPromptTokens(activePromptText));
    let response: any;
    let maxOutputChars = input.requestedMaxTokens * 4;
    let retryCount = 0;
    ({ response, maxOutputChars } = await runCompletion(activePromptText));

    let validation = validateCompactionSummaryResponse(response, "final", maxOutputChars, {
      modelFileBlocks: "discard",
    });
    const responseErrorMessage = typeof response?.errorMessage === "string" ? response.errorMessage : "";
    const providerInputOverflow = response?.stopReason === "error" && isCompactionInputOverflow(responseErrorMessage);
    if (!validation.ok && validation.retryable && !providerInputOverflow && !input.abortSignal.aborted) {
      const repairInstruction = buildCompactionRepairInstruction("final", validation.reason);
      const retryPrompt = `${activePromptText}${repairInstruction}`;
      let retryFits = true;
      try {
        getSafeCompactionMaxTokens(input.model, retryPrompt, input.requestedMaxTokens);
      } catch (error) {
        if (isCompactionInputOverflow(error instanceof Error ? error.message : String(error))) retryFits = false;
        else throw error;
      }

      if (retryFits && retryCount === 0) {
        retryCount = 1;
        activePromptText = retryPrompt;
        log.debug("Smart compaction output rejected; retrying once with the complete source prompt and repair instructions", {
          operation: "smart_compaction.output_retry",
          stopReason: response?.stopReason ?? "missing",
          validationFailure: validation.ok ? null : validation.code,
          retryCount,
        });
        input.onStage?.("output_repair_retry", estimateCompactionPromptTokens(activePromptText));
        ({ response, maxOutputChars } = await runCompletion(activePromptText));
        validation = validateCompactionSummaryResponse(response, "final", maxOutputChars, {
          modelFileBlocks: "discard",
        });
      }
    }

    if (!validation.ok) {
      const errorMessage = response?.stopReason === "error" && response?.errorMessage
        ? `${validation.reason}: ${response.errorMessage}`
        : validation.reason;
      log.debug("Smart compaction output validation failed; refusing partial output", {
        operation: "smart_compaction.output_invalid",
        stopReason: validation.stopReason,
        validationFailure: validation.code,
        retryCount,
      });
      return {
        ok: false,
        cancelled: false,
        error: `Smart compaction output invalid (${validation.code}): ${errorMessage}`,
        modelCallCount,
      };
    }

    if (input.abortSignal.aborted) return { ok: false, cancelled: true, error: "Compaction cancelled", modelCallCount };
    return { ok: true, summary: validation.text, modelCallCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = input.abortSignal.aborted || /Compaction cancelled/i.test(message);
    const attributedMessage = !cancelled && input.providerTiming && /timed? out|timeout/i.test(message)
      ? formatCompactionProviderTimeout(message, input.providerTiming)
      : message;
    if (!cancelled) log.debug(`Smart compaction error: ${attributedMessage}`);
    return { ok: false, cancelled, error: attributedMessage, modelCallCount };
  }
}
