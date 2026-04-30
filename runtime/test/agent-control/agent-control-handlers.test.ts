/**
 * test/agent-control/agent-control-handlers.test.ts – Tests for command handler dispatch.
 *
 * Exercises applyControlCommand() with various command types, verifying
 * correct handler selection, model registry interactions, state changes,
 * and error/success result formatting.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { withChatContext } from "../../src/core/chat-context.js";
import { listTrackedProcesses, registerProcess } from "../../src/utils/process-tracker.js";
import { getTestWorkspace, setEnv } from "../helpers.js";
import { DEFAULT_TEST_MODEL, TestAgentControlSession, cleanupRotatedSessionArtifacts, createTestModelRegistry, createTestSessionRuntime } from "./session-fixture.js";

let restoreEnv: (() => void) | null = null;
let restoreIdentityState: (() => void) | null = null;

// ── Config fixture ──────────────────────────────────────────────
// Tests that exercise config-writing handlers must never touch the real
// workspace config. Resolve the path lazily from the current test env and
// hard-fail if it ever points at /workspace/.piclaw/config.json.
let savedConfig: string | null = null;
let savedConfigPath: string | null = null;

function getConfigPath(): string {
  const configPath = resolve(process.env.PICLAW_WORKSPACE || "/workspace", ".piclaw", "config.json");
  if (configPath === "/workspace/.piclaw/config.json") {
    throw new Error("Refusing to use the production config path in tests");
  }
  return configPath;
}

function saveConfig() {
  const configPath = getConfigPath();
  savedConfigPath = configPath;
  try { savedConfig = readFileSync(configPath, "utf-8"); } catch { savedConfig = null; }
}

function restoreConfig() {
  if (!savedConfigPath) {
    savedConfig = null;
    return;
  }
  if (savedConfig !== null) {
    mkdirSync(dirname(savedConfigPath), { recursive: true });
    writeFileSync(savedConfigPath, savedConfig, "utf-8");
  } else {
    rmSync(savedConfigPath, { force: true });
  }
  savedConfig = null;
  savedConfigPath = null;
}

async function saveIdentityState() {
  const cfg = await import("../../src/core/config.js");
  const snapshot = { ...cfg.getIdentityConfig() };
  return () => {
    cfg.setAssistantName(snapshot.assistantName);
    cfg.setAssistantAvatar(snapshot.assistantAvatar);
    cfg.setUserName(snapshot.userName);
    cfg.setUserAvatar(snapshot.userAvatar);
    cfg.setUserAvatarBackground(snapshot.userAvatarBackground);
  };
}

beforeEach(async () => {
  restoreIdentityState = await saveIdentityState();
  saveConfig();
  cleanupRotatedSessionArtifacts(process.cwd());
});

afterEach(() => {
  cleanupRotatedSessionArtifacts(process.cwd());
  restoreEnv?.();
  restoreEnv = null;
  restoreIdentityState?.();
  restoreIdentityState = null;
  restoreConfig();
});

const registry = createTestModelRegistry([DEFAULT_TEST_MODEL]);

async function getControl() {
  const mod = await import("../../src/agent-control/index.js");
  return mod.applyControlCommand as (session: any, runtime: any, registry: any, command: any) => Promise<any>;
}

test("agent control info and mode commands", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);

  session.sessionFile = join(ws.data, "sessions", "web_default", "state-session.jsonl");
  mkdirSync(dirname(session.sessionFile), { recursive: true });
  writeFileSync(session.sessionFile, '{"type":"session","id":"state","version":3}\n');

  const state = await applyControlCommand(runtime as any, registry, { type: "state", raw: "/state" });
  expect(state.message).toContain("**Model**");
  expect(state.message).toContain("**File size**");

  const db = await import("../../src/db.js");
  db.initDatabase();
  db.storeTokenUsage({
    chat_jid: "web:default",
    run_at: new Date().toISOString(),
    input_tokens: 120,
    output_tokens: 30,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 150,
    cost_input: 0,
    cost_output: 0,
    cost_cache_read: 0,
    cost_cache_write: 0,
    cost_total: 0.15,
    provider: "openai",
    model: "gpt-test",
  });

  const stats = await withChatContext("web:default", "web", () =>
    applyControlCommand(runtime as any, registry, { type: "stats", raw: "/stats" })
  );
  expect(stats.message).toContain("**Session stats**");
  expect(stats.message).toContain("**Tracked usage (persisted)**");
  expect(stats.message).toContain("**Per provider**");
  expect(stats.message).toContain("**Per model**");

  const context = await applyControlCommand(runtime as any, registry, { type: "context", raw: "/context" });
  expect(context.message).toContain("**Context usage**");

  const last = await applyControlCommand(runtime as any, registry, { type: "last", raw: "/last" });
  expect(last.message).toContain("last response");

  const commands = await applyControlCommand(runtime as any, registry, { type: "commands", raw: "/commands" });
  expect(commands.message).toContain("/model");
  expect(commands.message).not.toContain("/test-card");
  expect(commands.message).toContain("/exit");
  expect(commands.message).toContain("/session-rotate");
  expect(commands.message).toContain("/ext");
  expect(commands.message).toContain("/template");
  expect(commands.message).toContain("/skill:demo");

  // sourceInfo provenance surfaces in /commands output
  expect(commands.message).toMatch(/\/ext.*user/);       // extension command shows scope
  expect(commands.message).toMatch(/\/skill:demo.*user/); // skill shows scope from sourceInfo

  const steering = await applyControlCommand(runtime as any, registry, { type: "steering_mode", mode: "all", raw: "/steering-mode all" });
  expect(steering.message).toContain("all");
  expect(session.steeringModeCalls).toContain("all");

  const followup = await applyControlCommand(runtime as any, registry, { type: "followup_mode", mode: "all", raw: "/followup-mode all" });
  expect(followup.message).toContain("all");
  expect(session.followUpModeCalls).toContain("all");
});

test("agent control state shows oversized session warning", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);
  session.sessionFile = join(ws.data, "sessions", "web_default", "oversized-session.jsonl");
  mkdirSync(dirname(session.sessionFile), { recursive: true });
  writeFileSync(session.sessionFile, '{"type":"session","id":"oversized","version":3}\n');
  truncateSync(session.sessionFile, 101 * 1024 * 1024);

  const state = await applyControlCommand(runtime as any, registry, { type: "state", raw: "/state" });
  expect(state.message).toContain("Session file exceeds threshold");
  expect(state.message).toContain("Consider `/session-rotate`");
});

test("agent control session and tree commands", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);

  const sessionName = await applyControlCommand(runtime as any, registry, { type: "session_name", name: "My session", raw: "/session-name My session" });
  expect(sessionName.message).toContain("My session");

  const newSession = await applyControlCommand(runtime as any, registry, { type: "new_session", raw: "/new-session" });
  expect(newSession.message).toContain("new session");

  const switchSession = await applyControlCommand(runtime as any, registry, { type: "switch_session", path: "path/to/session", raw: "/switch-session path/to/session" });
  expect(switchSession.message).toContain("Switched to session");

  session.sessionName = "Carry forward";
  session.sessionFile = join(ws.data, "sessions", "web_default", "active-session.jsonl");
  mkdirSync(dirname(session.sessionFile), { recursive: true });
  writeFileSync(session.sessionFile, '{"type":"session","id":"active","version":3}\n{"type":"message","id":"m1","parentId":null,"timestamp":"2026-03-14T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}],"provider":"openai","model":"gpt-test","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1}}\n');
  const rotated = await applyControlCommand(runtime as any, registry, { type: "session_rotate", instructions: "keep active work", raw: "/session-rotate keep active work" });
  expect(rotated.status).toBe("success");
  expect(rotated.message).toContain("Session rotated.");
  expect(rotated.message).toContain("Archived previous session:");
  expect(rotated.message).toContain("New session:");
  expect(rotated.message).toContain("Compaction before rotate: yes");
  expect(session.compactCalls).toBe(1);
  expect(existsSync(session.sessionFile)).toBe(true);
  expect(existsSync(join(ws.data, "sessions", "web_default", "active-session.jsonl"))).toBe(false);
  expect(existsSync(join(ws.data, "sessions", "web_default", "archive", "active-session.jsonl"))).toBe(true);
  expect(session.seededEntries.at(-1)?.some((entry) => entry[0] === "compaction")).toBe(true);

  const fork = await applyControlCommand(runtime as any, registry, { type: "fork", entryId: "entry-1", raw: "/fork entry-1" });
  expect(fork.message).toContain("Selected");

  const clone = await applyControlCommand(runtime as any, registry, { type: "clone", raw: "/clone" });
  expect(clone.message).toContain("Selected");

  const forks = await applyControlCommand(runtime as any, registry, { type: "forks", raw: "/forks" });
  expect(forks.message).toContain("Forkable messages:");

  const exportHtml = await applyControlCommand(runtime as any, registry, { type: "export_html", raw: "/export-html" });
  expect(exportHtml.message).toContain("Exported session");

  const tree = await applyControlCommand(runtime as any, registry, { type: "tree", raw: "/tree" });
  expect(tree.message).toBe("");
  expect(tree.contentBlocks?.[0]).toMatchObject({
    type: "generated_widget",
    artifact: { kind: "session_tree" },
  });

  const treeNav = await applyControlCommand(runtime as any, registry, { type: "tree", targetId: "entry-1", raw: "/tree entry-1" });
  expect(treeNav.message).toContain("Navigation complete");

  const label = await applyControlCommand(runtime as any, registry, { type: "label", targetId: "entry-1", label: "flag", raw: "/label entry-1 flag" });
  expect(label.message).toContain("Label set");
  expect(session.labelChanges.length).toBe(1);

  const labels = await applyControlCommand(runtime as any, registry, { type: "labels", raw: "/labels" });
  expect(labels.message).toContain("Labels:");
});

test("agent control queue, compact, and abort commands", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);

  session.agent.state.messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "call-1" }] },
    { role: "toolResult", toolCallId: "call-1" },
    { role: "toolResult", toolCallId: "call-orphan" },
  ];

  const compact = await applyControlCommand(runtime as any, registry, { type: "compact", instructions: "shorten", raw: "/compact shorten" });
  expect(compact.message).toContain("Compaction complete.");
  expect(compact.message).toContain("Removed 1 orphaned tool-result block before rewriting the session.");
  expect(compact.message).toContain("Attached: full compaction report (.md).");
  expect(compact.message).not.toContain("Summary:");
  expect(compact.message).not.toContain("Summary");
  expect(compact.mediaIds).toHaveLength(1);
  expect(session.agent.state.messages).toEqual([
    { role: "assistant", content: [{ type: "toolCall", id: "call-1" }] },
    { role: "toolResult", toolCallId: "call-1" },
  ]);
  const compactMedia = db.getMediaById(compact.mediaIds![0]);
  expect(compactMedia?.filename).toMatch(/^compaction-report-.*\.md$/);
  expect(compactMedia?.content_type).toBe("text/markdown");
  const compactReport = compactMedia ? new TextDecoder().decode(compactMedia.data) : "";
  expect(compactReport).toContain("# Compaction report");
  expect(compactReport).toContain("## Summary");
  expect(compactReport).toContain("Summary");

  session.compactError = new Error("400 messages.2.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_test. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.");
  const compactCorruption = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
  expect(compactCorruption.status).toBe("error");
  expect(compactCorruption.message).toContain("⚠️ API error — the session may be corrupted");
  expect(compactCorruption.message).toContain("prunes orphaned tool-result blocks and corrupt image blocks automatically");
  session.compactError = null;

  const originalCompact = session.compact.bind(session);
  const restoreTimeoutEnv = setEnv({ PICLAW_COMPACTION_TIMEOUT_MS: "20" });
  try {
    session.compact = async () => {
      session.compactCalls += 1;
      session.isCompacting = true;
      await new Promise(() => {});
      return { tokensBefore: 0, firstKeptEntryId: null, summary: "" } as any;
    };
    const compactTimeout = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
    expect(compactTimeout.status).toBe("error");
    expect(compactTimeout.message).toContain("Compaction timed out");
    expect(compactTimeout.message).toContain("session was not rewritten");
    expect(session.abortCompactionCalls).toBe(1);
  } finally {
    restoreTimeoutEnv();
    session.compact = originalCompact;
    session.isCompacting = false;
  }

  const autoCompact = await applyControlCommand(runtime as any, registry, { type: "auto_compact", enabled: true, raw: "/auto-compact on" });
  expect(autoCompact.message).toContain("on");
  expect(session.autoCompactionEnabled).toBe(true);

  const autoRetry = await applyControlCommand(runtime as any, registry, { type: "auto_retry", enabled: true, raw: "/auto-retry on" });
  expect(autoRetry.message).toContain("on");
  expect(session.autoRetryEnabled).toBe(true);

  registerProcess(999999);
  expect(listTrackedProcesses()).toContain(999999);

  const abort = await applyControlCommand(runtime as any, registry, { type: "abort", raw: "/abort" });
  expect(abort.message).toContain("Aborted current response");
  expect(abort.message).toContain("Killed 1 tracked tool process");
  expect(session.abortCalls).toBe(1);
  expect(listTrackedProcesses()).not.toContain(999999);

  session.isCompacting = true;
  const abortCompactionCallsBeforeAbort = session.abortCompactionCalls;
  const abortCompaction = await applyControlCommand(runtime as any, registry, { type: "abort", raw: "/abort" });
  expect(abortCompaction.message).toContain("Compaction aborted");
  expect(session.abortCompactionCalls).toBe(abortCompactionCallsBeforeAbort + 1);
  expect(session.abortCalls).toBe(1);
  session.isCompacting = false;

  const abortRetry = await applyControlCommand(runtime as any, registry, { type: "abort_retry", raw: "/abort-retry" });
  expect(abortRetry.message).toContain("Retry aborted");
  expect(session.abortRetryCalls).toBe(1);

  const abortBashNone = await applyControlCommand(runtime as any, registry, { type: "abort_bash", raw: "/abort-bash" });
  expect(abortBashNone.message).toContain("No bash command");

  session.isBashRunning = true;
  const abortBash = await applyControlCommand(runtime as any, registry, { type: "abort_bash", raw: "/abort-bash" });
  expect(abortBash.message).toContain("aborted");
  expect(session.abortBashCalls).toBe(1);

  const queued = await applyControlCommand(runtime as any, registry, { type: "queue", message: "queued text", raw: "/queue queued text" });
  expect(queued.message).toContain("Queued follow-up");
  expect(queued.queued_followup).toBe(true);
});

test("login config writes stay inside the overridden pi-agent dir", async () => {
  const ws = getTestWorkspace();
  const piAgentDir = join(ws.workspace, ".pi-agent-test");
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_PI_AGENT_DIR: piAgentDir,
  });

  mkdirSync(piAgentDir, { recursive: true });
  writeFileSync(join(piAgentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "old-key" } }, null, 2));

  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([{ provider: "openai", id: "gpt-test", name: "GPT Test", reasoning: true }]);
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const apiKeyResult = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "openai", method: "api_key", api_key: "new-key" })}`,
    raw: "/login __step2",
  });
  expect(apiKeyResult.status).toBe("success");
  expect(apiKeyResult.model_label).toBe("openai/gpt-test");
  expect(session.model?.provider).toBe("openai");
  expect(session.model?.id).toBe("gpt-test");
  const authBackups = readdirSync(piAgentDir).filter((name) => name.startsWith("auth.json.") && name.endsWith(".bak"));
  expect(authBackups.length).toBeGreaterThan(0);

  const configureResult = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "ollama", method: "configure", baseUrl: "http://127.0.0.1:11434/v1", modelId: "llama3:latest", modelIds: "qwen3:latest", contextWindow: "128000" })}`,
    raw: "/login __step2",
  });
  expect(configureResult.status).toBe("success");

  const modelsPath = join(piAgentDir, "models.json");
  expect(existsSync(modelsPath)).toBe(true);
  const modelsJson = JSON.parse(readFileSync(modelsPath, "utf-8"));
  expect(modelsJson.providers?.ollama?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  expect(modelsJson.providers?.ollama?.models?.map((entry: { id: string }) => entry.id)).toEqual(["llama3:latest", "qwen3:latest"]);
});

test("login refreshes model registry before activating newly authenticated provider models", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  let refreshCalls = 0;
  const loginRegistry = {
    authStorage: {
      get: (provider: string) => provider === "github-copilot" ? ({ type: "oauth" } as const) : undefined,
      set: () => {},
      reload: () => {},
    },
    refresh: () => { refreshCalls += 1; },
    getAvailable: () => [],
    getAll: () => refreshCalls > 0
      ? [{ provider: "github-copilot", id: "gpt-4.1", name: "GPT 4.1", reasoning: true }]
      : [],
  };
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const result = await applyControlCommand(runtime as any, loginRegistry as any, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "github-copilot", method: "oauth_check" })}`,
    raw: "/login __step2",
  });

  expect(refreshCalls).toBeGreaterThan(0);
  expect(result.status).toBe("success");
  expect(result.model_label).toBe("github-copilot/gpt-4.1");
  expect(session.model?.provider).toBe("github-copilot");
  expect(session.model?.id).toBe("gpt-4.1");
});

test("agent control cycle and agent identity commands", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const cycleRegistry = createTestModelRegistry([
    { provider: "openai", id: "gpt-test", reasoning: true, contextWindow: 200000 },
    { provider: "anthropic", id: "claude-test", reasoning: true, contextWindow: 200000 },
  ]);
  const session = new TestAgentControlSession(ws.workspace, cycleRegistry);
  const runtime = createTestSessionRuntime(session);

  const cycleModel = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_model", direction: "forward", raw: "/cycle-model" });
  expect(cycleModel.message).toContain("Model set to");

  session.isCompacting = true;
  const blockedCycleModel = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_model", direction: "forward", raw: "/cycle-model" });
  expect(blockedCycleModel.status).toBe("error");
  expect(blockedCycleModel.message).toContain("Auto-compaction is still running");
  session.isCompacting = false;

  const cycleThinking = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_thinking", raw: "/cycle-thinking" });
  expect(cycleThinking.message).toContain("Thinking level set");

  const maxOnOpenAi = await applyControlCommand(runtime as any, cycleRegistry, { type: "thinking", level: "max", raw: "/thinking max" });
  expect(maxOnOpenAi.status).toBe("error");
  expect(maxOnOpenAi.message).toContain("Unknown thinking level: max");

  session.model = { provider: "anthropic", id: "claude-opus-4-6", reasoning: true } as any;
  const maxOnAnthropic = await applyControlCommand(runtime as any, cycleRegistry, { type: "thinking", level: "max", raw: "/thinking max" });
  expect(maxOnAnthropic.status).toBe("success");
  expect(maxOnAnthropic.thinking_level).toBe("xhigh");
  expect(maxOnAnthropic.thinking_level_label).toBe("max");
  expect(maxOnAnthropic.message).toContain("Thinking level set to max");

  const agentName = await applyControlCommand(runtime as any, cycleRegistry, { type: "agent_name", name: "Pi", raw: "/agent-name Pi" });
  expect(agentName.message).toContain("Agent name set");

  const agentAvatar = await applyControlCommand(runtime as any, cycleRegistry, { type: "agent_avatar", avatar: "https://example.com/avatar.png", raw: "/agent-avatar https://example.com/avatar.png" });
  expect(agentAvatar.message).toContain("Agent avatar set");
});

test("agent control blocks undersized model switches and skips them while cycling", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const models = [
    { provider: "openai", id: "gpt-large", reasoning: true, contextWindow: 200000 },
    { provider: "openai", id: "gpt-small", reasoning: true, contextWindow: 128000 },
    { provider: "anthropic", id: "claude-large", reasoning: true, contextWindow: 256000 },
  ] as any[];
  const sizedRegistry = createTestModelRegistry(models);
  const session = new TestAgentControlSession(ws.workspace, sizedRegistry);
  const runtime = createTestSessionRuntime(session);

  let currentIndex = 0;
  session.model = models[currentIndex];
  session.getContextUsage = () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }) as any;
  session.setModel = async (model: any) => {
    session.model = model;
    const nextIndex = models.findIndex((entry) => entry.provider === model.provider && entry.id === model.id);
    if (nextIndex >= 0) currentIndex = nextIndex;
  };
  session.cycleModel = async () => {
    currentIndex = (currentIndex + 1) % models.length;
    session.model = models[currentIndex];
    return { model: session.model, thinkingLevel: "low", isScoped: false } as any;
  };

  const blockedModel = await applyControlCommand(runtime as any, sizedRegistry, {
    type: "model",
    provider: "openai",
    modelId: "gpt-small",
    raw: "/model openai/gpt-small",
  });
  expect(blockedModel.status).toBe("error");
  expect(blockedModel.message).toContain("Current context won’t fit");
  expect(session.model?.id).toBe("gpt-large");

  const cycledModel = await applyControlCommand(runtime as any, sizedRegistry, {
    type: "cycle_model",
    direction: "forward",
    raw: "/cycle-model",
  });
  expect(cycledModel.status).toBe("success");
  expect(cycledModel.model_label).toBe("anthropic/claude-large");
  expect(session.model?.id).toBe("claude-large");
});

test("agent control idempotent mode commands stay stable across repeats", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);

  const autoCompactFirst = await applyControlCommand(runtime as any, registry, { type: "auto_compact", enabled: true, raw: "/auto-compact on" });
  const autoCompactSecond = await applyControlCommand(runtime as any, registry, { type: "auto_compact", enabled: true, raw: "/auto-compact on" });
  expect(autoCompactFirst.status).toBe("success");
  expect(autoCompactSecond.status).toBe("success");
  expect(session.autoCompactionEnabled).toBe(true);

  const autoRetryFirst = await applyControlCommand(runtime as any, registry, { type: "auto_retry", enabled: false, raw: "/auto-retry off" });
  const autoRetrySecond = await applyControlCommand(runtime as any, registry, { type: "auto_retry", enabled: false, raw: "/auto-retry off" });
  expect(autoRetryFirst.status).toBe("success");
  expect(autoRetrySecond.status).toBe("success");
  expect(session.autoRetryEnabled).toBe(false);

  const steeringFirst = await applyControlCommand(runtime as any, registry, { type: "steering_mode", mode: "all", raw: "/steering-mode all" });
  const steeringSecond = await applyControlCommand(runtime as any, registry, { type: "steering_mode", mode: "all", raw: "/steering-mode all" });
  expect(steeringFirst.message).toContain("all");
  expect(steeringSecond.message).toContain("all");
  expect(session.steeringMode).toBe("all");

  const followupFirst = await applyControlCommand(runtime as any, registry, { type: "followup_mode", mode: "one-at-a-time", raw: "/followup-mode one" });
  const followupSecond = await applyControlCommand(runtime as any, registry, { type: "followup_mode", mode: "one-at-a-time", raw: "/followup-mode one" });
  expect(followupFirst.status).toBe("success");
  expect(followupSecond.status).toBe("success");
  expect(session.followUpMode).toBe("one-at-a-time");
});
