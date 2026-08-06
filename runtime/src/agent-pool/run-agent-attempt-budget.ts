import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { RunAgentOptions } from "./contracts.js";
import { logToolStateTransition } from "./tool-state-transitions.js";

export interface AttemptToolBudgetState {
  toolUseBudgetExceeded: boolean;
  toolUseSoftStopApplied: boolean;
  finalizationReserveApplied: boolean;
  hadToolFailureBeforeSoftStop: boolean;
  hadToolFailureAfterSoftStop: boolean;
  reservedToolExecutionCount: number;
}

export interface AttemptToolBudgetController {
  state: AttemptToolBudgetState;
  restoreToolBudgetGuard(): void;
  restoreToolBudgetSoftStop(): void;
  applyFinalizationReserve(): boolean;
  requestToolBudgetSoftStop(toolCallBlocks: Array<Record<string, unknown>>, assistantToolUseMessageCount: number): void;
  enforceCompletedExecutionBudget(): void;
  consumeToolExecutionEnd(toolCallId: unknown, isError: unknown): { wasBlockedByBudget: boolean };
}

export function createAttemptToolBudgetController(options: {
  session: AgentSession;
  chatJid: string;
  initialToolExecutionCount: number;
  toolUseMessageBudget: number;
  toolUseWarningThreshold: number;
  runOptions: RunAgentOptions;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  getRunObservabilityDetails(runOptions: RunAgentOptions): Record<string, unknown>;
}): AttemptToolBudgetController {
  const state: AttemptToolBudgetState = {
    toolUseBudgetExceeded: false,
    toolUseSoftStopApplied: false,
    finalizationReserveApplied: false,
    hadToolFailureBeforeSoftStop: false,
    hadToolFailureAfterSoftStop: false,
    reservedToolExecutionCount: options.initialToolExecutionCount,
  };
  const agent = (options.session as unknown as { agent?: AgentSession["agent"] }).agent;
  const originalBeforeToolCall = agent?.beforeToolCall;
  const reservedToolCallIds = new Set<string>();
  const blockedToolCallIds = new Set<string>();
  const pendingSoftStopToolCallIds = new Set<string>();
  let pendingSoftStopAnonymousToolCallCount = 0;
  let toolUseWarningEmitted = false;
  let toolUseSoftStopRequested = false;
  let softStopSavedToolNames: string[] | null = null;

  const applyToolBudgetSoftStop = (assistantToolUseMessageCount: number) => {
    if (state.toolUseSoftStopApplied) return;
    state.toolUseSoftStopApplied = true;
    const toolControl = options.session as unknown as {
      getActiveToolNames?: () => string[];
      setActiveToolsByName?: (toolNames: string[]) => void;
    };
    if (typeof toolControl.getActiveToolNames === "function" && typeof toolControl.setActiveToolsByName === "function") {
      softStopSavedToolNames = toolControl.getActiveToolNames();
      toolControl.setActiveToolsByName([]);
      logToolStateTransition({
        chatJid: options.chatJid,
        turnId: options.runOptions.turnId,
        phase: "attempt",
        cause: "tool_budget_soft_stop",
        previous: softStopSavedToolNames,
        next: [],
      });
      options.onWarn?.("Tool-use budget soft threshold reached; disabling tools to force terminal reply", {
        operation: "run_agent.tool_use_budget_soft_stop",
        chatJid: options.chatJid,
        assistantToolUseMessageCount,
        toolUseMessageBudget: options.toolUseMessageBudget,
        toolUseSoftStopThreshold: options.toolUseMessageBudget,
        ...options.getRunObservabilityDetails(options.runOptions),
      });
    } else {
      options.onWarn?.("Tool-use budget soft threshold reached but active tools could not be disabled", {
        operation: "run_agent.tool_use_budget_soft_stop_unavailable",
        chatJid: options.chatJid,
        assistantToolUseMessageCount,
        toolUseMessageBudget: options.toolUseMessageBudget,
        toolUseSoftStopThreshold: options.toolUseMessageBudget,
        ...options.getRunObservabilityDetails(options.runOptions),
      });
    }
  };

  const maybeApplyPendingToolBudgetSoftStop = (assistantToolUseMessageCount: number) => {
    if (!toolUseSoftStopRequested) return;
    if (pendingSoftStopToolCallIds.size > 0 || pendingSoftStopAnonymousToolCallCount > 0) return;
    applyToolBudgetSoftStop(assistantToolUseMessageCount);
  };

  const toolBudgetBeforeToolCall: NonNullable<AgentSession["agent"]["beforeToolCall"]> = async (context, signal) => {
    const prior = await originalBeforeToolCall?.(context, signal);
    if (prior?.block) return prior;
    if (state.finalizationReserveApplied) {
      return {
        block: true,
        reason: "Automatic recovery is in its finalization window. Return a terminal assistant reply without calling more tools.",
      };
    }
    if (!toolUseWarningEmitted && state.reservedToolExecutionCount >= options.toolUseWarningThreshold) {
      toolUseWarningEmitted = true;
      options.onWarn?.("Tool-use budget warning threshold reached", {
        operation: "run_agent.tool_use_budget_warning",
        chatJid: options.chatJid,
        reservedToolExecutionCount: state.reservedToolExecutionCount,
        toolUseBudget: options.toolUseMessageBudget,
        toolUseWarningThreshold: options.toolUseWarningThreshold,
        toolName: context.toolCall.name,
        ...options.getRunObservabilityDetails(options.runOptions),
      });
    }
    if (state.reservedToolExecutionCount >= options.toolUseMessageBudget) {
      blockedToolCallIds.add(context.toolCall.id);
      state.toolUseBudgetExceeded = true;
      return {
        block: true,
        reason: `Per-turn tool execution budget exhausted (${options.toolUseMessageBudget}/${options.toolUseMessageBudget}). Ask the user to continue before calling more tools.`,
      };
    }
    state.reservedToolExecutionCount += 1;
    reservedToolCallIds.add(context.toolCall.id);
    return prior;
  };
  if (agent) agent.beforeToolCall = toolBudgetBeforeToolCall;

  return {
    state,
    restoreToolBudgetGuard() {
      if (agent?.beforeToolCall === toolBudgetBeforeToolCall) agent.beforeToolCall = originalBeforeToolCall;
    },
    restoreToolBudgetSoftStop() {
      if (!softStopSavedToolNames) return;
      const toolControl = options.session as unknown as { setActiveToolsByName?: (toolNames: string[]) => void };
      if (typeof toolControl.setActiveToolsByName === "function") {
        toolControl.setActiveToolsByName(softStopSavedToolNames);
        logToolStateTransition({
          chatJid: options.chatJid,
          turnId: options.runOptions.turnId,
          phase: "attempt",
          cause: "tool_budget_restore",
          previous: [],
          next: softStopSavedToolNames,
          restored: true,
        });
      }
      softStopSavedToolNames = null;
    },
    applyFinalizationReserve() {
      if (state.finalizationReserveApplied) return false;
      state.finalizationReserveApplied = true;
      const toolControl = options.session as unknown as {
        getActiveToolNames?: () => string[];
        setActiveToolsByName?: (toolNames: string[]) => void;
      };
      if (typeof toolControl.getActiveToolNames === "function" && typeof toolControl.setActiveToolsByName === "function") {
        softStopSavedToolNames = softStopSavedToolNames ?? toolControl.getActiveToolNames();
        toolControl.setActiveToolsByName([]);
        logToolStateTransition({
          chatJid: options.chatJid,
          turnId: options.runOptions.turnId,
          phase: "attempt",
          cause: "recovery_finalization_reserve",
          previous: softStopSavedToolNames,
          next: [],
        });
      }
      return true;
    },
    requestToolBudgetSoftStop(toolCallBlocks, assistantToolUseMessageCount) {
      if (toolUseSoftStopRequested || assistantToolUseMessageCount < options.toolUseMessageBudget) return;
      toolUseSoftStopRequested = true;
      for (const block of toolCallBlocks) {
        const id = typeof block.id === "string" && block.id.trim() ? block.id : null;
        if (id) pendingSoftStopToolCallIds.add(id);
        else pendingSoftStopAnonymousToolCallCount += 1;
      }
      maybeApplyPendingToolBudgetSoftStop(assistantToolUseMessageCount);
    },
    enforceCompletedExecutionBudget() {
      state.toolUseBudgetExceeded = true;
      // Executions already admitted by beforeToolCall may be a legitimate
      // parallel batch. Let them settle, but prevent every new execution now
      // instead of waiting for an arbitrary count of assistant tool messages.
      applyToolBudgetSoftStop(options.toolUseMessageBudget);
    },
    consumeToolExecutionEnd(toolCallId, isError) {
      const normalizedToolCallId = typeof toolCallId === "string" ? toolCallId : null;
      const wasBlockedByBudget = normalizedToolCallId ? blockedToolCallIds.delete(normalizedToolCallId) : false;
      if (normalizedToolCallId) reservedToolCallIds.delete(normalizedToolCallId);
      if (typeof normalizedToolCallId === "string" && pendingSoftStopToolCallIds.delete(normalizedToolCallId)) {
        // matched the threshold-crossing tool-use message
      } else if (pendingSoftStopAnonymousToolCallCount > 0) {
        pendingSoftStopAnonymousToolCallCount -= 1;
      }
      maybeApplyPendingToolBudgetSoftStop(options.toolUseMessageBudget);
      if (isError === true) {
        if (state.toolUseSoftStopApplied) state.hadToolFailureAfterSoftStop = true;
        else state.hadToolFailureBeforeSoftStop = true;
      }
      return { wasBlockedByBudget };
    },
  };
}
