import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { ensureSessionDir } from "../../src/agent-pool/session.js";
import { getAttachmentRegistry } from "../../src/agent-pool/attachments.js";
import { setCompactionSettlementGraceForTests } from "../../src/agent-pool/compaction.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { createToolExecutionWatchdogHeartbeatController, runAgentPrompt } from "../../src/agent-pool/run-agent-orchestrator.js";
import { getAgentAbortCause, recordAgentAbortCause, resetAgentAbortProvenanceForTests } from "../../src/agent-pool/abort-provenance.js";
import { getRecoveryFinalizationReserveMs } from "../../src/agent-pool/run-agent-recovery-phase.js";
import { RECOVERY_CONTINUATION_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import { getSshConfig, initDatabase, setChatAutoCompactionWindow, upsertSshConfig } from "../../src/db.js";
import {
  resetProgressWatchdogForTests,
  scanForStalls,
  setProgressWatchdogTimeoutForTests,
} from "../../src/runtime/progress-watchdog.js";
import {
  getSessionStorageConfig,
  getToolUseMessageBudget,
  setSessionStorageConfig,
  setToolUseMessageBudget,
} from "../../src/core/config.js";
import {
  applyLiveSshConfig,
  hasLiveChatSshConnection,
  registerLiveChatSshSession,
  setSshConnectionResolverForTests,
  unregisterLiveChatSshSession,
} from "../../src/extensions/ssh-core.js";
import { setEnv } from "../helpers.js";

function createRuntime(session: any, retrySettings?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {
      settingsManager: {
        getRetrySettings: () => ({
          enabled: retrySettings?.enabled ?? true,
          maxRetries: retrySettings?.maxRetries ?? 3,
          baseDelayMs: retrySettings?.baseDelayMs ?? 2000,
          maxDelayMs: retrySettings?.maxDelayMs ?? 60000,
        }),
      },
    } as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {},
  } as any;
}

const tempLogsDirs: string[] = [];

function findAgentLogFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findAgentLogFiles(path);
    if (entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".log")) return [path];
    return [];
  });
}

function createTestLogsDir(): string {
  const logsDir = mkdtempSync(join(tmpdir(), "piclaw-run-agent-logs-"));
  tempLogsDirs.push(logsDir);
  return logsDir;
}

afterEach(() => {
  resetProgressWatchdogForTests();
  resetAgentAbortProvenanceForTests();
  setSshConnectionResolverForTests(null);
  while (tempLogsDirs.length > 0) {
    const logsDir = tempLogsDirs.pop();
    if (!logsDir) continue;
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test("runAgentPrompt clears stale abort provenance before starting a new turn", async () => {
  const chatJid = "web:stale-abort-provenance";
  recordAgentAbortCause(chatJid, "user_command", "agent_control.abort");

  const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0, skipPrePromptCompaction: true }, {
    getOrCreateRuntime: async () => { throw new Error("runtime unavailable"); },
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result).toMatchObject({ status: "error", error: "runtime unavailable" });
  expect(getAgentAbortCause(chatJid)).toBeNull();
});

test("runAgentPrompt consumes abort provenance on exceptional orchestration exit", async () => {
  const chatJid = "web:exceptional-abort-provenance";

  const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0, skipPrePromptCompaction: true }, {
    getOrCreateRuntime: async () => {
      recordAgentAbortCause(chatJid, "service_shutdown", "test.runtime_creation");
      throw new Error("runtime creation interrupted");
    },
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result).toMatchObject({ status: "error", error: "runtime creation interrupted" });
  expect(getAgentAbortCause(chatJid)).toBeNull();
});

test("runAgentPrompt aborts and returns an interrupted result when active progress goes stale", async () => {
  initDatabase();
  const restoreWatchdogTimeout = setProgressWatchdogTimeoutForTests(10);
  class StalledSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-stale" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    aborted = false;
    private releasePrompt: (() => void) | null = null;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.isStreaming = true;
      await new Promise<void>((resolve) => {
        this.releasePrompt = resolve;
      });
      this.isStreaming = false;
    }
    async abort() {
      this.aborted = true;
      this.releasePrompt?.();
    }
  }

  try {
    const session = new StalledSession();
    const logs: Array<Record<string, unknown>> = [];
    const run = runAgentPrompt("test", "web:stale-progress", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: (_message, details) => logs.push(details),
    });

    let stalls = scanForStalls(Date.now());
    for (let attempt = 0; stalls.length === 0 && attempt < 20; attempt += 1) {
      await Bun.sleep(10);
      stalls = scanForStalls(Date.now());
    }
    expect(stalls).toHaveLength(1);

    const result = await run;
    expect(session.aborted).toBe(true);
    expect(result.status).toBe("error");
    expect(result.error).toContain("Stale-progress watchdog interrupted");
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "run_agent.stale_progress_abort", chatJid: "web:stale-progress" }),
    ]));
  } finally {
    restoreWatchdogTimeout();
  }
});

test("runAgentPrompt reports stale-progress abort failures", async () => {
  initDatabase();
  const restoreWatchdogTimeout = setProgressWatchdogTimeoutForTests(10);
  class AbortFailingSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-stale-fail" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      await Bun.sleep(25);
    }
    async abort() {
      throw new Error("abort unavailable");
    }
  }

  try {
    const session = new AbortFailingSession();
    const run = runAgentPrompt("test", "web:stale-abort-fail", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: () => {},
    });

    let stalls = scanForStalls(Date.now());
    for (let attempt = 0; stalls.length === 0 && attempt < 20; attempt += 1) {
      await Bun.sleep(10);
      stalls = scanForStalls(Date.now());
    }
    expect(stalls).toHaveLength(1);
    const result = await run;
    expect(result.status).toBe("error");
    expect(result.error).toContain("failed to abort");
    expect(result.error).toContain("abort unavailable");
  } finally {
    restoreWatchdogTimeout();
  }
});

test("progress watchdog does not abort active runs that keep heartbeating", async () => {
  initDatabase();
  const restoreWatchdogTimeout = setProgressWatchdogTimeoutForTests(20);
  class ProgressingSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-progress" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    aborted = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (let i = 0; i < 3; i += 1) {
        await Bun.sleep(8);
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: i === 2 ? "done" : "." } });
        }
      }
    }
    async abort() {
      this.aborted = true;
    }
  }

  try {
    const session = new ProgressingSession();
    const run = runAgentPrompt("test", "web:progressing", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    await Bun.sleep(12);
    expect(scanForStalls(Date.now())).toHaveLength(0);
    const result = await run;
    expect(result.status).toBe("success");
    expect(session.aborted).toBe(false);
  } finally {
    restoreWatchdogTimeout();
  }
});

test("tool-execution watchdog heartbeat controller keeps pulsing while tools remain active", async () => {
  const beats: Array<Record<string, unknown> | undefined> = [];
  const controller = createToolExecutionWatchdogHeartbeatController("web:test", {
    heartbeat: (_chatJid, _phase, metadata) => {
      beats.push(metadata);
    },
    getIntervalMs: () => 10,
  });

  expect(controller.getActiveExecutionCount()).toBe(0);
  controller.handleEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash" });
  expect(controller.getActiveExecutionCount()).toBe(1);
  await Bun.sleep(35);
  controller.handleEvent({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash" });
  expect(controller.getActiveExecutionCount()).toBe(0);
  const beatCountAfterEnd = beats.length;
  await Bun.sleep(25);
  controller.stop();

  expect(beatCountAfterEnd).toBeGreaterThan(0);
  expect(beats[0]).toMatchObject({
    eventType: "tool_execution_watchdog_heartbeat",
    activeToolCount: 1,
    activeToolNames: ["bash"],
  });
  expect(beats).toHaveLength(beatCountAfterEnd);
});

function createAssistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  } as const;
}

test("runAgentPrompt clears live SSH tool redirection and stored profile at turn end", async () => {
  const chatJid = "web:ssh-turn-scope";
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-ssh" };
    model = { provider: "openai", id: "gpt-test", contextWindow: 1000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "message_end", message: createAssistantMessage("done") } });
      }
      return createAssistantMessage("done");
    }
  }

  setSshConnectionResolverForTests(async (_rawTarget, localCwd, localHome, port) => ({
    sshTarget: "agent@example.com",
    port,
    remoteCwd: "/srv/project",
    remoteHome: "/home/agent",
    localCwd,
    localHome,
    privateKeyPath: "/tmp/test-key",
    controlPath: "/tmp/test-control",
    strictHostKeyChecking: "yes",
    tempDir: "/tmp/piclaw-ssh-test",
  }) as any);

  initDatabase();
  upsertSshConfig({
    chat_jid: chatJid,
    ssh_target: "agent@example.com:/srv/project",
    ssh_port: 22,
    private_key_keychain: "ssh/piclaw",
    known_hosts_keychain: null,
    strict_host_key_checking: "yes",
  });
  await registerLiveChatSshSession(chatJid, { localCwd: "/workspace", localHome: "/home/agent" });
  await applyLiveSshConfig(chatJid, {
    target: "agent@example.com:/srv/project",
    port: 22,
    privateKeyKeychain: "ssh/piclaw",
    strictHostKeyChecking: "yes",
  });
  expect(hasLiveChatSshConnection(chatJid)).toBe(true);
  expect(getSshConfig(chatJid)?.ssh_target).toBe("agent@example.com:/srv/project");

  try {
    const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0, skipPrePromptCompaction: true }, {
      getOrCreateRuntime: async () => createRuntime(new StubSession()) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onInfo: () => {},
      onWarn: () => {},
      onError: () => {},
    });

    expect(result.status).toBe("success");
    expect(hasLiveChatSshConnection(chatJid)).toBe(false);
    expect(getSshConfig(chatJid)).toBeNull();
  } finally {
    await unregisterLiveChatSshSession(chatJid);
  }
});

