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

function loadConfigInSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined> } = {},
): Record<string, any> {
  const proc = Bun.spawnSync({
    cmd: ["bun", CONFIG_SUBPROCESS, ...(options.args || [])],
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
  return JSON.parse(stdout || "{}");
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
        remoteInteropEnabled: true,
        remoteInteropAllowHttp: true,
        remoteInteropShortCircuitEnabled: true,
        remoteInstanceName: "relay",
        remoteInteropDecisionModel: "openai/gpt-4o",
      });
      writeFileSync(join(workspace.workspace, ".env"), [
        "PICLAW_LOG_LEVEL=debug",
        "PICLAW_ASSISTANT_AVATAR=https://env-file.example/avatar.png",
      ].join("\n"), "utf8");
      const snapshot = loadConfigInSubprocess(workspace, [
        "WORKSPACE_DIR", "STORE_DIR", "DATA_DIR",
        "call:getIdentityConfig", "call:getLoggingConfig", "call:getWebRuntimeConfig", "call:getToolActivationConfig", "call:getWorkspaceSearchConfig", "call:getRemoteInteropConfig",
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
          PICLAW_REMOTE_INTEROP_ENABLED: undefined,
          PICLAW_REMOTE_INTEROP_ALLOW_HTTP: undefined,
          PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK: undefined,
          PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED: undefined,
          PICLAW_REMOTE_INSTANCE_NAME: undefined,
          PICLAW_REMOTE_INTEROP_DECISION_MODEL: undefined,
        },
      });
      expect(snapshot.WORKSPACE_DIR).toBe(workspace.workspace);
      expect(snapshot.STORE_DIR).toBe(workspace.store);
      expect(snapshot.DATA_DIR).toBe(workspace.data);
      expect(snapshot["call:getIdentityConfig"]).toEqual({ assistantName: "Env Assistant", assistantAvatar: "https://env-file.example/avatar.png", userName: "Config User", userAvatar: "https://config.example/user.png", userAvatarBackground: "#123456" });
      expect(snapshot["call:getLoggingConfig"]).toEqual({ level: "debug" });
      expect(snapshot["call:getWebRuntimeConfig"]).toMatchObject({ passkeyMode: "totp-only", sessionTtl: 99, totpWindow: 3, internalSecret: "cfg-secret", terminalEnabled: false, vncAllowDirect: false, vncTargetsRaw: "", debugCardSubmissions: true, trustProxy: false, composeUploadLimitMb: 32, workspaceUploadLimitMb: 256 });
      expect(snapshot["call:getToolActivationConfig"]).toEqual({ additionalDefaultTools: ["search_workspace", "introspect_sql"] });
      expect(snapshot["call:getWorkspaceSearchConfig"]).toEqual({ roots: ["notes", ".pi/skills", "docs"], extraExtensions: [] });
      expect(snapshot["call:getRemoteInteropConfig"]).toEqual({ enabled: true, allowHttp: true, allowPrivateNetwork: false, shortCircuitEnabled: true, instanceName: "relay", decisionModel: "openai/gpt-4o" });
    } finally {
      workspace.cleanup();
    }
  });

  test("CLI flags override env-derived web server settings", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      const snapshot = loadConfigInSubprocess(workspace, ["call:getWebServerConfig"], {
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
      const malformed = loadConfigInSubprocess(workspace, ["call:getAgentLogConfig", "call:getToolOutputConfig"], {
        env: {
          PICLAW_AGENT_LOG_RETENTION_MS: "60000oops",
          PICLAW_AGENT_LOG_RETENTION_DAYS: "2",
          PICLAW_AGENT_LOG_CLEANUP_INTERVAL_MS: "120000oops",
          PICLAW_TOOL_OUTPUT_RETENTION_MS: undefined,
          PICLAW_TOOL_OUTPUT_RETENTION_DAYS: "2oops",
          PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "30000oops",
        },
      });
      expect(malformed["call:getAgentLogConfig"]).toEqual({
        retentionMs: 2 * 24 * 60 * 60 * 1000,
        cleanupIntervalMs: 60 * 60 * 1000,
      });
      expect(malformed["call:getToolOutputConfig"]).toEqual({
        retentionMs: 30 * 24 * 60 * 60 * 1000,
        cleanupIntervalMs: 15 * 60 * 1000,
      });

      const precedenceAndCap = loadConfigInSubprocess(workspace, ["call:getAgentLogConfig", "call:getToolOutputConfig"], {
        env: {
          PICLAW_AGENT_LOG_RETENTION_MS: "60000",
          PICLAW_AGENT_LOG_RETENTION_DAYS: "2",
          PICLAW_AGENT_LOG_CLEANUP_INTERVAL_MS: "120000",
          PICLAW_TOOL_OUTPUT_RETENTION_MS: undefined,
          PICLAW_TOOL_OUTPUT_RETENTION_DAYS: "45",
          PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "30000",
        },
      });
      expect(precedenceAndCap["call:getAgentLogConfig"]).toEqual({
        retentionMs: 60_000,
        cleanupIntervalMs: 120_000,
      });
      expect(precedenceAndCap["call:getToolOutputConfig"]).toEqual({
        retentionMs: 30 * 24 * 60 * 60 * 1000,
        cleanupIntervalMs: 30_000,
      });
    } finally {
      workspace.cleanup();
    }
  });

  test("mid-turn tool execution hard ceiling defaults, overrides, and clamps", () => {
    const workspace = createTempWorkspace("piclaw-config-");
    try {
      const defaults = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: undefined },
      });
      expect(defaults["call:getMidTurnToolExecutionHardCeiling"]).toBe(48);

      const overridden = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "96" },
      });
      expect(overridden["call:getMidTurnToolExecutionHardCeiling"]).toBe(96);

      const invalid = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "not-a-number" },
      });
      expect(invalid["call:getMidTurnToolExecutionHardCeiling"]).toBe(48);

      const capped = loadConfigInSubprocess(workspace, ["call:getMidTurnToolExecutionHardCeiling"], {
        env: { PICLAW_MID_TURN_TOOL_EXECUTION_HARD_CEILING: "9999" },
      });
      expect(capped["call:getMidTurnToolExecutionHardCeiling"]).toBe(512);
    } finally {
      workspace.cleanup();
    }
  });

  test("mutable general-setting setters persist and apply immediately", async () => {
    await withFreshConfig({}, async ({ workspace, config }) => {
      config.setSessionStorageConfig({ maxSizeMb: 48, autoRotate: false });
      config.setWebTerminalEnabled(false);
      config.setToolUseMessageBudget(21);

      expect(config.getSessionStorageConfig()).toMatchObject({
        maxSizeMb: 48,
        maxSizeBytes: 48 * 1024 * 1024,
        autoRotate: false,
      });
      expect(config.getWebRuntimeConfig().terminalEnabled).toBe(false);
      expect(config.getToolUseMessageBudget()).toBe(21);
      expect(process.env.PICLAW_SESSION_MAX_SIZE_MB).toBe("48");
      expect(process.env.PICLAW_SESSION_AUTO_ROTATE).toBe("0");
      expect(process.env.PICLAW_WEB_TERMINAL_ENABLED).toBe("0");
      expect(process.env.PICLAW_TURN_MAX_TOOL_USE_MESSAGES).toBe("21");

      const persisted = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
      expect(persisted).toMatchObject({
        sessionMaxSizeMb: 48,
        sessionAutoRotate: false,
        turnMaxToolUseMessages: 21,
        web: {
          terminalEnabled: false,
        },
      });
    });
  });

  test("scopedModelsOnly loads from config/env and persists under models", async () => {
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
        expect(process.env.PICLAW_SCOPED_MODELS_ONLY).toBe("0");

        const parsed = JSON.parse(readFileSync(join(workspace.workspace, ".piclaw", "config.json"), "utf8"));
        expect(parsed.models).toEqual({ scopedModelsOnly: false });
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
