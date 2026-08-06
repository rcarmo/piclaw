import { describe, expect, test } from "bun:test";

import "../helpers.js";

import {
  finalizePromptAttemptOutput,
  readSessionStateErrorMessage,
} from "../../src/agent-pool/run-agent-attempt-finalization.js";
import { recordAgentAbortCause, resetAgentAbortProvenanceForTests } from "../../src/agent-pool/abort-provenance.js";

function baseInput(overrides: Partial<Parameters<typeof finalizePromptAttemptOutput>[0]> = {}): Parameters<typeof finalizePromptAttemptOutput>[0] {
  return {
    session: { sessionManager: { getEntries: () => [] } } as any,
    sessionEntryBaseline: 0,
    chatJid: "web:test-finalize",
    timeoutMs: 1234,
    timedOut: false,
    staleProgressAbortFailed: null,
    staleProgressInterrupted: false,
    finalText: "",
    finalAttachments: [],
    finalUsage: null,
    lastAssistantState: null,
    promptThrownError: null,
    turnError: null,
    latentStateError: null,
    hadToolActivity: false,
    hadPartialOutput: false,
    hadCompletedTurnOutput: false,
    hadTerminalTurnOutput: false,
    sawAssistantToolCallMessage: false,
    onlyReadOnlyToolActivity: true,
    hasUnresolvedToolExecution: false,
    sawTerminalSideEffectToolActivity: false,
    hadToolFailure: false,
    hadToolFailureBeforeSoftStop: false,
    hadToolFailureAfterSoftStop: false,
    toolUseSoftStopApplied: false,
    toolUseBudgetExceeded: false,
    toolExecutionCount: 0,
    assistantToolUseMessageCount: 0,
    toolUseMessageBudget: 64,
    compactionErrorMessage: null,
    sawCompactionIntent: false,
    runOptions: {},
    onWarn: () => {},
    getRunObservabilityDetails: () => ({}),
    formatTimeoutDuration: (ms) => `${ms}ms`,
    getProgressWatchdogTimeoutMs: () => 5000,
    log: { child: () => baseInput().log, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe("prompt attempt finalization", () => {
  test("persists the initiating abort provenance on a generic aborted turn", () => {
    recordAgentAbortCause("web:test-finalize", "user_command", "agent_control.abort");
    const { output } = finalizePromptAttemptOutput(baseInput({
      promptThrownError: "Request aborted",
    }));
    expect(output).toMatchObject({
      status: "error",
      abortCause: "user_command",
      abortOperation: "agent_control.abort",
    });
    resetAgentAbortProvenanceForTests();
  });
  test("classifies timer expiry before blank-turn fallback", () => {
    const { output, snapshot } = finalizePromptAttemptOutput(baseInput({ timedOut: true, timeoutMs: 2500 }));
    expect(output).toEqual({ status: "error", result: null, error: "Timed out after 2500ms" });
    expect(snapshot.hadToolActivity).toBe(false);
    expect(snapshot.hasUnresolvedToolExecution).toBe(false);
    expect(snapshot.sawThinkingOnlyStop).toBe(false);
  });

  test("does not treat pending streaming state as a terminal success", () => {
    const { output } = finalizePromptAttemptOutput(baseInput({
      finalText: "partial draft",
      lastAssistantState: {
        stopReason: "pending",
        rawStopReason: "in_progress",
        hadTextContent: true,
        hadThinkingContent: false,
        hadToolCallContent: false,
      },
    }));

    expect(output.status).toBe("error");
    expect(output.error).toContain("remained pending");
    expect(output.error).toContain("in_progress");
  });

  test("does not let a terminal side-effect hide earlier failed tools", () => {
    const { output, snapshot } = finalizePromptAttemptOutput(baseInput({
      session: {
        sessionManager: {
          getEntries: () => [{ type: "message", message: { role: "assistant" } }],
        },
      } as any,
      hadToolActivity: true,
      sawAssistantToolCallMessage: true,
      sawTerminalSideEffectToolActivity: true,
      hadToolFailure: true,
      lastAssistantState: { stopReason: "stop", hadTextContent: false, hadThinkingContent: false, hadToolCallContent: true },
      toolExecutionCount: 2,
    }));
    expect(output.status).toBe("error");
    expect(output.error).toContain("provider stopped after tool use without a final assistant reply");
    expect(snapshot.hadToolFailure).toBe(true);
    expect(snapshot.sawTerminalSideEffectToolActivity).toBe(true);
  });

  test("preserves unresolved tool execution state in the recovery snapshot", () => {
    const { snapshot } = finalizePromptAttemptOutput(baseInput({
      timedOut: true,
      hadToolActivity: true,
      hasUnresolvedToolExecution: true,
    }));
    expect(snapshot.hasUnresolvedToolExecution).toBe(true);
  });

  test("reads latent session state errors without throwing on missing internals", () => {
    expect(readSessionStateErrorMessage({} as any)).toBeNull();
    expect(readSessionStateErrorMessage({ agent: { state: { errorMessage: " latent " } } } as any)).toBe("latent");
  });
});