test("runAgentPrompt uses the configured execution budget without requesting compaction on a 1.05M model", async () => {
  initDatabase();
  const previousBudget = getToolUseMessageBudget();
  setToolUseMessageBudget(48);
  class ToolCeilingSession {
    private listeners: Array<(event: any) => void> = [];
    compactCalls = 0;
    aborted = false;
    sessionManager = {
      getLeafId: () => "leaf-tool-ceiling",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "small prompt" }] }),
    };
    model = { provider: "github-copilot", id: "gpt-5.6-sol", contextWindow: 1_050_000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    getContextUsage = () => ({ tokens: 181_080 });
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      const toolCalls = Array.from({ length: 48 }, (_, index) => ({ type: "toolCall", id: `tool-${index}`, name: "read" }));
      for (const listener of this.listeners) {
        listener({ type: "message_end", message: { role: "assistant", content: toolCalls, stopReason: "toolUse", usage: { inputTokens: 181_080 } } });
        for (let index = 0; index < 48; index += 1) {
          listener({
            type: "tool_execution_end",
            toolCallId: `tool-${index}`,
            toolName: "read",
            isError: false,
            result: { content: [{ type: "text", text: "ok" }] },
          });
        }
      }
    }
    async abort() {
      this.aborted = true;
    }
  }

  const session = new ToolCeilingSession();
  const logs: Array<Record<string, unknown>> = [];
  const result = await runAgentPrompt("test", "web:tool-ceiling-no-context-pressure", {
    timeoutMs: 0,
    skipPrePromptCompaction: true,
  }, {
    getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 1 }) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
    onWarn: (_message, details) => logs.push(details),
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("Tool-use budget exceeded before finalization (48/48 tool steps)");
  expect(result.toolStepsUsed).toBe(48);
  expect(result.toolStepsBudget).toBe(48);
  expect(result.recovery).toEqual(expect.objectContaining({
    attemptsUsed: 0,
    exhausted: true,
    recovered: false,
    lastClassifier: "tool_history_pressure",
    strategyHistory: [],
  }));
  expect(session.aborted).toBe(true);
  expect(session.compactCalls).toBe(0);
  expect(logs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      operation: "run_agent.mid_turn_tool_ceiling",
      reason: "mid_turn_tool_execution_hard_ceiling",
      contextTokens: 199_215,
      thresholdTokens: 836_800,
      configuredBudget: 48,
    }),
  ]));
  setToolUseMessageBudget(previousBudget);
});

test("runAgentPrompt projects only tool-result tokens not yet reflected by the estimator", async () => {
  initDatabase();
  const restoreEnv = setEnv({ PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "2" });

  class CatchingUpEstimatorSession {
    private listeners: Array<(event: any) => void> = [];
    private usageTokens = 10_000;
    private entryCount = 0;
    sessionManager = {
      getLeafId: () => "leaf-catching-up-estimator",
      getEntries: () => Array.from({ length: this.entryCount }),
      buildSessionContext: () => ({ messages: [{ role: "user", content: "small prompt" }] }),
    };
    model = { provider: "test", id: "large-context", contextWindow: 1_000_000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    getContextUsage = () => ({ tokens: this.usageTokens });
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt() {
      for (let index = 0; index < 2; index += 1) {
        if (index > 0) {
          // The next assistant tool-call message grows context independently
          // of tool results and must not mask the next result projection.
          this.usageTokens += 500;
          this.entryCount += 1;
        }
        for (const listener of this.listeners) {
          listener({ type: "message_start", message: { role: "assistant" } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "toolCall", id: `tool-${index}`, name: "read" }],
              stopReason: "toolUse",
              usage: { inputTokens: this.usageTokens },
            },
          });
          listener({ type: "tool_execution_start", toolCallId: `tool-${index}`, toolName: "read" });
          listener({
            type: "tool_execution_end",
            toolCallId: `tool-${index}`,
            toolName: "read",
            isError: false,
            result: { content: [{ type: "text", text: "x".repeat(400) }] },
          });
        }
        this.usageTokens += 100;
        this.entryCount += 1;
      }
    }
    async abort() {}
  }

  try {
    const warnings: Array<Record<string, unknown>> = [];
    const result = await runAgentPrompt("test", "web:catching-up-estimator", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(new CatchingUpEstimatorSession(), { maxRetries: 0 }) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: (_message, details) => warnings.push(details),
    });

    expect(result.status).toBe("error");
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "run_agent.mid_turn_tool_ceiling",
        midTurnToolResultChars: 800,
        projectedAdditionalRawTokens: 100,
      }),
    ]));
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt applies mid-turn projections to body-after-prefix usage instead of total context", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_AUTO_COMPACTION_SCOPE: "body_after_prefix",
    PICLAW_COMPACTION_THRESHOLD_PERCENT: "80",
    PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: "0",
  });
  const chatJid = `web:scoped-mid-turn-${Date.now()}`;
  setChatAutoCompactionWindow(chatJid, { ordinal: 2, baselineTokens: 50_000, prefillTokens: 50_000 });

  class ScopedMidTurnSession {
    private listeners: Array<(event: any) => void> = [];
    aborted = false;
    sessionManager = {
      getLeafId: () => "leaf-scoped-mid-turn",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "prefix and body" }] }),
    };
    model = { provider: "github-copilot", id: "scoped-context", contextWindow: 100_000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    getContextUsage = () => ({ tokens: 70_000 });
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "tool_execution_end",
          toolCallId: "tool-scoped-1",
          toolName: "read",
          isError: false,
          result: { content: [{ type: "text", text: "ok" }] },
        });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
        listener({ type: "message_end", message: createAssistantMessage("done") });
      }
    }
    async abort() {
      this.aborted = true;
    }
  }

  try {
    const session = new ScopedMidTurnSession();
    const warnings: Array<Record<string, unknown>> = [];
    const result = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: (_message, details) => warnings.push(details),
    });

    expect(result.status).toBe("success");
    expect(session.aborted).toBe(false);
    expect(warnings.some((entry) => entry.operation === "run_agent.mid_turn_context_pressure")).toBe(false);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt emits turn-aware observability log metadata for turn and tool steps", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-obs",
      buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "context" }] }] }),
    };
    model = { provider: "openai", id: "gpt-test", contextWindow: 1000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "thinking..." } });
        listener({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read" }], stopReason: "toolUse", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } } });
        listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" } });
        listener({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", isError: false, durationMs: 12 });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
        listener({ type: "message_end", message: createAssistantMessage("done") });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const logs: Array<Record<string, unknown>> = [];
  const contextEvents: any[] = [];
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", {
    timeoutMs: 0,
    skipPrePromptCompaction: true,
    turnId: "turn-obs-1",
    onEvent: (event) => {
      if (event.type === "context_usage_update") contextEvents.push(event);
    },
  }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
    onInfo: (_message, details) => logs.push(details),
    onWarn: (_message, details) => logs.push(details),
  });

  expect(result.status).toBe("success");
  expect(logs).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: "run_agent.prompt", turnId: "turn-obs-1", sessionLeafId: "leaf-obs" }),
    expect.objectContaining({ operation: "tool.call.start", turnId: "turn-obs-1", toolCallId: "tool-1", sessionLeafId: "leaf-obs" }),
    expect.objectContaining({ operation: "tool.call.end", turnId: "turn-obs-1", toolCallId: "tool-1", durationMs: 12, sessionLeafId: "leaf-obs" }),
    expect.objectContaining({ operation: "run_agent.prompt_resolved", turnId: "turn-obs-1", sessionLeafId: "leaf-obs" }),
    expect.objectContaining({ operation: "run_agent.complete", turnId: "turn-obs-1", sessionLeafId: "leaf-obs" }),
  ]));
  expect(contextEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
    "prompt_start",
    "message_end",
    "tool_execution_start",
    "mid_turn_tool_result",
  ]));
  expect(contextEvents.every((event) => event.contextWindow === 1000 && typeof event.tokens === "number")).toBe(true);
});

test("runAgentPrompt aggregates deltas and returns pending attachments", async () => {
  const attachments = getAttachmentRegistry();
  attachments.clear("web:default");

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      attachments.register("web:default", {
        id: 1,
        name: "out.txt",
        contentType: "text/plain",
        size: 3,
        kind: "file",
        sourcePath: "/tmp/out.txt",
      });
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const forkStates: Array<string | null> = [];
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: (chatJid) => attachments.take(chatJid),
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: (chatJid) => attachments.clear(chatJid),
    takeAttachments: (chatJid) => attachments.take(chatJid),
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: (_chatJid, leafId) => {
      forkStates.push(leafId);
    },
    clearActiveForkBaseLeaf: () => {
      forkStates.push(null);
    },
  });

  expect(result.status).toBe("success");
  expect(result.result).toBe("hello world");
  expect(result.attachments).toHaveLength(1);
  expect(forkStates).toEqual(["leaf-1", null]);
});

test.skip("runAgentPrompt auto-compacts before prompting when estimated context exceeds the threshold", async () => {
  const calls: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: true,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(calls).toEqual(["compact", "prompt"]);
});

test("runAgentPrompt skips Piclaw pre-prompt compaction when requested by the caller", async () => {
  const calls: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: true,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0, skipPrePromptCompaction: true }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(calls).toEqual(["prompt"]);
});

test("runAgentPrompt suppresses upstream auto-compaction inside session.prompt", async () => {
  initDatabase();
  const calls: string[] = [];
  const warnings: Array<Record<string, unknown>> = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-upstream-auto",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "short" }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: true,
        reserveTokens: 25_000,
      }),
    };
    model = { contextWindow: 1_000_000, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async _checkCompaction() {
      calls.push("upstreamCheckCompaction");
      await this._runAutoCompaction("threshold", false);
    }
    async _runAutoCompaction() {
      calls.push("upstreamRunAutoCompaction");
      await new Promise(() => {});
    }
    async prompt() {
      calls.push("prompt");
      await this._checkCompaction("threshold");
      await this._runAutoCompaction("overflow", true);
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const originalCheckCompaction = session._checkCompaction;
  const originalRunAutoCompaction = session._runAutoCompaction;
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:upstream-auto-suppressed", {
    timeoutMs: 0,
    skipPrePromptCompaction: true,
  }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    onWarn: (_message, details) => warnings.push(details),
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(result.result).toBe("done");
  expect(calls).toEqual(["prompt"]);
  expect(warnings).toContainEqual(expect.objectContaining({
    operation: "run_agent.suppress_upstream_auto_compaction",
    chatJid: "web:upstream-auto-suppressed",
    method: "_checkCompaction",
    upstreamReason: "threshold",
  }));
  expect(warnings).toContainEqual(expect.objectContaining({
    operation: "run_agent.suppress_upstream_auto_compaction",
    chatJid: "web:upstream-auto-suppressed",
    method: "_runAutoCompaction",
    upstreamReason: "overflow",
  }));
  expect(session._checkCompaction).toBe(originalCheckCompaction);
  expect(session._runAutoCompaction).toBe(originalRunAutoCompaction);
});

