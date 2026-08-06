import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import "../helpers.js";

import {
  buildRecoveryDiagnosticEntry,
  runAgentRecoveryPhase,
  type PromptAttemptResult,
  type SessionWithToolControl,
} from "../../src/agent-pool/run-agent-recovery-phase.js";
import { RECOVERY_CONTINUATION_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";
import { initDatabase } from "../../src/db.js";
import { endTrackedPhase } from "../../src/runtime/progress-watchdog.js";

const TEST_CHAT_JIDS = [
  "web:test-recovery-phase",
  "web:test-recovery-compact",
];

beforeEach(() => {
  initDatabase();
});

afterEach(() => {
  for (const chatJid of TEST_CHAT_JIDS) endTrackedPhase(chatJid);
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

describe("runAgentRecoveryPhase", () => {
  test("continues after resolved tool work with tools available and execution budget carried", async () => {
    let activeTools = ["read", "bash"];
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
      startTime: Date.now(),
      modelLabel: "test/model",
      recoveryConfig: recoveryConfig(),
      runOptions: { onEvent: (event) => events.push(event) },
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async (prompt, timeoutMs, toolExecutionCountAtStart) => {
        calls.push({ prompt, timeoutMs, toolExecutionCountAtStart });
        if (calls.length === 1) {
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
    expect(calls[1]?.timeoutMs).toBeGreaterThanOrEqual(950);
    expect(calls[1]?.timeoutMs).toBeLessThanOrEqual(1_000);
    expect(activeToolSets).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "recovery_start", attempt: 1, strategy: "retry" }),
      expect.objectContaining({ type: "recovery_end", outcome: "recovered", attemptsUsed: 1 }),
    ]));
  });

  test.each([
    ["unable-access", "I’m unable to access the execution tools in this recovery turn, so I can’t advance the task."],
    ["production-blocked", "I’m blocked from further tool execution in this recovered turn, so I cannot safely inspect or edit the continuation ledger yet."],
    ["blocked-using", "We are blocked from using the tools, so this task cannot continue."],
  ])("does not report a tool-unavailable protected continuation as recovered: %s", async (caseId, protectedReply) => {
    let activeTools = ["read", "bash"];
    const sessionCtrl: SessionWithToolControl = {
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => { activeTools = [...names]; },
    };
    let calls = 0;

    const result = await runAgentRecoveryPhase({
      prompt: "continue goal",
      chatJid: `web:test-recovery-phase:${caseId}`,
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
        expect(activeTools).toEqual([]);
        return attempt({
          output: output("success", undefined, protectedReply),
        });
      },
    });

    expect(result).toMatchObject({
      status: "error",
      recovery: { recovered: false, exhausted: true, lastClassifier: "tool_activity" },
    });
    expect(result.error).toContain("could not advance the task");
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("disables and restores tools when transient recovery tools are opted out", async () => {
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
        expect(activeTools).toEqual([]);
        return attempt({ output: output("success", undefined, "done") });
      },
    });

    expect(result.status).toBe("success");
    expect(activeToolSets).toEqual([[], ["read", "bash"]]);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("disables and restores tools for an unresolved transient tool execution", async () => {
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
      recoveryConfig: recoveryConfig(),
      runOptions: {},
      logsDir: "/tmp/nonexistent-piclaw-test-logs",
      clearAttachments: () => {},
      runPromptAttempt: async () => {
        calls += 1;
        if (calls === 1) {
          return attempt({
            output: output("error", "WebSocket closed 1006 Connection ended"),
            snapshot: {
              hadToolActivity: true,
              hadPartialOutput: false,
              hadCompletedTurnOutput: false,
              hadTerminalTurnOutput: false,
              sawCompactionIntent: false,
              canDisableToolsForRecovery: true,
              hasUnresolvedToolExecution: true,
            },
            promptWasPersisted: true,
          });
        }
        expect(activeTools).toEqual([]);
        return attempt({ output: output("success", undefined, "done") });
      },
    });

    expect(result.status).toBe("success");
    expect(activeToolSets).toEqual([[], ["read", "bash"]]);
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("runs recovery compaction outside the initial elapsed budget before retrying", async () => {
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
        throw new Error("Nothing to compact (session too small)");
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
              hasUnresolvedToolExecution: true,
              toolExecutionCount: 2,
            },
            promptWasPersisted: true,
            toolExecutionCount: 2,
          });
        }
        expect(activeTools).toEqual([]);
        // Simulate an extension before_agent_start hook trying to auto-activate
        // a tool after recovery already disabled the tool set.
        sessionCtrl.setActiveToolsByName?.(["delegate"]);
        expect(activeTools).toEqual([]);
        return attempt({
          output: output("success", undefined, "recovered"),
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
    expect(compactCalls).toBe(1);
    expect(calls[1]?.prompt).toBe(RECOVERY_CONTINUATION_PROMPT);
    expect(calls[1]?.toolExecutionCountAtStart).toBe(2);
    expect(calls[1]?.timeoutMs).toBeGreaterThanOrEqual(20);
    expect(calls[1]?.timeoutMs).toBeLessThanOrEqual(25);
    expect(activeToolSets).toEqual([[], [], ["read", "bash"]]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "compaction_start", trigger: "recovery" }),
      expect.objectContaining({ type: "compaction_end", trigger: "recovery", willRetry: true }),
      expect.objectContaining({ type: "recovery_end", outcome: "recovered" }),
    ]));
  });

  test("refuses context-pressure recovery when tools cannot be disabled safely", async () => {
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
    expect(result.error).toContain("cannot control tools safely");
    expect(result.toolBudgetExceeded).toBeUndefined();
  });

  test("emergency-rotates and continues when recovery compaction fails", async () => {
    let calls = 0;
    let rotations = 0;
    const oldSession = { compact: async () => { throw new Error("Progressive compaction output invalid (stop_reason): completion stop reason was length; expected stop"); } } as any;
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

    expect(result.result).toBe("rotated after compaction failure");
    expect(rotations).toBe(1);
    expect(calls).toBe(2);
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
    expect(result.result).toBe("rotated");
    expect(rotations).toBe(1);
    expect(calls).toBe(2);
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
