/**
 * test/agent-control/agent-control-handlers.test.ts – Tests for command handler dispatch.
 *
 * Exercises applyControlCommand() with various command types, verifying
 * correct handler selection, model registry interactions, state changes,
 * and error/success result formatting.
 */

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { withChatContext } from "../../src/core/chat-context.js";
import { clearProviderUsageCache, warmProviderUsage } from "../../src/agent-pool/provider-usage.js";
import { listTrackedProcesses, registerProcess } from "../../src/utils/process-tracker.js";
import { getTestWorkspace, setEnv } from "../helpers.js";
import { DEFAULT_TEST_MODEL, TestAgentControlSession, cleanupRotatedSessionArtifacts, createTestAuthStorage, createTestModelRegistry, createTestSessionRuntime } from "./session-fixture.js";

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
  clearProviderUsageCache();
});

afterEach(() => {
  cleanupRotatedSessionArtifacts(process.cwd());
  restoreEnv?.();
  restoreEnv = null;
  restoreIdentityState?.();
  restoreIdentityState = null;
  restoreConfig();
  clearProviderUsageCache();
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
  expect(stats.message).toContain("**Per source**");
  expect(stats.message).toContain("| assistant | 150 | 0 | $0.15 | 1 |");
  expect(stats.message).toContain("**Per provider**");
  expect(stats.message).toContain("**Per model**");

  const coldQuota = await applyControlCommand(runtime as any, registry, { type: "quota", raw: "/quota" });
  expect(coldQuota.message).toBe("openai/gpt-test\nNo quota data available.");

  const authStorage = createTestAuthStorage();
  authStorage.set("zai", { type: "api_key", key: "test-key" });
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  const now = new Date("2026-06-25T12:00:00.000Z").getTime();
  Date.now = () => now;
  const fetchMock = mock(async () => new Response(JSON.stringify({
    data: {
      level: "Pro",
      limits: [
        { type: "TOKENS_LIMIT", percentage: 38, nextResetTime: now + 90 * 60 * 1000 },
        { type: "TIME_LIMIT", percentage: 59, nextResetTime: now + 48 * 60 * 60 * 1000 },
      ],
    },
  })));
  globalThis.fetch = fetchMock as any;
  try {
    await warmProviderUsage({ getAuth: async () => ({ auth: { apiKey: "test-key" } }) } as any, "zai");
    session.model = { provider: "zai", id: "glm-4.6", reasoning: true } as any;
    const warmQuota = await applyControlCommand(runtime as any, registry, { type: "quota", raw: "/quota" });
    expect(warmQuota.message).toBe("zai/glm-4.6\nPlan: Pro • 5h 62% • tools 41% • resets in ~1h 30m • resets in ~2d 0h");
  } finally {
    globalThis.fetch = previousFetch;
    Date.now = previousNow;
  }

  const context = await applyControlCommand(runtime as any, registry, { type: "context", raw: "/context" });
  expect(context.message).toContain("**Context usage**");
  expect(context.message).toContain("Provider-reported used");
  expect(context.message).toContain("Piclaw active estimate");
  expect(context.message).toContain("Auto-compaction scope");

  session.getContextUsage = () => ({ tokens: 100, contextWindow: 0, percent: null }) as any;
  const zeroWindowContext = await applyControlCommand(runtime as any, registry, { type: "context", raw: "/context" });
  expect(zeroWindowContext.message).toContain("Provider fill");
  expect(zeroWindowContext.message).toContain("unknown");
  expect(zeroWindowContext.message).not.toContain("Infinity");
  expect(zeroWindowContext.message).not.toContain("NaN");

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
  expect(rotated.status, rotated.message).toBe("success");
  expect(rotated.message).toContain("Session rotated.");
  expect(rotated.message).toContain("Archived previous session:");
  expect(rotated.message).toContain("New session:");
  expect(rotated.message).toContain("Compaction before rotate: yes");
  expect(session.compactCalls).toBe(1);
  expect(existsSync(session.sessionFile)).toBe(true);
  expect(existsSync(join(ws.data, "sessions", "web_default", "active-session.jsonl"))).toBe(false);
  expect(existsSync(join(ws.data, "sessions", "web_default", "archive", "active-session.jsonl"))).toBe(true);
  expect(session.seededEntries.at(-1)?.some((entry) => entry[0] === "compaction")).toBe(true);
  expect(session.seededEntries.at(-1)?.some((entry) => entry[0] === "thinking_level_change" && entry[1] === "low")).toBe(true);

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

test("provider-native compact report surfaces the marked readable checkpoint without opaque state", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();
  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);
  session.compact = async () => ({
    tokensBefore: 77399,
    estimatedTokensAfter: 19730,
    firstKeptEntryId: "entry-remote",
    summary: "[Piclaw provider-native compaction state. The opaque canonical context is injected at request time.]",
    details: {
      kind: "piclaw.remote_compaction",
      version: 1,
      adapter: "openai-responses-compact",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      output: [
        {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "Earlier context was compacted locally. Preserve this continuity state together with the following events:\n\n## Goal\nPreserve this readable checkpoint.",
          }],
        },
        { type: "compaction_summary", encrypted_content: "opaque-secret" },
      ],
      fileOperations: { read: [], written: [], edited: [] },
      createdAt: "2026-07-16T05:34:41.961Z",
    },
  }) as any;

  const compact = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
  expect(compact.status).toBe("success");
  const media = db.getMediaById(compact.mediaIds![0]);
  const report = media ? new TextDecoder().decode(media.data) : "";
  expect(report).toContain("## Readable continuity checkpoint");
  expect(report).toContain("## Goal\nPreserve this readable checkpoint.");
  expect(report).not.toContain("## Summary");
  expect(report).not.toContain("opaque-secret");
  expect(report).not.toContain("opaque canonical context is injected");
});

