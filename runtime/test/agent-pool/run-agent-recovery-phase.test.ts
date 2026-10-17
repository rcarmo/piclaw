import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import "../helpers.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type Model, type Provider } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";

import {
  buildRecoveryDiagnosticEntry,
  MAX_RECOVERY_GENERATIONS_PER_SOURCE,
  resetRecoveryLoopGuardForTests,
  runAgentRecoveryPhase,
  shouldAdvanceRecoveryGeneration,
  shouldSuppressRecoveryLoop,
  type PromptAttemptResult,
  type SessionWithToolControl,
} from "../../src/agent-pool/run-agent-recovery-phase.js";
import { FINALIZATION_RECOVERY_PROMPT, RECOVERY_CONTINUATION_PROMPT, TOOLS_DISABLED_RECOVERY_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";
import { initDatabase } from "../../src/db.js";
import { endTrackedPhase } from "../../src/runtime/progress-watchdog.js";
import { createOpenRouterOutputBudgetState } from "../../src/core/openrouter-output-budget.js";

const TEST_CHAT_JIDS = [
  "web:test-recovery-phase",
  "web:test-recovery-tools-required",
  "web:test-recovery-terminal-category",
  "web:test-recovery-retry-terminal-category",
  "web:test-recovery-provider-exhausted",
  "web:test-recovery-budget-exhausted",
  "web:test-recovery-compact",
  "web:test-recovery-compact:insufficient",
  "web:test-recovery-compact:protected:1",
  "web:test-recovery-compact:protected:2",
  "web:test-recovery-compact:protected:bounded",
  "web:test-recovery-generation-progress",
  "web:test-openrouter-budget-recovery",
  "web:test-openrouter-budget-terminal",
];

beforeEach(() => {
  initDatabase();
});

afterEach(() => {
  for (const chatJid of TEST_CHAT_JIDS) endTrackedPhase(chatJid);
  resetRecoveryLoopGuardForTests();
});

function output(status: AgentOutput["status"], error?: string, result: string | null = null): AgentOutput {
  return status === "error"
    ? { status, result: null, error: error ?? "failed" }
    : { status, result, ...(error ? { error } : {}) };
}

function attempt(partial: Partial<PromptAttemptResult> = {}): PromptAttemptResult {
  return {
    output: output("error", "Timed out after 1s"),
    snapshot: {
      hadToolActivity: false,
      hadPartialOutput: false,
      hadCompletedTurnOutput: false,
      hadTerminalTurnOutput: false,
      sawCompactionIntent: false,
    },
    promptWasPersisted: false,
    timedOut: false,
    toolExecutionCount: 0,
    ...partial,
  };
}

function recoveryConfig(overrides: Partial<Parameters<typeof runAgentRecoveryPhase>[0]["recoveryConfig"]> = {}) {
  return {
    enabled: true,
    transientRecoveryEnabled: true,
    transientRecoveryToolsEnabled: true,
    maxAttempts: 3,
    totalBudgetMs: 1_000,
    baseDelayMs: 0,
    maxDelayMs: 0,
    ...overrides,
  };
}

describe("recovery generation policy", () => {
  const eligible = {
    recoveryGeneration: 0,
    successfulRecoveryCompaction: true,
    promptWasPersisted: true,
    hadCompletedTurnOutput: true,
    attemptRanWithExecutionTools: true,
    toolExecutionCountAtStart: 2,
    toolExecutionCountAtEnd: 3,
    hasUnresolvedToolExecution: false,
    hadToolFailure: false,
    decision: {
      recover: true,
      classifier: "transient" as const,
      strategy: "retry" as const,
      reason: "retry",
    },
  };

  test("advances only after durable resolved post-compaction tool progress", () => {
    expect(shouldAdvanceRecoveryGeneration(eligible)).toBe(true);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, successfulRecoveryCompaction: false })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, promptWasPersisted: false })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, hadCompletedTurnOutput: false })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, attemptRanWithExecutionTools: false })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, toolExecutionCountAtEnd: 2 })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, hasUnresolvedToolExecution: true })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, hadToolFailure: true })).toBe(false);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, decision: { ...eligible.decision, recover: false, strategy: null } })).toBe(false);
  });

  test("enforces an absolute three-generation source cap", () => {
    expect(MAX_RECOVERY_GENERATIONS_PER_SOURCE).toBe(3);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, recoveryGeneration: 1 })).toBe(true);
    expect(shouldAdvanceRecoveryGeneration({ ...eligible, recoveryGeneration: 2 })).toBe(false);
  });

  test("partitions repeated-failure suppression by source and generation", () => {
    const guard = (recoverySourceId: string, recoveryGeneration: number) => shouldSuppressRecoveryLoop({
      chatJid: "web:test-recovery-phase",
      recoverySourceId,
      recoveryGeneration,
      modelLabel: "test/model",
      failureCategory: "timeout",
      classifier: "transient",
      strategy: "retry",
      now: 1_000,
    });

    expect(guard("source-a", 0).suppress).toBe(false);
    expect(guard("source-a", 0).suppress).toBe(false);
    expect(guard("source-a", 0).suppress).toBe(true);
    expect(guard("source-a", 1)).toMatchObject({ suppress: false, attemptsInWindow: 1 });
    expect(guard("source-b", 0)).toMatchObject({ suppress: false, attemptsInWindow: 1 });
  });
});