test.skip("runAgentPrompt still pre-prompt compacts even when upstream auto-compaction is disabled", async () => {
  const calls: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: false,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  // Piclaw manages compaction at safe pre-prompt boundaries regardless of
  // upstream auto-compaction setting — compact fires before prompt.
  expect(calls).toEqual(["compact", "prompt"]);
});

test.skip("runAgentPrompt aborts a stuck pre-prompt compaction and continues", async () => {
  const restoreEnv = setEnv({ PICLAW_COMPACTION_TIMEOUT_MS: "20" });
  const calls: string[] = [];
  const compactionEvents: Array<{ type: string; errorMessage?: string }> = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({
        messages: [
          { role: "user", content: "x".repeat(200) },
        ],
      }),
    };
    settingsManager = {
      getCompactionSettings: () => ({
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: true,
        reserveTokens: 10,
      }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      calls.push("compact");
      this.isCompacting = true;
      await new Promise(() => {});
    }
    abortCompaction() {
      calls.push("abortCompaction");
      this.isCompacting = false;
    }
    async prompt() {
      calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
    }
    async abort() {
      calls.push("abort");
      this.isCompacting = false;
    }
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("test", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "compaction_start" || event.type === "compaction_end") {
          compactionEvents.push({
            type: event.type,
            errorMessage: (event as { errorMessage?: string }).errorMessage,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("done");
    expect(calls).toEqual(["compact", "abortCompaction", "prompt"]);
    expect(compactionEvents).toEqual([
      { type: "compaction_start", errorMessage: undefined },
      { type: "compaction_end", errorMessage: "Pre-prompt compaction failed: Compaction timed out after 0.0s" },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt refuses to prompt a session when pre-prompt timeout emergency rotation fails", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_COMPACTION_TIMEOUT_MS: "1",
    PICLAW_COMPACTION_THRESHOLD_PERCENT: "1",
  });
  const restoreSettlementGrace = setCompactionSettlementGraceForTests(0);
  const calls: string[] = [];

  class StuckSession {
    sessionManager = {
      getLeafId: () => "leaf-stuck",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = { getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }) };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe() { return () => {}; }
    async compact() {
      calls.push("compact");
      this.isCompacting = true;
      await new Promise(() => {});
    }
    abortCompaction() {
      calls.push("abortCompaction");
      // Simulate a never-settling physical compaction that keeps the session
      // unsafe for rotation/prompting after the timeout wrapper returns.
      this.isCompacting = true;
    }
    async prompt() {
      calls.push("prompt");
    }
  }

  try {
    const session = new StuckSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("test", "web:stuck-rotation", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Refusing to prompt a session that may still be physically compacting");
    expect(calls).toEqual(["compact", "abortCompaction"]);
  } finally {
    restoreSettlementGrace();
    restoreEnv();
  }
}, 10_000);

test("runAgentPrompt suppresses auto-compaction under backoff and refuses unsafe prompt when emergency rotation fails", async () => {
  const restoreEnv = setEnv({
    PICLAW_COMPACTION_TIMEOUT_MS: "20",
    PICLAW_COMPACTION_BACKOFF_BASE_MS: "600000",
    PICLAW_COMPACTION_BACKOFF_MAX_MS: "600000",
  });
  const chatJid = `web:compaction-backoff-${Date.now()}`;
  const db = await import("../../src/db.js");
  db.initDatabase();
  const compactionEvents: string[] = [];

  class FailingSession {
    private listeners: Array<(event: any) => void> = [];
    private _compactReject: ((err: Error) => void) | null = null;
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.isCompacting = true;
      await new Promise<void>((_resolve, reject) => { this._compactReject = reject; });
    }
    abortCompaction() {
      this.isCompacting = false;
      this._compactReject?.(new Error("Compaction cancelled"));
      this._compactReject = null;
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "first" } });
      }
    }
    async abort() {
      this.isCompacting = false;
    }
  }

  class SuppressedSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.calls.push("compact");
    }
    async prompt() {
      this.calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "second" } });
      }
    }
    async abort() {}
  }

  try {
    const turnCoordinator = new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} });
    await runAgentPrompt("test", chatJid, { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(new FailingSession()) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(db.getChatCompactionBackoff(chatJid)).toEqual(expect.objectContaining({ failureCount: 1 }));

    const secondSession = new SuppressedSession();
    const secondResult = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "compaction_suppressed") compactionEvents.push(String((event as any).type));
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(secondSession) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(secondResult.status).toBe("error");
    expect(secondResult.error).toContain("Refusing to prompt a session");
    expect(secondSession.calls).toEqual([]);
    expect(compactionEvents).toEqual(["compaction_suppressed"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt records pre-prompt cancellation backoff while still prompting", async () => {
  const restoreEnv = setEnv({
    PICLAW_COMPACTION_BACKOFF_BASE_MS: "600000",
    PICLAW_COMPACTION_BACKOFF_MAX_MS: "600000",
  });
  const chatJid = `web:compaction-cancel-${Date.now()}`;
  const db = await import("../../src/db.js");
  db.initDatabase();

  class CancellingSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.calls.push("compact");
      throw new Error("Compaction cancelled");
    }
    async prompt() {
      this.calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new CancellingSession();
    const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("ok");
    expect(session.calls).toEqual(["compact", "prompt"]);
    expect(db.getChatCompactionBackoff(chatJid)).toEqual(expect.objectContaining({
      failureCount: 1,
      lastErrorMessage: "Compaction cancelled",
    }));
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt suppresses active cancellation backoff and prompts without re-compacting", async () => {
  const restoreEnv = setEnv({
    PICLAW_COMPACTION_BACKOFF_BASE_MS: "600000",
    PICLAW_COMPACTION_BACKOFF_MAX_MS: "600000",
  });
  const chatJid = `web:compaction-cancel-backoff-${Date.now()}`;
  const db = await import("../../src/db.js");
  db.initDatabase();
  db.setChatCompactionBackoff(chatJid, {
    failureCount: 1,
    lastFailedAt: new Date(Date.now() - 1000).toISOString(),
    backoffUntil: new Date(Date.now() + 600_000).toISOString(),
    lastErrorMessage: "Compaction cancelled",
  });

  class StubSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.calls.push("compact");
    }
    async prompt() {
      this.calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("ok");
    expect(session.calls).toEqual(["prompt"]);
    expect(db.getChatCompactionBackoff(chatJid)).toEqual(expect.objectContaining({
      failureCount: 1,
      lastErrorMessage: "Compaction cancelled",
    }));
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt clears compaction backoff after a successful compaction", async () => {
  const restoreEnv = setEnv({
    PICLAW_COMPACTION_BACKOFF_BASE_MS: "600000",
    PICLAW_COMPACTION_BACKOFF_MAX_MS: "600000",
  });
  const chatJid = `web:compaction-clear-${Date.now()}`;
  const db = await import("../../src/db.js");
  db.initDatabase();
  db.setChatCompactionBackoff(chatJid, {
    failureCount: 2,
    lastFailedAt: "2024-03-20T00:00:00.000Z",
    backoffUntil: new Date(Date.now() - 60_000).toISOString(),
    lastErrorMessage: "Previous compaction timed out",
  });

  class StubSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.calls.push("compact");
    }
    async prompt() {
      this.calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("test", chatJid, { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(session.calls).toEqual(["compact", "prompt"]);
    expect(db.getChatCompactionBackoff(chatJid)).toBeNull();
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt runs idle auto-compaction before returning after a successful turn when enabled", async () => {
  const restoreEnv = setEnv({
    PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS: "5000",
  });
  const chatJid = `web:idle-compact-${Date.now()}`;

  class StubSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-idle",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.calls.push("prompt");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
      }
    }
    async compact() {
      this.calls.push("compact");
    }
    async abort() {}
  }

  const session = new StubSession();
  const events: Array<{ type: string; reason?: string }> = [];

  try {
    const result = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      scheduleIdleAutoCompaction: true,
      onEvent: (event) => {
        if (event.type === "compaction_start" || event.type === "compaction_end") {
          events.push({ type: String(event.type), reason: typeof (event as any).reason === "string" ? (event as any).reason : undefined });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(session.calls).toEqual(["prompt", "compact"]);
    expect(events).toEqual([
      { type: "compaction_start", reason: "idle" },
      { type: "compaction_end", reason: "idle" },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt runs post-turn idle auto-compaction after terminal tool completion when enabled", async () => {
  const restoreEnv = setEnv({
    PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS: "5000",
  });
  const chatJid = `web:idle-tool-complete-${Date.now()}`;

  class StubSession {
    calls: string[] = [];
    private listeners: Array<(event: any) => void> = [];
    private entries: Array<{ type: string; message?: { role: string } }> = [{ type: "message", message: { role: "user" } }];
    sessionManager = {
      getLeafId: () => "leaf-idle-tool-complete",
      getEntries: () => this.entries,
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.calls.push("prompt");
      this.entries.push({ type: "message", message: { role: "toolResult" } });
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "card-1", name: "send_adaptive_card", arguments: {} }],
          },
        });
        listener({ type: "tool_execution_start", toolCallId: "card-1", toolName: "send_adaptive_card", args: {} });
        listener({ type: "tool_execution_end", toolCallId: "card-1", toolName: "send_adaptive_card", isError: false, durationMs: 1 });
        listener({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [] } });
      }
    }
    async compact() {
      this.calls.push("compact");
    }
    async abort() {}
  }

  const session = new StubSession();
  const events: Array<{ type: string; reason?: string }> = [];

  try {
    const result = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      scheduleIdleAutoCompaction: true,
      onEvent: (event) => {
        if (event.type === "compaction_start" || event.type === "compaction_end") {
          events.push({ type: String(event.type), reason: typeof (event as any).reason === "string" ? (event as any).reason : undefined });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("tool_complete");
    expect(session.calls).toEqual(["prompt", "compact"]);
    expect(events).toEqual([
      { type: "compaction_start", reason: "idle" },
      { type: "compaction_end", reason: "idle" },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt runs post-turn idle auto-compaction after each successful turn that still exceeds the threshold", async () => {
  const restoreEnv = setEnv({
    PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS: "5000",
  });
  const chatJid = `web:idle-repeat-${Date.now()}`;

  class StubSession {
    promptCalls = 0;
    compactCalls = 0;
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-idle-cancel",
      buildSessionContext: () => ({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    };
    settingsManager = {
      getCompactionSettings: () => ({ ...DEFAULT_COMPACTION_SETTINGS, enabled: true, reserveTokens: 10 }),
    };
    model = { contextWindow: 20, provider: "test", id: "model" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `ok-${this.promptCalls}` } });
      }
    }
    async compact() {
      this.compactCalls += 1;
    }
    async abort() {}
  }

  const session = new StubSession();
  const options = {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  };

  try {
    const first = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      scheduleIdleAutoCompaction: true,
    }, options);
    const second = await runAgentPrompt("test", chatJid, {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      scheduleIdleAutoCompaction: true,
    }, options);

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(2);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt compacts and retries after OpenAI context-window 400 errors", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const events: any[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-openai-context" };
    model = { provider: "openai", id: "gpt-test", contextWindow: 128_000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        if (this.promptCalls === 1) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "OpenAI API error (400): 400 Your input exceeds the context window of this model. Please adjust your input and try again.",
              content: [],
            },
          });
        } else {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered" } });
        }
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("test", "web:openai-context-400", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end" || event.type === "compaction_start" || event.type === "compaction_end") {
          events.push(event);
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered");
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["recovery_start", "compaction_start", "compaction_end", "recovery_end"]);
    expect(events.find((event) => event.type === "compaction_end")).toEqual(expect.objectContaining({
      reason: "overflow",
      trigger: "recovery",
      piclawReason: "recovery",
      willRetry: true,
      aborted: false,
      source: "automatic_recovery",
    }));
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt compacts and retries after thrown OpenAI context-window 400 errors", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const events: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-openai-thrown-context" };
    model = { provider: "openai", id: "gpt-test", contextWindow: 128_000 };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        throw new Error("OpenAI API error (400): 400 Your input exceeds the context window of this model. Please adjust your input and try again.");
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered after throw" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("test", "web:openai-thrown-context-400", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end" || event.type === "compaction_start" || event.type === "compaction_end") {
          events.push(event.type);
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered after throw");
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(events).toEqual(["recovery_start", "compaction_start", "compaction_end", "recovery_end"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt does not auto-recover generic failures after tool activity", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const events: string[] = [];

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "write_file", args: { path: "x" } });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "draft",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "Timed out after 30s",
            content: [],
          },
        });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("test", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end" || event.type === "compaction_start" || event.type === "compaction_end") {
          events.push(event.type);
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Timed out after 30s");
    expect(result.recovery?.diagnostics[0]?.hasUnresolvedToolExecution).toBe(true);
    expect(session.promptCalls).toBe(1);
    expect(session.compactCalls).toBe(0);
    expect(events).toEqual([]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt prompts the rotated runtime session after auto-rotation swaps objects", async () => {
  const workspaceBase = mkdtempSync(join(tmpdir(), "piclaw-run-agent-rotate-"));
  const restoreEnv = setEnv({
    PICLAW_WORKSPACE: workspaceBase,
    PICLAW_STORE: join(workspaceBase, "store"),
    PICLAW_DATA: join(workspaceBase, "data"),
    PICLAW_SESSION_AUTO_ROTATE: undefined,
    PICLAW_SESSION_MAX_SIZE_MB: undefined,
  });
  const previousSessionStorageConfig = getSessionStorageConfig();
  setSessionStorageConfig({ autoRotate: true, maxSizeMb: 1 });

  class SessionBeforeRotate {
    sessionManager: SessionManager;
    sessionFile: string | undefined;
    sessionName = "Before rotate";
    model = { provider: "openai", id: "gpt-test", reasoning: true } as const;
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    pendingMessageCount = 0;
    promptCalls = 0;

    constructor() {
      const sessionDir = ensureSessionDir("web:default");
      this.sessionManager = SessionManager.create(workspaceBase, sessionDir);
      this.sessionManager.appendMessage({ role: "user", content: "rotate me", timestamp: Date.now() } as const);
      this.sessionManager.appendMessage(createAssistantMessage("pre-rotation context"));
      this.sessionFile = this.sessionManager.getSessionFile();
      truncateSync(this.sessionFile!, 2 * 1024 * 1024);
    }

    subscribe() {
      return () => {};
    }

    async compact() {
      const firstKeptEntryId = this.sessionManager.getEntries()[0]?.id ?? "root";
      this.sessionManager.appendCompaction("rotation summary", firstKeptEntryId, 100);
      this.sessionFile = this.sessionManager.getSessionFile();
      return { summary: "rotation summary", firstKeptEntryId, tokensBefore: 100 };
    }

    async prompt() {
      this.promptCalls += 1;
      throw new Error("stale session should not be prompted after auto-rotation");
    }

    async abort() {}
  }

  class SessionAfterRotate {
    private listeners: Array<(event: any) => void> = [];
    sessionManager: SessionManager;
    sessionFile: string | undefined;
    sessionName = "After rotate";
    model = { provider: "openai", id: "gpt-test", reasoning: true } as const;
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    pendingMessageCount = 0;
    promptCalls = 0;

    constructor(sessionManager: SessionManager) {
      this.sessionManager = sessionManager;
      this.sessionFile = sessionManager.getSessionFile();
    }

    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }

    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "rotated ok" } });
      }
    }

    async abort() {}
  }

  try {
    const oldSession = new SessionBeforeRotate();
    let activeSession: SessionBeforeRotate | SessionAfterRotate = oldSession;
    const runtime = {
      get session() {
        return activeSession;
      },
      cwd: workspaceBase,
      diagnostics: [],
      services: {} as any,
      modelFallbackMessage: undefined,
      newSession: async (options?: { parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void> | void }) => {
        const manager = SessionManager.create(workspaceBase, ensureSessionDir("web:default"));
        manager.newSession({ parentSession: options?.parentSession });
        if (options?.setup) {
          await options.setup(manager);
        }
        activeSession = new SessionAfterRotate(manager);
        return { cancelled: false };
      },
      switchSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      importFromJsonl: async () => ({ cancelled: false }),
      dispose: async () => {},
    } as AgentSessionRuntime;

    const forkStates: Array<string | null> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("test", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => runtime as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: (_chatJid, leafId) => {
        forkStates.push(leafId);
      },
      clearActiveForkBaseLeaf: () => {
        forkStates.push(null);
      },
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("rotated ok");
    expect(oldSession.promptCalls).toBe(0);
    expect((activeSession as SessionAfterRotate).promptCalls).toBe(1);
    expect(forkStates).toHaveLength(2);
    expect(forkStates.at(-1)).toBe(null);
  } finally {
    setSessionStorageConfig({
      maxSizeMb: previousSessionStorageConfig.maxSizeMb,
      maxLines: previousSessionStorageConfig.maxLines,
      maxCompactionsBeforeRotation: previousSessionStorageConfig.maxCompactionsBeforeRotation,
      autoRotate: previousSessionStorageConfig.autoRotate,
    });
    restoreEnv();
    rmSync(workspaceBase, { recursive: true, force: true });
  }
});

