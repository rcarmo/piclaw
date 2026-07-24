import { expect, test } from "bun:test";

import {
  decideAutomaticRecovery,
  DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
  getAutomaticRecoveryConfig,
  isContextPressureFailure,
  isLengthStopFailure,
  isNonRecoverableFailure,
  isProviderAuthConfigFailure,
  isTransientFailure,
} from "../../src/agent-pool/automatic-recovery.js";

test("keeps turn auto-recovery enabled when generic retry is disabled", () => {
  const previous = process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  try {
    const config = getAutomaticRecoveryConfig({ enabled: false, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.enabled).toBe(true);
    expect(config.maxAttempts).toBe(7);
    expect(config.baseDelayMs).toBe(1234);
    expect(config.maxDelayMs).toBe(5678);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = previous;
  }
});

test("honors explicit turn auto-recovery env disable", () => {
  const previous = process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
  process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = "0";
  try {
    const config = getAutomaticRecoveryConfig({ enabled: true, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.enabled).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED = previous;
  }
});

test("turn auto-recovery numeric env rejects malformed suffixes", () => {
  const previousAttempts = process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS;
  const previousBudget = process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS;
  process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS = "12abc";
  process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS = "4000oops";
  try {
    const config = getAutomaticRecoveryConfig({ enabled: true, maxRetries: 7, baseDelayMs: 1234, maxDelayMs: 5678 });
    expect(config.maxAttempts).toBe(7);
    expect(config.totalBudgetMs).toBe(DEFAULT_AUTOMATIC_RECOVERY_CONFIG.totalBudgetMs);
  } finally {
    if (previousAttempts === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS = previousAttempts;
    if (previousBudget === undefined) delete process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS;
    else process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS = previousBudget;
  }
});

test("classifies context-limit failures as compact-then-retry", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "maximum context length exceeded for this model",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: true,
    },
  });

  expect(isContextPressureFailure("maximum context length exceeded")).toBe(true);
  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});

test("treats timeout-before-finalization during compaction intent as compact-then-retry", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Response timed out before finalization",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: true,
      sawCompactionIntent: true,
    },
  });

  expect(isTransientFailure("Response timed out before finalization")).toBe(true);
  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});

test("classifies provider auth/config failures as terminal auth_config", () => {
  expect(isProviderAuthConfigFailure("No API key for provider: openai-codex")).toBe(true);
  expect(isProviderAuthConfigFailure("Token refresh failed: 401")).toBe(true);
  expect(isProviderAuthConfigFailure("provider.getApiKey is not a function")).toBe(true);

  const noKeyDecision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "No API key for provider: openai-codex",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
    },
  });

  expect(noKeyDecision.recover).toBe(false);
  expect(noKeyDecision.classifier).toBe("auth_config");
  expect(noKeyDecision.strategy).toBeNull();

  const refreshDecision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Token refresh failed: 401",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
    },
  });

  expect(refreshDecision.recover).toBe(false);
  expect(refreshDecision.classifier).toBe("auth_config");
  expect(refreshDecision.strategy).toBeNull();

  const compactionAuthDecision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "provider.getApiKey is not a function",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      compactionErrorMessage: "provider.getApiKey is not a function",
      sawCompactionIntent: true,
    },
  });

  expect(compactionAuthDecision.recover).toBe(false);
  expect(compactionAuthDecision.classifier).toBe("auth_config");
  expect(compactionAuthDecision.strategy).toBeNull();
});

test("classifies output-length stops as terminal length_stop without confusing context length", () => {
  expect(isLengthStopFailure("Provider stopped because it hit the maximum output length before finalization (finish reason: length).")).toBe(true);
  expect(isLengthStopFailure("maximum context length exceeded")).toBe(false);

  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Provider stopped because it hit the maximum output length before finalization (finish reason: length). The partial answer was preserved.",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("length_stop");
  expect(decision.strategy).toBeNull();
});

test("retries unknown failures without compaction when there is no context pressure", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "unexpected provider disconnect state",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      sawCompactionIntent: false,
    },
  });

  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("unknown");
  expect(decision.strategy).toBe("retry");
});

test("classifies invalid-request and aborted failures as non-recoverable", () => {
  expect(isNonRecoverableFailure("invalid_request_error: malformed schema")).toBe(true);
  expect(isNonRecoverableFailure("Request was aborted")).toBe(true);

  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Request was aborted",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("non_recoverable");
  expect(decision.strategy).toBeNull();
});

test("preserves a mixed terminal-side-effect and failed-tool outcome", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Prompt completed without emitting an assistant reply before finalization (tool activity seen).",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: false,
      hadTerminalTurnOutput: false,
      canDisableToolsForRecovery: true,
      hadToolFailure: true,
      sawTerminalSideEffectToolActivity: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("tool_activity");
  expect(decision.strategy).toBeNull();
});

test("uses a continuation retry after non-terminal tool activity times out", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Timed out after 30s",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
      hadCompletedTurnOutput: true,
      hadTerminalTurnOutput: false,
      sawAssistantToolCall: true,
      canDisableToolsForRecovery: true,
    },
  });

  expect(isTransientFailure("Timed out after 30s")).toBe(true);
  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("transient");
  expect(decision.strategy).toBe("retry");
});

test("keeps legacy completed-turn snapshots terminal when terminal detail is absent", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Timed out after 30s",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
      hadCompletedTurnOutput: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("completed_turn_output");
});