test("manual compaction context usage falls back to the safety-adjusted report estimate", async () => {
  const { resolveManualCompactionContextUsage } = await import("../../src/agent-control/handlers/control.js");
  const report = {
    tokensBefore: 77399,
    estimatedTokensAfter: 19730,
    estimatedTokensAfterSource: "upstream" as const,
    safetyAdjustedTokensAfter: 21703,
    reductionPercent: 74.5,
  };

  expect(resolveManualCompactionContextUsage({
    tokens: null,
    contextWindow: 200000,
    percent: null,
    estimated: true,
    source: "compact_command",
    phase: "after_manual_compaction",
  }, report)).toEqual({
    tokens: 21703,
    contextWindow: 200000,
    percent: 10.8515,
    estimated: true,
    source: "compaction_report",
    phase: "after_manual_compaction",
  });

  const measured = {
    tokens: 21000,
    contextWindow: 200000,
    percent: 10.5,
    estimated: true,
    source: "compact_command",
    phase: "after_manual_compaction",
  };
  expect(resolveManualCompactionContextUsage(measured, report)).toBe(measured);
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
  expect(compact.message).toContain("Method: Pipelined");
  expect(compact.message).toContain("Execution: Single Pass");
  expect(compact.message).toContain("Provider-native pre-pass: Provider Failure — Remote endpoint returned HTTP 503");
  expect(compact.message).toContain("Removed 1 orphaned tool-result block before rewriting the session.");
  expect(compact.message).toContain("Estimated after: 42 (upstream estimate)");
  expect(compact.message).toContain("96.5% reduction");
  expect(compact.message).toContain("Safety-adjusted after:");
  expect(compact.message).toContain("Attached: full compaction report (.md).");
  expect(compact.message).not.toContain("Summary:");
  expect(compact.message).not.toContain("Summary");
  expect(compact.mediaIds).toHaveLength(1);
  expect(compact.contextUsage).toEqual(expect.objectContaining({
    tokens: expect.any(Number),
    contextWindow: expect.any(Number),
    percent: expect.any(Number),
    estimated: true,
    source: "compact_command",
    phase: "after_manual_compaction",
  }));
  expect(session.agent.state.messages).toEqual([
    { role: "assistant", content: [{ type: "toolCall", id: "call-1" }] },
    { role: "toolResult", toolCallId: "call-1" },
  ]);
  const compactMedia = db.getMediaById(compact.mediaIds![0]);
  expect(compactMedia?.filename).toMatch(/^compaction-report-.*\.md$/);
  expect(compactMedia?.content_type).toBe("text/markdown");
  expect(compactMedia?.metadata).toMatchObject({
    compaction_method: "Pipelined",
    compaction_execution: "Single Pass",
    remote_compaction_outcome: "Provider Failure — Remote endpoint returned HTTP 503",
  });
  const compactReport = compactMedia ? new TextDecoder().decode(compactMedia.data) : "";
  expect(compactReport).toContain("# Compaction report");
  expect(compactReport).toContain("Method: Pipelined");
  expect(compactReport).toContain("Execution: Single Pass");
  expect(compactReport).toContain("Provider-native pre-pass: Provider Failure — Remote endpoint returned HTTP 503");
  expect(compactReport).toContain("Estimated tokens after: 42 (upstream)");
  expect(compactReport).toContain("Estimated reduction: 96.5%");
  expect(compactReport).toContain("## Summary");
  expect(compactReport).toContain("Summary");

  session.compactError = new Error("400 messages.2.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_test. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.");
  const compactCorruption = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
  expect(compactCorruption.status).toBe("error");
  expect(compactCorruption.message).toContain("⚠️ API error — the session may be corrupted");
  expect(compactCorruption.message).toContain("prunes orphaned tool-result blocks and corrupt image blocks automatically");
  session.compactError = null;

  const compactBackoffBlocked = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
  expect(compactBackoffBlocked.status).toBe("error");
  expect(compactBackoffBlocked.message).toContain("Compaction is in backoff");
  expect(compactBackoffBlocked.message).toContain("Manual /compact is disabled while compaction backoff is active");
  db.clearChatCompactionBackoff("web:default");
  db.clearChatCompactionBackoff("control:/compact");

  const originalCompact = session.compact.bind(session);
  const restoreTimeoutEnv = setEnv({ PICLAW_COMPACTION_TIMEOUT_MS: "20" });
  try {
    let _compactReject: ((err: Error) => void) | null = null;
    session.compact = async () => {
      session.compactCalls += 1;
      session.isCompacting = true;
      await new Promise<void>((_resolve, reject) => { _compactReject = reject; });
      return { tokensBefore: 0, firstKeptEntryId: null, summary: "" } as any;
    };
    const origAbort = session.abortCompaction?.bind(session);
    (session as any).abortCompaction = () => {
      origAbort?.();
      _compactReject?.(new Error("Compaction cancelled"));
      _compactReject = null;
    };
    const compactTimeout = await applyControlCommand(runtime as any, registry, { type: "compact", raw: "/compact" });
    expect(compactTimeout.status).toBe("error");
    expect(compactTimeout.message).toContain("Compaction timed out");
    expect(compactTimeout.message).toContain("physical compaction may still be settling");
    expect(compactTimeout.message).toContain("external failsafe remains armed");
    expect(session.abortCompactionCalls).toBe(1);
  } finally {
    restoreTimeoutEnv();
    session.compact = originalCompact;
    session.isCompacting = false;
  }

  const autoCompactOff = await applyControlCommand(runtime as any, registry, { type: "auto_compact", enabled: false, raw: "/auto-compact off" });
  expect(autoCompactOff.message).toContain("off");
  const autoCompactOn = await applyControlCommand(runtime as any, registry, { type: "auto_compact", enabled: true, raw: "/auto-compact on" });
  expect(autoCompactOn.message).toContain("on");
  const configModule = await import("../../src/core/config.js");
  expect(configModule.getCompactionRuntimeConfig().autoCompactionEnabled).toBe(true);
  expect(JSON.parse(readFileSync(getConfigPath(), "utf-8")).compaction.autoCompactionEnabled).toBe(true);
  // Piclaw owns this preference; the upstream session auto-compactor remains suppressed.
  expect(session.autoCompactionEnabled).toBe(false);

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

  const apiKeyStart = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step1 ${JSON.stringify({ provider: "openai" })}`,
    raw: "/login __step1",
  });
  expect((apiKeyStart.contentBlocks?.[0] as any)?.payload?.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "auth_value", style: "password" }),
  ]));
  const apiKeyResult = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "openai", method: "runtime_continue", auth_type: "api_key", auth_value: "new-key" })}`,
    raw: "/login __step2",
  });
  expect(apiKeyResult.status).toBe("success");
  expect(apiKeyResult.model_label).toBe("openai/gpt-test");
  expect(session.model?.provider).toBe("openai");
  expect(session.model?.id).toBe("gpt-test");
  expect(loginRegistry.authStorage.get("openai")).toMatchObject({ type: "api_key", key: "new-key" });

  let modelRefreshCalls = 0;
  const modelRefreshOptions: unknown[] = [];
  loginRegistry.modelRuntime.refresh = async (options: unknown) => {
    modelRefreshCalls += 1;
    modelRefreshOptions.push(options);
    return { aborted: false, errors: new Map() };
  };
  const configureResult = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "ollama", method: "configure", baseUrl: "http://127.0.0.1:11434/v1", modelId: "llama3:latest", modelIds: "qwen3:latest", contextWindow: "128000" })}`,
    raw: "/login __step2",
  });
  expect(configureResult.status).toBe("success");
  expect(modelRefreshCalls).toBe(1);
  expect(modelRefreshOptions).toEqual([{ allowNetwork: false }]);

  const modelsPath = join(piAgentDir, "models.json");
  expect(existsSync(modelsPath)).toBe(true);
  const modelsJson = JSON.parse(readFileSync(modelsPath, "utf-8"));
  expect(modelsJson.providers?.ollama?.baseUrl).toBe("http://127.0.0.1:11434/v1");
  expect(modelsJson.providers?.ollama?.models?.map((entry: { id: string }) => entry.id)).toEqual(["llama3:latest", "qwen3:latest"]);

  const llamaCppResult = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "llama-cpp", method: "configure", baseUrl: "http://127.0.0.1:8080/v1", modelId: "local-model", contextWindow: "32768" })}`,
    raw: "/login __step2",
  });
  expect(llamaCppResult.status).toBe("success");
  expect(modelRefreshCalls).toBe(2);
  expect(modelRefreshOptions).toEqual([{ allowNetwork: false }, { allowNetwork: false }]);

  const updatedModelsJson = JSON.parse(readFileSync(modelsPath, "utf-8"));
  expect(updatedModelsJson.providers?.["llama-cpp"]?.baseUrl).toBe("http://127.0.0.1:8080/v1");
  expect(updatedModelsJson.providers?.["llama-cpp"]?.api).toBe("openai-completions");
  expect(updatedModelsJson.providers?.["llama-cpp"]?.models?.[0]).toMatchObject({
    id: "local-model",
    contextWindow: 32768,
    compat: {
      supportsStore: false,
      supportsStrictMode: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsLongCacheRetention: false,
      maxTokensField: "max_tokens",
    },
  });
});