test("runAgentPrompt retries a recoverable interrupted turn and returns one final success", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial draft" } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Response ended with an error before finalization",
              content: [],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered answer" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: string[] = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push(String(event.type));
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered answer");
    expect(result.recovery?.recovered).toBe(true);
    expect(result.recovery?.attemptsUsed).toBe(1);
    expect(result.recovery?.diagnostics).toEqual([
      expect.objectContaining({
        phase: "attempt_failure",
        attempt: 1,
        classifier: "transient",
        strategy: "retry",
        error: "Response ended with an error before finalization",
        hadPartialOutput: true,
      }),
    ]);
    expect(session.promptCalls).toBe(2);
    expect(recoveryEvents).toEqual(["recovery_start", "recovery_end"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt recovers a timeout-before-finalization when compaction was in progress", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({ type: "compaction_start", reason: "overflow" });
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "draft during compaction" } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Response timed out before finalization",
              content: [],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered after compaction" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryStarts: Array<{ classifier?: string; strategy?: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start") {
          recoveryStarts.push({
            classifier: (event as any).classifier,
            strategy: (event as any).strategy,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered after compaction");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      exhausted: false,
      lastClassifier: "context_pressure",
      strategyHistory: ["compact_then_retry"],
    }));
    expect(result.recovery?.diagnostics).toEqual([
      expect.objectContaining({
        phase: "attempt_failure",
        attempt: 1,
        classifier: "context_pressure",
        strategy: "compact_then_retry",
        error: "Response timed out before finalization",
        sawCompactionIntent: true,
      }),
    ]);
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(recoveryStarts).toEqual([{ classifier: "context_pressure", strategy: "compact_then_retry" }]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt starts the recovery budget after the first failed attempt", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async compact() {
      this.compactCalls += 1;
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        now += 120_000;
        for (const listener of this.listeners) {
          listener({ type: "compaction_start", reason: "overflow" });
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "draft during slow compaction" } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Response timed out before finalization",
              content: [],
            },
          });
        }
        return;
      }
      now += 1_000;
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered after delayed first attempt" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered after delayed first attempt");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      exhausted: false,
      lastClassifier: "context_pressure",
      strategyHistory: ["compact_then_retry"],
    }));
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
  } finally {
    Date.now = originalDateNow;
    restoreEnv();
  }
});

