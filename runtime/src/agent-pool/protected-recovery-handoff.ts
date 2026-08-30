/**
 * protected-recovery-handoff.ts – Bounded ordinary-turn handoff for protected recovery.
 *
 * A generic recovery that would require tool suppression is converted into a
 * typed handoff before another provider request is made. Non-web callers
 * consume the handoff here; web defers it so its handler can durably order the
 * continuation with cursor and terminal-message persistence.
 */

import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "./context-pressure-retry.js";
import type { AgentOutput, RunAgentOptions, TurnOutput } from "./contracts.js";
import {
  buildProtectedRecoveryHandoffMetadata,
  formatProtectedRecoveryHandoff,
} from "./protected-recovery-handoff-reason.js";

export interface ProtectedRecoveryHandoffOptions {
  /** Web persists the continuation itself before terminal run finalization. */
  deferToolEnabledContinuation?: boolean;
}

export const MAX_PROTECTED_RECOVERY_HANDOFF_DEPTH = 2;
export const PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE =
  "Automatic recovery reached its bounded handoff limit. The session is preserved; send “continue” to resume the unfinished work.";

/** A successful recovery compaction made one more ordinary turn useful. */
export function isPostCompactionProtectedRecoveryHandoff(output: AgentOutput): boolean {
  return Boolean(output.requiresToolEnabledContinuation)
    && output.protectedRecoveryHandoff?.reason === "post_compaction_tools_required"
    && output.protectedRecoveryHandoff.compaction === "succeeded";
}

export function finishBoundedProtectedRecoveryHandoff(output: AgentOutput): AgentOutput {
  const { requiresToolEnabledContinuation: _spent, ...terminal } = output;
  const priorHandoff = output.protectedRecoveryHandoff;
  const reason = priorHandoff?.reason
    ?? (isPostCompactionProtectedRecoveryHandoff(output)
      ? "post_compaction_tools_required"
      : "continuation_generation_exhausted");
  const protectedRecoveryHandoff = buildProtectedRecoveryHandoffMetadata(
    reason,
    {
      recoveryAttempts: priorHandoff?.recoveryAttempts ?? output.recovery?.attemptsUsed ?? 0,
      compaction: priorHandoff?.compaction,
      toolsRequired: priorHandoff?.toolsRequired ?? true,
      retryable: priorHandoff?.retryable ?? true,
      recoverySourceId: priorHandoff?.recoverySourceId,
      recoveryGeneration: priorHandoff?.recoveryGeneration,
    },
  );
  const presentation = formatProtectedRecoveryHandoff(protectedRecoveryHandoff);
  const terminalMessage = reason === "continuation_generation_exhausted"
    ? PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE
    : `${presentation.title}. ${presentation.detail} ${presentation.nextAction}`;
  return {
    ...terminal,
    status: "error",
    result: terminalMessage,
    error: terminalMessage,
    nextAction: presentation.nextAction,
    protectedRecoveryHandoff,
  };
}

/**
 * Run one prompt and a bounded ordinary tool-enabled continuation. A generated
 * continuation may hand off once more only after recovery successfully compacted
 * the session; all other repeated handoffs stop with deterministic guidance.
 */
export async function runWithProtectedRecoveryHandoff(
  prompt: string,
  options: RunAgentOptions & ProtectedRecoveryHandoffOptions,
  run: (nextPrompt: string, nextOptions: RunAgentOptions) => Promise<AgentOutput>,
  onOutput?: (output: AgentOutput) => void,
): Promise<AgentOutput> {
  const bufferedTurns: TurnOutput[] = [];
  const originalOnTurnComplete = options.onTurnComplete;
  const initialDepth = options.protectedRecoveryContinuationDepth
    ?? (options.protectedRecoveryContinuation ? 1 : 0);
  if (options.protectedRecoveryHandoffContext?.reason === "unresolved_tool_execution") {
    const terminal = finishBoundedProtectedRecoveryHandoff({
      status: "error",
      result: null,
      error: "Automatic continuation stopped because a prior tool execution is unresolved.",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: options.protectedRecoveryHandoffContext,
    });
    onOutput?.(terminal);
    return terminal;
  }
  const shouldBufferInitialTurns = Boolean(originalOnTurnComplete) && initialDepth === 0;
  const initialOptions = shouldBufferInitialTurns
    ? { ...options, onTurnComplete: (turn: TurnOutput) => bufferedTurns.push(turn) }
    : options;
  let output = await run(prompt, initialOptions);
  onOutput?.(output);

  if (!output.requiresToolEnabledContinuation) {
    for (const turn of bufferedTurns) originalOnTurnComplete?.(turn);
    return output;
  }

  // Preserve committed pre-tool progress from the protected run, but suppress
  // any unauthoritative terminal prose produced by legacy/injected runners:
  // only an ordinary continuation may close tool-dependent work.
  for (const turn of bufferedTurns) {
    if (turn.followedByToolUse) originalOnTurnComplete?.(turn);
  }
  if (options.deferToolEnabledContinuation) return output;
  if (output.protectedRecoveryHandoff?.reason === "unresolved_tool_execution") {
    return finishBoundedProtectedRecoveryHandoff(output);
  }

  let handoffDepth = initialDepth;
  while (output.requiresToolEnabledContinuation) {
    const canHandoff = handoffDepth === 0
      || (handoffDepth < MAX_PROTECTED_RECOVERY_HANDOFF_DEPTH
        && isPostCompactionProtectedRecoveryHandoff(output));
    if (!canHandoff) return finishBoundedProtectedRecoveryHandoff(output);

    handoffDepth += 1;
    const protectedRecoveryHandoffContext = output.protectedRecoveryHandoff;
    output = await run(TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT, {
      ...options,
      protectedRecoveryContinuation: true,
      protectedRecoveryContinuationDepth: handoffDepth,
      protectedRecoveryHandoffContext,
    });
    onOutput?.(output);
  }
  return output;
}