test("provider-owned API-key login supports multiple prompts without direct credential writes", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([{ provider: "cloudflare-ai-gateway", id: "model", name: "Model" }]);
  loginRegistry.modelRuntime.login = async (_providerId: string, _type: string, interaction: any) => {
    const key = await interaction.prompt({ type: "secret", message: "Enter Cloudflare API key" });
    const account = await interaction.prompt({ type: "text", message: "Enter Cloudflare account ID" });
    loginRegistry.authStorage.set("cloudflare-ai-gateway", { type: "api_key", key, env: { CLOUDFLARE_ACCOUNT_ID: account } });
  };
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const start = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step1 ${JSON.stringify({ provider: "cloudflare-ai-gateway" })}`, raw: "/login __step1",
  });
  expect((start.contentBlocks?.[0] as any)?.payload?.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "auth_value", style: "password" })]));
  const next = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step2 ${JSON.stringify({ provider: "cloudflare-ai-gateway", method: "runtime_continue", auth_type: "api_key", auth_value: "secret-key" })}`, raw: "/login __step2",
  });
  expect((next.contentBlocks?.[0] as any)?.payload?.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "auth_value", style: "text" })]));
  const done = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step2 ${JSON.stringify({ provider: "cloudflare-ai-gateway", method: "runtime_continue", auth_type: "api_key", auth_value: "acct-1" })}`, raw: "/login __step2",
  });
  expect(done.status).toBe("success");
  expect(loginRegistry.authStorage.get("cloudflare-ai-gateway")).toMatchObject({ key: "secret-key", env: { CLOUDFLARE_ACCOUNT_ID: "acct-1" } });
});

test("provider-owned auth cancellation aborts the runtime flow and clears pending prompts", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([{ provider: "openai-codex", id: "gpt-5.5" }]);
  let sawAbort = false;
  loginRegistry.modelRuntime.login = async (_providerId: string, _type: string, interaction: any) => {
    interaction.signal.addEventListener("abort", () => { sawAbort = true; }, { once: true });
    await interaction.prompt({ type: "manual_code", message: "Paste redirect URL" });
  };
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);
  await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step1 ${JSON.stringify({ provider: "openai-codex" })}`, raw: "/login __step1",
  });
  const cancelled = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step2 ${JSON.stringify({ provider: "openai-codex", method: "runtime_cancel", auth_type: "oauth" })}`, raw: "/login __step2",
  });
  expect(cancelled.status).toBe("success");
  expect(cancelled.message).toContain("cancelled");
  expect(sawAbort).toBe(true);
  const stale = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login", provider: `__step2 ${JSON.stringify({ provider: "openai-codex", method: "runtime_check", auth_type: "oauth" })}`, raw: "/login __step2",
  });
  expect(stale.status).toBe("error");
  expect(stale.message).toContain("No active authentication flow");
});

test("logout delegates credential deletion to ModelRuntime", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([{ provider: "openai", id: "gpt-test" }]);
  loginRegistry.authStorage.set("openai", { type: "api_key", key: "secret" });
  let logoutCalls = 0;
  const originalLogout = loginRegistry.modelRuntime.logout;
  loginRegistry.modelRuntime.logout = async (providerId: string) => { logoutCalls += 1; await originalLogout(providerId); };
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const result = await applyControlCommand(createTestSessionRuntime(session) as any, loginRegistry, { type: "logout", provider: "openai", raw: "/logout openai" });
  expect(result.status).toBe("success");
  expect(logoutCalls).toBe(1);
  expect(loginRegistry.authStorage.get("openai")).toBeUndefined();
});

test("abort returns when session abort remains pending", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_ABORT_SETTLE_TIMEOUT_MS: "5",
  });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  session.abort = async () => {
    session.abortCalls += 1;
    await new Promise(() => {});
  };
  const runtime = createTestSessionRuntime(session);
  const startedAt = Date.now();

  const result = await applyControlCommand(runtime as any, registry, { type: "abort", raw: "/abort" });

  expect(Date.now() - startedAt).toBeLessThan(250);
  expect(result.status).toBe("success");
  expect(result.message).toContain("Aborted current response.");
  expect(result.message).toContain("Abort is still settling after 5ms.");
  expect(session.abortCalls).toBe(1);
});

test("login refreshes model registry before activating newly authenticated provider models", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([
    { provider: "github-copilot", id: "gpt-4.1", name: "GPT 4.1", reasoning: true },
  ]);
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const picker = await applyControlCommand(runtime as any, loginRegistry as any, {
    type: "login",
    provider: `__step1 ${JSON.stringify({ provider: "github-copilot" })}`,
    raw: "/login __step1",
  });
  expect(picker.status).toBe("success");
  const result = await applyControlCommand(runtime as any, loginRegistry as any, {
    type: "login",
    provider: `__step1method ${JSON.stringify({ provider: "github-copilot", action: "oauth" })}`,
    raw: "/login __step1method",
  });

  expect(result.status).toBe("success");
  expect(loginRegistry.authStorage.get("github-copilot")?.type).toBe("oauth");
  expect(result.model_label, result.message).toBe("github-copilot/gpt-4.1");
  expect(session.model?.provider).toBe("github-copilot");
  expect(session.model?.id).toBe("gpt-4.1");
});

test("provider-owned auth interaction renders select and device-code events", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([{ provider: "openai-codex", id: "gpt-5.5", name: "GPT 5.5", reasoning: true }]);
  let selectedMethod: string | null = null;
  loginRegistry.modelRuntime.login = async (_providerId: string, _type: string, interaction: any) => {
    selectedMethod = await interaction.prompt({
      type: "select",
      message: "Select OpenAI Codex login method:",
      options: [{ id: "browser", label: "Browser" }, { id: "device_code", label: "Device code" }],
    });
    interaction.notify({ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://auth.openai.com/codex/device" });
    await new Promise(() => {});
  };
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const start = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step1 ${JSON.stringify({ provider: "openai-codex" })}`,
    raw: "/login __step1",
  });
  expect((start.contentBlocks?.[0] as any)?.payload?.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "auth_value", style: "expanded" }),
  ]));

  const next = await applyControlCommand(runtime as any, loginRegistry, {
    type: "login",
    provider: `__step2 ${JSON.stringify({ provider: "openai-codex", method: "runtime_continue", auth_type: "oauth", auth_value: "device_code" })}`,
    raw: "/login __step2",
  });
  expect(selectedMethod).toBe("device_code");
  const card = next.contentBlocks?.[0] as any;
  expect(card?.payload?.actions?.find((action: any) => action.type === "Action.OpenUrl")?.url).toBe("https://auth.openai.com/codex/device");
  expect(card?.payload?.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: "ABCD-EFGH", fontType: "Monospace" }),
  ]));
});