test("runAgentPrompt gives compact_then_retry a full continuation budget after a long initial attempt and compaction", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-long-initial" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async compact() {
      this.compactCalls += 1;
      now += 60_000;
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        now += 120_000;
        throw new Error("maximum context length exceeded after a long initial request");
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "continued after bounded recovery" } });
        listener({ type: "message_end", message: createAssistantMessage("continued after bounded recovery") });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} });
    const attemptTimeouts: number[] = [];
    const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
    turnCoordinator.startPromptTimeout = ((promptSession: any, chatJid: string, timeoutMs: number) => {
      attemptTimeouts.push(timeoutMs);
      return originalStartPromptTimeout(promptSession, chatJid, timeoutMs);
    }) as any;

    const result = await runAgentPrompt("large turn", "web:long-initial-recovery", { timeoutMs: 180_000 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("continued after bounded recovery");
    expect(result.recovery).toEqual(expect.objectContaining({ attemptsUsed: 1, recovered: true, lastClassifier: "context_pressure" }));
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(attemptTimeouts).toEqual([180_000, 30_000]);
  } finally {
    Date.now = originalDateNow;
    restoreEnv();
  }
});

test("recovery finalization reserve scales with continuation budgets", () => {
  expect(getRecoveryFinalizationReserveMs(1)).toBe(0);
  expect(getRecoveryFinalizationReserveMs(30)).toBe(15);
  expect(getRecoveryFinalizationReserveMs(10_000)).toBe(5_000);
  expect(getRecoveryFinalizationReserveMs(30_000)).toBe(5_000);
  expect(getRecoveryFinalizationReserveMs(360_000)).toBe(54_000);
  expect(getRecoveryFinalizationReserveMs(600_000)).toBe(60_000);
});

test("runAgentPrompt reserves the tail of compact_then_retry for a tools-disabled final reply", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "read"];
    private releaseContinuation: (() => void) | null = null;
    sessionManager = { getLeafId: () => "leaf-finalization-reserve" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    toolSets: string[][] = [];
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) {
      this.activeTools = [...names];
      this.toolSets.push([...names]);
      if (this.promptCalls === 2 && names.length === 0) this.releaseContinuation?.();
    }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async compact() { this.compactCalls += 1; }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) throw new Error("maximum context length exceeded before retry");
      await new Promise<void>((resolve) => { this.releaseContinuation = resolve; });
      expect(this.activeTools).toEqual([]);
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Final answer from the reserved window." } });
        listener({ type: "message_end", message: createAssistantMessage("Final answer from the reserved window.") });
      }
    }
    async abort() { this.releaseContinuation?.(); }
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("large turn", "web:finalization-reserve", { timeoutMs: 30 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Final answer from the reserved window.");
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(session.toolSets).toContainEqual([]);
    expect(session.getActiveToolNames()).toEqual(["bash", "read"]);
  } finally {
    restoreEnv();
  }
}, 5_000);

test("runAgentPrompt bounds the compact_then_retry continuation attempt timeout", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-bounded-continuation" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    abortCalls = 0;
    private releasePrompt: (() => void) | null = null;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async compact() { this.compactCalls += 1; }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) throw new Error("maximum context length exceeded before retry");
      await new Promise<void>((resolve) => { this.releasePrompt = resolve; });
    }
    async abort() {
      this.abortCalls += 1;
      this.releasePrompt?.();
      this.releasePrompt = null;
    }
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} });
    const attemptTimeouts: number[] = [];
    const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
    turnCoordinator.startPromptTimeout = ((promptSession: any, chatJid: string, timeoutMs: number) => {
      attemptTimeouts.push(timeoutMs);
      return originalStartPromptTimeout(promptSession, chatJid, timeoutMs);
    }) as any;

    const result = await runAgentPrompt("large turn", "web:bounded-continuation", { timeoutMs: 30 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Timed out after");
    expect(result.recovery).toEqual(expect.objectContaining({ attemptsUsed: 1, exhausted: true, lastClassifier: "budget_exhausted" }));
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(1);
    expect(session.abortCalls).toBe(1);
    expect(attemptTimeouts[0]).toBe(30);
    expect(attemptTimeouts[1]).toBeGreaterThan(0);
    expect(attemptTimeouts[1]).toBeLessThanOrEqual(30);
  } finally {
    restoreEnv();
  }
}, 5_000);

test("runAgentPrompt does not reset continuation budget across repeated compact_then_retry cycles", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "3",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "100",
  });
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-multi-cycle" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    abortCalls = 0;
    private releasePrompt: (() => void) | null = null;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async compact() {
      this.compactCalls += 1;
      // Compaction has its own timeout and does not consume continuation prompt budget.
      now += 10_000;
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) throw new Error("maximum context length exceeded before first recovery");
      if (this.promptCalls === 2) {
        now += 40;
        throw new Error("maximum context length exceeded during continuation");
      }
      await new Promise<void>((resolve) => { this.releasePrompt = resolve; });
    }
    async abort() {
      this.abortCalls += 1;
      // The active continuation consumed the remaining 60ms recovery budget
      // before its timeout fired. Date.now is fake in this test, so advance it
      // explicitly when the timeout aborts the hanging prompt.
      if (this.promptCalls === 3) now += 60;
      this.releasePrompt?.();
      this.releasePrompt = null;
    }
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} });
    const attemptTimeouts: number[] = [];
    const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
    turnCoordinator.startPromptTimeout = ((promptSession: any, chatJid: string, timeoutMs: number) => {
      attemptTimeouts.push(timeoutMs);
      return originalStartPromptTimeout(promptSession, chatJid, timeoutMs);
    }) as any;

    const result = await runAgentPrompt("large turn", "web:multi-cycle-continuation-budget", { timeoutMs: 1_000 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Timed out after");
    expect(result.recovery).toEqual(expect.objectContaining({ attemptsUsed: 2, exhausted: true, lastClassifier: "budget_exhausted" }));
    expect(session.promptCalls).toBe(3);
    expect(session.compactCalls).toBe(2);
    expect(session.abortCalls).toBe(1);
    expect(attemptTimeouts[0]).toBe(1_000);
    expect(attemptTimeouts[1]).toBe(100);
    expect(attemptTimeouts[2]).toBeGreaterThan(0);
    expect(attemptTimeouts[2]).toBeLessThanOrEqual(60);
  } finally {
    Date.now = originalDateNow;
    restoreEnv();
  }
}, 5_000);

test("runAgentPrompt writes recovery diagnostics into the agent log", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial draft" } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Response ended with an error before finalization",
              content: [],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered answer" } });
      }
    }
    async abort() {}
  }

  const logsDir = createTestLogsDir();

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir,
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    const logFile = tempLogsDirs.find((entry) => entry === logsDir);
    expect(logFile).toBe(logsDir);
    const logFiles = findAgentLogFiles(logsDir);
    expect(logFiles.length).toBeGreaterThan(0);
    const content = readFileSync(logFiles.sort().slice(-1)[0], "utf8");
    expect(content).toContain("RecoveryAttemptsUsed: 1");
    expect(content).toContain("RecoveryRecovered: true");
    expect(content).toContain("RecoveryDiagnostics:");
    expect(content).toContain("Response ended with an error before finalization");
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt auto-compacts and retries when tool activity produced no text output", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    leafId = "leaf-1";
    sessionManager = { getLeafId: () => this.leafId };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    promptTexts: string[] = [];
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt(text: string) {
      this.promptCalls += 1;
      this.promptTexts.push(text);
      this.leafId = `leaf-attempt-${this.promptCalls}`;
      for (const listener of this.listeners) {
        listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "write_file", args: { path: "x" } });
        listener({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "maximum context length exceeded", content: [] } });
      }
    }
    async compact() {
      this.compactCalls += 1;
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("cannot control tools safely");
    expect(result.error).not.toContain("Tool-use budget exceeded");
    expect(session.promptCalls).toBe(1);
    expect(session.promptTexts).toEqual(["hello"]);
    expect(session.compactCalls).toBe(1);
    expect(result.recovery).toBeUndefined();
    expect(result).not.toMatchObject({
      toolBudgetExceeded: true,
    });
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt stops without compaction after tool-use budget exhaustion", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
    PICLAW_TURN_MAX_TOOL_USE_MESSAGES: undefined,
  });
  const previousToolUseBudget = getToolUseMessageBudget();
  setToolUseMessageBudget(8);

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          for (let i = 1; i <= 9; i += 1) {
            listener({
              type: "message_end",
              message: {
                role: "assistant",
                stopReason: "toolUse",
                content: [{ type: "toolCall", id: `tool-${i}`, name: "read", arguments: { path: `/tmp/${i}` } }],
              },
            });
            if (i < 9) {
              listener({ type: "tool_execution_start", toolCallId: `tool-${i}`, toolName: "read", args: { path: `/tmp/${i}` } });
              listener({ type: "tool_execution_end", toolCallId: `tool-${i}`, toolName: "read", isError: false });
            }
          }
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered after tool budget compaction" } });
      }
    }
    async compact() {
      this.compactCalls += 1;
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryStarts: Array<{ classifier?: string; strategy?: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start") {
          recoveryStarts.push({
            classifier: (event as any).classifier,
            strategy: (event as any).strategy,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Tool-use budget exceeded before finalization");
    expect(session.promptCalls).toBe(1);
    expect(session.compactCalls).toBe(0);
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 0,
      recovered: false,
      exhausted: true,
      lastClassifier: "tool_history_pressure",
      strategyHistory: [],
    }));
    expect(recoveryStarts).toEqual([]);
  } finally {
    setToolUseMessageBudget(previousToolUseBudget);
    restoreEnv();
  }
});