describe("runAgentRecoveryPhase", () => {
  test("continues after resolved tool work with tools available and execution budget carried", async () => {
    let activeTools = ["read", "bash"];
    let now = Date.now();
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const activeToolSets: string[][] = [];
      const sessionCtrl: SessionWithToolControl = {
        getActiveToolNames: () => [...activeTools],
        setActiveToolsByName: (names) => {
          activeTools = [...names];
          activeToolSets.push([...names]);
        },
      };
      const calls: Array<{ prompt: string; timeoutMs: number; toolExecutionCountAtStart: number }> = [];
      const events: unknown[] = [];

      const result = await runAgentRecoveryPhase({
        prompt: "original prompt",
        chatJid: "web:test-recovery-phase",
        session: {} as any,
        sessionCtrl,
        timeoutMs: 10_000,
        startTime: now,
        modelLabel: "test/model",
        recoveryConfig: recoveryConfig(),
        runOptions: { onEvent: (event) => events.push(event) },
        logsDir: "/tmp/nonexistent-piclaw-test-logs",
        clearAttachments: () => {},
        runPromptAttempt: async (prompt, timeoutMs, toolExecutionCountAtStart) => {
          calls.push({ prompt, timeoutMs, toolExecutionCountAtStart });
          if (calls.length === 1) {
            now += 20;
            return attempt({
              output: output("error", "429 Too Many Requests"),
              snapshot: {
                hadToolActivity: true,
                hadPartialOutput: false,
                hadCompletedTurnOutput: false,
                hadTerminalTurnOutput: false,
                sawCompactionIntent: false,
                canDisableToolsForRecovery: true,
                hasUnresolvedToolExecution: false,
                toolExecutionCount: 3,
              },
              promptWasPersisted: true,
              toolExecutionCount: 3,
            });
          }
          expect(activeTools).toEqual(["read", "bash"]);
          return attempt({
            output: output("success", undefined, "done"),
            snapshot: {
              hadToolActivity: false,
              hadPartialOutput: false,
              hadCompletedTurnOutput: true,
              hadTerminalTurnOutput: true,
              sawCompactionIntent: false,
            },
            promptWasPersisted: true,
            toolExecutionCount: toolExecutionCountAtStart,
          });
        },
      });

      expect(result.status).toBe("success");
      expect(result.result).toBe("done");
      expect(result.recovery?.attemptsUsed).toBe(1);
      expect(calls[0]).toEqual({ prompt: "original prompt", timeoutMs: 10_000, toolExecutionCountAtStart: 0 });
      expect(calls[1]?.prompt).toBe(RECOVERY_CONTINUATION_PROMPT);
      expect(calls[1]?.toolExecutionCountAtStart).toBe(3);
      expect(calls[1]?.timeoutMs).toBe(980);
      expect(activeToolSets).toEqual([]);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "recovery_start", attempt: 1, strategy: "retry" }),
        expect.objectContaining({ type: "recovery_end", outcome: "recovered", attemptsUsed: 1 }),
      ]));
    } finally {
      clock.mockRestore();
    }
  });

  test("preserves a first-attempt protected terminal category without inventing provider retry exhaustion", async () => {
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-terminal-category",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: { protectedRecoveryContinuation: true },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: { ...output("error", "output limit reached"), failureCategory: "output_limit" },
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: true,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(1);
    expect(result.failureCategory).toBe("output_limit");
    expect(result.protectedRecoveryHandoff).toBeUndefined();
  });

  test("preserves a known terminal category after a protected provider retry", async () => {
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-retry-terminal-category",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ maxAttempts: 2 }),
      runOptions: { protectedRecoveryContinuation: true },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "503 temporarily unavailable"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: false,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: false,
            },
            promptWasPersisted: true,
          });
        }
        return attempt({
          output: { ...output("error", "output limit reached"), failureCategory: "output_limit" },
          snapshot: {
            hadToolActivity: false,
            hadPartialOutput: true,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(2);
    expect(result.failureCategory).toBe("output_limit");
    expect(result.protectedRecoveryHandoff).toBeUndefined();
  });

  test("classifies an actual protected provider retry exhaustion", async () => {
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-provider-exhausted",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ maxAttempts: 1 }),
      runOptions: { protectedRecoveryContinuation: true },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: output("error", "503 temporarily unavailable"),
          snapshot: {
            hadToolActivity: calls === 1,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: "error",
      protectedRecoveryHandoff: {
        reason: "provider_retry_exhausted",
        compaction: "not_attempted",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
      },
    });
  });

  test("classifies protected timeout exhaustion separately from provider retries", async () => {
    let calls = 0;
    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-timeout-exhausted",
      session: {} as any,
      sessionCtrl: { getActiveToolNames: () => ["read"], setActiveToolsByName: () => {} },
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ maxAttempts: 1 }),
      runOptions: { protectedRecoveryContinuation: true },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: { ...output("error", "provider timed out before finalization"), failureCategory: "timeout" },
          snapshot: {
            hadToolActivity: false,
            hadPartialOutput: true,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: "error",
      failureCategory: "timeout",
      protectedRecoveryHandoff: {
        reason: "timeout_recovery_exhausted",
        compaction: "not_attempted",
        retryable: true,
        recoveryAttempts: 1,
      },
    });
  });

  test("keeps unresolved tool evidence ahead of protected recovery budget exhaustion", async () => {
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-budget-exhausted",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ totalBudgetMs: 5, baseDelayMs: 10, maxDelayMs: 10 }),
      runOptions: {
        protectedRecoveryContinuation: true,
        protectedRecoveryHandoffContext: {
          reason: "unresolved_tool_execution",
          compaction: "not_attempted",
          toolsRequired: true,
          retryable: true,
          recoveryAttempts: 1,
        },
      },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: output("error", "503 temporarily unavailable"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      status: "error",
      failureCategory: "no_terminal_output",
      protectedRecoveryHandoff: {
        reason: "unresolved_tool_execution",
        compaction: "not_attempted",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
      },
    });
  });

  test("carries prior handoff evidence into a deliberately protected retry", async () => {
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read"],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "retry safely",
      chatJid: "web:test-recovery-tools-required",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ transientRecoveryToolsEnabled: false }),
      runOptions: {
        protectedRecoveryContinuation: true,
        protectedRecoveryHandoffContext: {
          reason: "unresolved_tool_execution",
          compaction: "succeeded",
          toolsRequired: true,
          retryable: false,
          recoveryAttempts: 2,
        },
      },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: output("error", "503 temporarily unavailable"),
          snapshot: {
            hadToolActivity: false,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "unresolved_tool_execution",
        toolsRequired: true,
        compaction: "succeeded",
        retryable: false,
        recoveryAttempts: 2,
      },
    });
  });

  test("hands off a generic tools-disabled recovery without making a disposable provider call", async () => {
    let activeTools = ["read", "bash"];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => { activeTools = [...names]; },
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue goal",
      chatJid: "web:test-recovery-phase:skip-provider",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ transientRecoveryToolsEnabled: false }),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls > 1) throw new Error("generic tools-disabled recovery must not invoke the provider");
        return attempt({
          output: output("error", "503 temporarily unavailable"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
          },
          promptWasPersisted: true,
        });
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "tools_required",
        compaction: "not_attempted",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
      },
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(result.nextAction).toContain("ordinary turn");
    expect(calls).toBe(1);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("preserves a tool-enabled timeout as primary cause when handing off a skipped tools-disabled retry", async () => {
    const sessionCtrl: SessionWithToolControl = {
      // The production outer tool flag was stale; durable attempt activity is authoritative.
      getActiveToolNames: () => [],
      setActiveToolsByName: () => {},
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-tools-required",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 3_600_000,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ transientRecoveryToolsEnabled: false }),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls > 1) throw new Error("tools-disabled recovery must be handed off without another provider call");
        return attempt({
          output: {
            status: "error",
            result: null,
            error: "Timed out after 3600s",
            failureCategory: "timeout",
          },
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: true,
            hadCompletedTurnOutput: true,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: false,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
            assistantToolUseMessageCount: 205,
            toolExecutionCount: 403,
            toolUseMessageBudget: 512,
          },
          promptWasPersisted: true,
          // Reproduces the production mismatch: the typed output said timeout
          // while the outer legacy flag had already been reset.
          timedOut: false,
          toolExecutionCount: 403,
        });
      },
    });

    expect(result).toMatchObject({
      status: "error",
      failureCategory: "timeout",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "tools_required",
        compaction: "not_attempted",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
        primaryFailure: {
          category: "timeout",
          detail: "Timed out after 3600s.",
          executionToolsEnabled: true,
          hadPartialOutput: true,
          hadToolActivity: true,
          toolExecutionCount: 403,
        },
      },
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(result.protectedRecoveryHandoff?.primaryFailure?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(calls).toBe(1);
  });

  test("skips a tools-disabled transient provider attempt and preserves tools", async () => {
    let activeTools = ["read", "bash"];
    const activeToolSets: string[][] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        activeToolSets.push([...names]);
      },
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-phase",
      session: {} as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({ transientRecoveryToolsEnabled: false }),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "503 temporarily unavailable"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: false,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: false,
            },
            promptWasPersisted: true,
          });
        }
        throw new Error("generic tools-disabled recovery must not invoke the provider");
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(calls).toBe(1);
    expect(activeToolSets).toEqual([]);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("unresolved tool execution overrides a reported success before recovery compaction", async () => {
    let activeTools = ["read", "bash"];
    const activeToolSets: string[][] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        activeToolSets.push([...names]);
      },
    };
    let calls = 0;
    let compactCalls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-phase",
      session: { compact: async () => { compactCalls += 1; return {}; } } as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("success", undefined, "reported success with an unresolved tool"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: true,
              hadTerminalTurnOutput: true,
              sawCompactionIntent: true,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: true,
            },
            promptWasPersisted: true,
          });
        }
        throw new Error("generic tools-disabled recovery must not invoke the provider");
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "unresolved_tool_execution",
        compaction: "not_attempted",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 0,
      },
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(calls).toBe(1);
    expect(compactCalls).toBe(0);
    expect(activeToolSets).toEqual([]);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("runs recovery compaction before handing off without a disposable provider call",  async () => {
    let compactCalls = 0;
    const calls: Array<{ prompt: string; timeoutMs: number; toolExecutionCountAtStart: number }> = [];
    const events: unknown[] = [];
    let activeTools = ["read", "bash"];
    const activeToolSets: string[][] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        activeToolSets.push([...names]);
      },
    };
    const session = {
      compact: async () => {
        compactCalls += 1;
        return { tokensBefore: 16_000, estimatedTokensAfter: 8_000 };
      },
    } as any;

    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-compact",
      session,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now() - 60_000,
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig({
        enabled: false,
        transientRecoveryEnabled: false,
        transientRecoveryToolsEnabled: false,
        totalBudgetMs: 25,
      }),
      runOptions: { onEvent: (event) => events.push(event) },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async (prompt, timeoutMs, toolExecutionCountAtStart) => {
        calls.push({ prompt, timeoutMs, toolExecutionCountAtStart });
        if (calls.length === 1) {
          return attempt({
            output: output("error", "context length exceeded"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: true,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: false,
              toolExecutionCount: 2,
            },
            promptWasPersisted: true,
            toolExecutionCount: 2,
          });
        }
        throw new Error("post-compaction tools-disabled recovery must not invoke the provider");
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "post_compaction_tools_required",
        compaction: "succeeded",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
      },
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(compactCalls).toBe(1);
    expect(calls).toEqual([{ prompt: "original prompt", timeoutMs: 0, toolExecutionCountAtStart: 0 }]);
    expect(activeToolSets).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "compaction_start", trigger: "recovery" }),
      expect.objectContaining({ type: "compaction_end", trigger: "recovery", willRetry: true }),
      expect.objectContaining({ type: "recovery_end", outcome: "handoff" }),
    ]));
  });

  for (const scenario of [
    { name: "timeout", failureCategory: "timeout" as const, error: "provider timed out before finalization", sawCompactionIntent: false },
    { name: "context pressure", failureCategory: "context_pressure" as const, error: "maximum context length exceeded", sawCompactionIntent: true },
  ]) {
    test(`initial ${scenario.name} recovery compacts then runs one tools-enabled continuation`, async () => {
      let activeTools = ["read", "bash"];
      const activeToolSets: string[][] = [];
      const calls: Array<{ prompt: string; activeTools: string[] }> = [];
      let compactCalls = 0;
      const sessionCtrl: SessionWithToolControl = {
        getActiveToolNames: () => [...activeTools],
        setActiveToolsByName: (names) => {
          activeTools = [...names];
          activeToolSets.push([...names]);
        },
      };

      const result = await runAgentRecoveryPhase({
        prompt: "finish the tool-dependent task",
        chatJid: `web:test-initial-${scenario.name.replace(/\s+/g, "-")}`,
        session: { compact: async () => { compactCalls += 1; return {}; } } as any,
        sessionCtrl,
        timeoutMs: 0,
        startTime: Date.now(),
        modelLabel: "test/model",
        recoveryConfig: recoveryConfig(),
        runOptions: { recoveryGeneration: 0, recoverySourceId: `source-${scenario.name}` },
        logsDir: "/tmp/nonexistent-piclaw-test-logs",
        clearAttachments: () => {},
        runPromptAttempt: async (prompt) => {
          calls.push({ prompt, activeTools: [...activeTools] });
          if (calls.length === 1) {
            return attempt({
              output: { ...output("error", scenario.error), failureCategory: scenario.failureCategory },
              snapshot: {
                hadToolActivity: true,
                hadPartialOutput: true,
                hadCompletedTurnOutput: false,
                hadTerminalTurnOutput: false,
                sawCompactionIntent: scenario.sawCompactionIntent,
                canDisableToolsForRecovery: true,
                hasUnresolvedToolExecution: false,
                hadToolFailure: false,
                sawTerminalSideEffectToolActivity: false,
                toolUseBudgetExceeded: false,
                toolExecutionCount: 2,
              },
              promptWasPersisted: true,
              timedOut: scenario.failureCategory === "timeout",
              toolExecutionCount: 2,
            });
          }
          return attempt({
            output: output("success", undefined, "finished automatically"),
            snapshot: {
              hadToolActivity: false,
              hadPartialOutput: false,
              hadCompletedTurnOutput: true,
              hadTerminalTurnOutput: true,
              sawCompactionIntent: false,
            },
            promptWasPersisted: true,
            toolExecutionCount: 2,
          });
        },
      });

      expect(result).toMatchObject({ status: "success", result: "finished automatically", recovery: { attemptsUsed: 1, recovered: true } });
      expect(compactCalls).toBe(1);
      expect(calls).toEqual([
        { prompt: "finish the tool-dependent task", activeTools: ["read", "bash"] },
        { prompt: RECOVERY_CONTINUATION_PROMPT, activeTools: ["read", "bash"] },
      ]);
      expect(activeToolSets).toEqual([]);
    });
  }

  for (const unsafe of [
    { name: "unresolved execution", snapshot: { hasUnresolvedToolExecution: true, hadToolFailure: false, sawTerminalSideEffectToolActivity: false, toolUseBudgetExceeded: false, canDisableToolsForRecovery: true } },
    { name: "tool failure", snapshot: { hasUnresolvedToolExecution: false, hadToolFailure: true, sawTerminalSideEffectToolActivity: false, toolUseBudgetExceeded: false, canDisableToolsForRecovery: true } },
    { name: "terminal side effect", snapshot: { hasUnresolvedToolExecution: false, hadToolFailure: false, sawTerminalSideEffectToolActivity: true, toolUseBudgetExceeded: false, canDisableToolsForRecovery: true } },
    { name: "tool budget exhaustion", snapshot: { hasUnresolvedToolExecution: false, hadToolFailure: false, sawTerminalSideEffectToolActivity: false, toolUseBudgetExceeded: true, canDisableToolsForRecovery: true } },
    { name: "missing tool control", snapshot: { hasUnresolvedToolExecution: false, hadToolFailure: false, sawTerminalSideEffectToolActivity: false, toolUseBudgetExceeded: false, canDisableToolsForRecovery: false } },
  ]) {
    test(`does not auto re-arm tools after ${unsafe.name}`, async () => {
      let calls = 0;
      const result = await runAgentRecoveryPhase({
        prompt: "finish bounded work",
        chatJid: `web:test-unsafe-${unsafe.name.replace(/\s+/g, "-")}`,
        session: { compact: async () => ({}) } as any,
        sessionCtrl: { getActiveToolNames: () => ["read"], setActiveToolsByName: () => {} },
        timeoutMs: 0,
        startTime: Date.now(),
        modelLabel: "test/model",
        recoveryConfig: recoveryConfig(),
        runOptions: {},
        logsDir: "/tmp/nonexistent-piclaw-test-logs",
        clearAttachments: () => {},
        runPromptAttempt: async () => {
          calls += 1;
          return attempt({
            output: { ...output("error", "maximum context length exceeded"), failureCategory: "context_pressure" },
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: true,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: true,
              toolExecutionCount: 1,
              ...unsafe.snapshot,
            },
            promptWasPersisted: true,
            toolExecutionCount: 1,
          });
        },
      });
      expect(calls).toBe(1);
      expect(result).toMatchObject({ status: "error", requiresToolEnabledContinuation: true });
    });
  }

  test("final recovery generation cannot re-arm an initial tools-enabled continuation", async () => {
    let calls = 0;
    const result = await runAgentRecoveryPhase({
      prompt: "finish bounded work",
      chatJid: "web:test-initial-generation-exhausted",
      session: { compact: async () => ({}) } as any,
      sessionCtrl: { getActiveToolNames: () => ["read"], setActiveToolsByName: () => {} },
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: { recoveryGeneration: MAX_RECOVERY_GENERATIONS_PER_SOURCE - 1 },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: { ...output("error", "maximum context length exceeded"), failureCategory: "context_pressure" },
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: true,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: true,
            hasUnresolvedToolExecution: false,
            toolExecutionCount: 1,
          },
          promptWasPersisted: true,
          toolExecutionCount: 1,
        });
      },
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: "error", requiresToolEnabledContinuation: true });
  });

  test("a benign compaction skip does not re-arm a protected tool-enabled retry", async () => {
    let calls = 0;
    let activeTools = ["read", "bash"];
    const activeToolSets: string[][] = [];
    const events: any[] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        activeToolSets.push([...names]);
      },
    };

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid: "web:test-recovery-compact:protected:benign-skip",
      session: {
        compact: async () => { throw new Error("Nothing to compact (session too small)"); },
      } as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {
        protectedRecoveryContinuation: true,
        onEvent: (event) => events.push(event),
        protectedRecoveryHandoffContext: {
          reason: "post_compaction_tools_required",
          compaction: "succeeded",
          toolsRequired: true,
          retryable: true,
          recoveryAttempts: 1,
        },
      },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: output("error", "context length exceeded"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: true,
            toolExecutionCount: 1,
          },
          promptWasPersisted: true,
          toolExecutionCount: 1,
        });
      },
    });

    expect(calls).toBe(1);
    expect(activeToolSets).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "compaction_end",
      skipped: true,
      willRetry: false,
    }));
    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "tools_required",
        compaction: "not_attempted",
        toolsRequired: true,
      },
    });
  });

  test("each fresh protected continuation re-arms one tool-enabled retry after compaction", async () => {
    for (const sequence of [1, 2]) {
      const chatJid = `web:test-recovery-compact:protected:${sequence}`;
      let compactCalls = 0;
      let activeTools = ["read", "bash"];
      const activeToolSets: string[][] = [];
      const calls: Array<{ prompt: string; toolExecutionCountAtStart: number }> = [];
      const sessionCtrl: SessionWithToolControl = {
        getActiveToolNames: () => [...activeTools],
        setActiveToolsByName: (names) => {
          activeTools = [...names];
          activeToolSets.push([...names]);
        },
      };

      const result = await runAgentRecoveryPhase({
        prompt: "continue protected work",
        chatJid,
        session: { compact: async () => { compactCalls += 1; return {}; } } as any,
        sessionCtrl,
        timeoutMs: 0,
        startTime: Date.now(),
        modelLabel: "test/model",
        recoveryConfig: recoveryConfig(),
        runOptions: {
          protectedRecoveryContinuation: true,
          protectedRecoveryContinuationDepth: 1,
        },
        logsDir: "/tmp/nonexistent-piclaw-test-logs",
        clearAttachments: () => {},
        runPromptAttempt: async (prompt, _timeoutMs, toolExecutionCountAtStart) => {
          calls.push({ prompt, toolExecutionCountAtStart });
          if (calls.length === 1) {
            return attempt({
              output: output("error", "context length exceeded"),
              snapshot: {
                hadToolActivity: true,
                hadPartialOutput: true,
                hadCompletedTurnOutput: false,
                hadTerminalTurnOutput: false,
                sawCompactionIntent: true,
                canDisableToolsForRecovery: true,
                hasUnresolvedToolExecution: false,
                toolExecutionCount: 2,
              },
              promptWasPersisted: true,
              toolExecutionCount: 2,
            });
          }
          expect(activeTools).toEqual(["read", "bash"]);
          return attempt({
            output: output("success", undefined, `finished sequence ${sequence}`),
            snapshot: {
              hadToolActivity: false,
              hadPartialOutput: false,
              hadCompletedTurnOutput: true,
              hadTerminalTurnOutput: true,
              sawCompactionIntent: false,
            },
            promptWasPersisted: true,
            toolExecutionCount: toolExecutionCountAtStart,
          });
        },
      });

      expect(result).toMatchObject({
        status: "success",
        result: `finished sequence ${sequence}`,
        recovery: { attemptsUsed: 1, recovered: true, exhausted: false },
      });
      expect(result.requiresToolEnabledContinuation).toBeUndefined();
      expect(compactCalls).toBe(1);
      expect(calls).toEqual([
        { prompt: "continue protected work", toolExecutionCountAtStart: 0 },
        { prompt: RECOVERY_CONTINUATION_PROMPT, toolExecutionCountAtStart: 2 },
      ]);
      expect(activeToolSets).toEqual([]);
    }
  });

  test("post-compaction durable tool progress advances the loop-guard generation", async () => {
    const chatJid = "web:test-recovery-generation-progress";
    const recoverySourceId = "source-message-1063";
    let calls = 0;
    let compactCalls = 0;
    const generationEvents: Array<Record<string, unknown>> = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["read", "edit"],
      setActiveToolsByName: () => {},
    };

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid,
      session: { compact: async () => { compactCalls += 1; return {}; } } as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {
        protectedRecoveryContinuation: true,
        protectedRecoveryContinuationDepth: 1,
        recoverySourceId,
        recoveryGeneration: 0,
      },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      onInfo: (_message, details) => {
        if (details.operation === "run_agent.recovery_generation_advanced") generationEvents.push(details);
      },
      runPromptAttempt: async (_prompt, _timeoutMs, toolExecutionCountAtStart) => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: { ...output("error", "context length exceeded"), failureCategory: "context_pressure" },
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: true,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: true,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: false,
              hadToolFailure: false,
              toolExecutionCount: 2,
            },
            promptWasPersisted: true,
            toolExecutionCount: 2,
          });
        }
        if (calls === 2) {
          const oldGenerationGuard = () => shouldSuppressRecoveryLoop({
            chatJid,
            recoverySourceId,
            recoveryGeneration: 0,
            modelLabel: "test/model",
            failureCategory: "timeout",
            classifier: "transient",
            strategy: "retry",
            now: 2_000,
          });
          expect(oldGenerationGuard().suppress).toBe(false);
          expect(oldGenerationGuard().suppress).toBe(false);
          return attempt({
            output: { ...output("error", "provider timed out before finalization"), failureCategory: "timeout" },
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: true,
              hadCompletedTurnOutput: true,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: false,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: false,
              hadToolFailure: false,
              toolExecutionCount: 3,
            },
            promptWasPersisted: true,
            toolExecutionCount: 3,
          });
        }
        return attempt({
          output: output("success", undefined, "finished after generation advance"),
          snapshot: {
            hadToolActivity: false,
            hadPartialOutput: false,
            hadCompletedTurnOutput: true,
            hadTerminalTurnOutput: true,
            sawCompactionIntent: false,
          },
          promptWasPersisted: true,
          toolExecutionCount: toolExecutionCountAtStart,
        });
      },
    });

    expect(result).toMatchObject({ status: "success", result: "finished after generation advance" });
    expect(calls).toBe(3);
    expect(compactCalls).toBe(1);
    expect(generationEvents).toEqual([
      expect.objectContaining({ recoverySourceId, recoveryGeneration: 1 }),
    ]);
  });

  test("a later benign compaction skip cannot reuse fresh-compaction authority", async () => {
    const chatJid = "web:test-recovery-compact:protected:bounded";
    let compactCalls = 0;
    let activeTools = ["read", "bash"];
    const activeToolSets: string[][] = [];
    const prompts: string[] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => {
        activeTools = [...names];
        activeToolSets.push([...names]);
      },
    };

    const result = await runAgentRecoveryPhase({
      prompt: "continue protected work",
      chatJid,
      session: {
        compact: async () => {
          compactCalls += 1;
          if (compactCalls === 2) throw new Error("Nothing to compact (session too small)");
          return {};
        },
      } as any,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {
        protectedRecoveryContinuation: true,
        protectedRecoveryContinuationDepth: 1,
      },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async (prompt) => {
        prompts.push(prompt);
        if (prompts.length > 2) throw new Error("bounded protected recovery must not make a third provider call");
        expect(activeTools).toEqual(["read", "bash"]);
        return attempt({
          output: output("error", "context length exceeded"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: true,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: true,
            canDisableToolsForRecovery: true,
            hasUnresolvedToolExecution: false,
            toolExecutionCount: prompts.length,
          },
          promptWasPersisted: true,
          toolExecutionCount: prompts.length,
        });
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      recovery: {
        attemptsUsed: 2,
        recovered: false,
        exhausted: true,
        strategyHistory: ["compact_then_retry", "compact_then_retry"],
      },
      protectedRecoveryHandoff: {
        reason: "tools_required",
        compaction: "not_attempted",
      },
    });
    expect(prompts).toEqual(["continue protected work", RECOVERY_CONTINUATION_PROMPT]);
    expect(compactCalls).toBe(2);
    expect(activeToolSets).toEqual([]);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("hands off context-pressure recovery without requiring tool suppression support", async () => {
    let calls = 0;
    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-phase",
      session: { compact: async () => ({}) } as any,
      sessionCtrl: null,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        return attempt({
          output: output("error", "context length exceeded"),
          snapshot: {
            hadToolActivity: true,
            hadPartialOutput: false,
            hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false,
            sawCompactionIntent: true,
            toolExecutionCount: 1,
          },
          promptWasPersisted: true,
          toolExecutionCount: 1,
        });
      },
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      recovery: { attemptsUsed: 1, lastClassifier: "tool_activity" },
    });
    expect(result.toolBudgetExceeded).toBeUndefined();
  });

  test("treats a missing compaction model as failure before emergency rotation", async () => {
    let calls = 0;
    let rotations = 0;
    const oldSession = { compact: async () => { throw new Error("No model selected"); } } as any;
    const newSession = {} as any;
    let activeTools = ["read"];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => { activeTools = [...names]; },
    };
    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-compact",
      session: oldSession,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      rotateAfterCompactionFailure: async () => {
        rotations += 1;
        return { ok: true, session: newSession, sessionCtrl };
      },
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "context length exceeded"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: true,
              toolExecutionCount: 1,
            },
            promptWasPersisted: true,
            toolExecutionCount: 1,
          });
        }
        expect(activeTools).toEqual([]);
        return attempt({ output: output("success", undefined, "rotated after compaction failure") });
      },
    });

    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: {
        reason: "compaction_failed",
        compaction: "failed",
        toolsRequired: true,
        retryable: true,
        recoveryAttempts: 1,
      },
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(rotations).toBe(1);
    expect(calls).toBe(1);
  });

  test("rotates when recovery compaction remains over threshold", async () => {
    let calls = 0;
    let rotations = 0;
    const oldSession = {
      compact: async () => ({ tokensBefore: 300_000, estimatedTokensAfter: 300_000 }),
      model: { contextWindow: 128_000 },
      getContextUsage: () => ({ tokens: 300_000 }),
      sessionManager: { getLeafId: () => "leaf", getEntries: () => [], buildSessionContext: () => ({ messages: [] }) },
    } as any;
    const newSession = {} as any;
    let activeTools = ["read"];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => { activeTools = [...names]; },
    };
    const result = await runAgentRecoveryPhase({
      prompt: "original prompt",
      chatJid: "web:test-recovery-compact:insufficient",
      session: oldSession,
      sessionCtrl,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      rotateAfterInsufficientCompaction: async () => {
        rotations += 1;
        return { ok: true, session: newSession, sessionCtrl };
      },
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "context length exceeded"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: true,
              toolExecutionCount: 1,
            },
            promptWasPersisted: true,
            toolExecutionCount: 1,
          });
        }
        expect(activeTools).toEqual([]);
        return attempt({ output: output("success", undefined, "rotated") });
      },
    });
    expect(result).toMatchObject({
      status: "error",
      requiresToolEnabledContinuation: true,
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(rotations).toBe(1);
    expect(calls).toBe(1);
  });

  test("OpenRouter affordability recovery changes the ceiling once and then succeeds", async () => {
    const budgetState = createOpenRouterOutputBudgetState("web:test-openrouter-budget-recovery");
    budgetState.requestAttempt = 1;
    budgetState.lastAppliedLimit = 32_768;
    budgetState.lastOriginalLimit = 384_000;
    budgetState.lastTokenField = "max_tokens";
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "weather",
      chatJid: "web:test-openrouter-budget-recovery",
      session: {} as any,
      sessionCtrl: null,
      timeoutMs: 0,
      startTime: Date.now(),
      modelLabel: "openrouter/deepseek/test",
      recoveryConfig: recoveryConfig({ enabled: false, transientRecoveryEnabled: false }),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      openRouterOutputBudgetState: budgetState,
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "402: {\"message\":\"This request requires more credits, or fewer max_tokens. You requested up to 32768 tokens, but can only afford 10000. provider body omitted\"}"),
            promptWasPersisted: true,
          });
        }
        expect(budgetState.adaptiveLimit).toBe(9_000);
        budgetState.requestAttempt = 2;
        budgetState.lastAppliedLimit = budgetState.adaptiveLimit;
        return attempt({ output: output("success", undefined, "sunny"), promptWasPersisted: true });
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: "success",
      result: "sunny",
      recovery: { attemptsUsed: 1, recovered: true, lastClassifier: "provider_budget" },
    });
    expect(result.recovery?.diagnostics[0]?.error).toContain("requested 32768 tokens; affordable 10000 tokens");
    expect(result.recovery?.diagnostics[0]?.error).not.toContain("provider body omitted");
  });

  test("repeated and malformed OpenRouter 402 failures are terminal without generic retries", async () => {
    for (const [suffix, secondError] of [
      ["repeated", "HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 9000 tokens, but can only afford 5000."],
      ["malformed", null],
    ] as const) {
      const budgetState = createOpenRouterOutputBudgetState("web:test-openrouter-budget-terminal");
      budgetState.requestAttempt = 1;
      budgetState.lastAppliedLimit = 32_768;
      budgetState.lastTokenField = "max_tokens";
      let calls = 0;
      const result = await runAgentRecoveryPhase({
        prompt: suffix,
        chatJid: "web:test-openrouter-budget-terminal",
        session: {} as any,
        sessionCtrl: null,
        timeoutMs: 0,
        startTime: Date.now(),
        modelLabel: "openrouter/test",
        recoveryConfig: recoveryConfig(),
        runOptions: {},
        logsDir: "/tmp/nonexistent-piclaw-test-logs",
        clearAttachments: () => {},
        openRouterOutputBudgetState: budgetState,
        runPromptAttempt: async () => {
          calls += 1;
          if (suffix === "malformed") {
            return attempt({ output: output("error", "402: arbitrary payment required"), promptWasPersisted: true });
          }
          if (calls === 1) {
            return attempt({
              output: output("error", "402: This request requires more credits, or fewer max_tokens. You requested up to 32768 tokens, but can only afford 10000."),
              promptWasPersisted: true,
            });
          }
          budgetState.requestAttempt = 2;
          budgetState.lastAppliedLimit = 9_000;
          return attempt({ output: output("error", secondError!), promptWasPersisted: true });
        },
      });

      expect(calls).toBe(suffix === "malformed" ? 1 : 2);
      expect(result.status).toBe("error");
      expect(result.failureCategory).toBe("provider_budget");
      expect(result.error).toContain("OpenRouter");
      expect(result.recovery?.lastClassifier).toBe("provider_budget");
    }
  });

  test("buildRecoveryDiagnosticEntry preserves serializable budget fields", () => {
    expect(buildRecoveryDiagnosticEntry(
      "attempt_failure",
      2,
      "tool_history_pressure",
      null,
      "budget reached",
      "Tool-use budget exceeded",
      123,
      {
        hadToolActivity: true,
        hadPartialOutput: true,
        hadCompletedTurnOutput: false,
        hadTerminalTurnOutput: false,
        hasUnresolvedToolExecution: true,
        sawCompactionIntent: false,
        compactionErrorMessage: null,
        toolUseBudgetExceeded: true,
        assistantToolUseMessageCount: 4,
        toolExecutionCount: 7,
      },
    )).toEqual({
      phase: "attempt_failure",
      attempt: 2,
      classifier: "tool_history_pressure",
      strategy: null,
      reason: "budget reached",
      error: "Tool-use budget exceeded",
      elapsedMs: 123,
      hadToolActivity: true,
      hadPartialOutput: true,
      hadCompletedTurnOutput: false,
      hadTerminalTurnOutput: false,
      hasUnresolvedToolExecution: true,
      sawCompactionIntent: false,
      compactionErrorMessage: null,
      toolUseBudgetExceeded: true,
      assistantToolUseMessageCount: 4,
      toolExecutionCount: 7,
    });
  });
});