test("agent control cycle and agent identity commands", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  let cycleRefreshCalls = 0;
  const cycleRegistry = createTestModelRegistry([
    { provider: "openai", id: "gpt-test", reasoning: true, contextWindow: 200000 },
    { provider: "anthropic", id: "claude-test", reasoning: true, contextWindow: 200000 },
  ]);
  cycleRegistry.refresh = async () => { cycleRefreshCalls += 1; };
  const session = new TestAgentControlSession(ws.workspace, cycleRegistry);
  const runtime = createTestSessionRuntime(session);

  const cycleModel = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_model", direction: "forward", raw: "/cycle-model" });
  expect(cycleModel.message).toContain("Model set to");
  expect(cycleRefreshCalls).toBe(1);

  session.isCompacting = true;
  const blockedCycleModel = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_model", direction: "forward", raw: "/cycle-model" });
  expect(blockedCycleModel.status).toBe("error");
  expect(blockedCycleModel.message).toContain("Auto-compaction is still running");
  session.isCompacting = false;

  const cycleThinking = await applyControlCommand(runtime as any, cycleRegistry, { type: "cycle_thinking", raw: "/cycle-thinking" });
  expect(cycleThinking.message).toContain("Thinking level set");

  session.model = {
    provider: "openai",
    id: "gpt-5.6-sol",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
  } as any;
  const maxOnOpenAi = await applyControlCommand(runtime as any, cycleRegistry, { type: "thinking", level: "max", raw: "/thinking max" });
  expect(maxOnOpenAi.status).toBe("success");
  expect(maxOnOpenAi.thinking_level).toBe("max");
  expect(maxOnOpenAi.thinking_level_label).toBe("max");

  session.model = {
    provider: "anthropic",
    id: "claude-opus-4-6",
    reasoning: true,
    thinkingLevelMap: { max: "max" },
  } as any;
  const maxOnAnthropic = await applyControlCommand(runtime as any, cycleRegistry, { type: "thinking", level: "max", raw: "/thinking max" });
  expect(maxOnAnthropic.status).toBe("success");
  expect(maxOnAnthropic.thinking_level).toBe("max");
  expect(maxOnAnthropic.thinking_level_label).toBe("max");
  expect(maxOnAnthropic.message).toContain("Thinking level set to max");

  const agentName = await applyControlCommand(runtime as any, cycleRegistry, { type: "agent_name", name: "Pi", raw: "/agent-name Pi" });
  expect(agentName.message).toContain("Agent name set");

  const agentAvatar = await applyControlCommand(runtime as any, cycleRegistry, { type: "agent_avatar", avatar: "https://example.com/avatar.png", raw: "/agent-avatar https://example.com/avatar.png" });
  expect(agentAvatar.message).toContain("Agent avatar set");
});

