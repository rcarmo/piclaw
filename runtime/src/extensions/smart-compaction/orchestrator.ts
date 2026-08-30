/** Smart-compaction lifecycle orchestrator. Policy and provider execution live in focused modules. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionFactory, CompactionResult, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../utils/logger.js";
import { applyTokenEstimateSafetyMultiplier } from "../../utils/context-window-budget.js";
import { checkPiclawCompactionBudget, maybeYieldPiclawCompaction, resolvePiclawCompactionTrigger, updatePiclawCompactionExecution } from "../../agent-pool/compaction-trigger-context.js";
import { getCompactionRuntimeConfig } from "../../core/config.js";
import { MAX_PROMPT_CHARS, MIN_COMPACTION_OUTPUT_TOKENS, PROGRESSIVE_FALLBACK_CONTEXT_WINDOW, SMART_COMPACTION_PROGRESS_INTERVAL_MS } from "./config.js";
import { estimateCompactionPromptTokens, estimateSmartCompactionCompletionPercent, getContextWindowEstimate, publishContextEstimate } from "./context.js";
import { reconcileFileOperations } from "./files.js";
import { analyzeToolOutcomes, isRealUserSourceMessage, type SourceMessage } from "./messages.js";
import { prepareCompactionSource } from "./source.js";
import { canonicalizeFileLists, tryNoOpCompaction } from "./noop.js";
import { extractKeptMessagesSummary } from "./retained-context.js";
import { getProgressiveCompactionBudget, runProgressiveCompaction } from "./progressive.js";
import {
  clampKeepRecentTokens,
  estimatePostCompactionFit,
  getCompactionOutputTokenTarget,
  getSafeCompactionMaxTokens,
} from "./safety.js";
import { detectRecentTopicShift } from "./selective-prompt.js";
import { buildSelectiveMethodPrompt } from "./selective-method.js";
import type { CompactionStreamFn } from "./stream-complete.js";
import { validateCompactionSummaryResponse } from "./summary-validation.js";
import { resolveSmartCompactionModelRequest } from "./model-request.js";
import { runCompactionModelExecution } from "./model-execution.js";
import {
  attemptRemoteCompaction,
  stripRemoteCompactionMarker,
  getLatestRemoteCompactionState,
  injectRemoteCompactionPayload,
  isRemoteCompactionCompatible,
  mergeRemoteCompactionFileOperations,
  prependRemoteCompactionPayload,
  REMOTE_COMPACTION_SUMMARY_SENTINEL,
} from "./remote-compaction.js";
import { buildPipelinedAuditTelemetry, buildPipelinedPrompt } from "./pipelined.js";
import { assemblePipelineEvents, buildCanonicalPipelineSourceUnits } from "./pipeline-events.js";
import { createProgressiveCheckpointStore } from "./progressive-checkpoint.js";
import { createSmartCompactionResultDetails, type SmartCompactionRemoteOutcome } from "./result-details.js";
import { createCompactionProviderTiming, formatFirstTokenWaitStatus, inferCompactionTimeoutStage } from "./provider-timing.js";
import { buildCompactionLatencyEstimate } from "../../agent-pool/compaction-prefill-estimate.js";
import { sanitizeContextPruneCompactionMessages } from "../context-prune/pruner.js";
import {
  buildTargetContextGuidance,
  estimateKeptTokensFromEntryId,
  findBranchEntryIndex,
  isValidCompactionRetainedBoundary,
  maybeAdjustFirstKeptForFit,
  parseTargetContextInstructions,
  resolveFirstKeptEntryIdForSourceMessageIndex,
  resolveSourceEntryIdsForMessages,
} from "./boundary-policy.js";
import {
  beginCompactionStatusOwnership,
  cancelCompactionWithReason,
  estimateProgressiveProgressCompletion,
  finishCompactionStatusOwnership,
  formatProgressiveProgressMessage,
  getCompactionStatusPrefix,
  isRecoveryCompaction,
  makeResilientCtx,
  ownsCompactionStatus,
  publishCompactionStatus,
  statusMessage,
} from "./status.js";

const log = createLogger("ext.smart-compaction.orchestrator");

export function createSmartCompactionExtension(options: { streamFn?: CompactionStreamFn; modelRuntime?: ModelRuntime } = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {

  // Provider-native compacted windows are persisted in CompactionEntry.details.
  // Rehydrate the opaque window at the provider-payload boundary so Pi's
  // human-readable compaction summary projection never reduces or rewrites it.
  pi.on("before_provider_request", (event, ctx) => {
    const state = getLatestRemoteCompactionState(ctx.sessionManager.getBranch());
    if (!state) return;
    if (state.kind === "invalid") {
      log.warn("Dropped malformed provider-native compaction replay marker", {
        operation: "remote_compaction.replay",
        outcome: "malformed",
        reason: state.message,
      });
      return stripRemoteCompactionMarker(event.payload);
    }
    const details = state.details;
    const replay = injectRemoteCompactionPayload(event.payload, ctx.model as any, details);
    if (replay.ok) {
      log.debug("Injected persisted provider-native compaction window", {
        operation: "remote_compaction.replay",
        outcome: "success",
        provider: details.provider,
        modelId: details.modelId,
        itemCount: replay.injectedItems,
      });
      return replay.payload;
    }
    log.warn("Dropped un-replayable provider-native compaction window; continuing without it", {
      operation: "remote_compaction.replay",
      outcome: replay.code,
      provider: details.provider,
      modelId: details.modelId,
      reason: replay.message,
    });
    return replay.fallbackPayload;
  });

  pi.on("session_before_compact", async (event, rawCtx) => {
    const ctx = makeResilientCtx(rawCtx as any) as typeof rawCtx;
    const { preparation, signal, customInstructions, branchEntries } = event;
    // Runtime settings can change without restart. Capture the lifecycle
    // settings exactly once so an in-flight generation never switches method
    // or adopts a different timeout midway.
    const compactionRuntimeConfig = getCompactionRuntimeConfig();
    const smartCompactionMethod = compactionRuntimeConfig.smartCompactionMethod;
    const compactionMetadata = resolvePiclawCompactionTrigger({
      reason: (event as { reason?: string }).reason,
      willRetry: (event as { willRetry?: boolean }).willRetry,
    });
    const parsedTargetContext = parseTargetContextInstructions(customInstructions);
    const targetContext = {
      targetContextWindow: compactionMetadata.targetContextWindow ?? parsedTargetContext.targetContextWindow,
      targetModelLabel: compactionMetadata.targetModelLabel ?? parsedTargetContext.targetModelLabel,
      instructions: parsedTargetContext.instructions,
    };
    const {
      messagesToSummarize,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
      settings,
    } = preparation;

    updatePiclawCompactionExecution({ compactionMethod: smartCompactionMethod, compactionInputTokens: tokensBefore });
    let finalContextTokens: number | null = null;
    const publishContextSnapshot = (tokens: number | null | undefined, phase: "before_compaction" | "after_compaction") => {
      publishContextEstimate(ctx, typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : null, phase, {
        completionPercent: phase === "after_compaction" ? 100 : 0,
        contextWindow: phase === "after_compaction" ? targetContext.targetContextWindow : undefined,
      });
    };

    const discardedSourceMessages = [
      ...messagesToSummarize,
      ...(preparation.isSplitTurn ? preparation.turnPrefixMessages : []),
    ] as SourceMessage[];
    if (discardedSourceMessages.length === 0) return;

    const statusOwner = beginCompactionStatusOwnership(compactionMetadata, ctx);
    const compactionStartedAt = Date.now();
    let providerTiming = createCompactionProviderTiming(ctx.model as any);
    let providerWaitStatusTimer: ReturnType<typeof setInterval> | null = null;
    publishContextSnapshot(tokensBefore, "before_compaction");
    publishCompactionStatus(ctx, statusMessage(compactionMetadata, `scanning ${discardedSourceMessages.length} messages…`), estimateSmartCompactionCompletionPercent("scanning"), statusOwner);

    try {
      // Capture the signal reference from the event. The upstream
      // `_compactionAbortController` can be cleared by a concurrent `compact()`
      // call's finally block while our async handler is in flight. By capturing
      // the signal here we can check `.aborted` reliably and return `{ cancel }`
      // instead of falling through — which would crash upstream when it accesses
      // the already-cleared controller.
      const abortSignal = signal;
      let remoteOutcome: Exclude<SmartCompactionRemoteOutcome, "success"> = compactionRuntimeConfig.remoteCompactionEnabled
        ? "unsupported"
        : "disabled";
      let remoteReason = compactionRuntimeConfig.remoteCompactionEnabled
        ? "Provider-native capability was not attempted"
        : "Provider-native compaction is disabled";
      const resultDetails = (
        execution: Parameters<typeof createSmartCompactionResultDetails>[0]["execution"],
        modelCallCount: number,
        progress?: { processedChunkCount: number; totalChunkCount: number },
      ) => createSmartCompactionResultDetails({
        method: smartCompactionMethod,
        execution,
        remoteOutcome,
        remoteReason,
        modelCallCount,
        model: providerTiming.model,
        providerRequestCount: providerTiming.requestCount,
        ...(providerTiming.timeToFirstTokenMs !== null ? { timeToFirstTokenMs: providerTiming.timeToFirstTokenMs } : {}),
        durationMs: Math.max(0, Date.now() - compactionStartedAt),
        ...(providerTiming.timeoutStage ? { timeoutStage: providerTiming.timeoutStage } : {}),
        ...progress,
      });
      const publishCompactionStage = (message: string, phase: string, _tokens?: number | null, completionPercent = estimateSmartCompactionCompletionPercent(phase)) => {
        publishCompactionStatus(ctx, message, completionPercent, statusOwner);
      };
      let lastProgressUiAt = 0;
      providerWaitStatusTimer = setInterval(() => {
        const message = formatFirstTokenWaitStatus(providerTiming, Date.now(), compactionMetadata.deadlineAtMs);
        if (!message) return;
        publishCompactionStage(
          statusMessage(compactionMetadata, message),
          "provider_waiting_first_token",
        );
      }, SMART_COMPACTION_PROGRESS_INTERVAL_MS);
      if (typeof providerWaitStatusTimer.unref === "function") providerWaitStatusTimer.unref();
      const setThrottledProgressMessage = (message: string, phase: string, completionPercent = estimateSmartCompactionCompletionPercent(phase)) => {
        const now = Date.now();
        if (now - lastProgressUiAt < SMART_COMPACTION_PROGRESS_INTERVAL_MS) return;
        lastProgressUiAt = now;
        publishCompactionStatus(ctx, message, completionPercent, statusOwner);
      };

      // ── Compute topic-shift signal once for all downstream paths ──────
      // Both tryNoOpCompaction (to gate the minimal-content fast path) and
      // buildSelectivePrompt (to annotate the compaction prompt) need this.
      // We preserve source-message provenance so synthetic upstream user-role
      // wrappers (branch/compaction summaries, custom messages, bashExecution)
      // don't get mistaken for real human user turns.
      checkPiclawCompactionBudget("smart_compaction.handler.start");
      // Every message before firstKeptEntryId will be discarded, including a
      // split turn's prefix. Compact them as one ordered source stream so no
      // bounded preview can silently stand in for discarded continuity state.
      const sanitizedContextPrune = sanitizeContextPruneCompactionMessages(
        discardedSourceMessages,
        branchEntries,
      );
      await maybeYieldPiclawCompaction("smart_compaction.handler.after_sanitize");
      const messagesForCompaction = sanitizedContextPrune.messages as SourceMessage[];
      if (sanitizedContextPrune.prunedToolResults > 0 || sanitizedContextPrune.replacedToolCalls > 0) {
        log.debug("Sanitized context-pruned tool history before smart compaction", {
          operation: "smart_compaction.context_prune_sanitize",
          prunedToolResults: sanitizedContextPrune.prunedToolResults,
          replacedToolCalls: sanitizedContextPrune.replacedToolCalls,
          summarizedToolCallCount: sanitizedContextPrune.summarizedToolCallIds.size,
        });
      }

      const previousRemoteState = getLatestRemoteCompactionState(branchEntries);
      if (previousRemoteState?.kind === "invalid") {
        log.warn("Provider-native compaction state is malformed; cancelling instead of discarding canonical context", {
          operation: "remote_compaction.blocked",
          outcome: "malformed",
          reason: previousRemoteState.message,
        });
        return cancelCompactionWithReason(ctx, previousRemoteState.message);
      }
      if (previousRemoteState?.kind === "valid" && !isRemoteCompactionCompatible(ctx.model as any, previousRemoteState.details)) {
        log.warn("Provider-native compaction state is incompatible with the active model; cancelling compaction", {
          operation: "remote_compaction.blocked",
          outcome: "incompatible",
          provider: previousRemoteState.details.provider,
          modelId: previousRemoteState.details.modelId,
        });
        return cancelCompactionWithReason(
          ctx,
          "Persisted provider-native compaction state is incompatible with the active model",
        );
      }
      const localPreviousSummary = previousRemoteState?.kind === "valid"
        ? "Provider-native canonical context is supplied as opaque input before this compaction prompt. Preserve its continuity together with the new source events."
        : previousSummary;

      const sourceFileOps = previousRemoteState?.kind === "valid"
        ? mergeRemoteCompactionFileOperations(preparation.fileOps, previousRemoteState.details)
        : preparation.fileOps;
      const inheritedRemoteModifiedPaths = previousRemoteState?.kind === "valid"
        ? [...previousRemoteState.details.fileOperations.written, ...previousRemoteState.details.fileOperations.edited]
        : [];
      const rawSourceEntryIds = resolveSourceEntryIdsForMessages(
        branchEntries,
        discardedSourceMessages,
      );
      const preparedSource = prepareCompactionSource({
        rawMessages: discardedSourceMessages,
        rawSourceEntryIds,
        modelSafeSourceMessages: messagesForCompaction,
        modelSafeSourceIndexes: sanitizedContextPrune.sourceMessageIndexesByMessageIndex,
        previousSummary: localPreviousSummary,
        fileOps: sourceFileOps,
      });
      const {
        llmMessages,
        humanUserIndexes,
        sourceIndexesByLlmIndex,
        sourceEntryIdsByLlmIndex,
      } = preparedSource;
      const toolAnalysis = analyzeToolOutcomes(llmMessages);
      await maybeYieldPiclawCompaction("smart_compaction.handler.after_tool_analysis");
      const effectiveFileOps = reconcileFileOperations(
        sourceFileOps,
        toolAnalysis,
        previousSummary,
        inheritedRemoteModifiedPaths,
      );
      preparedSource.fileOps = effectiveFileOps;
      const effectivePreparation = { ...preparation, fileOps: effectiveFileOps };

      if (compactionRuntimeConfig.remoteCompactionEnabled) {
        const modelRequest = await resolveSmartCompactionModelRequest(ctx, options.modelRuntime, { resolveDirectRequestAuth: true });
        if (!modelRequest.ok) {
          remoteOutcome = "unavailable";
          remoteReason = modelRequest.error;
          log.info("Provider-native compaction unavailable; using configured local fallback", {
            operation: "remote_compaction.fallback",
            outcome: remoteOutcome,
            fallbackMethod: smartCompactionMethod,
            reason: modelRequest.error,
          });
          publishCompactionStage(
            statusMessage(compactionMetadata, `local ${smartCompactionMethod} fallback — provider-native unavailable: ${modelRequest.error}`),
            "remote_fallback",
            tokensBefore,
          );
        } else {
          publishCompactionStage(
            statusMessage(compactionMetadata, `provider-native compaction in progress — ${modelRequest.model.provider}/${modelRequest.model.id}`),
            "remote_compaction",
            tokensBefore,
          );
          log.debug("Attempting provider-native compaction", {
            operation: "remote_compaction.attempt",
            provider: modelRequest.model.provider,
            modelId: modelRequest.model.id,
            fallbackMethod: smartCompactionMethod,
          });
          const remoteResult = await attemptRemoteCompaction({
            model: modelRequest.model,
            auth: modelRequest.auth,
            messages: messagesForCompaction as unknown as AgentMessage[],
            previousDetails: previousRemoteState?.kind === "valid" ? previousRemoteState.details : null,
            previousSummary: previousRemoteState?.kind === "valid" ? null : previousSummary,
            fileOps: effectiveFileOps,
            systemPrompt: ctx.getSystemPrompt(),
            tools: pi.getAllTools(),
            signal: abortSignal,
            timeoutMs: compactionRuntimeConfig.remoteCompactionTimeoutMs,
            backoffBaseMs: compactionRuntimeConfig.backoffBaseMs,
            backoffMaxMs: compactionRuntimeConfig.backoffMaxMs,
          });
          if (remoteResult.ok) {
            updatePiclawCompactionExecution({
              compactionMethod: "provider_native",
              compactionExecution: "provider_native",
              providerModel: `${remoteResult.details.provider}/${remoteResult.details.modelId}`,
              providerRequestCount: 1,
            });
            const outputChars = JSON.stringify(remoteResult.details.output).length;
            finalContextTokens = Math.max(1, Math.ceil(outputChars / 4)) + Math.max(0, Number(settings.keepRecentTokens) || 0);
            publishCompactionStage(
              statusMessage(compactionMetadata, `provider-native compaction complete — ${remoteResult.details.provider}/${remoteResult.details.modelId}`),
              "completed_remote",
              finalContextTokens,
              100,
            );
            log.info("Provider-native compaction completed", {
              operation: "remote_compaction.completed",
              outcome: "success",
              provider: remoteResult.details.provider,
              modelId: remoteResult.details.modelId,
              canonicalItemCount: remoteResult.details.output.length,
              inputTokens: remoteResult.details.usage?.inputTokens ?? null,
              outputTokens: remoteResult.details.usage?.outputTokens ?? null,
              totalTokens: remoteResult.details.usage?.totalTokens ?? null,
              durationMs: Date.now() - compactionStartedAt,
            });
            return {
              compaction: {
                summary: REMOTE_COMPACTION_SUMMARY_SENTINEL,
                firstKeptEntryId,
                tokensBefore,
                details: remoteResult.details,
              } satisfies CompactionResult,
            };
          }
          if (remoteResult.code === "cancelled") return { cancel: true };
          remoteOutcome = remoteResult.code;
          remoteReason = remoteResult.message;
          log.info("Provider-native compaction failed; using configured local fallback", {
            operation: "remote_compaction.fallback",
            outcome: remoteResult.code,
            provider: modelRequest.model.provider,
            modelId: modelRequest.model.id,
            status: remoteResult.status ?? null,
            retryAfterMs: remoteResult.retryAfterMs ?? null,
            fallbackMethod: smartCompactionMethod,
            reason: remoteResult.message,
          });
          publishCompactionStage(
            statusMessage(compactionMetadata, `local ${smartCompactionMethod} fallback — provider-native ${remoteResult.code}: ${remoteResult.message}`),
            "remote_fallback",
            tokensBefore,
          );
        }
      } else {
        log.debug("Provider-native compaction disabled; using configured local method", {
          operation: "remote_compaction.skipped",
          outcome: "disabled",
          fallbackMethod: smartCompactionMethod,
        });
      }

      // Check abort early — a concurrent compact() may have already cancelled us.
      if (abortSignal.aborted) return { cancel: true };

      const topicShift = detectRecentTopicShift(llmMessages, humanUserIndexes);
      await maybeYieldPiclawCompaction("smart_compaction.handler.after_topic_shift");

      log.debug("Pivot detection result", {
        detected: !!topicShift,
        reasons: topicShift?.reasons ?? [],
        overlap: topicShift?.overlap ?? null,
        messageCount: llmMessages.length,
      });

      // Extract kept-messages context from branchEntries so the LLM knows
      // what the user is currently working on (kept messages survive compaction).
      const keptContext = branchEntries
        ? extractKeptMessagesSummary(branchEntries, firstKeptEntryId)
        : { summary: "", hasHumanUser: false };
      const keptMessagesSummary = keptContext.summary;
      const hasTurnPrefixHumanUser = preparation.isSplitTurn
        && preparation.turnPrefixMessages.some((message) => isRealUserSourceMessage(message as SourceMessage));

      const contextWindow = targetContext.targetContextWindow ?? getContextWindowEstimate(ctx) ?? PROGRESSIVE_FALLBACK_CONTEXT_WINDOW;
      const configuredKeepRecent = Math.max(0, Number(settings.keepRecentTokens) || 0);
      const safeKeepRecent = clampKeepRecentTokens(configuredKeepRecent, contextWindow);
      const targetGuidance = buildTargetContextGuidance(targetContext.targetContextWindow, targetContext.targetModelLabel, configuredKeepRecent);
      const effectiveCustomInstructions = [targetGuidance, targetContext.instructions].filter((part) => part?.trim()).join("\n\n") || undefined;
      preparedSource.retainedContext = keptMessagesSummary;
      preparedSource.customInstructions = effectiveCustomInstructions;

      log.debug("Prepared complete discarded source", {
        operation: "smart_compaction.source_prepared",
        method: smartCompactionMethod,
        sourceEventCount: preparedSource.sourceEvents.length,
        modelMessageCount: preparedSource.llmMessages.length,
        contextPrunedEventCount: preparedSource.sourceEvents.filter((sourceEvent) => sourceEvent.contextPruned).length,
      });
      const pipelinedPrompt = smartCompactionMethod === "pipelined"
        ? buildPipelinedPrompt(preparedSource, toolAnalysis)
        : null;
      if (pipelinedPrompt) {
        log.debug("Pipelined source ledger validated", {
          operation: "smart_compaction.pipeline_planned",
          method: smartCompactionMethod,
          sourceEventCount: preparedSource.sourceEvents.length,
          groupCount: pipelinedPrompt.groupCount,
          sourceUnitCount: pipelinedPrompt.plan.units.length,
          dispositionCounts: pipelinedPrompt.plan.dispositionCounts,
          pipelineCompression: pipelinedPrompt.plan.compression,
          coverageComplete: pipelinedPrompt.plan.coverageComplete,
          auditLedger: buildPipelinedAuditTelemetry(pipelinedPrompt.plan),
        });
      }
      const discardedRawSourceChars = preparedSource.sourceEvents.reduce((total, sourceEvent) => {
        try {
          return total + JSON.stringify(sourceEvent.rawMessage).length;
        } catch {
          return total + String(sourceEvent.rawMessage.content ?? "").length;
        }
      }, 0);
      const discardedSourceTokenEstimate = applyTokenEstimateSafetyMultiplier(
        Math.max(1, Math.ceil(discardedRawSourceChars / 4)),
      );
      const canonicalTokenEstimate = pipelinedPrompt
        ? estimateCompactionPromptTokens(pipelinedPrompt.plan.units.map((unit) => unit.renderedText).join("\n"))
        : null;
      const logNoOpMetrics = (summary: string, postCompactionTokenEstimate: number, partialBoundary: string | null) => {
        const summaryTokenEstimate = estimateCompactionPromptTokens(summary);
        log.debug("Smart compaction metrics", {
          operation: "smart_compaction.completed",
          method: smartCompactionMethod,
          execution: "deterministic_noop",
          sourceEventCount: preparedSource.sourceEvents.length,
          sourceGroupCount: pipelinedPrompt?.groupCount ?? preparedSource.sourceEvents.length,
          dispositionCounts: pipelinedPrompt?.plan.dispositionCounts ?? null,
          pipelineCompression: pipelinedPrompt?.plan.compression ?? null,
          sourceTokenEstimate: discardedSourceTokenEstimate,
          canonicalTokenEstimate,
          semanticInputTokenEstimate: 0,
          summaryTokenEstimate,
          retainedTokenEstimate: estimateCompactionPromptTokens(keptMessagesSummary),
          postCompactionTokenEstimate,
          deterministicReductionPercent: canonicalTokenEstimate === null
            ? null
            : Math.max(0, Math.round((1 - canonicalTokenEstimate / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10),
          finalReductionPercent: Math.max(0, Math.round((1 - summaryTokenEstimate / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10),
          modelCallCount: 0,
          chunkCount: 0,
          durationMs: Date.now() - compactionStartedAt,
          partialBoundary,
          coverageComplete: true,
        });
      };

      // ── No-op detection ──────────────────────────────────────────────
      // Skip the LLM call entirely when we can produce a good summary
      // mechanically. This saves ~60-110s and 100-270k input tokens.
      const hasNonToolSourceBearingContext = preparedSource.sourceEvents.some((sourceEvent) =>
        sourceEvent.classification === "context"
        || sourceEvent.rawMessage.role === "branchSummary"
        || (sourceEvent.classification === "synthetic" && sourceEvent.rawMessage.role !== "compactionSummary"),
      );
      if (hasNonToolSourceBearingContext) {
        log.debug("No-op compaction disabled because discarded source contains non-tool continuity context", {
          operation: "smart_compaction.noop_source_bearing_context",
          sourceIndexes: preparedSource.sourceEvents
            .filter((sourceEvent) =>
              sourceEvent.classification === "context"
              || sourceEvent.rawMessage.role === "branchSummary"
              || (sourceEvent.classification === "synthetic" && sourceEvent.rawMessage.role !== "compactionSummary"),
            )
            .map((sourceEvent) => sourceEvent.sourceIndex),
        });
      }
      const noOpResult = hasNonToolSourceBearingContext ? null : tryNoOpCompaction(
        llmMessages,
        { ...effectivePreparation, customInstructions: effectiveCustomInstructions },
        firstKeptEntryId,
        tokensBefore,
        topicShift,
        humanUserIndexes,
        toolAnalysis,
        {
          hasKeptUserContext: keptContext.hasHumanUser,
          hasTurnPrefixHumanUser,
        },
        (message, completionPercent) => publishCompactionStatus(ctx, message, completionPercent, statusOwner),
      );
      const noOpValidation = noOpResult
        ? validateCompactionSummaryResponse(
            { content: [{ type: "text", text: noOpResult.compaction.summary }], stopReason: "stop" },
            "final",
            MAX_PROMPT_CHARS,
          )
        : null;
      if (noOpResult && noOpValidation?.ok) {
        const actualNoOpKeptTokens = estimateKeptTokensFromEntryId(branchEntries, noOpResult.compaction.firstKeptEntryId);
        const noOpKeptTokens = actualNoOpKeptTokens ?? configuredKeepRecent;
        const postFit = estimatePostCompactionFit(noOpResult.compaction.summary, noOpKeptTokens, contextWindow);
        const noOpBoundaryInvalid = !isValidCompactionRetainedBoundary(
          branchEntries,
          noOpResult.compaction.firstKeptEntryId,
        );
        if (!postFit.fits || noOpKeptTokens > safeKeepRecent || noOpBoundaryInvalid) {
          try {
            const adjusted = maybeAdjustFirstKeptForFit({
              summary: noOpResult.compaction.summary,
              currentFirstKeptEntryId: noOpResult.compaction.firstKeptEntryId,
              configuredKeepRecent,
              targetKeepRecent: safeKeepRecent,
              contextWindow,
              branchEntries,
            });
            if (adjusted.adjusted) {
              log.debug(
                `No-op compaction adjusted kept window to fit ${contextWindow} context (firstKept ${noOpResult.compaction.firstKeptEntryId} → ${adjusted.firstKeptEntryId}, estimated ${adjusted.estimatedTotal}t, margin ${adjusted.margin}t).`,
              );
            }
            finalContextTokens = adjusted.estimatedTotal;
            publishCompactionStage(statusMessage(compactionMetadata, "reused summary with adjusted kept context…"), "completed_noop_adjusted", adjusted.estimatedTotal);
            logNoOpMetrics(noOpResult.compaction.summary, adjusted.estimatedTotal, null);
            updatePiclawCompactionExecution({ compactionExecution: "deterministic_noop" });
            return {
              compaction: {
                ...noOpResult.compaction,
                firstKeptEntryId: adjusted.firstKeptEntryId,
                details: resultDetails("deterministic_noop", 0),
              },
            };
          } catch {
            log.debug(
              `No-op compaction: post-compaction estimate ${postFit.estimatedTotal} tokens is unsafe for ${contextWindow} context (actual kept ${noOpKeptTokens}t, configured kept ${configuredKeepRecent}t, safe kept ${safeKeepRecent}t, margin ${postFit.margin}t). Falling through to LLM compaction.`,
            );
            publishCompactionStage(statusMessage(compactionMetadata, "no-op estimate unsafe; extracting signal…"), "noop_unsafe", postFit.estimatedTotal);
            // Don't return the no-op — fall through to LLM-based compaction
          }
        } else {
          finalContextTokens = postFit.estimatedTotal;
          publishCompactionStage(statusMessage(compactionMetadata, "reused existing summary…"), "completed_noop", postFit.estimatedTotal);
          logNoOpMetrics(noOpResult.compaction.summary, postFit.estimatedTotal, null);
          updatePiclawCompactionExecution({ compactionExecution: "deterministic_noop" });
          return {
            compaction: {
              ...noOpResult.compaction,
              details: resultDetails("deterministic_noop", 0),
            },
          };
        }
      } else if (noOpResult && noOpValidation && !noOpValidation.ok) {
        log.debug("No-op compaction rejected an inherited malformed summary; falling through to LLM compaction", {
          operation: "smart_compaction.noop_invalid_summary",
          validationFailure: noOpValidation.code,
        });
      }

      // Always keep compaction on Piclaw's observable selective/progressive
      // paths. Upstream full-pass fallback is intentionally disabled because
      // large tool/image payloads can exceed provider request limits.

      if (safeKeepRecent < configuredKeepRecent) {
        log.debug(
          `keepRecentTokens setting ${configuredKeepRecent} exceeds safe ${safeKeepRecent} for ${contextWindow} context; post-compaction fit checks will use the configured kept-window estimate to avoid under-reporting`,
          );
      }

      const methodLabel = smartCompactionMethod === "pipelined" ? "pipelined" : "selective";
      publishCompactionStage(statusMessage(compactionMetadata, `extracting signal from ${messagesForCompaction.length} messages with ${methodLabel}…`), "extracting", tokensBefore);
      log.debug(
        `${getCompactionStatusPrefix(compactionMetadata)}: ${messagesForCompaction.length} msgs → ${smartCompactionMethod}`,
      );

      const selectivePrompt = smartCompactionMethod === "selective"
        ? buildSelectiveMethodPrompt({
            source: preparedSource,
            tokensBefore,
            fileOps: effectiveFileOps,
            topicShift,
          })
        : null;
      const promptText = pipelinedPrompt?.text ?? selectivePrompt!.text;

      await maybeYieldPiclawCompaction("smart_compaction.handler.after_method_prompt");
      const promptTokens = estimateCompactionPromptTokens(promptText);
      log.debug(
        `Prompt: ${Math.round(promptText.length / 1000)}k chars / ~${Math.round(promptTokens / 1000)}k tokens (vs ~${Math.round(tokensBefore / 1000)}k tokens full)`,
          );
      publishCompactionStage(statusMessage(compactionMetadata, `preparing ${methodLabel} summary prompt…`), "summarizing_prompt", promptTokens);

      const modelRequest = await resolveSmartCompactionModelRequest(ctx, options.modelRuntime, { useConfiguredModel: true });
      if (!modelRequest.ok) {
        log.debug("Compaction model or credentials are unavailable; cancelling instead of falling through to upstream full-pass compaction");
        return cancelCompactionWithReason(ctx, modelRequest.error);
      }
      const { model: compactionModel, auth } = modelRequest;
      providerTiming = createCompactionProviderTiming(compactionModel);
      const latencyEstimate = buildCompactionLatencyEstimate({
        provider: compactionModel.provider,
        model: compactionModel.id,
        inputTokens: tokensBefore,
        deadlineMs: compactionRuntimeConfig.timeoutMs,
      });
      if (latencyEstimate?.warningText) {
        publishCompactionStage(statusMessage(compactionMetadata, latencyEstimate.warningText), "prefill_warning", tokensBefore, 24);
        log.warn("Compaction latency warning", {
          operation: "smart_compaction.latency_warning",
          provider: latencyEstimate.provider,
          model: latencyEstimate.model,
          inputBucketMin: latencyEstimate.inputBucketMin,
          inputBucketMax: latencyEstimate.inputBucketMax,
          sampleCount: latencyEstimate.sampleCount,
          medianDurationMs: latencyEstimate.medianDurationMs,
          p90DurationMs: latencyEstimate.p90DurationMs,
          deadlineMs: compactionRuntimeConfig.timeoutMs,
        });
      }
      if (previousRemoteState?.kind === "valid" && !isRemoteCompactionCompatible(compactionModel, previousRemoteState.details)) {
        return cancelCompactionWithReason(
          ctx,
          "Persisted provider-native compaction state is incompatible with the resolved compaction model",
        );
      }

      const baseBudget = getProgressiveCompactionBudget(compactionModel);
      const recoveryCompaction = isRecoveryCompaction(compactionMetadata);
      const budget = recoveryCompaction ? { ...baseBudget, forceProgressive: true } : baseBudget;
      const requestedOutputTokens = getCompactionOutputTokenTarget(settings.reserveTokens);
      let promptTooLargeForSinglePass = promptTokens + MIN_COMPACTION_OUTPUT_TOKENS > budget.contextWindow;
      if (!promptTooLargeForSinglePass) {
        try {
          getSafeCompactionMaxTokens(compactionModel, promptText, requestedOutputTokens);
        } catch (error) {
          if (/exceeds safe model budget/i.test(error instanceof Error ? error.message : String(error))) {
            promptTooLargeForSinglePass = true;
          } else {
            throw error;
          }
        }
      }
      // A bounded selective prompt must not disguise that it sampled an input
      // too large for a complete single-pass representation. Use both upstream's
      // count and an independent source estimate because tokensBefore can lag.
      const sourceChars = llmMessages.reduce((total, message) => {
        try {
          return total + JSON.stringify(message).length;
        } catch {
          return total + String((message as SourceMessage).content ?? "").length;
        }
      }, 0);
      const sourceTokens = Math.max(
        tokensBefore,
        applyTokenEstimateSafetyMultiplier(Math.max(1, Math.ceil(sourceChars / 4))),
      );
      const sourceTooLargeForSinglePass = sourceChars > budget.promptBudgetChars
        || sourceTokens + MIN_COMPACTION_OUTPUT_TOKENS > budget.contextWindow;
      const selectiveCoverageIncomplete = selectivePrompt ? !selectivePrompt.completeSourceCoverage : false;
      if (selectiveCoverageIncomplete) {
        log.debug("Selective prompt omitted source-bearing messages; routing through complete progressive coverage", {
          operation: "smart_compaction.selective_coverage_incomplete",
          omittedSourceMessageCount: selectivePrompt?.omittedSourceMessageCount,
          truncatedContinuitySectionCount: selectivePrompt?.truncatedContinuitySectionCount,
        });
      }
      if (
        budget.forceProgressive
        || selectiveCoverageIncomplete
        || promptText.length > budget.promptBudgetChars
        || promptTooLargeForSinglePass
        || (smartCompactionMethod === "selective" && sourceTooLargeForSinglePass)
      ) {
        try {
          publishCompactionStage(statusMessage(compactionMetadata, "progressive iterative mode…"), "progressive_iterative", promptTokens);
          log.debug(
            `Progressive compaction enabled (${compactionMetadata.trigger}): prompt ${Math.round(promptText.length / 1000)}k chars / ~${Math.round(promptTokens / 1000)}k tokens exceeds safe single-pass budget (${Math.round(budget.promptBudgetChars / 1000)}k chars, ${budget.contextWindow.toLocaleString()} context)`,
          );
          const progressiveSourceUnits = pipelinedPrompt?.plan.units
            ?? buildCanonicalPipelineSourceUnits(assemblePipelineEvents(preparedSource).groups);
          const progressiveResult = await runProgressiveCompaction({
            llmMessages,
            sourceUnits: progressiveSourceUnits,
            humanUserIndexes,
            sourceIndexesByLlmIndex,
            sourceEntryIdsByLlmIndex,
            model: compactionModel,
            auth,
            settings,
            previousSummary: localPreviousSummary,
            keptMessagesSummary,
            turnPrefixSummary: "",
            customInstructions: effectiveCustomInstructions,
            fileOps: effectiveFileOps,
            budget,
            abortSignal,
            ctx: {
              ui: {
                setStatus: (key, text) => {
                  if (ownsCompactionStatus(statusOwner)) ctx.ui.setStatus?.(key, text);
                },
              },
            },
            timeoutMs: compactionRuntimeConfig.timeoutMs,
            startedAt: compactionStartedAt,
            publishEstimate: undefined,
            streamFn: options.streamFn,
            onPayload: previousRemoteState?.kind === "valid"
              ? (payload) => prependRemoteCompactionPayload(payload, previousRemoteState.details)
              : undefined,
            checkpointStore: createProgressiveCheckpointStore(compactionMetadata.chatJid),
            providerTiming,
            onProgress: (_generatedChars, progress) => {
              setThrottledProgressMessage(
                statusMessage(compactionMetadata, formatProgressiveProgressMessage(progress).replace(/^Smart compaction:\s*/, "")),
                progress?.phase ?? "progressive_streaming",
                estimateProgressiveProgressCompletion(progress),
              );
            },
          });
          const progressiveValidation = validateCompactionSummaryResponse(
            { content: [{ type: "text", text: progressiveResult.summary }], stopReason: "stop" },
            "final",
            getCompactionOutputTokenTarget(settings.reserveTokens) * 4,
          );
          if (!progressiveValidation.ok) {
            return cancelCompactionWithReason(
              ctx,
              `Progressive compaction summary invalid (${progressiveValidation.code}): ${progressiveValidation.reason}`,
            );
          }
          const validatedProgressiveSummary = progressiveValidation.text;
          const fullSummary = canonicalizeFileLists(validatedProgressiveSummary, effectiveFileOps);

          let finalFirstKeptEntryId = firstKeptEntryId;
          let estimatedTotal = 0;
          let margin = 0;
          let adjusted = false;

          if (!progressiveResult.complete) {
            // The source index is authoritative. A source-unit's entry-ID list
            // omits undefined IDs, so its first ID can belong to a later event
            // in the same atomic group and must not be used as the cut point.
            const partialSourceMessageIndex = progressiveResult.nextUnprocessedSourceMessageIndex;
            const partialFirstKeptEntryId = partialSourceMessageIndex == null
              ? null
              : rawSourceEntryIds[partialSourceMessageIndex]
                ?? resolveFirstKeptEntryIdForSourceMessageIndex(
                  branchEntries,
                  discardedSourceMessages,
                  partialSourceMessageIndex,
                );
            if (!partialFirstKeptEntryId) {
              return cancelCompactionWithReason(
                ctx,
                `Progressive compaction stopped early (${progressiveResult.partialReason ?? "time budget exhausted"}) but could not identify the first unsummarized entry to keep verbatim`,
              );
            }
            const partialFirstKeptIndex = findBranchEntryIndex(branchEntries, partialFirstKeptEntryId);
            if (
              partialFirstKeptIndex < 0
              || !isValidCompactionRetainedBoundary(branchEntries, partialFirstKeptEntryId)
            ) {
              return cancelCompactionWithReason(
                ctx,
                `Progressive compaction stopped early (${progressiveResult.partialReason ?? "time budget exhausted"}) but the first unsummarized entry is not a valid compaction cut point`,
              );
            }
            const keptTokens = estimateKeptTokensFromEntryId(branchEntries, partialFirstKeptEntryId) ?? configuredKeepRecent;
            const partialFit = estimatePostCompactionFit(fullSummary, keptTokens, contextWindow);
            if (!partialFit.fits) {
              return cancelCompactionWithReason(
                ctx,
                `Progressive compaction stopped early (${progressiveResult.partialReason ?? "time budget exhausted"}) and the safe partial boundary still exceeds context: estimated ${partialFit.estimatedTotal}t > ${contextWindow}t`,
              );
            }
            if (Number.isFinite(tokensBefore) && partialFit.estimatedTotal >= tokensBefore) {
              return cancelCompactionWithReason(
                ctx,
                `Progressive compaction stopped early (${progressiveResult.partialReason ?? "time budget exhausted"}) but the safe partial checkpoint would not reduce context: estimated ${partialFit.estimatedTotal}t >= ${tokensBefore}t before compaction`,
              );
            }
            finalFirstKeptEntryId = partialFirstKeptEntryId;
            estimatedTotal = partialFit.estimatedTotal;
            margin = partialFit.margin;
            adjusted = partialFirstKeptEntryId !== firstKeptEntryId;
            log.debug(
              `Progressive compaction stopped early but kept unsummarized messages verbatim (firstKept ${firstKeptEntryId} → ${partialFirstKeptEntryId}, processed ${progressiveResult.processedChunkCount}/${progressiveResult.totalChunkCount} chunks, estimated ${estimatedTotal}t, margin ${margin}t).`,
            );
          } else {
            const adjustedFit = maybeAdjustFirstKeptForFit({
              summary: fullSummary,
              currentFirstKeptEntryId: firstKeptEntryId,
              configuredKeepRecent,
              targetKeepRecent: safeKeepRecent,
              contextWindow,
              branchEntries,
            });
            finalFirstKeptEntryId = adjustedFit.firstKeptEntryId;
            estimatedTotal = adjustedFit.estimatedTotal;
            margin = adjustedFit.margin;
            adjusted = adjustedFit.adjusted;
          }

          finalContextTokens = estimatedTotal;
          publishCompactionStage(
            progressiveResult.complete
              ? statusMessage(compactionMetadata, "completed progressive summary…")
              : statusMessage(compactionMetadata, "completed partial progressive summary…"),
            progressiveResult.complete ? "completed_progressive" : "completed_progressive_partial",
            estimatedTotal,
          );
          if (adjusted && progressiveResult.complete) {
            log.debug(
              `Progressive compaction adjusted kept window for ${contextWindow} context (firstKept ${firstKeptEntryId} → ${finalFirstKeptEntryId}, estimated ${estimatedTotal}t, margin ${margin}t).`,
            );
          }
          log.debug("Smart compaction metrics", {
            operation: "smart_compaction.completed",
            method: smartCompactionMethod,
            sourceEventCount: preparedSource.sourceEvents.length,
            sourceGroupCount: pipelinedPrompt?.groupCount ?? null,
            dispositionCounts: pipelinedPrompt?.plan.dispositionCounts ?? null,
            pipelineCompression: pipelinedPrompt?.plan.compression ?? null,
            sourceTokenEstimate: discardedSourceTokenEstimate,
            canonicalTokenEstimate,
            semanticInputTokenEstimate: promptTokens,
            summaryTokenEstimate: estimateCompactionPromptTokens(fullSummary),
            retainedTokenEstimate: estimateCompactionPromptTokens(keptMessagesSummary),
            postCompactionTokenEstimate: estimatedTotal,
            deterministicReductionPercent: pipelinedPrompt
              ? Math.max(0, Math.round((1 - (canonicalTokenEstimate ?? discardedSourceTokenEstimate) / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10)
              : null,
            finalReductionPercent: Math.max(0, Math.round((1 - estimateCompactionPromptTokens(fullSummary) / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10),
            modelCallCount: progressiveResult.modelCallCount,
            chunkCount: progressiveResult.totalChunkCount,
            processedChunkCount: progressiveResult.processedChunkCount,
            durationMs: Date.now() - compactionStartedAt,
            partialBoundary: progressiveResult.complete ? null : finalFirstKeptEntryId,
            coverageComplete: progressiveResult.complete,
          });
          log.debug(progressiveResult.complete ? "Progressive compaction complete ✓" : "Progressive compaction partial boundary complete ✓");
          updatePiclawCompactionExecution({ compactionExecution: progressiveResult.complete ? "progressive" : "progressive_partial" });
          return {
            compaction: {
              summary: fullSummary,
              firstKeptEntryId: finalFirstKeptEntryId,
              tokensBefore,
              details: resultDetails(
                progressiveResult.complete ? "progressive" : "progressive_partial",
                progressiveResult.modelCallCount,
                {
                  processedChunkCount: progressiveResult.processedChunkCount,
                  totalChunkCount: progressiveResult.totalChunkCount,
                },
              ),
            } satisfies CompactionResult,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (abortSignal.aborted || /Compaction cancelled/i.test(msg)) return { cancel: true };
          const diagnostic = err as {
            validationCode?: string;
            validationPhase?: string;
            validationRetryCount?: number;
            fileTagSequence?: string[];
          };
          log.warn("Progressive compaction failed after provider-native fallback", {
            operation: "smart_compaction.progressive_failed",
            method: smartCompactionMethod,
            remoteOutcome,
            remoteReason,
            durationMs: Date.now() - compactionStartedAt,
            reason: msg,
            validationCode: diagnostic.validationCode ?? null,
            validationPhase: diagnostic.validationPhase ?? null,
            validationRetryCount: diagnostic.validationRetryCount ?? null,
            fileTagSequence: diagnostic.fileTagSequence ?? [],
          });
          return cancelCompactionWithReason(ctx, `${msg} (provider-native pre-pass: ${remoteOutcome} — ${remoteReason})`);
        }
      }

      const methodResult = await runCompactionModelExecution({
        model: compactionModel,
        auth,
        promptText,
        requestedMaxTokens: requestedOutputTokens,
        abortSignal,
        streamFn: options.streamFn,
        onPayload: previousRemoteState?.kind === "valid"
          ? (payload) => prependRemoteCompactionPayload(payload, previousRemoteState.details)
          : undefined,
        providerTiming,
        onProgress: () => {
          setThrottledProgressMessage(statusMessage(compactionMetadata, "generating summary still running…"), "generating_summary_streaming");
        },
        onStage: (stage, stagePromptTokens) => {
          if (stage === "generating") {
            publishCompactionStage(statusMessage(compactionMetadata, `generating ${methodLabel} summary…`), "generating_summary", stagePromptTokens);
          } else {
            publishCompactionStage(statusMessage(compactionMetadata, "repairing incomplete summary output…"), "generating_summary_repair", stagePromptTokens);
          }
        },
      });
      if (!methodResult.ok) {
        if (methodResult.cancelled) return { cancel: true };
        return cancelCompactionWithReason(ctx, methodResult.error);
      }

      const fullSummary = canonicalizeFileLists(methodResult.summary, effectiveFileOps);
      const adjustedFit = maybeAdjustFirstKeptForFit({
        summary: fullSummary,
        currentFirstKeptEntryId: firstKeptEntryId,
        configuredKeepRecent,
        targetKeepRecent: safeKeepRecent,
        contextWindow,
        branchEntries,
      });
      finalContextTokens = adjustedFit.estimatedTotal;
      publishCompactionStage(
        statusMessage(compactionMetadata, `completed ${methodLabel} summary…`),
        smartCompactionMethod === "pipelined" ? "completed_pipelined" : "completed_selective",
        adjustedFit.estimatedTotal,
        100,
      );

      if (adjustedFit.adjusted) {
        log.debug(`Single-pass compaction adjusted kept window for ${contextWindow} context (firstKept ${firstKeptEntryId} → ${adjustedFit.firstKeptEntryId}, estimated ${adjustedFit.estimatedTotal}t, margin ${adjustedFit.margin}t).`);
      }
      log.debug("Smart compaction metrics", {
        operation: "smart_compaction.completed",
        method: smartCompactionMethod,
        sourceEventCount: preparedSource.sourceEvents.length,
        sourceGroupCount: pipelinedPrompt?.groupCount ?? null,
        dispositionCounts: pipelinedPrompt?.plan.dispositionCounts ?? null,
        pipelineCompression: pipelinedPrompt?.plan.compression ?? null,
        sourceTokenEstimate: discardedSourceTokenEstimate,
        canonicalTokenEstimate,
        semanticInputTokenEstimate: promptTokens,
        summaryTokenEstimate: estimateCompactionPromptTokens(fullSummary),
        retainedTokenEstimate: estimateCompactionPromptTokens(keptMessagesSummary),
        postCompactionTokenEstimate: adjustedFit.estimatedTotal,
        deterministicReductionPercent: pipelinedPrompt
          ? Math.max(0, Math.round((1 - (canonicalTokenEstimate ?? discardedSourceTokenEstimate) / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10)
          : null,
        finalReductionPercent: Math.max(0, Math.round((1 - estimateCompactionPromptTokens(fullSummary) / Math.max(1, discardedSourceTokenEstimate)) * 1000) / 10),
        modelCallCount: methodResult.modelCallCount,
        chunkCount: 0,
        durationMs: Date.now() - compactionStartedAt,
        partialBoundary: null,
        coverageComplete: true,
      });
      log.debug("Smart compaction complete ✓");

      updatePiclawCompactionExecution({ compactionExecution: methodResult.modelCallCount > 1 ? "single_pass_repair" : "single_pass" });
      return {
        compaction: {
          summary: fullSummary,
          firstKeptEntryId: adjustedFit.firstKeptEntryId,
          tokensBefore,
          details: resultDetails(methodResult.modelCallCount > 1 ? "single_pass_repair" : "single_pass", methodResult.modelCallCount),
        } satisfies CompactionResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (signal.aborted || /Compaction cancelled/i.test(message)) return { cancel: true };
      if (/timed? out|timeout/i.test(message)) {
        providerTiming.timeoutStage = inferCompactionTimeoutStage(providerTiming);
        log.warn("Smart compaction timed out", {
          operation: "smart_compaction.timeout",
          model: providerTiming.model,
          timeoutStage: providerTiming.timeoutStage,
          providerRequestCount: providerTiming.requestCount,
          timeToFirstTokenMs: providerTiming.timeToFirstTokenMs,
          durationMs: Date.now() - compactionStartedAt,
          errorMessage: message,
        });
      }
      log.debug(`Smart compaction lifecycle failed: ${message}`);
      return cancelCompactionWithReason(ctx, message);
    } finally {
      if (providerWaitStatusTimer) clearInterval(providerWaitStatusTimer);
      // Always broadcast a final complete-context estimate so the meter is
      // never stale after compaction completes, fails, or is cancelled. During
      // compaction, keep prompt/chunk/merge estimates out of context_usage so
      // the visual context wheel only reflects real full-context sizes.
      if (ownsCompactionStatus(statusOwner)) {
        publishContextSnapshot(finalContextTokens ?? tokensBefore, "after_compaction");
      }
      finishCompactionStatusOwnership(ctx, statusOwner);
    }
  });
  };
}