test("runAgentPrompt does not count tool-use messages without executions against the budget", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "1",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });
  const previousToolUseBudget = getToolUseMessageBudget();
  setToolUseMessageBudget(8);

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = {
      getLeafId: () => "leaf-1",
      getEntries: () => [],
    };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          for (let i = 1; i <= 9; i += 1) {
            listener({
              type: "message_end",
              message: {
                role: "assistant",
                stopReason: "toolUse",
                content: [{ type: "toolCall", id: `tool-${i}`, name: "read", arguments: { path: `/tmp/${i}` } }],
              },
            });
          }
        }
      }
    }
    async compact() {
      this.compactCalls += 1;
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEnds: Array<{ classifier?: string | null; errorMessage?: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_end") {
          recoveryEnds.push({
            classifier: (event as any).classifier,
            errorMessage: (event as any).errorMessage,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Prompt completed without emitting an assistant reply");
    expect(result.toolBudgetExceeded).not.toBe(true);
    expect(result.toolStepsUsed).toBeUndefined();
    expect(result.toolStepsBudget).toBeUndefined();
    expect(recoveryEnds).toEqual(expect.any(Array));
    expect(session.promptCalls).toBeGreaterThanOrEqual(1);
    expect(session.compactCalls).toBe(0);
  } finally {
    setToolUseMessageBudget(previousToolUseBudget);
    restoreEnv();
  }
});

test("runAgentPrompt reports repeated mid-turn tool ceiling aborts as visible tool-budget exhaustion", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "1",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
    PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "2",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-repeated-mid-turn-ceiling", getEntries: () => [] };
    agent = { state: { errorMessage: "Request was aborted." } };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    compactCalls = 0;
    abortCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        for (let i = 1; i <= 2; i += 1) {
          listener({ type: "tool_execution_start", toolCallId: `tool-${this.promptCalls}-${i}`, toolName: "grep", args: { pattern: "x" } });
          listener({
            type: "tool_execution_end",
            toolCallId: `tool-${this.promptCalls}-${i}`,
            toolName: "grep",
            isError: false,
            durationMs: 1,
            result: { content: [{ type: "text", text: `result ${this.promptCalls}-${i}` }] },
          });
        }
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "aborted",
            errorMessage: "Request was aborted.",
            content: [],
            usage: { input: 0, output: 0, totalTokens: 0 },
          },
        });
      }
    }
    async compact() {
      this.compactCalls += 1;
    }
    async abort() {
      this.abortCalls += 1;
    }
  }

  try {
    const session = new StubSession();
    const recoveryEnds: Array<{ classifier?: string | null; errorMessage?: string }> = [];
    const result = await runAgentPrompt("hello", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_end") {
          recoveryEnds.push({
            classifier: (event as any).classifier,
            errorMessage: (event as any).errorMessage,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Tool-use budget exceeded before finalization (2/2 tool steps)");
    expect(result.error).toContain("Ask me to continue");
    expect(result.toolBudgetExceeded).toBe(true);
    expect(result.toolStepsUsed).toBe(2);
    expect(result.toolStepsBudget).toBe(2);
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 0,
      exhausted: true,
      recovered: false,
      lastClassifier: "tool_history_pressure",
      strategyHistory: [],
    }));
    expect(result.recovery?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        classifier: "tool_history_pressure",
        sawCompactionIntent: false,
        toolExecutionCount: 2,
      }),
    ]));
    expect(recoveryEnds).toEqual([]);
    expect(session.promptCalls).toBe(1);
    expect(session.compactCalls).toBe(0);
    expect(session.abortCalls).toBe(1);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt reports maxToolCalls cap as tool-budget exhaustion with usage counts", async () => {
  initDatabase();

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-tool-call-cap", getEntries: () => [] };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    abortCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        for (let i = 1; i <= 2; i += 1) {
          listener({ type: "tool_execution_start", toolCallId: `tool-${i}`, toolName: "bash", args: { command: "echo hi" } });
          listener({
            type: "tool_execution_end",
            toolCallId: `tool-${i}`,
            toolName: "bash",
            isError: false,
            durationMs: 1,
            result: { content: [{ type: "text", text: `result ${i}` }] },
          });
        }
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "finished" }],
            usage: { input: 1, output: 1, totalTokens: 2 },
          },
        });
      }
    }
    async abort() {
      this.abortCalls += 1;
    }
  }

  const session = new StubSession();
  const result = await runAgentPrompt("hello", "web:default", {
    timeoutMs: 0,
    maxToolCalls: 2,
  }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("Tool-use budget exceeded before finalization (2/2 tool calls).");
  expect(result.error).toContain("Ask me to continue");
  expect(result.toolBudgetExceeded).toBe(true);
  expect(result.toolStepsUsed).toBe(2);
  expect(result.toolStepsBudget).toBe(2);
  expect(result.nextAction).toContain("resume from the latest known partial state");
  expect(session.abortCalls).toBe(1);
});

test("runAgentPrompt uses the configured mid-turn tool execution hard ceiling", async () => {
  initDatabase();
  const restoreEnv = setEnv({ PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "2" });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-mid-turn-ceiling" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    abortCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        for (let i = 1; i <= 2; i += 1) {
          listener({ type: "tool_execution_start", toolCallId: `tool-${i}`, toolName: "read", args: { path: `/tmp/${i}` } });
          listener({
            type: "tool_execution_end",
            toolCallId: `tool-${i}`,
            toolName: "read",
            isError: false,
            durationMs: 1,
            result: { content: [{ type: "text", text: `result ${i}` }] },
          });
        }
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done after configured ceiling" } });
        listener({ type: "message_end", message: createAssistantMessage("done after configured ceiling") });
      }
    }
    async compact() {}
    async abort() {
      this.abortCalls += 1;
    }
  }

  try {
    const session = new StubSession();
    const warnings: Array<Record<string, unknown>> = [];
    const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
      onWarn: (_message, details) => warnings.push(details),
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("done after configured ceiling");
    expect(session.abortCalls).toBe(1);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "run_agent.mid_turn_tool_ceiling",
        reason: "mid_turn_tool_execution_hard_ceiling",
        ceiling: 2,
        configuredBudget: 2,
        toolExecutionCount: 2,
      }),
    ]));
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt surfaces provider error instead of returning null result", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage:
              'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage."},"request_id":"req_abc123"}',
            content: [],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("invalid_request_error");
  expect(result.error).toContain("extra usage");
  expect(result.result).toBeNull();
});

test("runAgentPrompt does not retry deterministic orphan Responses output errors", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-orphan-output" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "OpenAI API error (400): No tool call found for function call output with call_id call_orphan.",
            content: [],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const result = await runAgentPrompt("continue", "web:orphan-output", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("error");
  expect(result.error).toContain("call_orphan");
  expect(result.recovery).toEqual(expect.objectContaining({
    attemptsUsed: 0,
    exhausted: true,
    lastClassifier: "session_corruption",
    strategyHistory: [],
  }));
  expect(session.promptCalls).toBe(1);
});

test("runAgentPrompt treats provider length stop as an error with preserved partial draft", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "partial answer",
            contentIndex: 0,
            partial: { content: [{ type: "text" }] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "length",
            content: [{ type: "text", text: "partial answer" }],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("error");
  expect(result.result).toBeNull();
  expect(result.error).toContain("maximum output length");
  expect(result.error).toContain("partial answer was preserved");
  expect(result.recovery?.lastClassifier).toBe("length_stop");
});

test("runAgentPrompt surfaces latent session state errors when no final text is emitted", async () => {
  const restoreEnv = setEnv({ PICLAW_TURN_AUTO_RECOVERY_ENABLED: "0" });
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    agent = { state: { errorMessage: "Error: HTTP 429 Too Many Requests (rate limit exceeded)" } };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  try {
    const result = await runAgentPrompt("hello", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session, { enabled: false }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("429");
    expect(result.error).toContain("rate limit");
    expect(result.result).toBeNull();
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt does not return commentary-only output as a completed reply", async () => {
  initDatabase();
  const restoreEnv = setEnv({ PICLAW_TURN_AUTO_RECOVERY_ENABLED: "0" });
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "progress update",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "progress update", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }],
          },
        });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const discarded: Array<{ reason: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("test", "web:default", {
      timeoutMs: 0,
      onTurnDiscard: (discard) => discarded.push(discard),
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { enabled: false }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.result).toBeNull();
    expect(result.error).toContain("without emitting an assistant reply");
    expect(discarded).toEqual([{ reason: "commentary_only" }]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt uses a later final answer after a commentary-only provider error", async () => {
  initDatabase();
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-commentary-error-recovered" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      const commentarySignature = JSON.stringify({ phase: "commentary" });
      const finalSignature = JSON.stringify({ phase: "final_answer" });
      for (const listener of this.listeners) {
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Searching saved output.",
            contentIndex: 0,
            partial: { content: [{ type: "text", textSignature: commentarySignature }] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "Temporary provider error; try again.",
            content: [{ type: "text", text: "Searching saved output.", textSignature: commentarySignature }],
          },
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_start",
            contentIndex: 1,
            partial: { content: [
              { type: "text", textSignature: commentarySignature },
              { type: "text", textSignature: finalSignature },
            ] },
          },
        });
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "The request completed successfully.",
            contentIndex: 1,
            partial: { content: [
              { type: "text", textSignature: commentarySignature },
              { type: "text", textSignature: finalSignature },
            ] },
          },
        });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [
              { type: "text", text: "Checking one last detail. ", textSignature: commentarySignature },
              { type: "text", text: "The request completed successfully.", textSignature: finalSignature },
            ],
          },
        });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const completed: Array<{ text: string }> = [];
  const discarded: Array<{ reason: string }> = [];
  const result = await runAgentPrompt("test", "web:default", {
    timeoutMs: 0,
    onTurnComplete: (turn) => completed.push({ text: turn.text }),
    onTurnDiscard: (discard) => discarded.push(discard),
  }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  expect(result.status).toBe("success");
  expect(result.result).toBe("The request completed successfully.");
  expect(completed).toEqual([]);
  expect(discarded).toEqual([{ reason: "commentary_only" }]);
});