test("neutral tools-disabled prompt retains explicit user continuation without replacing finalization", () => {
  expect(TOOLS_DISABLED_RECOVERY_PROMPT).toContain("do not call any");
  expect(TOOLS_DISABLED_RECOVERY_PROMPT).toContain("what remains and the next step");
  expect(TOOLS_DISABLED_RECOVERY_PROMPT).toContain("they can ask you to continue");
  expect(TOOLS_DISABLED_RECOVERY_PROMPT).not.toBe(FINALIZATION_RECOVERY_PROMPT);
  expect(RECOVERY_CONTINUATION_PROMPT).toBe("Continue the current task from persisted state without repeating completed work.");
});

for (const transientRecoveryToolsEnabled of [false, true]) {
  test(`finalization checkpoint takes precedence over neutral continuation (retry tools ${transientRecoveryToolsEnabled})`, async () => {
    const prompts: string[] = [];
    let tools = ["bash", "list_tools"];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...tools],
      setActiveToolsByName: (names) => { tools = [...names]; },
    };
    const result = await runAgentRecoveryPhase({
      chatJid: "web:test-recovery-phase",
      session: {} as any,
      sessionCtrl,
      prompt: "implement the next step",
      startTime: Date.now(),
      modelLabel: "test/model",
      timeoutMs: 1_000,
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      recoveryConfig: recoveryConfig({ maxAttempts: 1, transientRecoveryToolsEnabled }),
      runPromptAttempt: async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return attempt({
            output: { ...output("error", "No terminal assistant output"), failureCategory: "no_terminal_output" },
            promptWasPersisted: true,
            snapshot: {
              hadToolActivity: true, hadPartialOutput: false, sawCompactionIntent: false,
              hadCompletedTurnOutput: false, hadTerminalTurnOutput: false,
              hasUnresolvedToolExecution: false, needsToolFreeFinalization: true,
              canDisableToolsForRecovery: true,
            },
          });
        }
        expect(tools).toEqual([]);
        expect(prompt).toBe(FINALIZATION_RECOVERY_PROMPT);
        expect(prompt).toContain("Do not call tools");
        expect(prompt).toContain("text-only checkpoint");
        expect(prompt).not.toContain("they can ask you to continue");
        expect(prompt).not.toBe(RECOVERY_CONTINUATION_PROMPT);
        // Extension hooks cannot re-enable tools in the closing attempt.
        sessionCtrl.setActiveToolsByName!(["bash"]);
        expect(tools).toEqual([]);
        return attempt({ output: output("success", undefined, "Checkpoint"), promptWasPersisted: true });
      },
    });
    expect(result).toMatchObject({ status: "success", result: "Checkpoint", recovery: { strategyHistory: ["finalize"] } });
    expect(prompts).toEqual(["implement the next step", FINALIZATION_RECOVERY_PROMPT]);
    expect(tools).toEqual(["bash", "list_tools"]);
    // The restored setter is bound to its controller, and usable again.
    sessionCtrl.setActiveToolsByName!(["bash"]);
    expect(tools).toEqual(["bash"]);
  });
}

