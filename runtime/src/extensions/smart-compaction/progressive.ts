/**
 * Extracted smart-compaction helper module.
 *
 * Keep this module focused; the public extension facade remains
 * ../smart-compaction.ts.
 */

import type { Message, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { FileOperations } from "@earendil-works/pi-coding-agent";
import { streamComplete, type CompactionStreamFn } from "./stream-complete.js";
import {
  DEFAULT_HIGH_CONTEXT_PROGRESSIVE_MAX_CHUNKS,
  DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS,
  HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT,
  MAX_PROGRESSIVE_CHUNKS,
  MAX_PROGRESSIVE_CHUNK_OUTPUT_TOKENS,
  PROGRESSIVE_COMPACTION_CONCURRENCY,
  PROGRESSIVE_FINAL_SETTLEMENT_RESERVE_MS,
  PROGRESSIVE_INITIAL_BATCH_ESTIMATE_MS,
  PROGRESSIVE_MERGE_RESERVE_MS,
  PROGRESSIVE_MIN_BATCH_ESTIMATE_MS,
  PROGRESSIVE_MIN_MERGE_RESERVE_MS,
  PROGRESSIVE_OBSERVED_BATCH_SAFETY_MULTIPLIER,
  MIN_COMPACTION_OUTPUT_TOKENS,
  SMART_COMPACTION_PROGRESS_INTERVAL_MS,
  type CompactionReasoningEffort,
} from "./config.js";
import { checkPiclawCompactionBudget, maybeYieldPiclawCompaction } from "../../agent-pool/compaction-trigger-context.js";
import { estimateCompactionPromptTokens, estimateSmartCompactionCompletionPercent, formatProgressCount, formatProgressRange, formatSmartCompactionStatus } from "./context.js";
import { getCompactionOutputTokenTarget, getCompactionReasoningEffort, getSafeCompactionMaxTokens } from "./safety.js";
import { createLogger } from "../../utils/logger.js";
import { SYSTEM_PROMPT } from "./selective-prompt.js";
import { buildCompactionRepairInstruction, validateCompactionSummaryResponse, type CompactionSummarySchema } from "./summary-validation.js";
import {
  CHUNK_SYSTEM_PROMPT,
  buildChunkSummaryPrompt,
  buildDeterministicProgressiveSummary,
  buildMergePrompt,
  buildProgressiveCompactionChunks,
  buildProgressiveCompactionChunksFromSourceUnits,
  getProgressiveCompactionBudget,
  isCompactionInputOverflow,
  sourceEntryIdForLlmIndex,
  sourceIndexForLlmIndex,
  type ProgressiveCompactionBudget,
  type ProgressiveCompactionChunk,
  type ProgressiveCompactionProgress,
  type ProgressiveCompactionResult,
} from "./progressive-policy.js";
import type { CompactionSourceUnit } from "./source.js";
import { buildProgressiveCheckpointFingerprint, type ProgressiveCheckpointStore } from "./progressive-checkpoint.js";

export {
  buildProgressiveCompactionChunks,
  buildProgressiveCompactionChunksFromSourceUnits,
  getProgressiveCompactionBudget,
};
export type {
  ProgressiveCompactionBudget,
  ProgressiveCompactionChunk,
  ProgressiveCompactionProgress,
  ProgressiveCompactionResult,
} from "./progressive-policy.js";

const log = createLogger("ext.smart-compaction.progressive");

function describeModelFileTagSequence(response: any): string[] {
  const text = Array.isArray(response?.content)
    ? response.content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("\n")
    : "";
  const tags = [...text.matchAll(/<\/?(?:read-files|modified-files)\b[^>\n]*(?:>|$)/gi)]
    .map((match) => match[0].toLowerCase().replace(/\s+/g, " "));
  return tags.length <= 12 ? tags : [...tags.slice(0, 12), `…(+${tags.length - 12})`];
}

function hasSafeCompactionOutputRoom(model: any, promptText: string, maxTokens: number): boolean {
  try {
    getSafeCompactionMaxTokens(model, promptText, maxTokens);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/exceeds safe model budget/i.test(message)) return false;
    throw err;
  }
}