test("skips recovery when a terminal assistant reply already completed", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Timed out after 30s",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
      hadCompletedTurnOutput: true,
      hadTerminalTurnOutput: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("completed_turn_output");
});

test("does not continue non-recoverable tool failures", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "permission denied by policy",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
      hadCompletedTurnOutput: true,
      hadTerminalTurnOutput: false,
      sawAssistantToolCall: true,
      canDisableToolsForRecovery: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("non_recoverable");
});

test("allows compaction recovery despite tool activity when compaction was in progress", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Timed out waiting for session idle after 30s (streaming=false, compacting=true, retrying=false)",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
      sawCompactionIntent: true,
    },
  });

  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});

test("allows compaction recovery despite tool activity when error is context-pressure", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "maximum context length exceeded",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
    },
  });

  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});

test("treats tool-use budget exhaustion as terminal tool-history pressure without compaction", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Tool-use budget exceeded before finalization (65/64 tool steps).",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: false,
      toolUseBudgetExceeded: true,
      assistantToolUseMessageCount: 65,
      toolExecutionCount: 64,
    },
  });

  expect(isContextPressureFailure("Tool-use budget exceeded before finalization (65/64 tool steps).")).toBe(false);
  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("tool_history_pressure");
  expect(decision.strategy).toBeNull();
});

test("compacts tool-budget exhaustion only when model-aware context pressure was independently observed", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Tool-use budget exceeded before finalization (48/48 tool steps).",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: false,
      toolUseBudgetExceeded: true,
      assistantToolUseMessageCount: 1,
      toolExecutionCount: 48,
      sawCompactionIntent: true,
    },
  });

  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});

test("does not compact-and-retry again after compaction itself overflows context", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "invalid_request_error: context_length_exceeded: Your input exceeds the context window of this model",
    recoveryAttemptsUsed: 1,
    elapsedMs: 2000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      compactionErrorMessage: "context_length_exceeded during compaction",
      sawCompactionIntent: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("compaction_failure");
  expect(decision.strategy).toBeNull();
});

test("stops recovery after the configured attempt budget", () => {
  const decision = decideAutomaticRecovery({
    config: { ...DEFAULT_AUTOMATIC_RECOVERY_CONFIG, maxAttempts: 2, totalBudgetMs: 30_000, enabled: true },
    errorText: "Response ended with an error before finalization",
    recoveryAttemptsUsed: 2,
    elapsedMs: 5000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: true,
    },
  });

  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("budget_exhausted");
});

test("treats partial-output interruptions as transient retry candidates", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Response ended with an error before finalization",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: true,
    },
  });

  expect(isTransientFailure("Response ended with an error before finalization")).toBe(true);
  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("transient");
  expect(decision.strategy).toBe("retry");
});

test("treats WebSocket 1006 provider disconnects as transient retry candidates", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "WebSocket closed 1006 Connection ended",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
    },
  });

  expect(isTransientFailure("WebSocket closed 1006 Connection ended")).toBe(true);
  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("transient");
  expect(decision.strategy).toBe("retry");
});

test("treats transient DNS lookup failures as retry candidates", () => {
  for (const message of [
    "getaddrinfo EAI_AGAIN api.openai.com",
    "DNS lookup failed for api.githubcopilot.com",
    "fetch failed: getaddrinfo ENOTFOUND api.example.invalid",
  ]) {
    const decision = decideAutomaticRecovery({
      config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
      errorText: message,
      recoveryAttemptsUsed: 0,
      elapsedMs: 1000,
      snapshot: {
        hadToolActivity: false,
        hadPartialOutput: false,
      },
    });

    expect(isTransientFailure(message)).toBe(true);
    expect(decision.recover).toBe(true);
    expect(decision.classifier).toBe("transient");
    expect(decision.strategy).toBe("retry");
  }
});

test("retries a thinking-only stop once before escalating", () => {
  const first = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Prompt completed without emitting an assistant reply before finalization (provider stopped after emitting thinking without a final assistant reply, last stop reason: stop, session delta: 2 appended entries).",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      hadCompletedTurnOutput: false,
      sawThinkingOnlyStop: true,
    },
  });

  expect(first.recover).toBe(true);
  expect(first.classifier).toBe("thinking_only_stop");
  expect(first.strategy).toBe("retry");

  const second = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Prompt completed without emitting an assistant reply before finalization (provider stopped after emitting thinking without a final assistant reply, last stop reason: stop, session delta: 2 appended entries).",
    recoveryAttemptsUsed: 1,
    elapsedMs: 3000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      hadCompletedTurnOutput: false,
      sawThinkingOnlyStop: true,
    },
  });

  expect(second.recover).toBe(false);
  expect(second.classifier).toBe("thinking_only_stop");
  expect(second.strategy).toBeNull();
});

test("escalates repeated thinking-only stop to compact-then-retry when context pressure is flagged", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Prompt completed without emitting an assistant reply before finalization (provider stopped after emitting thinking without a final assistant reply, last stop reason: stop, session delta: 2 appended entries).",
    recoveryAttemptsUsed: 1,
    elapsedMs: 3000,
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      hadCompletedTurnOutput: false,
      sawThinkingOnlyStop: true,
      sawCompactionIntent: true,
    },
  });

  expect(decision.recover).toBe(true);
  expect(decision.classifier).toBe("context_pressure");
  expect(decision.strategy).toBe("compact_then_retry");
});