test("runAgentPrompt retries a persisted commentary-only error instead of classifying it as completed output", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private leafId = "leaf-before-prompt";
    sessionManager = { getLeafId: () => this.leafId };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptTexts: string[] = [];
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt(text: string) {
      this.promptTexts.push(text);
      this.leafId = `leaf-after-prompt-${this.promptTexts.length}`;
      const commentarySignature = JSON.stringify({ phase: "commentary" });
      if (this.promptTexts.length === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: "Checking transient state.",
              contentIndex: 0,
              partial: { content: [{ type: "text", textSignature: commentarySignature }] },
            },
          });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Temporary provider error; try again.",
              content: [{ type: "text", text: "Checking transient state.", textSignature: commentarySignature }],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Recovered final answer." } });
        listener({ type: "message_end", message: createAssistantMessage("Recovered final answer.") });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const completed: Array<{ text: string }> = [];
    const discarded: Array<{ reason: string }> = [];
    const result = await runAgentPrompt("test", "web:default", {
      timeoutMs: 0,
      onTurnComplete: (turn) => completed.push({ text: turn.text }),
      onTurnDiscard: (discard) => discarded.push(discard),
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Recovered final answer.");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      lastClassifier: "transient",
      strategyHistory: ["retry"],
    }));
    expect(session.promptTexts).toEqual(["test", RECOVERY_CONTINUATION_PROMPT]);
    expect(completed).toEqual([]);
    expect(discarded).toEqual([{ reason: "commentary_only" }]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt continues with tools after a resolved side-effecting tool", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "write"];
    sessionManager = { getLeafId: () => "leaf-write-continuation" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    promptTexts: string[] = [];
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt(text: string) {
      this.promptCalls += 1;
      this.promptTexts.push(text);
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "tool-write", name: "write", arguments: { path: "/tmp/x", content: "done" } }] } });
          listener({ type: "tool_execution_start", toolCallId: "tool-write", toolName: "write", args: { path: "/tmp/x", content: "done" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-write", toolName: "write", isError: false });
          listener({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [] } });
        }
        return;
      }
      expect(this.activeTools).toEqual([]);
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Wrote /tmp/x successfully." } });
        listener({ type: "message_end", message: createAssistantMessage("Wrote /tmp/x successfully.") });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("write file", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Wrote /tmp/x successfully.");
    expect(session.promptTexts).toEqual(["write file", RECOVERY_CONTINUATION_PROMPT]);
    expect(session.getActiveToolNames()).toEqual(["bash", "write"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt treats terminal UI tool completion without final prose as informational", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-terminal-tool" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "tool-widget", name: "send_dashboard_widget", arguments: { html: "<div>ok</div>" } }],
          },
        });
        listener({ type: "tool_execution_start", toolCallId: "tool-widget", toolName: "send_dashboard_widget", args: { html: "<div>ok</div>" } });
        listener({ type: "tool_execution_end", toolCallId: "tool-widget", toolName: "send_dashboard_widget", isError: false });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("show widget", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({ type: String(event.type) });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("tool_complete");
    expect(result.error).toBeUndefined();
    expect(session.promptCalls).toBe(1);
    expect(recoveryEvents).toEqual([]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt does not let a terminal side-effect tool mask an earlier tool failure", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "exit_process"];
    sessionManager = { getLeafId: () => "leaf-terminal-side-effect" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      for (const listener of this.listeners) {
        listener({ type: "tool_execution_start", toolCallId: "tool-fail", toolName: "bash", args: { command: "false" } });
        listener({ type: "tool_execution_end", toolCallId: "tool-fail", toolName: "bash", isError: true });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "tool-exit", name: "exit_process", arguments: { reason: "restart" } }],
          },
        });
        listener({ type: "tool_execution_start", toolCallId: "tool-exit", toolName: "exit_process", args: { reason: "restart" } });
        listener({ type: "tool_execution_end", toolCallId: "tool-exit", toolName: "exit_process", isError: false });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("restart after deploy", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({ type: String(event.type) });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("without emitting an assistant reply before finalization");
    expect(session.promptCalls).toBe(1);
    expect(recoveryEvents).toEqual([]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt restores an accidentally empty active-tool set before an ordinary turn", async () => {
  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools: string[] = [];
    sessionManager = { getLeafId: () => "leaf-restored-tools" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt() {
      expect(this.activeTools).toContain("read");
      expect(this.activeTools).toContain("activate_tools");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Tools were restored." } });
        listener({ type: "message_end", message: createAssistantMessage("Tools were restored.") });
      }
    }
    async abort() {}
  }

  const session = new StubSession();
  const warnings: Array<{ message: string; details: Record<string, unknown> }> = [];
  const result = await runAgentPrompt("continue ordinary work", "web:default", { timeoutMs: 0 }, {
    getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
    turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
    onWarn: (message, details) => warnings.push({ message, details }),
  });

  expect(result).toMatchObject({ status: "success", result: "Tools were restored." });
  expect(warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      message: "Restored default tools after an empty active-tool set leaked into an ordinary turn",
      details: expect.objectContaining({ operation: "run_agent.restore_empty_tool_set" }),
    }),
  ]));
});