async function completeCompactionPrompt(
  model: any,
  auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> },
  promptText: string,
  schema: CompactionSummarySchema,
  maxTokens: number,
  abortSignal: AbortSignal,
  streamFn?: CompactionStreamFn,
  onProgress?: (generatedChars: number) => void,
  reasoning?: CompactionReasoningEffort,
  onModelRequest?: () => void,
  onPayload?: SimpleStreamOptions["onPayload"],
): Promise<string> {
  const runOnce = async (
    activePromptText: string,
    retryCount: number,
    requestedMaxTokens = maxTokens,
  ): Promise<string> => {
    if (abortSignal.aborted) throw new Error("Compaction cancelled");
    const safeOutput = getSafeCompactionMaxTokens(model, activePromptText, requestedMaxTokens);
    onModelRequest?.();
    const response = await streamComplete({
      model,
      systemPrompt: schema === "chunk" ? CHUNK_SYSTEM_PROMPT : SYSTEM_PROMPT,
      userPrompt: activePromptText,
      maxTokens: safeOutput.maxTokens,
      signal: abortSignal,
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      reasoning: (model as any).reasoning ? reasoning ?? getCompactionReasoningEffort(model, "selective") : undefined,
      onPayload,
      streamFn,
      onProgress,
    });
    const validation = validateCompactionSummaryResponse(response, schema, safeOutput.maxTokens * 4, {
      modelFileBlocks: "discard",
    });
    if (!validation.ok) {
      log.debug("Progressive compaction output validation failed", {
        operation: "smart_compaction.progressive_output_invalid",
        schema,
        stopReason: validation.stopReason,
        validationFailure: validation.code,
        validationPhase: schema,
        retryCount,
        fileTagSequence: describeModelFileTagSequence(response),
      });
      const providerError = response?.stopReason === "error" && typeof response?.errorMessage === "string"
        ? `: ${response.errorMessage}`
        : "";
      const tagSequence = describeModelFileTagSequence(response);
      const error = new Error(`Progressive compaction output invalid (${validation.code}): ${validation.reason}${providerError}`) as Error & {
        retryableOutput?: boolean;
        validationReason?: string;
        validationCode?: string;
        validationPhase?: CompactionSummarySchema;
        validationRetryCount?: number;
        validationMaxTokens?: number;
        fileTagSequence?: string[];
      };
      error.retryableOutput = validation.retryable;
      error.validationReason = validation.reason;
      error.validationCode = validation.code;
      error.validationPhase = schema;
      error.validationRetryCount = retryCount;
      error.validationMaxTokens = safeOutput.maxTokens;
      error.fileTagSequence = tagSequence;
      throw error;
    }
    if (abortSignal.aborted) throw new Error("Compaction cancelled");
    return validation.text;
  };

  try {
    return await runOnce(promptText, 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryableOutput = !!(err as { retryableOutput?: boolean })?.retryableOutput;
    const inputOverflow = isCompactionInputOverflow(message);
    if ((!retryableOutput && !inputOverflow) || abortSignal.aborted) throw err;

    // Never trim source-bearing progressive prompts after provider input
    // overflow: doing so would claim coverage for omitted content. Chunks are
    // split before submission; a hidden provider cap therefore cancels safely.
    if (inputOverflow && !retryableOutput) throw err;

    const repairReason = (err as { validationReason?: string })?.validationReason ?? message;
    // A length stop is evidence that the provider or route did not finish at
    // the original cap. A smaller, explicitly stated retry target makes the
    // one repair attempt materially different instead of repeating the same
    // truncation under an advisory-only "be concise" instruction.
    const firstAttemptMaxTokens = Number((err as { validationMaxTokens?: unknown })?.validationMaxTokens);
    const repairMaxTokens = (err as { validationCode?: string })?.validationCode === "stop_reason"
      && /stop reason was length/i.test(repairReason)
      ? Math.max(
        MIN_COMPACTION_OUTPUT_TOKENS,
        Math.floor((Number.isFinite(firstAttemptMaxTokens) && firstAttemptMaxTokens > 0 ? firstAttemptMaxTokens : maxTokens) * 0.5),
      )
      : maxTokens;
    const repairInstruction = buildCompactionRepairInstruction(schema, repairReason, repairMaxTokens);
    const appendRepairInstruction = (sourcePrompt: string): string => {
      const marker = schema === "final"
        ? "\nOutput this exact final format:"
        : "\nReturn a concise structured intermediate summary with the same headings as the chunk summaries.";
      const markerIndex = sourcePrompt.lastIndexOf(marker);
      if (markerIndex < 0) return `${sourcePrompt}${repairInstruction}`;
      return `${sourcePrompt.slice(0, markerIndex)}${repairInstruction}\n${sourcePrompt.slice(markerIndex)}`;
    };
    // Every progressive prompt is source-bearing: chunks contain raw messages,
    // while merge/final prompts contain the only summaries of messages that will
    // be discarded. Never trim any of them for repair, or a successful retry
    // could claim coverage for omitted history. Retry only when the complete
    // original prompt plus the bounded repair instruction still fits.
    const repairedPrompt = appendRepairInstruction(promptText);
    if (!hasSafeCompactionOutputRoom(model, repairedPrompt, repairMaxTokens)) throw err;
    log.debug("Progressive compaction retrying rejected output once", {
      operation: "smart_compaction.progressive_output_retry",
      schema,
      retryCount: 1,
      promptWasTrimmed: false,
    });
    return await runOnce(repairedPrompt, 1, repairMaxTokens);
  }
}

function findSafeHiddenCapSplitIndex(text: string): number {
  const codePoints = Array.from(text);
  if (codePoints.length < 2) return text.length;
  const midpoint = Math.floor(codePoints.length / 2);
  const min = Math.max(1, Math.floor(codePoints.length * 0.35));
  const max = Math.min(codePoints.length - 1, Math.ceil(codePoints.length * 0.65));
  const isBoundary = (value: string) => /\s/u.test(value);
  for (let distance = 0; midpoint - distance >= min || midpoint + distance <= max; distance += 1) {
    const left = midpoint - distance;
    if (left >= min && isBoundary(codePoints[left] ?? "")) return codePoints.slice(0, left + 1).join("").length;
    const right = midpoint + distance;
    if (right <= max && isBoundary(codePoints[right] ?? "")) return codePoints.slice(0, right + 1).join("").length;
  }
  return codePoints.slice(0, midpoint).join("").length;
}

function splitOversizedMergeSummary(
  summary: string,
  model: any,
  maxTokens: number,
  depth = 0,
): string[] {
  const fitPrompt = buildMergePrompt({ summaries: [summary], rangeLabel: "merge-fit-check", final: false });
  if (hasSafeCompactionOutputRoom(model, fitPrompt, maxTokens)) return [summary];
  if (summary.length < 2 || depth >= 32) {
    throw new Error("Progressive compaction cannot safely fit one intermediate summary into the model context");
  }
  const splitAt = findSafeHiddenCapSplitIndex(summary);
  if (splitAt <= 0 || splitAt >= summary.length) {
    throw new Error("Progressive compaction could not split an oversized intermediate summary");
  }
  return [
    ...splitOversizedMergeSummary(`[ordered merge fragment 1/2]\n${summary.slice(0, splitAt)}`, model, maxTokens, depth + 1),
    ...splitOversizedMergeSummary(`[ordered merge fragment 2/2]\n${summary.slice(splitAt)}`, model, maxTokens, depth + 1),
  ];
}

function buildSafeMergeBatches(
  summaries: string[],
  mergeBudgetChars: number,
  model: any,
  maxTokens: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let chars = 0;
  for (const summary of summaries) {
    checkPiclawCompactionBudget("smart_compaction.progressive.merge_batch");
    const nextChars = summary.length + 2;
    const candidate = [...batch, summary];
    const candidatePrompt = buildMergePrompt({ summaries: candidate, rangeLabel: "merge-fit-check", final: false });
    if (
      batch.length > 0
      && (chars + nextChars > mergeBudgetChars || !hasSafeCompactionOutputRoom(model, candidatePrompt, maxTokens))
    ) {
      batches.push(batch);
      batch = [summary];
      chars = nextChars;
    } else {
      batch = candidate;
      chars += nextChars;
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function mergeProgressiveSummaries(input: {
  summaries: string[];
  model: any;
  auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> };
  budget: ProgressiveCompactionBudget;
  maxTokens: number;
  abortSignal: AbortSignal;
  ctx: { ui: { setStatus?: (key: string, text: string | undefined) => void } };
  finalPromptExtras: Omit<Parameters<typeof buildMergePrompt>[0], "summaries" | "rangeLabel" | "final">;
  publishEstimate?: (tokens: number | null, phase: string, completionPercent?: number | null) => void;
  timeoutMs?: number;
  startedAt?: number;
  streamFn?: CompactionStreamFn;
  onProgress?: (generatedChars: number, progress?: ProgressiveCompactionProgress) => void;
  onModelRequest?: () => void;
}): Promise<string> {
  const MAX_PROGRESSIVE_MERGE_PASSES = 12;
  let summaries = input.summaries.flatMap((summary) => splitOversizedMergeSummary(summary, input.model, input.maxTokens));
  let pass = 1;
  let lastProgressUiAt = 0;
  const setProgressMessage = (message: string, phase: string, force = false, tokens: number | null = null, completionPercent = estimateSmartCompactionCompletionPercent(phase)) => {
    input.publishEstimate?.(tokens, phase, completionPercent);
    const now = Date.now();
    if (!force && now - lastProgressUiAt < SMART_COMPACTION_PROGRESS_INTERVAL_MS) return;
    lastProgressUiAt = now;
    input.ctx.ui.setStatus?.("smart_compaction", formatSmartCompactionStatus(message, completionPercent));
  };
  const buildFinalPrompt = () => buildMergePrompt({
    summaries,
    rangeLabel: "final",
    final: true,
    ...input.finalPromptExtras,
  });

  while (
    summaries.length > 1
    && (
      summaries.join("\n\n").length > input.budget.mergeBudgetChars
      || !hasSafeCompactionOutputRoom(input.model, buildFinalPrompt(), input.maxTokens)
    )
  ) {
    checkPiclawCompactionBudget("smart_compaction.progressive.merge_pass");
    await maybeYieldPiclawCompaction("smart_compaction.progressive.merge_pass");
    if (pass > MAX_PROGRESSIVE_MERGE_PASSES) {
      throw new Error(`Progressive compaction merge exceeded ${MAX_PROGRESSIVE_MERGE_PASSES} passes; refusing potential infinite merge loop`);
    }
    if (input.timeoutMs && input.startedAt) {
      const elapsed = Date.now() - input.startedAt;
      if (elapsed > getProgressiveMergeDeadlineMs(input.timeoutMs)) {
        throw new Error(
          `Progressive compaction time budget exhausted during merge pass ${pass} (${Math.round(elapsed / 1000)}s of ${Math.round(input.timeoutMs / 1000)}s)`,
        );
      }
    }

    // Provider outputs can be larger than the nominal merge character budget.
    // Split those summaries losslessly into ordered fragments before asking the
    // model to merge them, then form batches against both the configured budget
    // and the model-derived prompt ceiling.
    summaries = summaries.flatMap((summary) => splitOversizedMergeSummary(summary, input.model, input.maxTokens));
    const previousChars = summaries.join("\n\n").length;
    const previousCount = summaries.length;
    const next: string[] = [];
    const batches = buildSafeMergeBatches(
      summaries,
      input.budget.mergeBudgetChars,
      input.model,
      input.maxTokens,
    );
    const mergeBatchWithHiddenCapBisect = async (
      batch: string[],
      batchIndex: number,
      depth = 0,
    ): Promise<string[]> => {
      const batchPhase = `merge_pass_${pass}_batch_${batchIndex}`;
      const mergePrompt = buildMergePrompt({ summaries: batch, rangeLabel: `merge-pass-${pass}`, final: false });
      setProgressMessage(
        `Smart compaction: merging pass ${pass}, batch ${formatProgressCount(batchIndex, batches.length)}…`,
        batchPhase,
        false,
        estimateCompactionPromptTokens(mergePrompt),
        Math.min(85, 75 + pass),
      );
      try {
        return [await completeCompactionPrompt(
          input.model,
          input.auth,
          mergePrompt,
          "chunk",
          input.maxTokens,
          input.abortSignal,
          input.streamFn,
          input.onProgress ? (generatedChars) => input.onProgress?.(generatedChars, { phase: "progressive_merge", mergePass: pass, batchIndex }) : undefined,
          getCompactionReasoningEffort(input.model, "progressive_merge"),
          input.onModelRequest,
        )];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isCompactionInputOverflow(message) || depth >= 24) throw error;
        let left: string[];
        let right: string[];
        if (batch.length > 1) {
          const midpoint = Math.floor(batch.length / 2);
          left = batch.slice(0, midpoint);
          right = batch.slice(midpoint);
        } else {
          const summary = batch[0] ?? "";
          const splitAt = findSafeHiddenCapSplitIndex(summary);
          if (splitAt <= 0 || splitAt >= summary.length) throw error;
          left = [`[hidden-cap merge fragment 1/2]\n${summary.slice(0, splitAt)}`];
          right = [`[hidden-cap merge fragment 2/2]\n${summary.slice(splitAt)}`];
        }
        log.debug("Progressive merge exceeded a hidden provider input cap; bisecting the complete ordered batch", {
          operation: "smart_compaction.progressive_merge_hidden_cap_bisect",
          mergePass: pass,
          batchIndex,
          depth: depth + 1,
          originalSummaries: batch.length,
          leftSummaries: left.length,
          rightSummaries: right.length,
        });
        return [
          ...await mergeBatchWithHiddenCapBisect(left, batchIndex, depth + 1),
          ...await mergeBatchWithHiddenCapBisect(right, batchIndex, depth + 1),
        ];
      }
    };

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      checkPiclawCompactionBudget("smart_compaction.progressive.merge_summary");
      next.push(...await mergeBatchWithHiddenCapBisect(batches[batchIndex]!, batchIndex + 1));
    }
    const nextChars = next.join("\n\n").length;
    if (next.length >= previousCount && nextChars >= previousChars) {
      throw new Error(
        `Progressive compaction merge made no progress on pass ${pass} (${previousCount}/${previousChars} → ${next.length}/${nextChars}); refusing potential infinite merge loop`,
      );
    }

    setProgressMessage(`Smart compaction: merge pass ${pass} reduced ${formatProgressCount(next.length, summaries.length)} summaries…`, `merge_pass_${pass}_reduced`, false, null, Math.min(88, 80 + pass));
    summaries = next;
    pass += 1;
  }

  if (input.timeoutMs && input.startedAt) {
    const elapsed = Date.now() - input.startedAt;
    if (elapsed > getProgressiveMergeDeadlineMs(input.timeoutMs)) {
      throw new Error(
        `Progressive compaction time budget exhausted before final merge (${Math.round(elapsed / 1000)}s of ${Math.round(input.timeoutMs / 1000)}s)`,
      );
    }
  }

  setProgressMessage("Smart compaction: final progressive merge…", "merge_final", true, null, 90);
  let finalPrompt = buildFinalPrompt();
  for (let compressPass = 1; !hasSafeCompactionOutputRoom(input.model, finalPrompt, input.maxTokens) && summaries.length === 1 && compressPass <= 3; compressPass += 1) {
    const compressPrompt = buildMergePrompt({ summaries, rangeLabel: `final-fit-compress-${compressPass}`, final: false });
    if (!hasSafeCompactionOutputRoom(input.model, compressPrompt, input.maxTokens)) break;
    setProgressMessage(
      `Smart compaction: compressing final summary to fit context, pass ${formatProgressCount(compressPass, 3)}…`,
      `merge_final_compress_${compressPass}`,
      true,
      estimateCompactionPromptTokens(compressPrompt),
      88 + compressPass,
    );
    summaries = [await completeCompactionPrompt(
      input.model,
      input.auth,
      compressPrompt,
      "chunk",
      input.maxTokens,
      input.abortSignal,
      input.streamFn,
      input.onProgress ? (generatedChars) => input.onProgress?.(generatedChars, { phase: "progressive_compress", compressPass }) : undefined,
      getCompactionReasoningEffort(input.model, "progressive_compress"),
      input.onModelRequest,
    )];
    finalPrompt = buildFinalPrompt();
  }
  input.publishEstimate?.(estimateCompactionPromptTokens(finalPrompt), "merge_final", 92);
  return await completeCompactionPrompt(
    input.model,
    input.auth,
    finalPrompt,
    "final",
    input.maxTokens,
    input.abortSignal,
    input.streamFn,
    input.onProgress ? (generatedChars) => input.onProgress?.(generatedChars, { phase: "progressive_final" }) : undefined,
    getCompactionReasoningEffort(input.model, "progressive_final"),
    input.onModelRequest,
  );
}

function maybeAdaptProgressiveChunks(input: {
  chunks: ProgressiveCompactionChunk[];
  sourceUnits?: CompactionSourceUnit[];
  llmMessages: Message[];
  humanUserIndexes: Set<number>;
  budget: ProgressiveCompactionBudget;
}): ProgressiveCompactionChunk[] {
  if (input.budget.contextWindow < HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT) return input.chunks;
  if (input.chunks.length <= DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS) return input.chunks;

  const totalChars = input.chunks.reduce((total, chunk) => total + Math.max(0, chunk.estimatedChars || chunk.text.length), 0);
  // Add packing slack: source units are indivisible unless individually
  // oversized, so total/target alone can still leave many half-full chunks.
  const targetBudgetChars = Math.ceil((totalChars / DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS) * 1.25);
  let adaptiveBudgetChars = Math.min(input.budget.promptBudgetChars, Math.max(input.budget.chunkBudgetChars, targetBudgetChars));
  if (adaptiveBudgetChars <= input.budget.chunkBudgetChars) return input.chunks;

  let adaptedChunks = input.chunks;
  while (adaptiveBudgetChars > input.budget.chunkBudgetChars) {
    const candidate = input.sourceUnits
      ? buildProgressiveCompactionChunksFromSourceUnits(input.sourceUnits, adaptiveBudgetChars)
      : buildProgressiveCompactionChunks(input.llmMessages, adaptiveBudgetChars, input.humanUserIndexes);
    if (candidate.length < adaptedChunks.length) adaptedChunks = candidate;
    if (adaptedChunks.length <= DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS
      || adaptiveBudgetChars >= input.budget.promptBudgetChars) break;
    adaptiveBudgetChars = Math.min(
      input.budget.promptBudgetChars,
      Math.max(adaptiveBudgetChars + 1, Math.ceil(adaptiveBudgetChars * 1.20)),
    );
  }
  if (adaptedChunks.length >= input.chunks.length) return input.chunks;

  log.debug("Adaptive progressive chunk preflight selected larger chunk budget", {
    operation: "smart_compaction.progressive.adaptive_chunk_budget",
    contextWindow: input.budget.contextWindow,
    originalChunkCount: input.chunks.length,
    adaptedChunkCount: adaptedChunks.length,
    originalChunkBudgetChars: input.budget.chunkBudgetChars,
    adaptiveBudgetChars,
    targetChunkCount: DEFAULT_HIGH_CONTEXT_PROGRESSIVE_TARGET_CHUNKS,
    maxChunkCount: DEFAULT_HIGH_CONTEXT_PROGRESSIVE_MAX_CHUNKS,
  });
  return adaptedChunks;
}

function getProgressiveMergeReserveMs(timeoutMs: number): number {
  return Math.min(
    PROGRESSIVE_MERGE_RESERVE_MS,
    Math.max(PROGRESSIVE_MIN_MERGE_RESERVE_MS, Math.floor(timeoutMs * 0.20)),
  );
}

function getProgressiveChunkBudgetMs(timeoutMs: number): number {
  return Math.max(0, timeoutMs - getProgressiveMergeReserveMs(timeoutMs));
}

function getProgressiveMergeDeadlineMs(timeoutMs: number): number {
  return Math.max(0, timeoutMs - PROGRESSIVE_FINAL_SETTLEMENT_RESERVE_MS);
}

function assertProgressiveChunkCountFeasible(
  chunks: ProgressiveCompactionChunk[],
  budget: ProgressiveCompactionBudget,
  timeoutMs?: number,
  completedChunkCount = 0,
): void {
  if (budget.contextWindow >= HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT
    && chunks.length > DEFAULT_HIGH_CONTEXT_PROGRESSIVE_MAX_CHUNKS) {
    const batches = Math.ceil(chunks.length / PROGRESSIVE_COMPACTION_CONCURRENCY);
    throw new Error(
      `Progressive compaction would require ${chunks.length} chunks (${batches} model-call batches) even after adaptive chunk sizing; refusing a likely timeout-prone compaction. Reduce source size, increase compaction timeout, or raise the progressive prompt budget.`,
    );
  }
  if (budget.contextWindow < HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT || !timeoutMs || timeoutMs <= 0) return;
  const remainingChunks = Math.max(0, chunks.length - completedChunkCount);
  const remainingBatches = Math.ceil(remainingChunks / PROGRESSIVE_COMPACTION_CONCURRENCY);
  const mergeReserveMs = getProgressiveMergeReserveMs(timeoutMs);
  const executionBudgetMs = timeoutMs;
  const estimatedMs = remainingBatches * PROGRESSIVE_INITIAL_BATCH_ESTIMATE_MS + mergeReserveMs;
  if (estimatedMs < executionBudgetMs) return;
  throw new Error(
    `Progressive compaction time preflight estimates ${Math.round(estimatedMs / 1000)}s for ${remainingChunks} remaining chunks (${remainingBatches} model-call batches, including ${Math.round(mergeReserveMs / 1000)}s merge reserve), exceeding the ${Math.round(executionBudgetMs / 1000)}s execution budget. Refusing a likely timeout-prone compaction before model calls.`,
  );
}

function estimateRemainingProgressiveMs(input: {
  chunks: ProgressiveCompactionChunk[];
  completedChunkCount: number;
  observedBatchDurationsMs: number[];
  timeoutMs: number;
}): { estimatedMs: number; remainingBatches: number; batchEstimateMs: number; mergeReserveMs: number; executionBudgetMs: number } {
  const remainingChunks = Math.max(0, input.chunks.length - input.completedChunkCount);
  const remainingBatches = Math.ceil(remainingChunks / PROGRESSIVE_COMPACTION_CONCURRENCY);
  const observedAverage = input.observedBatchDurationsMs.length > 0
    ? input.observedBatchDurationsMs.reduce((total, value) => total + value, 0) / input.observedBatchDurationsMs.length
    : PROGRESSIVE_INITIAL_BATCH_ESTIMATE_MS;
  const batchEstimateMs = Math.max(
    PROGRESSIVE_MIN_BATCH_ESTIMATE_MS,
    Math.ceil(observedAverage * PROGRESSIVE_OBSERVED_BATCH_SAFETY_MULTIPLIER),
  );
  const mergeReserveMs = getProgressiveMergeReserveMs(input.timeoutMs);
  return {
    estimatedMs: remainingBatches * batchEstimateMs + mergeReserveMs,
    remainingBatches,
    batchEstimateMs,
    mergeReserveMs,
    executionBudgetMs: input.timeoutMs,
  };
}

export async function runProgressiveCompaction(input: {
  llmMessages: Message[];
  sourceUnits?: CompactionSourceUnit[];
  humanUserIndexes: Set<number>;
  sourceIndexesByLlmIndex?: number[];
  sourceEntryIdsByLlmIndex?: Array<string | undefined>;
  model: any;
  auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> };
  settings: { reserveTokens: number };
  previousSummary?: string;
  keptMessagesSummary?: string;
  turnPrefixSummary?: string;
  customInstructions?: string;
  fileOps: FileOperations;
  budget: ProgressiveCompactionBudget;
  abortSignal: AbortSignal;
  ctx: { ui: { setStatus?: (key: string, text: string | undefined) => void } };
  /** Compaction timeout (ms) — used to enforce a time budget so progressive doesn't run over. */
  timeoutMs?: number;
  /** Timestamp when compaction started — paired with timeoutMs for elapsed-time guard. */
  startedAt?: number;
  /** Callback to publish context estimate to the UI meter. */
  publishEstimate?: (tokens: number | null, phase: string, completionPercent?: number | null) => void;
  /** Custom stream function for proxy-routed providers. */
  streamFn?: CompactionStreamFn;
  /** Progress callback (chars generated so far). */
  onProgress?: (generatedChars: number, progress?: ProgressiveCompactionProgress) => void;
  /** Rehydrate provider-native state only for its dedicated continuity chunk. */
  onPayload?: SimpleStreamOptions["onPayload"];
  /** Optional durable validated-chunk checkpoint store. */
  checkpointStore?: ProgressiveCheckpointStore;
}): Promise<ProgressiveCompactionResult> {
  let modelCallCount = 0;
  const onModelRequest = () => { modelCallCount += 1; };
  // The previous summary is discarded and replaced by this compaction, so it
  // is source-bearing just like the raw message stream. Put it through the
  // same deterministic chunk path instead of copying an arbitrarily large
  // summary only into the final merge prompt, where it could overflow after
  // every message chunk had already succeeded.
  const previousSummary = input.previousSummary?.trim();
  const previousSummaryUnit: CompactionSourceUnit | null = previousSummary ? {
    id: "continuity-previous-summary",
    groupId: "continuity:previous-summary",
    renderedText: `## Previous Compaction Summary Source\n${previousSummary}`,
    sourceIndexes: [],
    sourceEntryIds: [],
    segmentIndex: 1,
    segmentCount: 1,
  } : null;
  const sourceUnitsWithContinuity = input.sourceUnits
    ? [...(previousSummaryUnit ? [previousSummaryUnit] : []), ...input.sourceUnits]
    : undefined;
  let chunks = sourceUnitsWithContinuity
    ? buildProgressiveCompactionChunksFromSourceUnits(sourceUnitsWithContinuity, input.budget.chunkBudgetChars)
    : buildProgressiveCompactionChunks(
        input.llmMessages,
        input.budget.chunkBudgetChars,
        input.humanUserIndexes,
      );
  if (previousSummaryUnit && !sourceUnitsWithContinuity) {
    const previousSummaryChunks = buildProgressiveCompactionChunksFromSourceUnits([previousSummaryUnit], input.budget.chunkBudgetChars);
    chunks = [...previousSummaryChunks, ...chunks];
  }

  const canAdaptChunks = !previousSummaryUnit || !!sourceUnitsWithContinuity;
  chunks = (canAdaptChunks ? maybeAdaptProgressiveChunks({
    chunks,
    sourceUnits: sourceUnitsWithContinuity,
    llmMessages: input.llmMessages,
    humanUserIndexes: input.humanUserIndexes,
    budget: input.budget,
  }) : chunks).map((chunk, index) => ({ ...chunk, index: index + 1 }));

  // Optional operational guard only. Never enlarge chunks to satisfy it: doing
  // so can recreate oversized provider prompts and defeats incremental mode.
  if (MAX_PROGRESSIVE_CHUNKS > 0 && chunks.length > MAX_PROGRESSIVE_CHUNKS) {
    throw new Error(
      `Progressive compaction would require ${chunks.length} chunks (configured max ${MAX_PROGRESSIVE_CHUNKS}); increase PICLAW_PROGRESSIVE_COMPACTION_MAX_CHUNKS or leave it unset for count-unbounded incremental compaction`,
    );
  }
  const checkpointFingerprint = buildProgressiveCheckpointFingerprint({
    chunks,
    model: input.model,
    budget: input.budget,
    reserveTokens: input.settings.reserveTokens,
    customInstructions: input.customInstructions,
  });
  const maxTokens = getCompactionOutputTokenTarget(input.settings.reserveTokens);
  const chunkMaxTokens = input.budget.contextWindow >= HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT
    ? Math.max(
        512,
        Math.min(
          MAX_PROGRESSIVE_CHUNK_OUTPUT_TOKENS,
          Math.floor(maxTokens / Math.max(1, chunks.length)),
        ),
      )
    : maxTokens;
  let lastProgressUiAt = 0;
  const chunkCompletionPercent = (processedChunks: number) => 30 + Math.round((Math.max(0, Math.min(chunks.length, processedChunks)) / Math.max(1, chunks.length)) * 40);
  const setProgressMessage = (message: string, phase: string, force = false, tokens: number | null = null, completionPercent = estimateSmartCompactionCompletionPercent(phase)) => {
    input.publishEstimate?.(tokens, phase, completionPercent);
    const now = Date.now();
    if (!force && now - lastProgressUiAt < SMART_COMPACTION_PROGRESS_INTERVAL_MS) return;
    lastProgressUiAt = now;
    input.ctx.ui.setStatus?.("smart_compaction", formatSmartCompactionStatus(message, completionPercent));
  };
  setProgressMessage(
    `Smart compaction: ${input.llmMessages.length} messages → ${chunks.length} chunks…`,
    "progressive_chunking",
    true,
    null,
    28,
  );

  const chunkSummaries: string[] = input.checkpointStore?.load(checkpointFingerprint, chunks) ?? [];
  assertProgressiveChunkCountFeasible(
    chunks,
    input.budget,
    input.timeoutMs,
    chunkSummaries.length,
  );
  if (chunkSummaries.length > 0) {
    modelCallCount = 0;
    log.info("Resuming validated progressive chunk checkpoints", {
      operation: "smart_compaction.progressive.checkpoint_resume",
      completedChunkCount: chunkSummaries.length,
      totalChunkCount: chunks.length,
    });
  }
  const summarizeChunkWithHiddenCapRecovery = async (
    chunk: ProgressiveCompactionChunk,
    text = chunk.text,
    depth = 0,
    segmentLabel = "",
    signal: AbortSignal = input.abortSignal,
  ): Promise<string> => {
    const MAX_HIDDEN_CAP_SPLIT_DEPTH = 10;
    const MIN_HIDDEN_CAP_SEGMENT_CHARS = 512;
    const segmentChunk = {
      ...chunk,
      text: segmentLabel ? `[${segmentLabel}]\n${text}` : text,
      estimatedChars: text.length,
    };
    const chunkPrompt = buildChunkSummaryPrompt(segmentChunk, chunks.length);
    input.publishEstimate?.(estimateCompactionPromptTokens(chunkPrompt), `progressive_chunk_${chunk.index}`, chunkCompletionPercent(chunk.index - 1));
    try {
      return await completeCompactionPrompt(
        input.model,
        input.auth,
        chunkPrompt,
        "chunk",
        chunkMaxTokens,
        signal,
        input.streamFn,
        input.onProgress ? (generatedChars) => input.onProgress?.(generatedChars, { phase: "progressive_chunk", chunkIndex: chunk.index, totalChunks: chunks.length }) : undefined,
        getCompactionReasoningEffort(input.model, "progressive_chunk"),
        onModelRequest,
        chunk.groupIds?.includes("continuity:previous-summary") ? input.onPayload : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !isCompactionInputOverflow(message)
        || depth >= MAX_HIDDEN_CAP_SPLIT_DEPTH
        || text.length < MIN_HIDDEN_CAP_SEGMENT_CHARS * 2
      ) throw error;

      // A provider/gateway can enforce a lower input cap than its advertised
      // model context. Bisect the complete source text and submit two changed,
      // smaller prompts; never retry the rejected prompt unchanged or trim it.
      const midpoint = findSafeHiddenCapSplitIndex(text);
      const boundary = "\n[provider-limit split boundary: preserve adjacent partial token/path/error exactly]\n";
      const left = await summarizeChunkWithHiddenCapRecovery(chunk, `${text.slice(0, midpoint)}${boundary}`, depth + 1, `${chunk.index} split ${depth + 1}a`, signal);
      const right = await summarizeChunkWithHiddenCapRecovery(chunk, `${boundary}${text.slice(midpoint)}`, depth + 1, `${chunk.index} split ${depth + 1}b`, signal);
      const indentHeadings = (summary: string) => summary.replace(/^## /gm, "### ");
      return [
        "## Chunk Range",
        `- ${chunk.startMessageIndex}-${chunk.endMessageIndex} (provider-limit split)`,
        "",
        "## Goals / User Intent",
        "- Preserved in the ordered subsegment summaries below.",
        "",
        "## Constraints & Preferences",
        "- Preserved in the ordered subsegment summaries below.",
        "",
        "## Decisions",
        "- Preserved in the ordered subsegment summaries below.",
        "",
        "## Files / Commands / Tool Outcomes",
        "- Preserved in the ordered subsegment summaries below.",
        "",
        "## Progress",
        "- Done: both changed, smaller source subsegments summarized",
        "- In progress: progressive merge",
        "- Blocked: none",
        "",
        "## Open Questions / Next Steps",
        "- Merge the ordered subsegment summaries without dropping facts.",
        "",
        "## Key Continuity Facts",
        "- Ordered provider-limit subsegment summaries:",
        `<subsegment index=\"1\">\n${indentHeadings(left)}\n</subsegment>`,
        `<subsegment index=\"2\">\n${indentHeadings(right)}\n</subsegment>`,
      ].join("\n");
    }
  };
  const buildTimeBudgetPartial = (
    maxProcessedChunkCount: number,
    elapsed: number,
    sourceReason?: string,
  ): ProgressiveCompactionResult => {
    const outputMaxChars = maxTokens * 4;
    const rollbackAtomicGroup = (count: number): number => {
      if (count <= 0) return 0;
      const removedGroupIds = new Set(chunks[count - 1]?.groupIds ?? []);
      let boundary = count - 1;
      while (boundary > 0 && removedGroupIds.size > 0) {
        const previousGroupIds = chunks[boundary - 1]?.groupIds ?? [];
        if (!previousGroupIds.some((groupId) => removedGroupIds.has(groupId))) break;
        for (const groupId of previousGroupIds) removedGroupIds.add(groupId);
        boundary -= 1;
      }
      return boundary;
    };
    const alignWithNextAtomicGroup = (count: number): number => {
      if (count <= 0 || count >= chunks.length) return count;
      const nextGroupIds = new Set(chunks[count]?.groupIds ?? []);
      let boundary = count;
      while (boundary > 0 && nextGroupIds.size > 0) {
        const previousGroupIds = chunks[boundary - 1]?.groupIds ?? [];
        if (!previousGroupIds.some((groupId) => nextGroupIds.has(groupId))) break;
        for (const groupId of previousGroupIds) nextGroupIds.add(groupId);
        boundary -= 1;
      }
      return boundary;
    };

    let processedChunkCount = alignWithNextAtomicGroup(Math.min(
      maxProcessedChunkCount,
      chunkSummaries.length,
      Math.max(0, chunks.length - 1),
    ));
    while (processedChunkCount > 0) {
      const retainedSummaries = chunkSummaries.slice(0, processedChunkCount);
      const rolledBack = chunkSummaries.length - processedChunkCount;
      const reason = `${sourceReason ?? "time budget exhausted"}; retained ${formatProgressCount(processedChunkCount, chunks.length)} complete chunks${rolledBack > 0 ? ` and rolled back ${rolledBack} chunk${rolledBack === 1 ? "" : "s"}` : ""} (${Math.round(elapsed / 1000)}s of ${Math.round((input.timeoutMs ?? 0) / 1000)}s)`;
      const buildCandidate = (includePreviousSummary: boolean) => buildDeterministicProgressiveSummary({
        summaries: retainedSummaries,
        chunks,
        complete: false,
        reason,
        // Native continuity has already passed through its dedicated chunk.
        // Prefer the raw text for a lossless local checkpoint, but allow its
        // validated chunk summary to stand in when the duplicate source alone
        // would make the checkpoint exceed the final output contract.
        previousSummary: input.onPayload || !includePreviousSummary ? undefined : input.previousSummary,
        keptMessagesSummary: input.keptMessagesSummary,
        turnPrefixSummary: input.turnPrefixSummary,
        customInstructions: input.customInstructions,
      });
      let summary = buildCandidate(true);
      let validation = validateCompactionSummaryResponse(
        { content: [{ type: "text", text: summary }], stopReason: "stop" },
        "final",
        outputMaxChars,
      );
      if (!validation.ok && input.previousSummary && !input.onPayload) {
        summary = buildCandidate(false);
        validation = validateCompactionSummaryResponse(
          { content: [{ type: "text", text: summary }], stopReason: "stop" },
          "final",
          outputMaxChars,
        );
      }
      if (validation.ok) {
        const nextChunk = chunks[processedChunkCount]!;
        return {
          summary: validation.text,
          complete: false,
          processedChunkCount,
          totalChunkCount: chunks.length,
          modelCallCount,
          nextUnprocessedMessageIndex: nextChunk.startMessageIndex,
          nextUnprocessedSourceMessageIndex: input.sourceUnits
            ? nextChunk.sourceIndexes?.[0]
            : sourceIndexForLlmIndex(input.sourceIndexesByLlmIndex, nextChunk.startMessageIndex),
          nextUnprocessedEntryId: input.sourceUnits
            ? nextChunk.sourceEntryIds?.[0]
            : sourceEntryIdForLlmIndex(input.sourceEntryIdsByLlmIndex, nextChunk.startMessageIndex),
          partialReason: reason,
        };
      }
      processedChunkCount = rollbackAtomicGroup(processedChunkCount);
    }

    throw new Error(
      `Progressive compaction time budget exhausted without a bounded complete atomic checkpoint (${Math.round(elapsed / 1000)}s of ${Math.round((input.timeoutMs ?? 0) / 1000)}s)`,
    );
  };

  const observedBatchDurationsMs: number[] = [];
  for (let offset = chunkSummaries.length; offset < chunks.length;) {
    checkPiclawCompactionBudget("smart_compaction.progressive.chunk_batch");
    await maybeYieldPiclawCompaction("smart_compaction.progressive.chunk_batch");
    const firstChunk = chunks[offset]!;
    if (input.timeoutMs && input.startedAt) {
      const elapsed = Date.now() - input.startedAt;
      if (elapsed > getProgressiveChunkBudgetMs(input.timeoutMs)) {
        return buildTimeBudgetPartial(chunkSummaries.length, elapsed);
      }
    }

    const batch = chunks.slice(offset, offset + PROGRESSIVE_COMPACTION_CONCURRENCY);
    const batchStartedAt = Date.now();
    const lastChunk = batch.at(-1)!;
    const batchLabel = formatProgressRange(firstChunk.index, lastChunk.index, chunks.length);
    setProgressMessage(
      `Smart compaction: summarizing chunks ${batchLabel}…`,
      `progressive_chunk_batch_${firstChunk.index}_${lastChunk.index}`,
      false,
      null,
      chunkCompletionPercent(firstChunk.index - 1),
    );

    const batchAbortController = new AbortController();
    const abortBatch = () => batchAbortController.abort();
    if (input.abortSignal.aborted) abortBatch();
    else input.abortSignal.addEventListener("abort", abortBatch, { once: true });
    let batchSummaries: string[];
    try {
      const settled = await Promise.allSettled(batch.map(async (chunk) =>
        await summarizeChunkWithHiddenCapRecovery(chunk, chunk.text, 0, "", batchAbortController.signal),
      ));
      const failedIndex = settled.findIndex((result) => result.status === "rejected");
      if (failedIndex >= 0) {
        // Preserve only the contiguous validated prefix before the first failed
        // chunk. Later concurrent successes cannot leap over a failed group.
        for (let index = 0; index < failedIndex; index += 1) {
          const result = settled[index];
          if (result?.status === "fulfilled") chunkSummaries.push(result.value);
        }
        if (failedIndex > 0) input.checkpointStore?.save(checkpointFingerprint, chunks, chunkSummaries);
        throw (settled[failedIndex] as PromiseRejectedResult).reason;
      }
      batchSummaries = settled.map((result) => (result as PromiseFulfilledResult<string>).value);
    } catch (error) {
      abortBatch();
      if (input.abortSignal.aborted) throw error;
      if (chunkSummaries.length > 0) {
        const message = error instanceof Error ? error.message : String(error);
        const elapsed = input.startedAt ? Date.now() - input.startedAt : 0;
        return buildTimeBudgetPartial(
          chunkSummaries.length,
          elapsed,
          `progressive chunk ${firstChunk.index}-${lastChunk.index} failed: ${message}`,
        );
      }
      throw error;
    } finally {
      input.abortSignal.removeEventListener("abort", abortBatch);
    }
    chunkSummaries.push(...batchSummaries);
    input.checkpointStore?.save(checkpointFingerprint, chunks, chunkSummaries);
    offset += batch.length;
    observedBatchDurationsMs.push(Math.max(0, Date.now() - batchStartedAt));
    setProgressMessage(
      `Smart compaction: summarized ${formatProgressCount(chunkSummaries.length, chunks.length)} chunks…`,
      `progressive_chunks_summarized_${chunkSummaries.length}`,
      false,
      null,
      chunkCompletionPercent(chunkSummaries.length),
    );

    if (input.budget.contextWindow >= HIGH_CONTEXT_PROGRESSIVE_TARGET_MIN_CONTEXT
      && offset < chunks.length
      && input.timeoutMs
      && input.startedAt) {
      const elapsed = Date.now() - input.startedAt;
      const projection = estimateRemainingProgressiveMs({
        chunks,
        completedChunkCount: chunkSummaries.length,
        observedBatchDurationsMs,
        timeoutMs: input.timeoutMs,
      });
      if (elapsed + projection.estimatedMs >= projection.executionBudgetMs) {
        log.info("Progressive compaction stopping before the remaining chunk batches exceed its time budget", {
          operation: "smart_compaction.progressive.time_projection_stop",
          completedChunkCount: chunkSummaries.length,
          totalChunkCount: chunks.length,
          elapsedMs: elapsed,
          remainingBatches: projection.remainingBatches,
          observedBatchEstimateMs: projection.batchEstimateMs,
          mergeReserveMs: projection.mergeReserveMs,
          projectedTotalMs: elapsed + projection.estimatedMs,
          executionBudgetMs: projection.executionBudgetMs,
        });
        return buildTimeBudgetPartial(
          chunkSummaries.length,
          elapsed,
          `time feasibility projection exceeded after ${formatProgressCount(chunkSummaries.length, chunks.length)} chunks: projected ${Math.round((elapsed + projection.estimatedMs) / 1000)}s including ${Math.round(projection.mergeReserveMs / 1000)}s merge reserve > ${Math.round(projection.executionBudgetMs / 1000)}s execution budget`,
        );
      }
    }
  }

  if (chunkSummaries.length === 0) {
    throw new Error("Progressive compaction produced no chunk summaries (time budget exhausted before first chunk)");
  }

  try {
    const summary = await mergeProgressiveSummaries({
      summaries: chunkSummaries,
      model: input.model,
      auth: input.auth,
      budget: input.budget,
      maxTokens,
      abortSignal: input.abortSignal,
      ctx: input.ctx,
      publishEstimate: input.publishEstimate,
      timeoutMs: input.timeoutMs,
      startedAt: input.startedAt,
      streamFn: input.streamFn,
      onProgress: input.onProgress,
      onModelRequest,
      finalPromptExtras: {
        // previousSummary has already been summarized as the first atomic
        // source group above; do not duplicate the full source in the final
        // merge prompt and recreate an input overflow.
        previousSummary: undefined,
        keptMessagesSummary: input.keptMessagesSummary,
        turnPrefixSummary: input.turnPrefixSummary,
        customInstructions: input.customInstructions,
        fileOps: input.fileOps,
      },
    });
    input.checkpointStore?.clear();
    return {
      summary,
      complete: true,
      processedChunkCount: chunkSummaries.length,
      totalChunkCount: chunks.length,
      modelCallCount,
    };
  } catch (err) {
    if (input.abortSignal.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const elapsed = input.startedAt ? Date.now() - input.startedAt : input.timeoutMs ?? 0;
    // A deterministic fallback that embeds every chunk summary can exceed the
    // same final output contract as the failed merge. Retain a bounded prefix
    // and leave at least one complete atomic tail group verbatim instead. This
    // is safe for output-validation/provider failures as well as timeouts: the
    // checkpoint claims coverage only for already validated chunk summaries.
    return buildTimeBudgetPartial(chunkSummaries.length - 1, elapsed, `progressive final merge failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
