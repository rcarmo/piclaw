import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import "../helpers.js";
import { createTempWorkspace, importFresh, withTempWorkspaceEnv } from "../helpers.js";

type ConfigModule = typeof import("../../src/core/config.js");

function writeWorkspaceConfig(workspace: string, config: Record<string, unknown>): string {
  const configDir = join(workspace, ".piclaw");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

const originalCwd = process.cwd();
const originalArgv = [...process.argv];
const RUNTIME_DIR = resolve(import.meta.dir, "../..");
const CONFIG_SUBPROCESS = join(RUNTIME_DIR, "test", "config", "config-subprocess.ts");

afterEach(() => {
  process.chdir(originalCwd);
  process.argv = [...originalArgv];
});

async function withFreshConfig(
  options: {
    env?: Record<string, string | undefined>;
    argv?: string[];
    dotEnv?: string;
    config?: Record<string, unknown>;
  },
  run: (ctx: { workspace: { workspace: string; store: string; data: string }; config: ConfigModule }) => Promise<void>,
): Promise<void> {
  await withTempWorkspaceEnv("piclaw-config-", options.env ?? {}, async (workspace) => {
    if (options.config) {
      const configPath = join(workspace.workspace, ".piclaw", "config.json");
      mkdirSync(join(workspace.workspace, ".piclaw"), { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(options.config, null, 2)}\n`, "utf8");
    }
    if (options.dotEnv !== undefined) {
      writeFileSync(join(workspace.workspace, ".env"), options.dotEnv, "utf8");
    }

    process.chdir(workspace.workspace);
    process.argv = [originalArgv[0] || "bun", originalArgv[1] || "test", ...(options.argv ?? [])];

    const config = await importFresh<ConfigModule>("../src/core/config.js");
    await run({ workspace, config });
  });
}

function runConfigSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined>; noEnvFile?: boolean } = {},
): { snapshot: Record<string, any>; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["bun", ...(options.noEnvFile ? ["--no-env-file"] : []), CONFIG_SUBPROCESS, ...(options.args || [])],
    cwd: workspace.workspace,
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      TMP: process.env.TMP || "/tmp",
      TEMP: process.env.TEMP || "/tmp",
      USER: process.env.USER || "agent",
      PICLAW_WORKSPACE: workspace.workspace,
      PICLAW_STORE: workspace.store,
      PICLAW_DATA: workspace.data,
      PICLAW_DB_IN_MEMORY: "1",
      PICLAW_CONFIG_EXPORTS: exports.join(","),
      ...(options.env || {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString().trim();
  const stderr = proc.stderr.toString().trim();
  expect(proc.exitCode, stderr || stdout).toBe(0);
  return { snapshot: JSON.parse(stdout || "{}"), stderr };
}

function loadConfigInSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined> } = {},
): Record<string, any> {
  return runConfigSubprocess(workspace, exports, options).snapshot;
}

function expectCompatWarningOnce(stderr: string, envKey: string): void {
  const warningLines = stderr
    .split("\n")
    .filter((line) => line.includes('"operation":"domain_config.compat_env"') && line.includes(`"envKey":"${envKey}"`));
  expect(warningLines, envKey).toHaveLength(1);
  expect(warningLines[0]).toContain('"removalVersion":"3.0.0"');
}

describe("core config", () => {
  test("platform helpers expose the documented default remote-surface policy", async () => {
    await withFreshConfig({}, async ({ config }) => {
      expect(config.isDefaultWebTerminalEnabled("linux")).toBe(true);
      expect(config.isDefaultWebTerminalEnabled("darwin")).toBe(true);
      expect(config.isDefaultWebTerminalEnabled("win32")).toBe(false);
      expect(config.isDefaultWebVncDirectEnabled("linux")).toBe(true);
      expect(config.isDefaultWebVncDirectEnabled("darwin")).toBe(true);
      expect(config.isDefaultWebVncDirectEnabled("win32")).toBe(true);
    });
  });

  test("loads grouped settings from env, .env, and config file using the documented precedence", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        assistant: { assistantName: "Config Assistant", assistantAvatar: "https://config.example/avatar.png" },
        user: { userName: "Config User", userAvatar: "https://config.example/user.png", userAvatarBackground: "#123456" },
        web: { passkeyMode: "passkey-only", sessionTtl: 99, totpWindow: 3, internalSecret: "cfg-secret", terminalEnabled: true, vncAllowDirect: false, trustProxy: true },
        debugCardSubmissions: true,
        tools: { additionalDefaultTools: ["search_workspace", "introspect_sql"], workspaceSearchRoots: ["notes", ".pi/skills", "docs"] },
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_LOG_LEVEL=debug",
        "PICLAW_ASSISTANT_AVATAR=https://env-file.example/avatar.png",
      ].join("\n"), "utf8");
      const snapshot = loadConfigInSubprocess(workspace, [
        "WORKSPACE_DIR", "STORE_DIR", "DATA_DIR",
        "call:getIdentityConfig", "call:getLoggingConfig", "call:getWebRuntimeConfig", "call:getToolActivationConfig", "call:getWorkspaceSearchConfig",
      ], {
        env: {
          PICLAW_ASSISTANT_NAME: "Env Assistant",
          PICLAW_WEB_PASSKEY_MODE: "totp-only",
          PICLAW_WEB_TERMINAL_ENABLED: "0",
          PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
          PICLAW_VNC_ALLOW_DIRECT: undefined,
          PICLAW_WEB_VNC_TARGETS: undefined,
          PICLAW_VNC_TARGETS: undefined,
          PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_TRUST_PROXY: "0",
        },
      });
      expect(snapshot.WORKSPACE_DIR).toBe(workspace.workspace);
      expect(snapshot.STORE_DIR).toBe(workspace.store);
      expect(snapshot.DATA_DIR).toBe(workspace.data);
      expect(snapshot["call:getIdentityConfig"]).toEqual({ assistantName: "Env Assistant", assistantAvatar: "https://env-file.example/avatar.png", userName: "Config User", userAvatar: "https://config.example/user.png", userAvatarBackground: "#123456" });
      expect(snapshot["call:getLoggingConfig"]).toEqual({ level: "debug" });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({ passkeyMode: "totp-only", sessionTtl: 99, totpWindow: 3, internalSecret: "cfg-secret", terminalEnabled: false, vncAllowDirect: false, vncTargetsRaw: "", debugCardSubmissions: true, trustProxy: false, composeUploadLimitMb: 256, workspaceUploadLimitMb: 256 });
      expect(snapshot["call:getToolActivationConfig"]).toEqual({ additionalDefaultTools: ["search_workspace", "introspect_sql"] });
      expect(snapshot["call:getWorkspaceSearchConfig"]).toEqual({ roots: ["notes", ".pi/skills", "docs"], extraExtensions: [] });
    } finally {
      workspace.cleanup();
    }
  });

  test("operational domains preserve precedence, clamps, and env immutability", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-operational-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          web: { contentMaxChars: 200000, contentPreviewChars: 12000 },
          addons: { apiFailureBackoffMs: 45000 },
          agentControl: { abortSettleTimeoutMs: 750 },
          sessionRecordings: { directory: "/tmp/persisted-recordings" },
        },
      });
      const persisted = runConfigSubprocess(workspace, [
        "call:getWebContentConfig",
        "call:getAddonsConfig",
        "call:getAgentControlConfig",
        "call:getSessionRecordingsConfig",
      ], { noEnvFile: true, env: {
        PICLAW_WEB_MAX_CONTENT_CHARS: undefined,
        PICLAW_WEB_PREVIEW_CHARS: undefined,
        PICLAW_ADDON_API_FAILURE_BACKOFF_MS: undefined,
        PICLAW_ABORT_SETTLE_TIMEOUT_MS: undefined,
        PICLAW_RECORDINGS_DIR: undefined,
      } });
      expect(persisted.snapshot["call:getWebContentConfig"]).toEqual({ maxChars: 200000, previewChars: 12000 });
      expect(persisted.snapshot["call:getAddonsConfig"]).toEqual({ apiFailureBackoffMs: 45000 });
      expect(persisted.snapshot["call:getAgentControlConfig"]).toEqual({ abortSettleTimeoutMs: 750 });
      expect(persisted.snapshot["call:getSessionRecordingsConfig"]).toEqual({ directory: "/tmp/persisted-recordings" });

      const compat = runConfigSubprocess(workspace, [
        "call:getWebContentConfig",
        "call:getAddonsConfig",
        "call:getAgentControlConfig",
        "call:getSessionRecordingsConfig",
        "env-unchanged:PICLAW_WEB_MAX_CONTENT_CHARS",
        "env-unchanged:PICLAW_WEB_PREVIEW_CHARS",
        "env-unchanged:PICLAW_ADDON_API_FAILURE_BACKOFF_MS",
        "env-unchanged:PICLAW_ABORT_SETTLE_TIMEOUT_MS",
        "env-unchanged:PICLAW_RECORDINGS_DIR",
      ], { env: {
        PICLAW_WEB_MAX_CONTENT_CHARS: "10000",
        PICLAW_WEB_PREVIEW_CHARS: "15000",
        PICLAW_ADDON_API_FAILURE_BACKOFF_MS: "30000",
        PICLAW_ABORT_SETTLE_TIMEOUT_MS: "20000",
        PICLAW_RECORDINGS_DIR: "/tmp/env-recordings",
      } });
      expect(compat.snapshot["call:getWebContentConfig"]).toEqual({ maxChars: 10000, previewChars: 10000 });
      expect(compat.snapshot["call:getAddonsConfig"]).toEqual({ apiFailureBackoffMs: 30000 });
      expect(compat.snapshot["call:getAgentControlConfig"]).toEqual({ abortSettleTimeoutMs: 10000 });
      expect(compat.snapshot["call:getSessionRecordingsConfig"]).toEqual({ directory: "/tmp/env-recordings" });
      for (const key of ["PICLAW_WEB_MAX_CONTENT_CHARS", "PICLAW_WEB_PREVIEW_CHARS", "PICLAW_ADDON_API_FAILURE_BACKOFF_MS", "PICLAW_ABORT_SETTLE_TIMEOUT_MS", "PICLAW_RECORDINGS_DIR"]) {
        expect(compat.snapshot[`env-unchanged:${key}`]).toBe(true);
        expectCompatWarningOnce(compat.stderr, key);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("dream domain preserves defaults, precedence, fallback, and env immutability", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-dream-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          agent: { backgroundTimeoutMs: 240000 },
          dream: { cron: "15 2 * * *", backupKeep: 7, model: "anthropic/claude-sonnet", agentTimeoutMs: 180000 },
        },
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_DREAM_CRON=30 3 * * *",
        "PICLAW_DREAM_BACKUP_KEEP=8",
        "PICLAW_DREAM_MODEL=openai/gpt-5-mini",
        "PICLAW_DREAM_AGENT_TIMEOUT_MS=210000",
      ].join("\n"), "utf8");

      const envFile = runConfigSubprocess(workspace, ["call:getDreamConfig"], {
        env: {
          PICLAW_DREAM_CRON: undefined,
          PICLAW_DREAM_BACKUP_KEEP: undefined,
          PICLAW_DREAM_MODEL: undefined,
          PICLAW_DREAM_AGENT_TIMEOUT_MS: undefined,
        },
      });
      expect(envFile.snapshot["call:getDreamConfig"]).toEqual({
        cron: "30 3 * * *",
        backupKeep: 8,
        model: "openai/gpt-5-mini",
        agentTimeoutMs: 210000,
      });

      const compatEnv = runConfigSubprocess(workspace, [
        "call:getDreamConfig",
        "env-unchanged:PICLAW_DREAM_CRON",
        "env-unchanged:PICLAW_DREAM_BACKUP_KEEP",
        "env-unchanged:PICLAW_DREAM_MODEL",
        "env-unchanged:PICLAW_DREAM_AGENT_TIMEOUT_MS",
      ], {
        env: {
          PICLAW_DREAM_CRON: "45 4 * * *",
          PICLAW_DREAM_BACKUP_KEEP: "9",
          PICLAW_DREAM_MODEL: "github-copilot/gpt-5-mini",
          PICLAW_DREAM_AGENT_TIMEOUT_MS: "220000",
        },
      });
      expect(compatEnv.snapshot["call:getDreamConfig"]).toEqual({
        cron: "45 4 * * *",
        backupKeep: 9,
        model: "github-copilot/gpt-5-mini",
        agentTimeoutMs: 220000,
      });
      expect(compatEnv.snapshot["env-unchanged:PICLAW_DREAM_CRON"]).toBe(true);
      expect(compatEnv.snapshot["env-unchanged:PICLAW_DREAM_BACKUP_KEEP"]).toBe(true);
      expect(compatEnv.snapshot["env-unchanged:PICLAW_DREAM_MODEL"]).toBe(true);
      expect(compatEnv.snapshot["env-unchanged:PICLAW_DREAM_AGENT_TIMEOUT_MS"]).toBe(true);
      for (const key of ["PICLAW_DREAM_CRON", "PICLAW_DREAM_BACKUP_KEEP", "PICLAW_DREAM_MODEL", "PICLAW_DREAM_AGENT_TIMEOUT_MS"]) {
        expectCompatWarningOnce(compatEnv.stderr, key);
      }

      writeWorkspaceConfig(workspace.workspace, { domains: { agent: { backgroundTimeoutMs: 240000 } } });
      writeFileSync(join(workspace.workspace, ".env"), "", "utf8");
      const fallback = runConfigSubprocess(workspace, ["call:getDreamConfig"], {
        noEnvFile: true,
        env: {
          PICLAW_DREAM_CRON: undefined,
          PICLAW_DREAM_BACKUP_KEEP: undefined,
          PICLAW_DREAM_MODEL: undefined,
          PICLAW_DREAM_AGENT_TIMEOUT_MS: undefined,
        },
      });
      expect(fallback.snapshot["call:getDreamConfig"]).toEqual({
        cron: "0 1 * * *",
        backupKeep: 10,
        model: "",
        agentTimeoutMs: 240000,
      });
    } finally {
      workspace.cleanup();
    }
  });

  test("logging level persists with env compatibility precedence and no mutation", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-log-level-");
    try {
      writeWorkspaceConfig(workspace.workspace, { domains: { logging: { level: "warn" } } });
      const persisted = runConfigSubprocess(workspace, ["call:getLoggingConfig"], {
        noEnvFile: true,
        env: { PICLAW_LOG_LEVEL: undefined, LOG_LEVEL: undefined },
      });
      expect(persisted.snapshot["call:getLoggingConfig"]).toEqual({ level: "warn" });

      const compat = runConfigSubprocess(workspace, [
        "call:getLoggingConfig",
        "env-unchanged:PICLAW_LOG_LEVEL",
      ], { env: { PICLAW_LOG_LEVEL: "debug", LOG_LEVEL: undefined } });
      expect(compat.snapshot["call:getLoggingConfig"]).toEqual({ level: "debug" });
      expect(compat.snapshot["env-unchanged:PICLAW_LOG_LEVEL"]).toBe(true);
      expectCompatWarningOnce(compat.stderr, "PICLAW_LOG_LEVEL");
    } finally {
      workspace.cleanup();
    }
  });

  test("agent, session, and logging domains persist across restart with compatibility precedence", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-agent-session-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          agent: { timeoutMs: 1111, backgroundTimeoutMs: 2222, toolUseMessageBudget: 23 },
          session: { maxSizeMb: 48, maxLines: 9000, maxCompactionsBeforeRotation: 5, autoRotate: false },
          logging: { level: "warn", retentionMs: 123456, cleanupIntervalMs: 654321 },
        },
      });
      const persisted = runConfigSubprocess(workspace, [
        "call:getAgentRuntimeConfig",
        "call:getToolUseMessageBudget",
        "call:getLoggingConfig",
      ], {
        env: {
          PICLAW_AGENT_TIMEOUT: undefined,
          AGENT_TIMEOUT: undefined,
          PICLAW_BACKGROUND_AGENT_TIMEOUT: undefined,
          AGENT_TIMEOUT_BACKGROUND: undefined,
          PICLAW_TURN_MAX_TOOL_USE_MESSAGES: undefined,
          PICLAW_SESSION_MAX_SIZE_MB: undefined,
          PICLAW_SESSION_MAX_LINES: undefined,
          PICLAW_SESSION_MAX_COMPACTIONS: undefined,
          PICLAW_SESSION_AUTO_ROTATE: undefined,
          PICLAW_LOG_LEVEL: undefined,
          LOG_LEVEL: undefined,
        },
      }).snapshot;
      expect(persisted["call:getAgentRuntimeConfig"]).toEqual({ timeoutMs: 1111, backgroundTimeoutMs: 2222 });
      expect(persisted["call:getToolUseMessageBudget"]).toBe(23);
      expect(persisted["call:getLoggingConfig"]).toEqual({ level: "warn" });

      const { snapshot, stderr } = runConfigSubprocess(workspace, [
        "call:getAgentRuntimeConfig",
        "call:getToolUseMessageBudget",
        "call:getLoggingConfig",
      ], {
        env: {
          PICLAW_AGENT_TIMEOUT: undefined,
          AGENT_TIMEOUT: "3333",
          PICLAW_BACKGROUND_AGENT_TIMEOUT: "4444",
          AGENT_TIMEOUT_BACKGROUND: "5555",
          PICLAW_TURN_MAX_TOOL_USE_MESSAGES: "31",
          PICLAW_SESSION_MAX_SIZE_MB: "64",
          PICLAW_SESSION_MAX_LINES: "10000",
          PICLAW_SESSION_MAX_COMPACTIONS: "7",
          PICLAW_SESSION_AUTO_ROTATE: "1",
          PICLAW_LOG_LEVEL: "debug",
          LOG_LEVEL: undefined,
        },
      });
      expect(snapshot["call:getAgentRuntimeConfig"]).toEqual({ timeoutMs: 3333, backgroundTimeoutMs: 4444 });
      expect(snapshot["call:getToolUseMessageBudget"]).toBe(31);
      expect(snapshot["call:getLoggingConfig"]).toEqual({ level: "debug" });
      for (const envKey of [
        "AGENT_TIMEOUT",
        "PICLAW_BACKGROUND_AGENT_TIMEOUT",
        "PICLAW_TURN_MAX_TOOL_USE_MESSAGES",
        "PICLAW_LOG_LEVEL",
      ]) expectCompatWarningOnce(stderr, envKey);
      expect(stderr).not.toContain('"envKey":"PICLAW_AGENT_LOG_RETENTION_MS"');
      expect(stderr).not.toContain('"envKey":"AGENT_TIMEOUT_BACKGROUND"');
    } finally {
      workspace.cleanup();
    }
  });

  test("default session cache retains four mains while pressure remains capped at one", () => {
    const workspace = createTempWorkspace("session-defaults-");
    try {
      const { snapshot: value } = runConfigSubprocess(workspace, ["call:getSessionPoolConfig"], { env: {
        PICLAW_MAIN_SESSION_POOL_MAX_SIZE: undefined, PICLAW_SESSION_POOL_MAX_SIZE: undefined,
        PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: undefined, PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: undefined,
      } });
      expect(value["call:getSessionPoolConfig"].mainSessionPoolMaxSize).toBe(4);
      expect(value["call:getSessionPoolConfig"].memoryPressureMainSessionPoolMaxSize).toBe(1);
      expect(value["call:getSessionPoolConfig"].memoryPressureRssBytes).toBe(384 * 1024 * 1024);
    } finally { workspace.cleanup(); }
  });

  test("session-pool domain persists across restart and preserves ordered generic aliases", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-session-pool-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          sessionPool: {
            mainIdleTtlMs: 111000,
            sideIdleTtlMs: 222000,
            cleanupIntervalMs: 333000,
            mainSessionPoolMaxSize: 4,
            memoryPressureRssBytes: 500000000,
            memoryPressureMainIdleTtlMs: 444000,
            memoryPressureMainSessionPoolMaxSize: 2,
          },
        },
      });
      const persisted = runConfigSubprocess(workspace, ["call:getSessionPoolConfig"], {
        env: {
          PICLAW_MAIN_SESSION_IDLE_TTL_MS: undefined,
          PICLAW_SIDE_SESSION_IDLE_TTL_MS: undefined,
          PICLAW_SESSION_IDLE_TTL_MS: undefined,
          PICLAW_SESSION_CLEANUP_INTERVAL_MS: undefined,
          PICLAW_MAIN_SESSION_POOL_MAX_SIZE: undefined,
          PICLAW_SESSION_POOL_MAX_SIZE: undefined,
          PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: undefined,
          PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS: undefined,
          PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: undefined,
        },
      }).snapshot;
      expect(persisted["call:getSessionPoolConfig"]).toEqual({
        mainIdleTtlMs: 111000,
        sideIdleTtlMs: 222000,
        cleanupIntervalMs: 333000,
        mainSessionPoolMaxSize: 4,
        memoryPressureRssBytes: 500000000,
        memoryPressureMainIdleTtlMs: 444000,
        memoryPressureMainSessionPoolMaxSize: 2,
      });

      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getSessionPoolConfig"], {
        env: {
          PICLAW_MAIN_SESSION_IDLE_TTL_MS: "invalid",
          PICLAW_SIDE_SESSION_IDLE_TTL_MS: "90000",
          PICLAW_SESSION_IDLE_TTL_MS: "70000",
          PICLAW_SESSION_CLEANUP_INTERVAL_MS: "45000",
          PICLAW_MAIN_SESSION_POOL_MAX_SIZE: "invalid",
          PICLAW_SESSION_POOL_MAX_SIZE: "3",
          PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: "600000000",
          PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS: "80000",
          PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: "2",
        },
      });
      expect(snapshot["call:getSessionPoolConfig"]).toEqual({
        mainIdleTtlMs: 70000,
        sideIdleTtlMs: 90000,
        cleanupIntervalMs: 45000,
        mainSessionPoolMaxSize: 3,
        memoryPressureRssBytes: 600000000,
        memoryPressureMainIdleTtlMs: 80000,
        memoryPressureMainSessionPoolMaxSize: 2,
      });
      for (const envKey of [
        "PICLAW_SESSION_IDLE_TTL_MS",
        "PICLAW_SIDE_SESSION_IDLE_TTL_MS",
        "PICLAW_SESSION_CLEANUP_INTERVAL_MS",
        "PICLAW_SESSION_POOL_MAX_SIZE",
        "PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES",
        "PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS",
        "PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE",
      ]) expectCompatWarningOnce(stderr, envKey);
      expect(stderr).not.toContain('"envKey":"PICLAW_MAIN_SESSION_IDLE_TTL_MS"');
      expect(stderr).not.toContain('"envKey":"PICLAW_MAIN_SESSION_POOL_MAX_SIZE"');

      const genericOnly = runConfigSubprocess(workspace, ["call:getSessionPoolConfig"], {
        env: {
          PICLAW_MAIN_SESSION_IDLE_TTL_MS: undefined,
          PICLAW_SIDE_SESSION_IDLE_TTL_MS: undefined,
          PICLAW_SESSION_IDLE_TTL_MS: "75000",
        },
      });
      expect(genericOnly.snapshot["call:getSessionPoolConfig"]).toMatchObject({
        mainIdleTtlMs: 75000,
        sideIdleTtlMs: 75000,
      });
      expectCompatWarningOnce(genericOnly.stderr, "PICLAW_SESSION_IDLE_TTL_MS");
    } finally {
      workspace.cleanup();
    }
  });

  test("session persistence and isolation domains preserve restart and compatibility precedence", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-session-persistence-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          session: { isolation: "summary" },
          sessionPersistence: {
            filePreloadSanitizeMinBytes: 2000000,
            toolResultMaxPersistBytes: 300000,
            toolResultPreviewChars: 5000,
          },
        },
      });
      const persisted = runConfigSubprocess(workspace, ["call:getSessionIsolationLevel", "call:getSessionPersistenceConfig"], {
        env: {
          PICLAW_SESSION_ISOLATION: undefined,
          PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES: undefined,
          PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES: undefined,
          PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS: undefined,
        },
      }).snapshot;
      expect(persisted["call:getSessionIsolationLevel"]).toBe("summary");
      expect(persisted["call:getSessionPersistenceConfig"]).toEqual({
        filePreloadSanitizeMinBytes: 2000000,
        toolResultMaxPersistBytes: 300000,
        toolResultPreviewChars: 5000,
      });

      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getSessionIsolationLevel", "call:getSessionPersistenceConfig"], {
        env: {
          PICLAW_SESSION_ISOLATION: "FULL",
          PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES: "invalid",
          PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES: "400000",
          PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS: "6000",
        },
      });
      expect(snapshot["call:getSessionIsolationLevel"]).toBe("full");
      expect(snapshot["call:getSessionPersistenceConfig"]).toEqual({
        filePreloadSanitizeMinBytes: 2000000,
        toolResultMaxPersistBytes: 400000,
        toolResultPreviewChars: 6000,
      });
      for (const envKey of [
        "PICLAW_SESSION_ISOLATION",
        "PICLAW_SESSION_TOOL_RESULT_MAX_PERSIST_BYTES",
        "PICLAW_SESSION_TOOL_RESULT_PREVIEW_CHARS",
      ]) expectCompatWarningOnce(stderr, envKey);
      expect(stderr).not.toContain('"envKey":"PICLAW_SESSION_FILE_PRELOAD_SANITIZE_MIN_BYTES"');
    } finally {
      workspace.cleanup();
    }
  });

  test("session isolation setter persists without mutating compatibility env", async () => {
    await withFreshConfig({ env: { PICLAW_SESSION_ISOLATION: "full" } }, async ({ workspace, config }) => {
      expect(config.setSessionIsolationLevel("summary")).toBe("full");
      expect(config.getSessionIsolationLevel()).toBe("full");
      expect(process.env.PICLAW_SESSION_ISOLATION).toBe("full");
      const persisted = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
      expect(persisted).toMatchObject({ domains: { session: { isolation: "summary" } } });
    });
  });

  test("watchdog domain persists across restart with ordered compatibility aliases", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-watchdog-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          watchdog: { enabled: true, timeoutMs: 120000, escalateOnStall: false, externalMonitorEnabled: true },
        },
      });
      const persisted = runConfigSubprocess(workspace, ["call:getProgressWatchdogConfig", "call:getCompactionRuntimeConfig"], {
        env: {
          PICLAW_PROGRESS_WATCHDOG_ENABLED: undefined,
          PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: undefined,
          PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL: undefined,
          PICLAW_PROGRESS_WATCHDOG_ESCALATE_ON_STALL: undefined,
          PICLAW_EXTERNAL_PROGRESS_WATCHDOG: undefined,
        },
      }).snapshot;
      expect(persisted["call:getProgressWatchdogConfig"]).toEqual({ enabled: true, timeoutMs: 120000, escalateOnStall: false, externalMonitorEnabled: true });
      expect(persisted["call:getCompactionRuntimeConfig"]).toMatchObject({ progressWatchdogEnabled: true, progressWatchdogTimeoutMs: 120000 });

      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getProgressWatchdogConfig"], {
        env: {
          PICLAW_PROGRESS_WATCHDOG_ENABLED: "0",
          PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: "invalid",
          PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL: "restart",
          PICLAW_PROGRESS_WATCHDOG_ESCALATE_ON_STALL: "0",
          PICLAW_EXTERNAL_PROGRESS_WATCHDOG: "disabled",
        },
      });
      expect(snapshot["call:getProgressWatchdogConfig"]).toEqual({ enabled: false, timeoutMs: 120000, escalateOnStall: true, externalMonitorEnabled: false });
      for (const envKey of [
        "PICLAW_PROGRESS_WATCHDOG_ENABLED",
        "PICLAW_PROGRESS_WATCHDOG_RESTART_ON_STALL",
        "PICLAW_EXTERNAL_PROGRESS_WATCHDOG",
      ]) expectCompatWarningOnce(stderr, envKey);
      expect(stderr).not.toContain('"envKey":"PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS"');
      expect(stderr).not.toContain('"envKey":"PICLAW_PROGRESS_WATCHDOG_ESCALATE_ON_STALL"');
    } finally {
      workspace.cleanup();
    }
  });

  test("compaction and agent ceiling domains preserve restart and compatibility precedence", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-compaction-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          agent: { toolUseMessageBudget: 72, midTurnToolExecutionHardCeiling: 48 },
          compaction: {
            autoCompactionEnabled: false,
            smartCompactionMethod: "pipelined",
            timeoutMs: 400000,
            backoffBaseMs: 120000,
            backoffMaxMs: 600000,
            systemPromptOverheadTokens: 5000,
            compactionRequestOverheadTokens: 1200,
            tokenEstimateSafetyMultiplier: 1.25,
            progressiveCompaction: true,
            smartCompactionReasoning: "low",
          },
        },
      });
      const names = ["call:getCompactionRuntimeConfig", "call:getMidTurnToolExecutionHardCeiling"];
      const persisted = runConfigSubprocess(workspace, names, { env: {
        PICLAW_AUTO_COMPACTION_ENABLED: undefined,
        PICLAW_SMART_COMPACTION_METHOD: undefined,
        PICLAW_COMPACTION_TIMEOUT_MS: undefined,
        PICLAW_COMPACTION_BACKOFF_BASE_MS: undefined,
        PICLAW_COMPACTION_BACKOFF_MAX_MS: undefined,
        PICLAW_COMPACTION_THRESHOLD_PERCENT: undefined,
        PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: undefined,
        PICLAW_AUTO_COMPACTION_SCOPE: undefined,
        PICLAW_COMPACTION_HARD_CEILING_PERCENT: undefined,
        PICLAW_COMPACTION_WARNING_THRESHOLD: undefined,
        PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR: undefined,
        PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: undefined,
        PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: undefined,
        PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER: undefined,
        PICLAW_PROGRESSIVE_COMPACTION: undefined,
        PICLAW_SMART_COMPACTION_REASONING: undefined,
        PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: undefined,
      } }).snapshot;
      expect(persisted["call:getCompactionRuntimeConfig"]).toMatchObject({
        autoCompactionEnabled: false,
        systemPromptOverheadTokens: 5000, compactionRequestOverheadTokens: 1200,
        tokenEstimateSafetyMultiplier: 1.25,
      });
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("timeoutMs");
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffBaseMs");
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffMaxMs");
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("progressiveCompaction");
      expect(persisted["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionReasoning");
      expect(persisted["call:getMidTurnToolExecutionHardCeiling"]).toBe(72);

      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { env: {
        PICLAW_AUTO_COMPACTION_ENABLED: "1",
        PICLAW_SMART_COMPACTION_METHOD: "traditional pipelined",
        PICLAW_COMPACTION_TIMEOUT_MS: "450000",
        PICLAW_COMPACTION_BACKOFF_BASE_MS: "900000",
        PICLAW_COMPACTION_BACKOFF_MAX_MS: "100000",
        PICLAW_COMPACTION_THRESHOLD_PERCENT: "invalid",
        PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: "0",
        PICLAW_AUTO_COMPACTION_SCOPE: "total",
        PICLAW_COMPACTION_HARD_CEILING_PERCENT: "100",
        PICLAW_COMPACTION_WARNING_THRESHOLD: "5",
        PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR: "0.5",
        PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: "6000",
        PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: "1500",
        PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER: "1.5",
        PICLAW_PROGRESSIVE_COMPACTION: "1",
        PICLAW_SMART_COMPACTION_REASONING: "high",
        PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "9999",
      } });
      expect(snapshot["call:getCompactionRuntimeConfig"]).toMatchObject({
        autoCompactionEnabled: true,
        systemPromptOverheadTokens: 6000, compactionRequestOverheadTokens: 1500,
        tokenEstimateSafetyMultiplier: 1.5,
      });
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("timeoutMs");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffBaseMs");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffMaxMs");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("progressiveCompaction");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionReasoning");
      expect(snapshot["call:getMidTurnToolExecutionHardCeiling"]).toBe(512);
      for (const envKey of [
        "PICLAW_AUTO_COMPACTION_ENABLED", "PICLAW_SMART_COMPACTION_METHOD", "PICLAW_COMPACTION_TIMEOUT_MS",
        "PICLAW_COMPACTION_BACKOFF_BASE_MS", "PICLAW_COMPACTION_BACKOFF_MAX_MS", "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
        "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS", "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
        "PICLAW_PROGRESSIVE_COMPACTION", "PICLAW_SMART_COMPACTION_REASONING",
        "PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING",
      ]) {
        if (/PICLAW_(SMART_COMPACTION|PROGRESSIVE_COMPACTION|COMPACTION_(TIMEOUT|BACKOFF))/.test(envKey)) expect(stderr).not.toContain('"envKey":"' + envKey + '"');
        else expectCompatWarningOnce(stderr, envKey);
      }
      expect(stderr).not.toContain('"envKey":"PICLAW_COMPACTION_THRESHOLD_PERCENT"');
    } finally {
      workspace.cleanup();
    }
  });

  test("C3 compaction compatibility aliases resolve from .env without mutating process.env", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-c3-envfile-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          compaction: {
            systemPromptOverheadTokens: 5_000,
            compactionRequestOverheadTokens: 1_200,
            tokenEstimateSafetyMultiplier: 1.25,
            progressiveCompaction: false,
            smartCompactionReasoning: "low",
          },
        },
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS=6000",
        "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS=1500",
        "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER=1.5",
        "PICLAW_PROGRESSIVE_COMPACTION=1",
        "PICLAW_SMART_COMPACTION_REASONING=medium",
      ].join("\n"), "utf8");
      const names = [
        "call:getCompactionRuntimeConfig",
        "env:PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
        "env:PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
        "env:PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
        "env:PICLAW_PROGRESSIVE_COMPACTION",
        "env:PICLAW_SMART_COMPACTION_REASONING",
        "env-unchanged:PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
        "env-unchanged:PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
        "env-unchanged:PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
        "env-unchanged:PICLAW_PROGRESSIVE_COMPACTION",
        "env-unchanged:PICLAW_SMART_COMPACTION_REASONING",
      ];
      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { env: {
        PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: undefined,
        PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: undefined,
        PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER: "2",
        PICLAW_PROGRESSIVE_COMPACTION: undefined,
        PICLAW_SMART_COMPACTION_REASONING: undefined,
      }, noEnvFile: true });

      expect(snapshot["call:getCompactionRuntimeConfig"]).toMatchObject({
        systemPromptOverheadTokens: 6000,
        compactionRequestOverheadTokens: 1500,
        tokenEstimateSafetyMultiplier: 2,
      });
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("progressiveCompaction");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionReasoning");
      expect(snapshot["env:PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS"]).toBeNull();
      expect(snapshot["env:PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS"]).toBeNull();
      expect(snapshot["env:PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER"]).toBe("2");
      expect(snapshot["env:PICLAW_PROGRESSIVE_COMPACTION"]).toBeNull();
      expect(snapshot["env:PICLAW_SMART_COMPACTION_REASONING"]).toBeNull();
      expect(snapshot["env-unchanged:PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS"]).toBe(true);
      expect(snapshot["env-unchanged:PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS"]).toBe(true);
      expect(snapshot["env-unchanged:PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER"]).toBe(true);
      expect(snapshot["env-unchanged:PICLAW_PROGRESSIVE_COMPACTION"]).toBe(true);
      expect(snapshot["env-unchanged:PICLAW_SMART_COMPACTION_REASONING"]).toBe(true);
      for (const envKey of [
        "PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS",
        "PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS",
        "PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER",
        "PICLAW_PROGRESSIVE_COMPACTION",
        "PICLAW_SMART_COMPACTION_REASONING",
      ]) {
        if (/PICLAW_(SMART_COMPACTION|PROGRESSIVE_COMPACTION|COMPACTION_(TIMEOUT|BACKOFF))/.test(envKey)) expect(stderr).not.toContain('"envKey":"' + envKey + '"');
        else expectCompatWarningOnce(stderr, envKey);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("C3 invalid compatibility aliases retain persisted and default config", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-c3-invalid-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          compaction: {
            systemPromptOverheadTokens: 5_000,
            compactionRequestOverheadTokens: 1_200,
            tokenEstimateSafetyMultiplier: 1.25,
            progressiveCompaction: true,
            smartCompactionReasoning: "low",
          },
        },
      });
      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getCompactionRuntimeConfig"], { env: {
        PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS: "0",
        PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS: "bad",
        PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER: "0.5",
        PICLAW_PROGRESSIVE_COMPACTION: "not-one",
        PICLAW_SMART_COMPACTION_REASONING: "extreme",
      } });
      expect(snapshot["call:getCompactionRuntimeConfig"]).toMatchObject({
        systemPromptOverheadTokens: 5_000,
        compactionRequestOverheadTokens: 1_200,
        tokenEstimateSafetyMultiplier: 1.25,
      });
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("progressiveCompaction");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionReasoning");
      expect(stderr).not.toContain('"envKey":"PICLAW_SYSTEM_PROMPT_OVERHEAD_TOKENS"');
      expect(stderr).not.toContain('"envKey":"PICLAW_COMPACTION_REQUEST_OVERHEAD_TOKENS"');
      expect(stderr).not.toContain('"envKey":"PICLAW_TOKEN_ESTIMATE_SAFETY_MULTIPLIER"');
      expect(stderr).not.toContain('"envKey":"PICLAW_PROGRESSIVE_COMPACTION"');
      expect(stderr).not.toContain('"envKey":"PICLAW_SMART_COMPACTION_REASONING"');
    } finally {
      workspace.cleanup();
    }
  });

  test("tools integration domain persists across restart with compatibility precedence", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-tools-integration-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          tools: {
            githubCopilotDynamicModels: false,
            githubCopilotModelsTimeoutMs: 7_000,
            openRouterDefaultMaxTokens: 65_536,
            mcpToolTimeoutMs: 0,
          },
        },
      });
      const names = ["call:getToolsIntegrationConfig"];
      const persisted = runConfigSubprocess(workspace, names, { env: {
        PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS: undefined,
        PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS: undefined,
        PICLAW_OPENROUTER_DEFAULT_MAX_TOKENS: undefined,
        PICLAW_MCP_TOOL_TIMEOUT_MS: undefined,
      } }).snapshot;
      expect(persisted["call:getToolsIntegrationConfig"]).toMatchObject({
        githubCopilotDynamicModels: false,
        githubCopilotModelsTimeoutMs: 7_000,
        openRouterDefaultMaxTokens: 65_536,
        mcpToolTimeoutMs: 0,
      });

      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { env: {
        PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS: "yes",
        PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS: "200",
        PICLAW_OPENROUTER_DEFAULT_MAX_TOKENS: "131072",
        PICLAW_MCP_TOOL_TIMEOUT_MS: "45000",
      } });
      expect(snapshot["call:getToolsIntegrationConfig"]).toMatchObject({
        // Preserve legacy semantics: only 0/false/no disable discovery.
        githubCopilotDynamicModels: true,
        // Preserve the existing 500ms lower clamp.
        githubCopilotModelsTimeoutMs: 500,
        openRouterDefaultMaxTokens: 131_072,
        mcpToolTimeoutMs: 45_000,
      });
      for (const envKey of [
        "PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS",
        "PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS",
        "PICLAW_OPENROUTER_DEFAULT_MAX_TOKENS",
        "PICLAW_MCP_TOOL_TIMEOUT_MS",
      ]) expectCompatWarningOnce(stderr, envKey);
    } finally {
      workspace.cleanup();
    }
  });

  test("tools integration aliases resolve from .env without mutating process.env", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-tools-envfile-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: { tools: { githubCopilotDynamicModels: false, githubCopilotModelsTimeoutMs: 7_000, mcpToolTimeoutMs: 90_000 } },
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS=yes",
        "PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS=6000",
        "PICLAW_MCP_TOOL_TIMEOUT_MS=0",
      ].join("\n"), "utf8");
      const names = [
        "call:getToolsIntegrationConfig",
        "env:PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS",
        "env:PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS",
        "env:PICLAW_MCP_TOOL_TIMEOUT_MS",
        "env-unchanged:PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS",
        "env-unchanged:PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS",
        "env-unchanged:PICLAW_MCP_TOOL_TIMEOUT_MS",
      ];
      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { noEnvFile: true, env: {
        PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS: undefined,
        PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS: undefined,
        PICLAW_MCP_TOOL_TIMEOUT_MS: undefined,
      } });
      expect(snapshot["call:getToolsIntegrationConfig"]).toMatchObject({
        githubCopilotDynamicModels: true,
        githubCopilotModelsTimeoutMs: 6_000,
        mcpToolTimeoutMs: 0,
      });
      for (const envKey of [
        "PICLAW_GITHUB_COPILOT_DYNAMIC_MODELS",
        "PICLAW_GITHUB_COPILOT_MODELS_TIMEOUT_MS",
        "PICLAW_MCP_TOOL_TIMEOUT_MS",
      ]) {
        expect(snapshot[`env:${envKey}`]).toBeNull();
        expect(snapshot[`env-unchanged:${envKey}`]).toBe(true);
        expectCompatWarningOnce(stderr, envKey);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("search match mode uses domains.tools precedence and no env mutation", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-search-match-");
    try {
      writeWorkspaceConfig(workspace.workspace, { domains: { tools: { searchMatchMode: "or" } } });
      const compat = runConfigSubprocess(workspace, [
        "call:getSearchMatchMode",
        "env-unchanged:PICLAW_SEARCH_MATCH_MODE",
      ], { env: { PICLAW_SEARCH_MATCH_MODE: "and" } });
      expect(compat.snapshot["call:getSearchMatchMode"]).toBe("and");
      expect(compat.snapshot["env-unchanged:PICLAW_SEARCH_MATCH_MODE"]).toBe(true);
      expectCompatWarningOnce(compat.stderr, "PICLAW_SEARCH_MATCH_MODE");

      const persisted = runConfigSubprocess(workspace, ["call:getSearchMatchMode"], {
        noEnvFile: true,
        env: { PICLAW_SEARCH_MATCH_MODE: undefined },
      });
      expect(persisted.snapshot["call:getSearchMatchMode"]).toBe("or");
    } finally {
      workspace.cleanup();
    }
  });

  test("tools workspace aliases preserve restart precedence and do not mutate process.env", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-tools-workspace-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: { tools: {
          packageRoot: "/persisted/package",
          unknownModelContextWindow: 80_000,
          scopedModelsOnly: false,
          workspaceSearchRoots: ["persisted"],
          workspaceSearchExtensions: [".log"],
        } },
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_PACKAGE_ROOT=/dotenv/package",
        "PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW=90000",
        "PICLAW_SCOPED_MODELS_ONLY=1",
        "PICLAW_WORKSPACE_SEARCH_ROOTS=docs,notes",
        "PICLAW_WORKSPACE_SEARCH_EXTENSIONS=.vtt,csv",
      ].join("\n"), "utf8");
      const envKeys = [
        "PICLAW_PACKAGE_ROOT",
        "PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW",
        "PICLAW_SCOPED_MODELS_ONLY",
        "PICLAW_WORKSPACE_SEARCH_ROOTS",
        "PICLAW_WORKSPACE_SEARCH_EXTENSIONS",
      ];
      const names = ["call:getToolsIntegrationConfig", ...envKeys.map((key) => `env:${key}`), ...envKeys.map((key) => `env-unchanged:${key}`)];
      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { noEnvFile: true, env: {
        ...Object.fromEntries(envKeys.map((key) => [key, undefined])),
        PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW: "95000",
      } });
      expect(snapshot["call:getToolsIntegrationConfig"]).toMatchObject({
        packageRoot: "/dotenv/package",
        unknownModelContextWindow: 95_000,
        scopedModelsOnly: true,
        workspaceSearchRoots: ["docs", "notes"],
        workspaceSearchExtensions: [".vtt", "csv"],
      });
      for (const envKey of envKeys) {
        expect(snapshot[`env:${envKey}`]).toBe(envKey === "PICLAW_UNKNOWN_MODEL_CONTEXT_WINDOW" ? "95000" : null);
        expect(snapshot[`env-unchanged:${envKey}`]).toBe(true);
        expectCompatWarningOnce(stderr, envKey);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("tool output presentation domain preserves precedence and avoids env mutation", async () => {
    const workspace = createTempWorkspace("piclaw-domain-config-tool-output-presentation-");
    try {
      writeWorkspaceConfig(workspace.workspace, { domains: { tools: {
        toolOutputStoreBytes: 7_000,
        toolOutputStoreLines: 50,
        toolOutputPreviewLines: 9,
        toolOutputPreviewLineChars: 240,
      } } });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_TOOL_OUTPUT_STORE_BYTES=8000",
        "PICLAW_TOOL_OUTPUT_STORE_LINES=60",
        "PICLAW_TOOL_OUTPUT_PREVIEW_LINES=10",
        "PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS=260",
      ].join("\n"), "utf8");
      const envKeys = ["PICLAW_TOOL_OUTPUT_STORE_BYTES", "PICLAW_TOOL_OUTPUT_STORE_LINES", "PICLAW_TOOL_OUTPUT_PREVIEW_LINES", "PICLAW_TOOL_OUTPUT_PREVIEW_LINE_CHARS"];
      const names = ["call:getToolOutputPresentationConfig", ...envKeys.map((key) => `env:${key}`), ...envKeys.map((key) => `env-unchanged:${key}`)];
      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { noEnvFile: true, env: {
        ...Object.fromEntries(envKeys.map((key) => [key, undefined])),
        PICLAW_TOOL_OUTPUT_STORE_BYTES: "9000",
      } });
      expect(snapshot["call:getToolOutputPresentationConfig"]).toEqual({ storeBytes: 9_000, storeLines: 60, previewLines: 10, previewLineChars: 260 });
      for (const envKey of envKeys) {
        expect(snapshot[`env:${envKey}`]).toBe(envKey === "PICLAW_TOOL_OUTPUT_STORE_BYTES" ? "9000" : null);
        expect(snapshot[`env-unchanged:${envKey}`]).toBe(true);
        expectCompatWarningOnce(stderr, envKey);
      }
    } finally { workspace.cleanup(); }

    await withFreshConfig({ env: { PICLAW_TOOL_OUTPUT_STORE_BYTES: undefined } }, async ({ workspace, config }) => {
      expect(config.setToolOutputStoreThreshold(12_345)).toBe(12_345);
      expect(process.env.PICLAW_TOOL_OUTPUT_STORE_BYTES).toBeUndefined();
      const persisted = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
      expect(persisted.domains?.tools?.toolOutputStoreBytes).toBe(12_345);
    });
  });

  test("tool output policy domain preserves precedence and avoids env mutation", async () => {
    const workspace = createTempWorkspace("piclaw-domain-config-tool-output-policy-");
    const envKeys = [
      "PICLAW_TOOL_OUTPUT_RETENTION_MS", "PICLAW_TOOL_OUTPUT_RETENTION_DAYS", "PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS",
      "PICLAW_TOOL_OUTPUT_STORE_THRESHOLDS_BY_TOOL", "PICLAW_TOOL_RESULT_COMPACTION_ENABLED", "PICLAW_TOOL_RESULT_COMPACTION_TOOLS",
      "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS",
      "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS", "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS",
    ];
    try {
      writeWorkspaceConfig(workspace.workspace, { domains: { tools: {
        toolOutputRetentionMs: 123_000,
        toolOutputCleanupIntervalMs: 45_000,
        toolResultCompactionEnabled: false,
        toolResultCompactionTools: ["bash"],
        toolResultCompactionThresholdsByTool: { bash: { bytes: 7000 } },
        toolResultSemanticSummaryEnabled: false,
        toolResultSemanticSummaryMaxInputChars: 20_000,
        toolResultSemanticSummaryMaxTokens: 512,
        toolResultSemanticSummaryTimeoutMs: 20_000,
      } } });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_TOOL_OUTPUT_RETENTION_DAYS=2",
        "PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS=60000",
        'PICLAW_TOOL_OUTPUT_STORE_THRESHOLDS_BY_TOOL={"bash":{"bytes":8000,"lines":80}}',
        "PICLAW_TOOL_RESULT_COMPACTION_ENABLED=1",
        "PICLAW_TOOL_RESULT_COMPACTION_TOOLS=bash,exec_batch",
        "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED=1",
        "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS=24000",
        "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS=640",
        "PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS=30000",
      ].join("\n"), "utf8");
      const names = ["call:getToolsIntegrationConfig", "same:getToolOutputConfig:TOOL_OUTPUT_CONFIG", ...envKeys.map((key) => `env-unchanged:${key}`)];
      const { snapshot, stderr } = runConfigSubprocess(workspace, names, { noEnvFile: true, env: {
        ...Object.fromEntries(envKeys.map((key) => [key, undefined])),
        PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: "768",
      } });
      expect(snapshot["call:getToolsIntegrationConfig"]).toMatchObject({
        toolOutputRetentionMs: 2 * 24 * 60 * 60 * 1000,
        toolOutputCleanupIntervalMs: 60_000,
        toolResultCompactionEnabled: true,
        toolResultCompactionTools: ["bash", "exec_batch"],
        toolResultCompactionThresholdsByTool: { bash: { bytes: 8000, lines: 80 } },
        toolResultSemanticSummaryEnabled: true,
        toolResultSemanticSummaryMaxInputChars: 24_000,
        toolResultSemanticSummaryMaxTokens: 768,
        toolResultSemanticSummaryTimeoutMs: 30_000,
      });
      expect(snapshot["same:getToolOutputConfig:TOOL_OUTPUT_CONFIG"]).toBe(true);
      for (const envKey of envKeys) {
        expect(snapshot[`env-unchanged:${envKey}`]).toBe(true);
        if (envKey !== "PICLAW_TOOL_OUTPUT_RETENTION_MS") expectCompatWarningOnce(stderr, envKey);
      }
    } finally { workspace.cleanup(); }

    await withFreshConfig({ env: Object.fromEntries(envKeys.map((key) => [key, undefined])) }, async ({ workspace, config }) => {
      config.setToolResultCompactionEnabled(false);
      config.setToolResultCompactionTools(["bash", "proxmox"]);
      config.setToolResultSemanticSummaryConfig({ enabled: true, maxInputChars: 500, maxTokens: 4096, timeoutMs: 300000 });
      for (const envKey of envKeys) expect(process.env[envKey]).toBeUndefined();
      const persisted = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
      expect(persisted.domains?.tools).toMatchObject({
        toolResultCompactionEnabled: false,
        toolResultCompactionTools: ["bash", "proxmox"],
        toolResultSemanticSummaryEnabled: true,
        toolResultSemanticSummaryMaxInputChars: 500,
        toolResultSemanticSummaryMaxTokens: 4096,
        toolResultSemanticSummaryTimeoutMs: 300000,
      });
    });
  });

  test("historical provider-native compaction settings remain stored but are not effective policy", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-provider-compaction-");
    try {
      writeWorkspaceConfig(workspace.workspace, { domains: { compaction: {
        remoteCompactionEnabled: true,
        remoteCompactionTimeoutMs: 45000,
      } } });
      const snapshot = runConfigSubprocess(workspace, ["call:getCompactionRuntimeConfig"]).snapshot;

      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("remoteCompactionEnabled");
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("remoteCompactionTimeoutMs");
    } finally { workspace.cleanup(); }
  });

  test("persisted web domain settings win in a fresh process when compatibility aliases are absent", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-restart-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          identity: {
            assistantName: "Persisted Assistant",
            assistantAvatar: "/persisted-assistant.png",
            userName: "Persisted User",
            userAvatar: "/persisted-user.png",
            userAvatarBackground: "#123456",
          },
          web: {
                idleTimeout: 123,
            persistThinking: true,
            persistThinkingMaxChars: 4321,
            totpWindow: 7,
            sessionTtl: 86400,
            passkeyMode: "passkey-only",
            pushSubscriptionCap: 24,
            pushVapidSubject: "mailto:domain@example.test",
            terminalEnabled: false,
            terminalImageProtocol: "kitty",
            composeUploadLimitMb: 48,
            workspaceUploadLimitMb: 512,
            notificationDebugLabels: true,
            vncAllowDirect: false,
            vncTargets: '[{"label":"persisted"}]',
            debugCardSubmissions: true,
            trustProxy: true,
          },
        },
      });
      const snapshot = loadConfigInSubprocess(workspace, [
        "call:getIdentityConfig",
        "call:getWebServerConfig",
        "call:getWebRuntimeConfig",
        "call:isPersistThinkingEnabled",
        "call:getPersistThinkingMaxChars",
      ], {
        env: {
          PICLAW_ASSISTANT_NAME: undefined,
          PICLAW_ASSISTANT_AVATAR: undefined,
          PICLAW_USER_NAME: undefined,
          PICLAW_USER_AVATAR: undefined,
          PICLAW_USER_AVATAR_BACKGROUND: undefined,
          PICLAW_WEB_UI_MODE: undefined,
          PICLAW_WEB_IDLE_TIMEOUT: undefined,
          PICLAW_WEB_PERSIST_THINKING: undefined,
          PICLAW_WEB_PERSIST_THINKING_MAX_CHARS: undefined,
          PICLAW_WEB_TOTP_WINDOW: undefined,
          PICLAW_WEB_SESSION_TTL: undefined,
          PICLAW_WEB_PASSKEY_MODE: undefined,
          PICLAW_WEB_PUSH_SUBSCRIPTION_CAP: undefined,
          PICLAW_WEB_PUSH_VAPID_SUBJECT: undefined,
          PICLAW_WEB_TERMINAL_ENABLED: undefined,
          PICLAW_TERMINAL_IMAGE_PROTOCOL: undefined,
          PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_WEB_NOTIFICATION_DEBUG_LABELS: undefined,
          PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
          PICLAW_VNC_ALLOW_DIRECT: undefined,
          PICLAW_WEB_VNC_TARGETS: undefined,
          PICLAW_VNC_TARGETS: undefined,
          PICLAW_DEBUG_CARD_SUBMISSIONS: undefined,
          PICLAW_TRUST_PROXY: undefined,
        },
      });
      expect(snapshot["call:getIdentityConfig"]).toEqual({
        assistantName: "Persisted Assistant",
        assistantAvatar: "/persisted-assistant.png",
        userName: "Persisted User",
        userAvatar: "/persisted-user.png",
        userAvatarBackground: "#123456",
      });
      expect(snapshot["call:getWebServerConfig"]).toMatchObject({ idleTimeout: 123 });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({
        totpWindow: 7,
        sessionTtl: 86400,
        passkeyMode: "passkey-only",
        terminalEnabled: false,
        terminalImageProtocol: "kitty",
        pushSubscriptionCap: 24,
        pushVapidSubject: "mailto:domain@example.test",
        composeUploadLimitMb: 512,
        workspaceUploadLimitMb: 512,
        notificationDebugLabels: true,
        vncAllowDirect: false,
        vncTargetsRaw: '[{"label":"persisted"}]',
        debugCardSubmissions: true,
        trustProxy: true,
      });
      expect(snapshot["call:isPersistThinkingEnabled"]).toBe(true);
      expect(snapshot["call:getPersistThinkingMaxChars"]).toBe(4321);
    } finally {
      workspace.cleanup();
    }
  });

  test("compatibility aliases override persisted domain settings and warn once", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-compat-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          identity: { assistantName: "Persisted Assistant" },
          web: {
            uiMode: "classic",
            idleTimeout: 5,
            totpWindow: 9,
            sessionTtl: 120,
            passkeyMode: "passkey-only",
            pushSubscriptionCap: 4,
            pushVapidSubject: "mailto:persisted@example.test",
            terminalEnabled: true,
            terminalImageProtocol: "sixel",
            trustProxy: false,
          },
        },
      });
      const { snapshot, stderr } = runConfigSubprocess(workspace, [
        "call:getIdentityConfig",
        "call:getWebServerConfig",
        "call:getWebRuntimeConfig",
      ], {
        env: {
          PICLAW_ASSISTANT_NAME: "Compatibility Assistant",
          PICLAW_WEB_UI_MODE: "visual",
          PICLAW_WEB_IDLE_TIMEOUT: "61",
          PICLAW_WEB_TOTP_WINDOW: "2",
          PICLAW_WEB_SESSION_TTL: "600",
          PICLAW_WEB_PASSKEY_MODE: "totp-only",
          PICLAW_WEB_PUSH_SUBSCRIPTION_CAP: "16",
          PICLAW_WEB_PUSH_VAPID_SUBJECT: "mailto:compat@example.test",
          PICLAW_WEB_TERMINAL_ENABLED: "0",
          PICLAW_TERMINAL_IMAGE_PROTOCOL: "kitty",
          PICLAW_TRUST_PROXY: "1",
        },
      });
      expect(snapshot["call:getIdentityConfig"]).toMatchObject({ assistantName: "Compatibility Assistant" });
      expect(snapshot["call:getWebServerConfig"]).toMatchObject({ idleTimeout: 61 });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({
        totpWindow: 2,
        sessionTtl: 600,
        passkeyMode: "totp-only",
        pushSubscriptionCap: 16,
        pushVapidSubject: "mailto:compat@example.test",
        terminalEnabled: false,
        terminalImageProtocol: "kitty",
        trustProxy: true,
      });
      for (const envKey of [
        "PICLAW_ASSISTANT_NAME",
        "PICLAW_WEB_IDLE_TIMEOUT",
        "PICLAW_WEB_TOTP_WINDOW",
        "PICLAW_WEB_SESSION_TTL",
        "PICLAW_WEB_PASSKEY_MODE",
        "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP",
        "PICLAW_WEB_PUSH_VAPID_SUBJECT",
        "PICLAW_WEB_TERMINAL_ENABLED",
        "PICLAW_TERMINAL_IMAGE_PROTOCOL",
        "PICLAW_TRUST_PROXY",
      ]) {
        expectCompatWarningOnce(stderr, envKey);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("compatibility aliases preserve legacy push and terminal fallback behavior", () => {
    const workspace = createTempWorkspace("piclaw-domain-config-legacy-fallback-");
    try {
      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getWebRuntimeConfig"], {
        env: {
          PICLAW_WEB_PUSH_SUBSCRIPTION_CAP: "invalid",
          PICLAW_WEB_PUSH_VAPID_SUBJECT: "   ",
          PICLAW_TERMINAL_IMAGE_PROTOCOL: "",
        },
      });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({
        pushSubscriptionCap: 32,
        pushVapidSubject: "mailto:notifications@localhost.invalid",
        terminalImageProtocol: "iterm2",
      });
      for (const envKey of [
        "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP",
        "PICLAW_WEB_PUSH_VAPID_SUBJECT",
        "PICLAW_TERMINAL_IMAGE_PROTOCOL",
      ]) {
        expectCompatWarningOnce(stderr, envKey);
      }
    } finally {
      workspace.cleanup();
    }
  });

  test("CLI idle timeout beats compatibility env and persisted domain values", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        domains: {
          web: {
            idleTimeout: 7,
          },
        },
      });
      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getWebServerConfig"], {
        env: {
          PICLAW_WEB_PORT: "8080",
          PICLAW_WEB_HOST: "0.0.0.0",
          PICLAW_WEB_IDLE_TIMEOUT: "15",
          PICLAW_WEB_TLS_CERT: "/env/cert.pem",
          PICLAW_WEB_TLS_KEY: "/env/key.pem",
        },
        args: ["--port", "9090", "--host=127.0.0.1", "--idle-timeout", "45", "--tls-cert", "/cli/cert.pem", "--tls-key=/cli/key.pem"],
      });
      expect(snapshot["call:getWebServerConfig"]).toEqual({ port: 9090, host: "127.0.0.1", idleTimeout: 45, tlsCert: "/cli/cert.pem", tlsKey: "/cli/key.pem" });
      expect(stderr).not.toContain('"envKey":"PICLAW_WEB_IDLE_TIMEOUT"');
    } finally {
      workspace.cleanup();
    }
  });

  test("VNC compatibility aliases prefer PICLAW_WEB_* over PICLAW_* and legacy config", () => {
    const workspace = createTempWorkspace("piclaw-vnc-compat-");
    try {
      writeWorkspaceConfig(workspace.workspace, {
        web: {
          vncAllowDirect: false,
          vncTargets: '[{"label":"legacy-nested"}]',
        },
        webVncAllowDirect: false,
        webVncTargets: '[{"label":"legacy-top"}]',
      });
      const { snapshot, stderr } = runConfigSubprocess(workspace, ["call:getWebRuntimeConfig"], {
        env: {
          PICLAW_WEB_VNC_ALLOW_DIRECT: "1",
          PICLAW_VNC_ALLOW_DIRECT: "0",
          PICLAW_WEB_VNC_TARGETS: '[{"label":"primary"}]',
          PICLAW_VNC_TARGETS: '[{"label":"legacy-alias"}]',
        },
      });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({
        vncAllowDirect: true,
        vncTargetsRaw: '[{"label":"primary"}]',
      });
      expectCompatWarningOnce(stderr, "PICLAW_WEB_VNC_ALLOW_DIRECT");
      expectCompatWarningOnce(stderr, "PICLAW_WEB_VNC_TARGETS");
      expect(stderr).not.toContain('"envKey":"PICLAW_VNC_ALLOW_DIRECT"');
      expect(stderr).not.toContain('"envKey":"PICLAW_VNC_TARGETS"');
    } finally {
      workspace.cleanup();
    }
  });

  test("identity setters keep exported values and routing config in sync", async () => {
    await withFreshConfig({}, async ({ config }) => {
      config.setAssistantName("  Smith  ");
      config.setAssistantAvatar("  https://example.test/assistant.png  ");
      config.setUserName("  Rita  ");
      config.setUserAvatar("  https://example.test/user.png  ");
      config.setUserAvatarBackground("  #abcdef  ");

      expect(config.ASSISTANT_NAME).toBe("Smith");
      expect(config.ASSISTANT_AVATAR).toBe("https://example.test/assistant.png");
      expect(config.USER_NAME).toBe("Rita");
      expect(config.USER_AVATAR).toBe("https://example.test/user.png");
      expect(config.USER_AVATAR_BACKGROUND).toBe("#abcdef");
      expect(config.getIdentityConfig()).toEqual({
        assistantName: "Smith",
        assistantAvatar: "https://example.test/assistant.png",
        userName: "Rita",
        userAvatar: "https://example.test/user.png",
        userAvatarBackground: "#abcdef",
      });
      expect(config.getRoutingConfig().triggerPattern.test("hello @Smith")).toBe(true);
      expect(config.getRoutingConfig().triggerPattern.test("hello @PiClaw")).toBe(false);
    });
  });

  test("retention and cleanup integer env rejects malformed suffixes without changing fallback policy", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      const malformed = loadConfigInSubprocess(workspace, ["call:getToolOutputConfig"], {
        env: {
          PICLAW_TOOL_OUTPUT_RETENTION_MS: undefined,
          PICLAW_TOOL_OUTPUT_RETENTION_DAYS: "2oops",
          PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "30000oops",
        },
      });
      expect(malformed["call:getToolOutputConfig"]).toEqual({
        retentionMs: 30 * 24 * 60 * 60 * 1000,
        cleanupIntervalMs: 15 * 60 * 1000,
      });

      const precedenceAndCap = loadConfigInSubprocess(workspace, ["call:getToolOutputConfig"], {
        env: {
          PICLAW_TOOL_OUTPUT_RETENTION_MS: undefined,
          PICLAW_TOOL_OUTPUT_RETENTION_DAYS: "45",
          PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "30000",
        },
      });
      expect(precedenceAndCap["call:getToolOutputConfig"]).toEqual({
        retentionMs: 30 * 24 * 60 * 60 * 1000,
        cleanupIntervalMs: 30_000,
      });
    } finally {
      workspace.cleanup();
    }
  });

  test("legacy mid-turn ceiling aliases resolve through the authoritative execution budget", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      const defaults = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: undefined },
      });
      expect(defaults["call:getMidTurnToolExecutionHardCeiling"]).toBe(64);

      const overridden = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "96" },
      });
      expect(overridden["call:getMidTurnToolExecutionHardCeiling"]).toBe(96);

      const invalid = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "not-a-number" },
      });
      expect(invalid["call:getMidTurnToolExecutionHardCeiling"]).toBe(64);

      const capped = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "9999" },
      });
      expect(capped["call:getMidTurnToolExecutionHardCeiling"]).toBe(512);
    } finally {
      workspace.cleanup();
    }
  });

  test("mutable general-setting setters persist and apply immediately", async () => {
  });

  test("web terminal and VNC setters persist domain values without mutating assigned env vars", async () => {
    await withFreshConfig(
      {
        env: {
          PICLAW_WEB_TERMINAL_ENABLED: "1",
          PICLAW_WEB_VNC_ALLOW_DIRECT: "0",
          PICLAW_VNC_ALLOW_DIRECT: "1",
        },
      },
      async ({ workspace, config }) => {
        expect(config.setWebTerminalEnabled(false)).toBe(true);
        expect(config.setWebVncAllowDirect(true)).toBe(false);
        expect(config.getWebRuntimeConfig()).toMatchObject({
          terminalEnabled: true,
          vncAllowDirect: false,
        });
        expect(process.env.PICLAW_WEB_TERMINAL_ENABLED).toBe("1");
        expect(process.env.PICLAW_WEB_VNC_ALLOW_DIRECT).toBe("0");
        expect(process.env.PICLAW_VNC_ALLOW_DIRECT).toBe("1");

        const persisted = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
        expect(persisted).toMatchObject({
          domains: {
            web: {
              terminalEnabled: false,
              vncAllowDirect: true,
            },
          },
        });
      },
    );
  });

  test("scopedModelsOnly reads legacy config and persists under domains.tools without env mutation", async () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      writeWorkspaceConfig(workspace.workspace, { models: { scopedModelsOnly: true } });
      const snapshot = loadConfigInSubprocess(workspace, ["call:getScopedModelsOnly"], {
        env: { PICLAW_SCOPED_MODELS_ONLY: undefined },
      });
      expect(snapshot["call:getScopedModelsOnly"]).toBe(true);
    } finally {
      workspace.cleanup();
    }

    await withFreshConfig(
      { env: { PICLAW_SCOPED_MODELS_ONLY: undefined } },
      async ({ workspace, config }) => {
        expect(config.setScopedModelsOnly(false)).toBe(false);
        expect(config.getScopedModelsOnly()).toBe(false);
        expect(process.env.PICLAW_SCOPED_MODELS_ONLY).toBeUndefined();

        const parsed = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
        expect(parsed.domains?.tools?.scopedModelsOnly).toBe(false);
      },
    );
  });

  test("setWebTotpSecret persists updates while preserving unrelated web config and supports clearing", async () => {
    await withFreshConfig(
      {
        config: {
          web: {
            sessionTtl: 123,
            passkeyMode: "totp-only",
            totpSecret: "old-secret",
          },
        },
      },
      async ({ workspace, config }) => {
        const configPath = join(workspace.workspace, ".piclaw", "config.json");

        expect(config.setWebTotpSecret("  new-secret  ")).toBe("new-secret");
        expect(config.getWebRuntimeConfig().totpSecret).toBe("new-secret");
        expect(process.env.PICLAW_WEB_TOTP_SECRET).toBe("new-secret");

        let parsed = JSON.parse(readFileSync(configPath, "utf8"));
        expect(parsed.web).toEqual({
          sessionTtl: 123,
          passkeyMode: "totp-only",
          totpSecret: "new-secret",
        });

        expect(config.setWebTotpSecret("")).toBe("");
        expect(config.getWebRuntimeConfig().totpSecret).toBe("");
        expect(process.env.PICLAW_WEB_TOTP_SECRET).toBeUndefined();

        parsed = JSON.parse(readFileSync(configPath, "utf8"));
        expect(parsed.web).toEqual({
          sessionTtl: 123,
          passkeyMode: "totp-only",
        });
      },
    );
  });
});

for (const legacy of [
  { domains: { web: { uiMode: 'visual' } } },
  { web: { uiMode: 'visual' } },
  { uiMode: 'visual' },
]) {
  test('retired Visual configuration is ignored with one deprecation warning: ' + JSON.stringify(legacy), () => {
    const workspace = createTempWorkspace('piclaw-retired-ui-');
    try {
      writeWorkspaceConfig(workspace.workspace, legacy);
      const { snapshot, stderr } = runConfigSubprocess(workspace, ['call:getWebRuntimeConfig', 'call:isPersistThinkingEnabled', 'call:getPersistThinkingMaxChars']);
      expect(snapshot['call:getWebRuntimeConfig']).not.toHaveProperty('uiMode');
      expect(stderr.split('Visual UI has been removed; using Classic').length - 1).toBe(1);
      expect(JSON.parse(readFileSync(join(workspace.workspace, '.piclaw/config.json'), 'utf8'))).toEqual(legacy);
    } finally { workspace.cleanup(); }
  });
}

test('retired UI environment selection cannot restore Visual and warns once even with persisted settings', () => {
  const workspace = createTempWorkspace('piclaw-retired-ui-env-');
  try {
    writeWorkspaceConfig(workspace.workspace, { domains: { web: { uiMode: 'visual' } } });
    const { snapshot, stderr } = runConfigSubprocess(workspace, ['call:getWebRuntimeConfig'], { env: { PICLAW_WEB_UI_MODE: 'visual' } });
    expect(snapshot['call:getWebRuntimeConfig']).not.toHaveProperty('uiMode');
    expect(stderr.split('Visual UI has been removed; using Classic').length - 1).toBe(1);
  } finally { workspace.cleanup(); }
});
