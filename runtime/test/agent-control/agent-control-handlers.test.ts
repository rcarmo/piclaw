import { loginSubmission, loginSurfaceData } from "./login-surface-fixture.js";
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
import { withPrivateProviderAuthResponse } from "../../src/agent-control/handlers/login.js";
import { clearProviderUsageCache, warmProviderUsage } from "../../src/agent-pool/provider-usage.js";
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

function loginActionData(result: any, method: string): Record<string, unknown> {
  return loginSurfaceData('web:default', result, method.replace(/^runtime_/, ''));
}

const nativeControls: Array<{ dispose(): void }> = [];
afterEach(() => { for (const control of nativeControls.splice(0)) control.dispose(); });
async function getControl() {
  const { createNativeControlFixture } = await import('./native-control-fixture.js');
  const { getChatJid } = await import('../../src/core/chat-context.js');
  await import('../../src/channels/web/http/extension-routes.js');
  const controls = new WeakMap<object, ReturnType<typeof createNativeControlFixture>>();
  return (runtime: any, registry: any, command: any) => {
    const chat = getChatJid('web:default');
    let control = controls.get(runtime);
    if (!control) {
      control = createNativeControlFixture(runtime.session, registry, chat);
      controls.set(runtime, control); nativeControls.push(control);
    }
    return control.facade.applyControlCommand(chat, command);
  };
}

test("tree command passes an invocation snapshot and chat scope through the generic renderer", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const session = new TestAgentControlSession(ws.workspace, registry);
  const runtime = createTestSessionRuntime(session);
  let rendererArtifact: Record<string, unknown> | null = null;
  const registerWidgetKind = (globalThis as any).__piclaw_registerWidgetKind as
    | ((kind: string, renderer: (artifact: Record<string, unknown>) => string) => void)
    | undefined;
  expect(typeof registerWidgetKind).toBe("function");

  registerWidgetKind!("session_tree", (artifact) => {
    rendererArtifact = artifact;
    return "<main>add-on-owned tree</main>";
  });

  try {
    const result = await withChatContext("web:tree-scope", "web", () =>
      applyControlCommand(runtime as any, registry, { type: "tree", raw: "/tree" })
    );

    expect(rendererArtifact).toMatchObject({
      chatJid: "web:tree-scope",
      tree: { version: 1, leafId: "entry-1", flat: true, total: 1 },
    });
    expect(result.message).toBe("");
    expect(result.contentBlocks).toHaveLength(1);
    expect(result.contentBlocks?.[0]).toMatchObject({
      type: "generated_widget",
      artifact: { kind: "html", html: "<main>add-on-owned tree</main>" },
    });
  } finally {
    registerWidgetKind!("session_tree", () => "");
  }
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
    ...loginSubmission("step1", { provider: "openai" })
  });
  expect(JSON.stringify(apiKeyStart.contentBlocks)).not.toContain('"id":"auth_value"');
  const apiKeyShown = await withPrivateProviderAuthResponse(() => applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", loginActionData(apiKeyStart, "runtime_present"))
  }));
  expect(apiKeyShown.authPresentation?.prompt?.type).toBe("secret");
  const apiKeyResult = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", { ...loginActionData(apiKeyShown, "runtime_continue"), auth_value: "new-key" })
  });
  expect(apiKeyResult.status).toBe("success");
  expect(apiKeyResult.model_label).toBeUndefined();
  const activationData = loginSurfaceData("web:default", apiKeyResult, "activate");
  const activated = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step3", { ...activationData, model: "gpt-test" })
  });
  expect(activated.model_label).toBe("openai/gpt-test");
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
    ...loginSubmission("step2", { provider: "ollama", method: "configure", baseUrl: "http://127.0.0.1:11434/v1", modelId: "llama3:latest", modelIds: "qwen3:latest", contextWindow: "128000" })
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
    ...loginSubmission("step2", { provider: "llama-cpp", method: "configure", baseUrl: "http://127.0.0.1:8080/v1", modelId: "local-model", contextWindow: "32768" })
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
    ...loginSubmission("step1", { provider: "cloudflare-ai-gateway" })
  });
  expect(JSON.stringify(start.contentBlocks)).not.toContain("Enter Cloudflare API key");
  const next = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", { ...loginActionData(start, "runtime_continue"), auth_value: "secret-key" })
  });
  expect(JSON.stringify(next.contentBlocks)).not.toContain("Enter Cloudflare account ID");
  const done = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", { ...loginActionData(next, "runtime_continue"), auth_value: "acct-1" })
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
  const start = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step1", { provider: "openai-codex" })
  });
  const cancelled = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", loginActionData(start, "runtime_cancel"))
  });
  expect(cancelled.status).toBe("success");
  expect(cancelled.message).toContain("cancelled");
  expect(sawAbort).toBe(true);
  const stale = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", { provider: "openai-codex", method: "runtime_check", auth_type: "oauth" })
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

test("login refreshes model registry but requires explicit activation even for one model", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const applyControlCommand = await getControl();
  const loginRegistry = createTestModelRegistry([
    { provider: "github-copilot", id: "gpt-4.1", name: "GPT 4.1", reasoning: true },
  ]);
  const session = new TestAgentControlSession(ws.workspace, loginRegistry);
  const runtime = createTestSessionRuntime(session);

  const picker = await applyControlCommand(runtime as any, loginRegistry as any, {
    ...loginSubmission("step1", { provider: "github-copilot" })
  });
  expect(picker.status).toBe("success");
  const result = await applyControlCommand(runtime as any, loginRegistry as any, {
    ...loginSubmission("step1method", { provider: "github-copilot", action: "oauth" })
  });

  expect(result.status).toBe("success");
  expect(loginRegistry.authStorage.get("github-copilot")?.type).toBe("oauth");
  expect(result.model_label).toBeUndefined();
  expect(session.model?.provider).toBe("openai");
  const activationData = loginSurfaceData("web:default", result, "activate");
  const activated = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step3", { ...activationData, model: "gpt-4.1" })
  });
  expect(activated.model_label).toBe("github-copilot/gpt-4.1");
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
    ...loginSubmission("step1", { provider: "openai-codex" })
  });
  expect(JSON.stringify(start.contentBlocks)).not.toContain("Select OpenAI Codex login method");

  const next = await applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", { ...loginActionData(start, "runtime_continue"), auth_value: "device_code" })
  });
  expect(selectedMethod).toBe("device_code");
  expect(JSON.stringify(next.contentBlocks)).not.toContain("ABCD-EFGH");
  const shown = await withPrivateProviderAuthResponse(() => applyControlCommand(runtime as any, loginRegistry, {
    ...loginSubmission("step2", loginActionData(next, "runtime_present"))
  }));
  expect(shown.authPresentation?.events).toContainEqual({ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://auth.openai.com/codex/device" });
});