test("runAgentPrompt requests one tools-disabled closing reply after resolved tool work", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private entries: any[] = [{ id: "base", type: "message" }];
    sessionManager = {
      getLeafId: () => "leaf-draft-backed-tool-stop",
      getEntries: () => this.entries,
    };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    promptTexts: string[] = [];
    toolSets: string[][] = [];
    activeTools = ["bash", "read"];
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) {
      this.activeTools = [...names];
      this.toolSets.push([...names]);
    }
    async prompt(text: string) {
      this.promptCalls += 1;
      this.promptTexts.push(text);
      if (this.promptCalls > 1) {
        expect(this.activeTools).toEqual([]);
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Tests passed. The requested work is complete." } });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "stop",
              content: [{ type: "text", text: "Tests passed. The requested work is complete." }],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I will run the tests now." } });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [
              { type: "text", text: "I will run the tests now." },
              { type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "make test" } },
            ],
          },
        });
        this.entries.push({ id: "assistant-tool", type: "message" });
        listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "make test" } });
        listener({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash", isError: false });
        this.entries.push({ id: "tool-result", type: "message" });
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Tests passed; I am preparing the final summary." } });
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [],
          },
        });
        this.entries.push(...Array.from({ length: 113 }, (_, index) => ({ id: `entry-${index}`, type: "message" })));
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const completedTurns: Array<{ text: string; followedByToolUse?: boolean }> = [];
    const result = await runAgentPrompt("run tests", "web:default", {
      timeoutMs: 0,
      onTurnComplete: (turn) => completedTurns.push({ text: turn.text, followedByToolUse: turn.followedByToolUse }),
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({ type: String(event.type) });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Tests passed. The requested work is complete.");
    expect(session.promptCalls).toBe(2);
    expect(session.promptTexts).toEqual(["run tests", RECOVERY_CONTINUATION_PROMPT]);
    expect(session.toolSets).toEqual([[], ["bash", "read"]]);
    expect(completedTurns).toEqual([
      { text: "I will run the tests now.", followedByToolUse: true },
    ]);
    expect(recoveryEvents).toEqual([
      { type: "recovery_start" },
      { type: "recovery_end" },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt disables tools by default during transient recovery", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: undefined,
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "read"];
    sessionManager = { getLeafId: () => "leaf-timeout-continuation" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    promptTexts: string[] = [];
    toolSets: string[][] = [];
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) {
      this.activeTools = [...names];
      this.toolSets.push([...names]);
    }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt(text: string) {
      this.promptCalls += 1;
      this.promptTexts.push(text);
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [
                { type: "text", text: "I will inspect the logs." },
                { type: "toolCall", id: "tool-logs", name: "bash", arguments: { command: "journalctl" } },
              ],
            },
          });
          listener({ type: "tool_execution_start", toolCallId: "tool-logs", toolName: "bash", args: { command: "journalctl" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-logs", toolName: "bash", isError: true });
        }
        return;
      }
      expect(this.activeTools).toEqual([]);
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The log query failed, but the investigation found the recovery bug." } });
        listener({ type: "message_end", message: createAssistantMessage("The log query failed, but the investigation found the recovery bug.") });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });
    let timeoutStarts = 0;
    turnCoordinator.startPromptTimeout = (() => {
      timeoutStarts += 1;
      return {
        timeoutId: null,
        timedOutRef: { value: timeoutStarts === 1 },
        completedRef: { value: false },
      };
    }) as any;

    const result = await runAgentPrompt("inspect logs", "web:default", { timeoutMs: 3600000 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("The log query failed, but the investigation found the recovery bug.");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      lastClassifier: "transient",
      strategyHistory: ["retry"],
    }));
    expect(session.promptTexts).toEqual(["inspect logs", RECOVERY_CONTINUATION_PROMPT]);
    expect(session.toolSets).toContainEqual([]);
    expect(session.toolSets.at(-1)).toEqual(["bash", "read"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt does not start a generic retry after backoff exhausts the configured timeout", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "read"];
    sessionManager = { getLeafId: () => "leaf-generic-short-timeout-budget" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [{ type: "toolCall", id: "tool-synthetic-timeout", name: "bash", arguments: { command: "false" } }],
            },
          });
          listener({ type: "tool_execution_start", toolCallId: "tool-synthetic-timeout", toolName: "bash", args: { command: "false" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-synthetic-timeout", toolName: "bash", isError: true });
        }
        await Bun.sleep(70);
        throw new Error("Response timed out before finalization");
      }
      throw new Error("recovery attempt must not start after its budget is exhausted");
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });
    const attemptTimeouts: number[] = [];
    const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
    turnCoordinator.startPromptTimeout = ((promptSession: any, chatJid: string, timeoutMs: number) => {
      attemptTimeouts.push(timeoutMs);
      return originalStartPromptTimeout(promptSession, chatJid, timeoutMs);
    }) as any;

    const result = await runAgentPrompt("retry within remaining budget", "web:generic-short-timeout-budget", { timeoutMs: 100 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 50 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("Response timed out before finalization");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      exhausted: true,
      lastClassifier: "budget_exhausted",
    }));
    expect(session.promptCalls).toBe(1);
    expect(attemptTimeouts).toEqual([100]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt clamps a recovery attempt to the remaining short timeout budget", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "read"];
    sessionManager = { getLeafId: () => "leaf-short-timeout-budget" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    private resolveTimedOutPrompt: (() => void) | null = null;
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [{ type: "toolCall", id: "tool-timeout", name: "bash", arguments: { command: "false" } }],
            },
          });
          listener({ type: "tool_execution_start", toolCallId: "tool-timeout", toolName: "bash", args: { command: "false" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-timeout", toolName: "bash", isError: true });
        }
        await new Promise<void>((resolve) => { this.resolveTimedOutPrompt = resolve; });
        return;
      }
      expect(this.activeTools).toEqual(["bash", "read"]);
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Recovered within the short budget." } });
        listener({ type: "message_end", message: createAssistantMessage("Recovered within the short budget.") });
      }
    }
    async abort() {
      this.resolveTimedOutPrompt?.();
      this.resolveTimedOutPrompt = null;
    }
  }

  try {
    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });
    const attemptTimeouts: number[] = [];
    const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
    turnCoordinator.startPromptTimeout = ((promptSession: any, chatJid: string, timeoutMs: number) => {
      attemptTimeouts.push(timeoutMs);
      return originalStartPromptTimeout(promptSession, chatJid, timeoutMs);
    }) as any;

    const result = await runAgentPrompt("retry briefly", "web:short-timeout-budget", { timeoutMs: 100 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Recovered within the short budget.");
    expect(attemptTimeouts).toHaveLength(2);
    expect(attemptTimeouts[0]).toBe(100);
    expect(attemptTimeouts[1]).toBeGreaterThan(0);
    expect(attemptTimeouts[1]).toBeLessThan(100);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt keeps tools disabled across repeated opted-out continuation attempts", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "0",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "3",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    private activeTools = ["bash", "read"];
    sessionManager = { getLeafId: () => "leaf-repeated-continuation" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    promptTexts: string[] = [];
    getActiveToolNames() { return [...this.activeTools]; }
    setActiveToolsByName(names: string[]) { this.activeTools = [...names]; }
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter((entry) => entry !== listener); };
    }
    async prompt(text: string) {
      this.promptCalls += 1;
      this.promptTexts.push(text);
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "false" } }] } });
          listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "false" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash", isError: true });
        }
        throw new Error("Response timed out before finalization");
      }
      expect(this.activeTools).toEqual([]);
      if (this.promptCalls === 2) throw new Error("WebSocket closed 1006 Connection ended");
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Final continuation response." } });
        listener({ type: "message_end", message: createAssistantMessage("Final continuation response.") });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const result = await runAgentPrompt("do work", "web:default", { timeoutMs: 0 }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("Final continuation response.");
    expect(result.recovery).toEqual(expect.objectContaining({ attemptsUsed: 2, recovered: true }));
    expect(session.promptTexts).toEqual(["do work", RECOVERY_CONTINUATION_PROMPT, RECOVERY_CONTINUATION_PROMPT]);
    expect(session.getActiveToolNames()).toEqual(["bash", "read"]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt retries when provider stops after a read-only tool call without a final reply", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "/tmp/x" } }],
            },
          });
          listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "/tmp/x" } });
          listener({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", isError: false });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "stop",
              content: [],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "draft restored" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string; delayMs?: number }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("show me the draft", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({ type: String(event.type), delayMs: typeof (event as any).delayMs === "number" ? (event as any).delayMs : undefined });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("draft restored");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      lastClassifier: "transient",
      strategyHistory: ["retry"],
    }));
    expect(session.promptCalls).toBe(2);
    expect(recoveryEvents).toEqual([
      { type: "recovery_start", delayMs: 1 },
      { type: "recovery_end", delayMs: undefined },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt retries once when the provider stops after emitting thinking only", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls === 1) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "stop",
              content: [{ type: "thinking", thinking: "Planning document updates" }],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "final answer after retry" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string; classifier?: string; delayMs?: number }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("update docs", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({
            type: String(event.type),
            classifier: typeof (event as any).classifier === "string" ? (event as any).classifier : undefined,
            delayMs: typeof (event as any).delayMs === "number" ? (event as any).delayMs : undefined,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("final answer after retry");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      lastClassifier: "thinking_only_stop",
      strategyHistory: ["retry"],
    }));
    expect(session.promptCalls).toBe(2);
    expect(recoveryEvents).toEqual([
      { type: "recovery_start", classifier: "thinking_only_stop", delayMs: 1 },
      { type: "recovery_end", classifier: "thinking_only_stop", delayMs: undefined },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt uses existing retry settings for automatic recovery attempts", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      if (this.promptCalls < 3) {
        for (const listener of this.listeners) {
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "toolUse",
              content: [{ type: "toolCall", id: `tool-${this.promptCalls}`, name: "read", arguments: { path: "/tmp/x" } }],
            },
          });
          listener({ type: "tool_execution_start", toolCallId: `tool-${this.promptCalls}`, toolName: "read", args: { path: "/tmp/x" } });
          listener({ type: "tool_execution_end", toolCallId: `tool-${this.promptCalls}`, toolName: "read", isError: false });
          listener({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "stop",
              content: [],
            },
          });
        }
        return;
      }
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "eventually recovered" } });
      }
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string; attempt?: number; maxAttempts?: number; delayMs?: number }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("show me the draft", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({
            type: String(event.type),
            attempt: typeof (event as any).attempt === "number" ? (event as any).attempt : undefined,
            maxAttempts: typeof (event as any).maxAttempts === "number" ? (event as any).maxAttempts : undefined,
            delayMs: typeof (event as any).delayMs === "number" ? (event as any).delayMs : undefined,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("eventually recovered");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 2,
      recovered: true,
      strategyHistory: ["retry", "retry"],
    }));
    expect(recoveryEvents).toEqual([
      { type: "recovery_start", attempt: 1, maxAttempts: 5, delayMs: 1 },
      { type: "recovery_start", attempt: 2, maxAttempts: 5, delayMs: 2 },
      { type: "recovery_end", attempt: undefined, maxAttempts: undefined, delayMs: undefined },
    ]);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt disarms the prompt timeout as soon as prompt() resolves", async () => {
  let abortCalls = 0;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = true;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
      setTimeout(() => {
        this.isStreaming = false;
      }, 5);
    }
    async abort() {
      abortCalls += 1;
    }
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  let timeoutState: ReturnType<typeof turnCoordinator.startPromptTimeout> | null = null;
  const originalStartPromptTimeout = turnCoordinator.startPromptTimeout.bind(turnCoordinator);
  turnCoordinator.startPromptTimeout = ((...args: any[]) => {
    timeoutState = originalStartPromptTimeout(...args);
    return timeoutState!;
  }) as any;

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 50 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
    onInfo: (message) => {
      if (message !== "session.prompt() resolved" || !timeoutState) return;
      queueMicrotask(async () => {
        if (timeoutState?.completedRef.value) return;
        timeoutState.timedOutRef.value = true;
        await session.abort();
      });
    },
  });

  await Bun.sleep(20);

  expect(result.status).toBe("success");
  expect(result.result).toBe("done");
  expect(timeoutState?.completedRef.value).toBe(true);
  expect(abortCalls).toBe(0);
});

test("runAgentPrompt ignores a queued late-timeout callback after prompt completion", async () => {
  let abortCalls = 0;
  let timeoutState: {
    timeoutId: ReturnType<typeof setTimeout> | null;
    timedOutRef: { value: boolean };
    completedRef: { value: boolean };
  } | null = null;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-1" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      for (const listener of this.listeners) {
        listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
      }
      setTimeout(() => {
        if (!timeoutState || timeoutState.completedRef.value) return;
        timeoutState.timedOutRef.value = true;
        void this.abort();
      }, 0);
    }
    async abort() {
      abortCalls += 1;
    }
  }

  const session = new StubSession();
  const turnCoordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  turnCoordinator.startPromptTimeout = (() => {
    timeoutState = {
      timeoutId: null,
      timedOutRef: { value: false },
      completedRef: { value: false },
    };
    return timeoutState;
  }) as any;

  const result = await runAgentPrompt("test", "web:default", { timeoutMs: 1000 }, {
    getOrCreateRuntime: async () => createRuntime(session) as any,
    turnCoordinator,
    clearAttachments: () => {},
    takeAttachments: () => [],
    logsDir: createTestLogsDir(),
    setActiveForkBaseLeaf: () => {},
    clearActiveForkBaseLeaf: () => {},
  });

  await Bun.sleep(0);

  expect(result.status).toBe("success");
  expect(result.result).toBe("done");
  expect(abortCalls).toBe(0);
});
test("runAgentPrompt recovery loop guard numeric env rejects malformed suffixes", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "6",
    PICLAW_RECOVERY_LOOP_GUARD_ENABLED: "1",
    PICLAW_RECOVERY_LOOP_GUARD_MAX_FAILURES: "2oops",
    PICLAW_RECOVERY_LOOP_GUARD_WINDOW_MS: "600000oops",
  });

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    sessionManager = { getLeafId: () => "leaf-loop-guard" };
    isStreaming = false;
    isCompacting = false;
    isRetrying = false;
    promptCalls = 0;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }
    async prompt() {
      this.promptCalls += 1;
      throw new Error("Response timed out before finalization");
    }
    async abort() {}
  }

  try {
    const session = new StubSession();
    const recoveryEvents: Array<{ type: string; classifier?: string }> = [];
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("loop guard", "web:default", {
      timeoutMs: 0,
      onEvent: (event) => {
        if (event.type === "recovery_start" || event.type === "recovery_end") {
          recoveryEvents.push({
            type: String(event.type),
            classifier: typeof (event as any).classifier === "string" ? (event as any).classifier : undefined,
          });
        }
      },
    }, {
      getOrCreateRuntime: async () => createRuntime(session, { maxRetries: 6, baseDelayMs: 1, maxDelayMs: 60000 }) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir: createTestLogsDir(),
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.recovery).toEqual(expect.objectContaining({
      exhausted: true,
      lastClassifier: "recovery_suppressed",
    }));
    expect(session.promptCalls).toBe(3);
    expect(recoveryEvents).toEqual([
      { type: "recovery_start", classifier: "transient" },
      { type: "recovery_start", classifier: "transient" },
      { type: "recovery_end", classifier: "recovery_suppressed" },
    ]);
  } finally {
    restoreEnv();
  }
});