for (const promptWasPersisted of [false, true]) {
  test(`ordinary retry preserves ${promptWasPersisted ? "enabled continuation" : "unpersisted user replay"}`, async () => {
    const prompts: string[] = [];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => ["bash"],
      setActiveToolsByName: () => { throw new Error("Enabled retries must not change tools"); },
    };
    const result = await runAgentRecoveryPhase({
      prompt: "original user instruction", chatJid: "web:test-recovery-phase",
      session: {} as any, sessionCtrl, timeoutMs: 0, startTime: Date.now(),
      modelLabel: "test/model", recoveryConfig: recoveryConfig(), runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs", clearAttachments: () => {},
      runPromptAttempt: async (prompt) => {
        prompts.push(prompt);
        return prompts.length === 1
          ? attempt({ output: { ...output("error", "Connection error"), failureCategory: "network" }, promptWasPersisted })
          : attempt({ output: output("success", undefined, "done") });
      },
    });
    expect(result.status).toBe("success");
    expect(prompts).toEqual(["original user instruction", promptWasPersisted ? RECOVERY_CONTINUATION_PROMPT : "original user instruction"]);
  });
}

test("actual SDK blocks tool calls and hook activation in finalization, then restores tools", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "recovery-sdk-"));
  const model: Model<"openai-completions"> = {
    id: "scripted", provider: "recovery-fixture", name: "Recovery fixture", api: "openai-completions",
    baseUrl: "https://unused.invalid", reasoning: false, input: ["text"], contextWindow: 128_000,
    maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let phase = 0;
  let providerCalls = 0;
  let executions = 0;
  let activationAttempts = 0;
  const declarations: string[][] = [];
  const scriptedStream: Provider["stream"] = (_model, context) => {
    providerCalls += 1;
    // Pi 1.2 providers receive normalized transcript tool deltas, not Context.tools.
    const declared = new Set<string>();
    for (const message of context.messages) {
      if (message.role !== "system") continue;
      for (const tool of message.toolsRemoved ?? []) declared.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) declared.add(tool.name);
    }
    declarations.push([...declared]);
    // Even a stale/hallucinated tool call must not execute during closing.
    const blockedCall = phase === 3 && providerCalls === 3;
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: blockedCall ? [{ type: "toolCall", id: "blocked-probe", name: "probe", arguments: {} }]
        : [{ type: "text", text: "Persisted checkpoint" }],
      stopReason: blockedCall ? "toolUse" : "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: blockedCall ? "toolUse" : "stop", message });
    return stream;
  };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Recovery fixture", getModels: () => [model],
    auth: { apiKey: { name: "No credential", login: async () => { throw new Error("Login forbidden"); },
      resolve: async () => ({ auth: {}, source: "synthetic" }) } },
    stream: scriptedStream, streamSimple: scriptedStream });
  await runtime.refresh({ allowNetwork: false });
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "profile"), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    disabledBuiltinExtensions: ["codemode", "tool-search", "mcp"],
    extensionFactories: [pi => {
      pi.registerTool({ name: "probe", label: "Probe", description: "In-memory execution counter",
        parameters: Type.Object({}), async execute() {
          executions += 1;
          return { content: [{ type: "text", text: "executed" }], details: {} };
        } });
      pi.on("before_agent_start", () => {
        activationAttempts += 1;
        pi.setActiveTools(["probe"]);
      });
    }],
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir: join(cwd, "profile"), modelRuntime: runtime, model,
      sessionManager: SessionManager.inMemory(cwd), settingsManager, resourceLoader: loader, noTools: "builtin" }));
    const controlledSession = session;
    await controlledSession.bindExtensions({ mode: "rpc", onError: error => { throw new Error(String(error)); } });
    const prompts: string[] = [];
    const result = await runAgentRecoveryPhase({
      prompt: "original instruction", chatJid: "web:test-recovery-phase", session: controlledSession,
      sessionCtrl: controlledSession, timeoutMs: 0, startTime: Date.now(), modelLabel: "recovery-fixture/scripted",
      recoveryConfig: recoveryConfig({ totalBudgetMs: 5_000 }), runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs", clearAttachments: () => {},
      runPromptAttempt: async prompt => {
        phase += 1;
        prompts.push(prompt);
        await controlledSession.prompt(prompt);
        if (phase === 1) return attempt({
          output: { ...output("error", "Connection error"), failureCategory: "network" }, promptWasPersisted: true,
        });
        if (phase === 2) return attempt({
          output: { ...output("error", "No terminal output"), failureCategory: "no_terminal_output" },
          promptWasPersisted: true, snapshot: {
            hadToolActivity: true, hadPartialOutput: false, hadCompletedTurnOutput: false,
            hadTerminalTurnOutput: false, sawCompactionIntent: false, hasUnresolvedToolExecution: false,
            needsToolFreeFinalization: true, canDisableToolsForRecovery: true,
          },
        });
        return attempt({ output: output("success", undefined, "Persisted checkpoint"), promptWasPersisted: true });
      },
    });
    expect(result).toMatchObject({ status: "success", recovery: { strategyHistory: ["retry", "finalize"] } });
    expect(prompts).toEqual(["original instruction", RECOVERY_CONTINUATION_PROMPT, FINALIZATION_RECOVERY_PROMPT]);
    expect(activationAttempts).toBe(3);
    expect(declarations).toEqual([["probe"], ["probe"], [], []]);
    expect(executions).toBe(0);
    expect(controlledSession.messages.find(message => message.role === "toolResult" && message.toolCallId === "blocked-probe"))
      .toMatchObject({ isError: true });
    expect(controlledSession.getActiveToolNames()).toEqual(["probe"]);
    controlledSession.setActiveToolsByName(["probe"]);
    await controlledSession.prompt("Verify restored tool baseline");
    expect(declarations.at(-1)).toEqual(["probe"]);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    rmSync(cwd, { recursive: true, force: true });
  }
}, 15_000);