test("agent control compacts undersized model switches and skips them while cycling", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const models = [
    { provider: "openai", id: "gpt-large", reasoning: true, contextWindow: 200000 },
    { provider: "openai", id: "gpt-small", reasoning: true, contextWindow: 128000 },
    { provider: "openai", id: "gpt-length", reasoning: true, contextLength: 128000 },
    { provider: "anthropic", id: "claude-large", reasoning: true, contextWindow: 256000 },
  ] as any[];
  const sizedRegistry = createTestModelRegistry(models);
  const session = new TestAgentControlSession(ws.workspace, sizedRegistry);
  const runtime = createTestSessionRuntime(session);

  let currentIndex = 0;
  session.model = models[currentIndex];
  session.getContextUsage = () => {
    const awaitingPostCompactionUsage = session.sessionContext.messages.some(
      (message: any) => message.role === "compactionSummary",
    );
    return {
      tokens: awaitingPostCompactionUsage ? null : 150000,
      contextWindow: 200000,
      percent: awaitingPostCompactionUsage ? null : 75,
    } as any;
  };
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

  const downshiftModel = await applyControlCommand(runtime as any, sizedRegistry, {
    type: "model",
    provider: "openai",
    modelId: "gpt-small",
    raw: "/model openai/gpt-small",
  });
  expect(downshiftModel.status).toBe("success");
  expect(downshiftModel.message).toContain("Compacted with the previous model first");
  expect(downshiftModel.model_label).toBe("openai/gpt-small");
  expect(session.compactCalls).toBe(1);
  expect(session.model?.id).toBe("gpt-small");

  session.model = models[0];
  currentIndex = 0;
  session.compactCalls = 0;
  session.sessionContext = { messages: [{ role: "user", content: [{ type: "text", text: "large" }] }] } as any;
  (session.sessionManager as any).getLeafId = () => "entry-large-explicit";

  let compactInstructions = "";
  session.compact = async (instructions?: string) => {
    session.compactCalls += 1;
    compactInstructions = instructions || "";
    session.sessionContext = {
      messages: [
        { role: "compactionSummary", summary: "small target-aware summary", tokensBefore: 150000 },
        { role: "assistant", content: [{ type: "text", text: "kept" }] },
      ],
    } as any;
    return { tokensBefore: 150000, firstKeptEntryId: "entry-1", summary: "small target-aware summary" } as any;
  };

  const compactModel = await applyControlCommand(runtime as any, sizedRegistry, {
    type: "model",
    provider: "openai",
    modelId: "gpt-small",
    compact: true,
    raw: "/model openai/gpt-small --compact",
  });
  expect(compactModel.status).toBe("success");
  expect(compactModel.model_label).toBe("openai/gpt-small");
  expect(session.compactCalls).toBe(1);
  expect(compactInstructions).toContain("piclaw:target-context-window=128000");
  expect(session.model?.id).toBe("gpt-small");

  session.model = models[0];
  currentIndex = 0;
  session.compactCalls = 0;
  session.sessionContext = { messages: [{ role: "user", content: [{ type: "text", text: "large" }] }] } as any;
  (session.sessionManager as any).getLeafId = () => "entry-large";

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
  const configModule = await import("../../src/core/config.js");
  expect(configModule.getCompactionRuntimeConfig().autoCompactionEnabled).toBe(true);
  expect(session.autoCompactionEnabled).toBe(false);

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
