import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import { getAutoCompactionTokenStatusForSession } from "./compaction.js";
import type { RunAgentOptions } from "./contracts.js";
import { debugSuppressedError, type StructuredLogger } from "../utils/logger.js";
import { recordAgentAbortCause } from "./abort-provenance.js";

const MID_TURN_CONTEXT_CHECK_MIN_INTERVAL_MS = 1_000;
const CONTEXT_USAGE_UPDATE_MIN_INTERVAL_MS = 250;
const TOOL_RESULT_CHARS_PER_TOKEN = 4;

export interface AttemptContextPressureState {
  sawCompactionIntent: boolean;
}

function buildContextUsageUpdateEvent(
  tokens: number,
  contextWindow: number,
  phase: string,
): AgentSessionEvent {
  return {
    type: "context_usage_update",
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
    estimated: true,
    source: "agent_orchestrator",
    phase,
  } as unknown as AgentSessionEvent;
}

export function createAttemptContextPressureController(options: {
  session: AgentSession;
  chatJid: string;
  runOptions: RunAgentOptions;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  getRunObservabilityDetails(runOptions: RunAgentOptions): Record<string, unknown>;
  log: StructuredLogger;
}) {
  const state: AttemptContextPressureState = { sawCompactionIntent: false };
  let midTurnToolResultChars = 0;
  let midTurnProjectionBaselineRawTokens: number | null = null;
  let midTurnProjectionBaselineToolResultChars = 0;
  let midTurnProjectionModelResponseSequence = -1;
  let lastMidTurnContextUpdateAt = 0;
  let lastContextUsageUpdateAt = 0;
  let midTurnContextAbortRequested = false;

  const readContextUsageSnapshot = (projectedAdditionalRawTokens = 0): {
    tokens: number;
    rawTokens: number;
    projectedAdditionalRawTokens: number;
    contextWindow: number;
    effectiveContextWindow: number;
    overheadTokens: number;
    thresholdTokens: number;
    thresholdPercent: number;
    hardCeilingTokens: number;
    hardCeilingReached: boolean;
    autoCompactionScope: string;
    autoCompactionScopeTokens: number;
    autoCompactionScopeLimit: number;
    autoCompactionWindowOrdinal: number | null;
    autoCompactionBaselineTokens: number | null;
    autoCompactionPrefillTokens: number | null;
    overThreshold: boolean;
  } | null => {
    const status = getAutoCompactionTokenStatusForSession(options.session, options.chatJid, { projectedAdditionalRawTokens });
    if (!status) return null;
    return {
      tokens: status.contextTokens,
      rawTokens: status.rawContextTokens,
      projectedAdditionalRawTokens: status.projectedAdditionalRawTokens,
      contextWindow: status.contextWindow,
      effectiveContextWindow: status.effectiveContextWindow,
      overheadTokens: status.overheadTokens,
      thresholdTokens: status.tokenStatus.autoCompactionScopeLimit,
      thresholdPercent: status.thresholdPercent,
      hardCeilingTokens: status.tokenStatus.fullContextWindowLimit,
      hardCeilingReached: status.tokenStatus.fullContextWindowLimitReached,
      autoCompactionScope: status.tokenStatus.scope,
      autoCompactionScopeTokens: status.tokenStatus.autoCompactionScopeTokens,
      autoCompactionScopeLimit: status.tokenStatus.autoCompactionScopeLimit,
      autoCompactionWindowOrdinal: status.tokenStatus.windowOrdinal,
      autoCompactionBaselineTokens: status.tokenStatus.baselineTokens,
      autoCompactionPrefillTokens: status.tokenStatus.prefillTokens,
      overThreshold: status.tokenStatus.tokenLimitReached,
    };
  };

  const publishContextUsageUpdate = (phase: string, force = false, projectedAdditionalRawTokens = 0): ReturnType<typeof readContextUsageSnapshot> => {
    try {
      const snapshot = readContextUsageSnapshot(projectedAdditionalRawTokens);
      if (!snapshot) return null;
      const now = Date.now();
      if (force || now - lastContextUsageUpdateAt >= CONTEXT_USAGE_UPDATE_MIN_INTERVAL_MS) {
        lastContextUsageUpdateAt = now;
        options.runOptions.onEvent?.(buildContextUsageUpdateEvent(snapshot.tokens, snapshot.contextWindow, phase));
      }
      return snapshot;
    } catch (err) {
      debugSuppressedError(options.log, "Failed to publish context usage update.", err, { chatJid: options.chatJid, phase });
      return null;
    }
  };

  const abortForToolExecutionCeiling = (toolName: unknown, toolExecutionCount: number, ceiling: number, configuredBudget: number, contextDetails: Record<string, unknown> = {}): void => {
    midTurnContextAbortRequested = true;
    options.onWarn?.("Configured mid-turn tool execution hard ceiling reached without context pressure; aborting turn without requesting compaction", {
      operation: "run_agent.mid_turn_tool_ceiling",
      reason: "mid_turn_tool_execution_hard_ceiling",
      chatJid: options.chatJid,
      toolExecutionCount,
      ceiling,
      configuredBudget,
      midTurnToolResultChars,
      toolName: typeof toolName === "string" ? toolName : null,
      ...contextDetails,
      ...options.getRunObservabilityDetails(options.runOptions),
    });
    void options.session.abort().catch((err) => {
      options.onWarn?.("Failed to abort session after mid-turn tool ceiling", {
        operation: "run_agent.mid_turn_tool_ceiling_abort_failed",
        chatJid: options.chatJid,
        err,
        ...options.getRunObservabilityDetails(options.runOptions),
      });
    });
  };

  return {
    state,
    publishContextUsageUpdate,
    addToolResultContent(toolResult: unknown): void {
      if (toolResult && typeof toolResult === "object") {
        const content = (toolResult as { content?: unknown[] }).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
              const text = (block as { text?: unknown }).text;
              if (typeof text === "string") midTurnToolResultChars += text.length;
            }
          }
        }
      }
    },
    establishToolStartBaseline(modelResponseSequence: number): void {
      const snapshot = publishContextUsageUpdate("tool_execution_start", true);
      if (snapshot && (midTurnProjectionBaselineRawTokens == null || midTurnProjectionModelResponseSequence !== modelResponseSequence)) {
        midTurnProjectionBaselineRawTokens = snapshot.rawTokens;
        midTurnProjectionBaselineToolResultChars = midTurnToolResultChars;
        midTurnProjectionModelResponseSequence = modelResponseSequence;
      }
    },
    checkMidTurnContextAfterToolResult(toolName: unknown, isError: unknown, toolExecutionCount: number, ceiling: number, configuredBudget: number): { ceilingReached: boolean } {
      try {
        if (midTurnContextAbortRequested) return { ceilingReached: false };
        const toolExecutionCeilingReached = toolExecutionCount >= ceiling;
        const now = Date.now();
        const forceUsageUpdate = now - lastMidTurnContextUpdateAt >= MID_TURN_CONTEXT_CHECK_MIN_INTERVAL_MS;
        if (forceUsageUpdate) lastMidTurnContextUpdateAt = now;
        const estimatorSnapshot = readContextUsageSnapshot();
        if (!estimatorSnapshot) {
          if (toolExecutionCeilingReached) abortForToolExecutionCeiling(toolName, toolExecutionCount, ceiling, configuredBudget);
          return { ceilingReached: toolExecutionCeilingReached };
        }
        if (midTurnProjectionBaselineRawTokens == null) midTurnProjectionBaselineRawTokens = estimatorSnapshot.rawTokens;
        const toolResultCharsSinceBaseline = Math.max(0, midTurnToolResultChars - midTurnProjectionBaselineToolResultChars);
        const toolResultRawTokensSinceBaseline = Math.ceil(toolResultCharsSinceBaseline / TOOL_RESULT_CHARS_PER_TOKEN);
        const projectedRawFloor = midTurnProjectionBaselineRawTokens + toolResultRawTokensSinceBaseline;
        const projectedAdditionalRawTokens = Math.max(0, projectedRawFloor - estimatorSnapshot.rawTokens);
        const snapshot = publishContextUsageUpdate("mid_turn_tool_result", forceUsageUpdate, projectedAdditionalRawTokens);
        if (!snapshot) {
          if (toolExecutionCeilingReached) abortForToolExecutionCeiling(toolName, toolExecutionCount, ceiling, configuredBudget);
          return { ceilingReached: toolExecutionCeilingReached };
        }
        if (!snapshot.overThreshold) {
          if (toolExecutionCeilingReached) {
            abortForToolExecutionCeiling(toolName, toolExecutionCount, ceiling, configuredBudget, {
              contextTokens: snapshot.tokens,
              estimatorReportedTokens: estimatorSnapshot.tokens,
              projectedAdditionalRawTokens,
              contextWindow: snapshot.contextWindow,
              thresholdTokens: snapshot.thresholdTokens,
              thresholdPercent: snapshot.thresholdPercent,
              hardCeilingTokens: snapshot.hardCeilingTokens,
              autoCompactionScope: snapshot.autoCompactionScope,
              autoCompactionScopeTokens: snapshot.autoCompactionScopeTokens,
              estimatorReportedAutoCompactionScopeTokens: estimatorSnapshot.autoCompactionScopeTokens,
              autoCompactionScopeLimit: snapshot.autoCompactionScopeLimit,
            });
          }
          return { ceilingReached: toolExecutionCeilingReached };
        }
        state.sawCompactionIntent = true;
        midTurnContextAbortRequested = true;
        options.runOptions.onEvent?.(buildContextUsageUpdateEvent(snapshot.tokens, snapshot.contextWindow, "mid_turn_tool_result_over_threshold"));
        options.onWarn?.("Mid-turn context pressure detected after tool result; aborting for compaction", {
          operation: "run_agent.mid_turn_context_pressure",
          chatJid: options.chatJid,
          contextTokens: snapshot.tokens,
          estimatorReportedTokens: estimatorSnapshot.tokens,
          projectedAdditionalRawTokens,
          midTurnToolResultChars,
          toolExecutionCount,
          contextWindow: snapshot.contextWindow,
          thresholdTokens: snapshot.thresholdTokens,
          thresholdPercent: snapshot.thresholdPercent,
          hardCeilingTokens: snapshot.hardCeilingTokens,
          hardCeilingReached: snapshot.hardCeilingReached,
          autoCompactionScope: snapshot.autoCompactionScope,
          autoCompactionScopeTokens: snapshot.autoCompactionScopeTokens,
          estimatorReportedAutoCompactionScopeTokens: estimatorSnapshot.autoCompactionScopeTokens,
          autoCompactionScopeLimit: snapshot.autoCompactionScopeLimit,
          autoCompactionWindowOrdinal: snapshot.autoCompactionWindowOrdinal,
          autoCompactionBaselineTokens: snapshot.autoCompactionBaselineTokens,
          autoCompactionPrefillTokens: snapshot.autoCompactionPrefillTokens,
          toolName: typeof toolName === "string" ? toolName : null,
          toolErrored: isError === true,
          ...options.getRunObservabilityDetails(options.runOptions),
        });
        recordAgentAbortCause(options.chatJid, "context_pressure", "run_agent.mid_turn_context_pressure");
        void options.session.abort().catch((err) => {
          options.onWarn?.("Failed to abort session after mid-turn context pressure", {
            operation: "run_agent.mid_turn_context_pressure_abort_failed",
            chatJid: options.chatJid,
            err,
            ...options.getRunObservabilityDetails(options.runOptions),
          });
        });
        return { ceilingReached: false };
      } catch (err) {
        debugSuppressedError(options.log, "Failed to check mid-turn context pressure after tool result.", err, { chatJid: options.chatJid });
        return { ceilingReached: false };
      }
    },
  };
}
