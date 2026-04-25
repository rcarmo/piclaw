import { expect, test } from "bun:test";

import {
  decideAutomaticRecovery,
  DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
  isContextPressureFailure,
  isNonRecoverableFailure,
  isTransientFailure,
} from "../../src/agent-pool/automatic-recovery.js";

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

test("classifies auth, invalid-request, and aborted failures as non-recoverable", () => {
  expect(isNonRecoverableFailure("Unauthorized: token expired")).toBe(true);
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

test("skips automatic recovery when tool activity already happened", () => {
  const decision = decideAutomaticRecovery({
    config: DEFAULT_AUTOMATIC_RECOVERY_CONFIG,
    errorText: "Timed out after 30s",
    recoveryAttemptsUsed: 0,
    elapsedMs: 1000,
    snapshot: {
      hadToolActivity: true,
      hadPartialOutput: true,
    },
  });

  expect(isTransientFailure("Timed out after 30s")).toBe(true);
  expect(decision.recover).toBe(false);
  expect(decision.classifier).toBe("tool_activity");
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
