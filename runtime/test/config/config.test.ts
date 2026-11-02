import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempWorkspace, importFresh, withTempWorkspaceEnv } from "../helpers.js";

const RUNTIME_DIR = resolve(import.meta.dir, "../..");
const CONFIG_SUBPROCESS = join(RUNTIME_DIR, "test", "config", "config-subprocess.ts");
const COMPACTION_PERSISTENCE_SUBPROCESS = join(RUNTIME_DIR, "test", "config", "compaction-persistence-subprocess.ts");

type ConfigSnapshot = Record<string, any>;

function writeWorkspaceConfig(workspace: string, config: Record<string, unknown>): string {
  const configDir = join(workspace, ".piclaw");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

function runConfigSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined> } = {},
): { snapshot: ConfigSnapshot; stderr: string } {
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
  return {
    snapshot: JSON.parse(stdout || "{}"),
    stderr,
  };
}

function loadConfigInSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined> } = {},
): ConfigSnapshot {
  return runConfigSubprocess(workspace, exports, options).snapshot;
}

test("native auto-compaction and watchdog settings survive a fresh process restart", () => {
  const ws = createTempWorkspace("piclaw-compaction-persistence-");
  try {
    const write = Bun.spawnSync({
      cmd: ["bun", COMPACTION_PERSISTENCE_SUBPROCESS],
      cwd: ws.workspace,
      env: {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "/tmp",
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(write.exitCode, write.stderr.toString()).toBe(0);
    expect(JSON.parse(write.stdout.toString())).toMatchObject({
      autoCompactionEnabled: false,
      progressWatchdogEnabled: true,
      progressWatchdogTimeoutMs: 120_000,
    });

    const restarted = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_SMART_COMPACTION_METHOD: undefined },
    });
    expect(restarted["call:getCompactionRuntimeConfig"]).toMatchObject({
      autoCompactionEnabled: false,
      progressWatchdogEnabled: true,
      progressWatchdogTimeoutMs: 120_000,
    });
  } finally {
    ws.cleanup();
  }
});

test("native auto-compaction defaults on with the 300s progress watchdog disabled by default", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    const snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: {
        PICLAW_COMPACTION_TIMEOUT_MS: undefined,
        PICLAW_PROGRESS_WATCHDOG_ENABLED: undefined,
        PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: undefined,
      },
    });

    expect(snapshot["call:getCompactionRuntimeConfig"].autoCompactionEnabled).toBe(true);
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("timeoutMs");
    expect(snapshot["call:getCompactionRuntimeConfig"].progressWatchdogEnabled).toBe(false);
    expect(snapshot["call:getCompactionRuntimeConfig"].progressWatchdogTimeoutMs).toBe(300_000);
  } finally {
    ws.cleanup();
  }
});

test("loads Piclaw-owned auto-compaction enable state without honoring poisoned upstream settings", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    writeWorkspaceConfig(ws.workspace, {
      compaction: { enabled: false },
    });

    let snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_AUTO_COMPACTION_ENABLED: undefined },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"].autoCompactionEnabled).toBe(true);

    writeWorkspaceConfig(ws.workspace, {
      compaction: { enabled: false, autoCompactionEnabled: false },
    });
    snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_AUTO_COMPACTION_ENABLED: undefined },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"].autoCompactionEnabled).toBe(false);

    snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_AUTO_COMPACTION_ENABLED: "1" },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"].autoCompactionEnabled).toBe(true);
  } finally {
    ws.cleanup();
  }
});

test("keeps historical provider/method/deadline settings inert in the compaction domain", () => {
  const ws = createTempWorkspace("piclaw-compaction-config-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      domains: { compaction: { remoteCompactionEnabled: true, remoteCompactionTimeoutMs: 300000 } },
    });
    writeFileSync(join(ws.workspace, ".env"), [
      "PICLAW_SMART_COMPACTION_METHOD=pipelined",
      "PICLAW_COMPACTION_TIMEOUT_MS=600000",
      "PICLAW_COMPACTION_BACKOFF_BASE_MS=120000",
      "PICLAW_COMPACTION_BACKOFF_MAX_MS=600000",
      "PICLAW_COMPACTION_THRESHOLD_PERCENT=70",
      "PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS=123456",
      "PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR=0.25",
    ].join("\n"), "utf8");
    const snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: {
        PICLAW_SMART_COMPACTION_METHOD: undefined,
        PICLAW_COMPACTION_TIMEOUT_MS: undefined,
        PICLAW_COMPACTION_BACKOFF_BASE_MS: undefined,
        PICLAW_COMPACTION_BACKOFF_MAX_MS: undefined,
        PICLAW_COMPACTION_THRESHOLD_PERCENT: undefined,
        PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: undefined,
        PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR: undefined,
      },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"]).toMatchObject({
      autoCompactionEnabled: true,
      progressWatchdogEnabled: false,
      progressWatchdogTimeoutMs: 300_000,
    });
    for (const key of ["smartCompactionMethod", "remoteCompactionEnabled", "remoteCompactionTimeoutMs", "timeoutMs", "backoffBaseMs", "backoffMaxMs"])
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty(key);
  } finally {
    ws.cleanup();
  }
});

test("legacy method aliases and environment overrides cannot configure a retired engine", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    writeWorkspaceConfig(ws.workspace, {
      compaction: { smartCompactionMethod: "traditional-pipelined" },
    });

    let snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_SMART_COMPACTION_METHOD: undefined },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");

    snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_SMART_COMPACTION_METHOD: "selective" },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");

    for (const alias of ["traditional_pipelined", "traditional pipelined", "pipelined"]) {
      snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
        env: { PICLAW_SMART_COMPACTION_METHOD: alias },
      });
      expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");
    }

    snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_SMART_COMPACTION_METHOD: "not-a-method" },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");

    writeWorkspaceConfig(ws.workspace, {
      compaction: { smart_compaction_method: "pipelined" },
    });
    snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: { PICLAW_SMART_COMPACTION_METHOD: undefined },
    });
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("smartCompactionMethod");
  } finally {
    ws.cleanup();
  }
});

test("legacy backoff environment overrides do not expose execution policy", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    const snapshot = loadConfigInSubprocess(ws, ["call:getCompactionRuntimeConfig"], {
      env: {
        PICLAW_COMPACTION_BACKOFF_BASE_MS: "900000",
        PICLAW_COMPACTION_BACKOFF_MAX_MS: "60000",
      },
    });

    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffBaseMs");
    expect(snapshot["call:getCompactionRuntimeConfig"]).not.toHaveProperty("backoffMaxMs");
  } finally {
    ws.cleanup();
  }
});

test("loads config-file aliases for pushover and identity fields", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    writeWorkspaceConfig(ws.workspace, {
      pushover: {
        appToken: "app-token",
        user_key: "user-key",
        device: "device-1",
        priority: 2,
        sound: "ping",
      },
      assistant: {
        agentName: "Config Bot",
        agent_avatar: "/assistant.png",
      },
      user: {
        name: "Casey",
        avatar: "/user.png",
        avatar_background: "#123456",
      },
    });

    const snapshot = loadConfigInSubprocess(ws, [
      "PUSHOVER_CONFIG",
      "IDENTITY_CONFIG",
      "ASSISTANT_NAME",
      "ASSISTANT_AVATAR",
      "USER_NAME",
      "USER_AVATAR",
      "USER_AVATAR_BACKGROUND",
    ]);

    expect(snapshot.PUSHOVER_CONFIG).toEqual({
      appToken: "app-token",
      userKey: "user-key",
      device: "device-1",
      priority: 2,
      sound: "ping",
    });
    expect(snapshot.IDENTITY_CONFIG).toEqual({
      assistantName: "Config Bot",
      assistantAvatar: "/assistant.png",
      userName: "Casey",
      userAvatar: "/user.png",
      userAvatarBackground: "#123456",
    });
    expect(snapshot.ASSISTANT_NAME).toBe("Config Bot");
    expect(snapshot.ASSISTANT_AVATAR).toBe("/assistant.png");
    expect(snapshot.USER_NAME).toBe("Casey");
    expect(snapshot.USER_AVATAR).toBe("/user.png");
    expect(snapshot.USER_AVATAR_BACKGROUND).toBe("#123456");
  } finally {
    ws.cleanup();
  }
});

test("CLI web flags override env values and invalid CLI numbers fall back to env", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    let snapshot = loadConfigInSubprocess(
      ws,
      ["WEB_SERVER_CONFIG"],
      {
        env: {
          PICLAW_WEB_PORT: "8081",
          PICLAW_WEB_HOST: "0.0.0.0",
          PICLAW_WEB_IDLE_TIMEOUT: "10",
          PICLAW_WEB_TLS_CERT: "/env-cert.pem",
          PICLAW_WEB_TLS_KEY: "/env-key.pem",
        },
        args: [
          "--port=9090",
          "--host",
          "127.0.0.1",
          "--idle-timeout",
          "25",
          "--tls-cert=/cli-cert.pem",
          "--tls-key",
          "/cli-key.pem",
        ],
      },
    );

    expect(snapshot.WEB_SERVER_CONFIG).toEqual({
      port: 9090,
      host: "127.0.0.1",
      idleTimeout: 25,
      tlsCert: "/cli-cert.pem",
      tlsKey: "/cli-key.pem",
    });

    snapshot = loadConfigInSubprocess(
      ws,
      ["WEB_SERVER_CONFIG"],
      {
        env: {
          PICLAW_WEB_PORT: "8181",
          PICLAW_WEB_HOST: "127.0.0.1",
          PICLAW_WEB_IDLE_TIMEOUT: "12",
          PICLAW_WEB_TLS_CERT: "/env-cert-fallback.pem",
          PICLAW_WEB_TLS_KEY: "/env-key-fallback.pem",
        },
        args: ["--port", "not-a-number", "--idle-timeout=bad"],
      },
    );

    expect(snapshot.WEB_SERVER_CONFIG).toEqual({
      port: 8181,
      host: "127.0.0.1",
      idleTimeout: 12,
      tlsCert: "/env-cert-fallback.pem",
      tlsKey: "/env-key-fallback.pem",
    });
  } finally {
    ws.cleanup();
  }
});

test("CLI workspace flag overrides env workspace and relocates derived state paths", () => {
  const envWs = createTempWorkspace("piclaw-config-env-");
  const cliWs = createTempWorkspace("piclaw-config-cli-");

  try {
    const snapshot = loadConfigInSubprocess(
      {
        workspace: envWs.workspace,
        store: envWs.store,
        data: envWs.data,
      },
      ["WORKSPACE_DIR", "STORE_DIR", "DATA_DIR", "PICLAW_CONFIG_PATH"],
      {
        args: ["--workspace", cliWs.workspace],
      },
    );

    expect(snapshot.WORKSPACE_DIR).toBe(resolve(cliWs.workspace));
    expect(snapshot.STORE_DIR).toBe(resolve(cliWs.workspace, ".piclaw", "store"));
    expect(snapshot.DATA_DIR).toBe(resolve(cliWs.workspace, ".piclaw", "data"));
    expect(snapshot.PICLAW_CONFIG_PATH).toBe(resolve(cliWs.workspace, ".piclaw", "config.json"));
  } finally {
    envWs.cleanup();
    cliWs.cleanup();
  }
});

test("config and env fallback chains handle booleans and session settings", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    writeWorkspaceConfig(ws.workspace, {
      web: {
        totpWindow: 4,
        sessionTtl: 60,
        internalSecret: "config-secret",
        passkeyMode: "PASSKEY-ONLY",
        terminalEnabled: true,
        trustProxy: true,
      },
      debugCardSubmissions: false,
      sessionMaxSizeMb: 8,
      sessionAutoRotate: true,
    });

    const snapshot = loadConfigInSubprocess(ws, [
      "WEB_RUNTIME_CONFIG",
    ], {
      env: {
        PICLAW_WEB_SESSION_TTL: "120",
        PICLAW_WEB_INTERNAL_SECRET: "env-secret",
        PICLAW_TRUST_PROXY: "0",
        PICLAW_WEB_TERMINAL_ENABLED: "false",
        PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
        PICLAW_VNC_ALLOW_DIRECT: undefined,
        PICLAW_WEB_VNC_TARGETS: undefined,
        PICLAW_VNC_TARGETS: undefined,
        PICLAW_DEBUG_CARD_SUBMISSIONS: "yes",
        PICLAW_SESSION_AUTO_ROTATE: "off",
      },
    });

    expect(snapshot.WEB_RUNTIME_CONFIG).toEqual({
      totpSecret: "",
      totpWindow: 4,
      sessionTtl: 120,
      internalSecret: "env-secret",
      widgetToken: "",
      passkeyMode: "passkey-only",
      terminalEnabled: false,
      terminalImageProtocol: "iterm2",
      pushSubscriptionCap: 32,
      pushVapidSubject: "mailto:notifications@localhost.invalid",
      notificationDebugLabels: false,
      sanitizeSvgFences: true,
      vncAllowDirect: process.platform === "linux" || process.platform === "darwin" || process.platform === "win32",
      vncTargetsRaw: "",
      debugCardSubmissions: true,
      trustProxy: false,
      composeUploadLimitMb: 256,
      workspaceUploadLimitMb: 256,
      uiMode: "classic",
    });
  } finally {
    ws.cleanup();
  }
});

test("config-file tool activation settings support additional default tools", () => {
  const ws = createTempWorkspace("piclaw-config-");

  try {
    writeWorkspaceConfig(ws.workspace, {
      tools: {
        additionalDefaultTools: "search_workspace, introspect_sql",
      },
    });

    const snapshot = loadConfigInSubprocess(ws, ["TOOL_ACTIVATION_CONFIG"]);
    expect(snapshot.TOOL_ACTIVATION_CONFIG).toEqual({
      additionalDefaultTools: ["search_workspace", "introspect_sql"],
    });
  } finally {
    ws.cleanup();
  }
});

test("tool output config getter groups retention env settings", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, [
      "TOOL_OUTPUT_CONFIG",
      "call:getToolOutputConfig",
      "same:getToolOutputConfig:TOOL_OUTPUT_CONFIG",
      "frozen:TOOL_OUTPUT_CONFIG",
    ], {
      env: {
        PICLAW_TOOL_OUTPUT_RETENTION_MS: "14400000",
        PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "60000",
      },
    });
    expect(snapshot["same:getToolOutputConfig:TOOL_OUTPUT_CONFIG"]).toBe(true);
    expect(snapshot["frozen:TOOL_OUTPUT_CONFIG"]).toBe(true);
    expect(snapshot.TOOL_OUTPUT_CONFIG).toEqual({ retentionMs: 14400000, cleanupIntervalMs: 60000 });
    expect(snapshot["call:getToolOutputConfig"]).toEqual(snapshot.TOOL_OUTPUT_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("tool-output retention config defaults and caps retention at 30 days", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const dayMs = 24 * 60 * 60 * 1000;
    const defaults = loadConfigInSubprocess(ws, ["TOOL_OUTPUT_CONFIG", "call:getToolOutputConfig"]);
    expect(defaults.TOOL_OUTPUT_CONFIG.retentionMs).toBe(30 * dayMs);
    expect(defaults["call:getToolOutputConfig"]).toEqual(defaults.TOOL_OUTPUT_CONFIG);

    const capped = loadConfigInSubprocess(ws, ["TOOL_OUTPUT_CONFIG"], {
      env: {
        PICLAW_TOOL_OUTPUT_RETENTION_MS: String(90 * dayMs),
      },
    });
    expect(capped.TOOL_OUTPUT_CONFIG.retentionMs).toBe(30 * dayMs);
  } finally {
    ws.cleanup();
  }
});

test("tool activation config getter groups additional default tools from config file", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      tools: { additionalDefaultTools: ["search_workspace", "introspect_sql"] },
    });
    const snapshot = loadConfigInSubprocess(ws, [
      "TOOL_ACTIVATION_CONFIG",
      "call:getToolActivationConfig",
      "same:getToolActivationConfig:TOOL_ACTIVATION_CONFIG",
      "frozen:TOOL_ACTIVATION_CONFIG",
    ]);
    expect(snapshot["same:getToolActivationConfig:TOOL_ACTIVATION_CONFIG"]).toBe(true);
    expect(snapshot["frozen:TOOL_ACTIVATION_CONFIG"]).toBe(true);
    expect(snapshot.TOOL_ACTIVATION_CONFIG).toEqual({ additionalDefaultTools: ["search_workspace", "introspect_sql"] });
    expect(snapshot["call:getToolActivationConfig"]).toEqual(snapshot.TOOL_ACTIVATION_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("workspace search config getter groups configured FTS roots from env or config", () => {
  const envWs = createTempWorkspace("piclaw-config-");
  try {
    const envSnapshot = loadConfigInSubprocess(envWs, [
      "WORKSPACE_SEARCH_CONFIG",
      "call:getWorkspaceSearchConfig",
      "same:getWorkspaceSearchConfig:WORKSPACE_SEARCH_CONFIG",
      "frozen:WORKSPACE_SEARCH_CONFIG",
    ], {
      env: { PICLAW_WORKSPACE_SEARCH_ROOTS: "notes,.pi/skills,docs" },
    });
    expect(envSnapshot["same:getWorkspaceSearchConfig:WORKSPACE_SEARCH_CONFIG"]).toBe(true);
    expect(envSnapshot["frozen:WORKSPACE_SEARCH_CONFIG"]).toBe(true);
    expect(envSnapshot.WORKSPACE_SEARCH_CONFIG).toEqual({ roots: ["notes", ".pi/skills", "docs"], extraExtensions: [] });
    expect(envSnapshot["call:getWorkspaceSearchConfig"]).toEqual(envSnapshot.WORKSPACE_SEARCH_CONFIG);
  } finally {
    envWs.cleanup();
  }

  const configWs = createTempWorkspace("piclaw-config-");
  try {
    writeWorkspaceConfig(configWs.workspace, {
      tools: { workspaceSearchRoots: ["notes", ".pi/skills", "workitems"] },
    });
    const cfgSnapshot = loadConfigInSubprocess(configWs, ["call:getWorkspaceSearchConfig"]);
    expect(cfgSnapshot["call:getWorkspaceSearchConfig"]).toEqual({ roots: ["notes", ".pi/skills", "workitems"], extraExtensions: [] });
  } finally {
    configWs.cleanup();
  }
});

test("pushover config getter groups aliased config file settings", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      pushover: { appToken: "app-token-2", user_key: "user-key-2", device: "device-2", priority: 1, sound: "magic" },
    });
    const snapshot = loadConfigInSubprocess(ws, [
      "PUSHOVER_CONFIG",
      "call:getPushoverConfig",
      "same:getPushoverConfig:PUSHOVER_CONFIG",
      "frozen:PUSHOVER_CONFIG",
    ]);
    expect(snapshot["same:getPushoverConfig:PUSHOVER_CONFIG"]).toBe(true);
    expect(snapshot["frozen:PUSHOVER_CONFIG"]).toBe(true);
    expect(snapshot.PUSHOVER_CONFIG).toEqual({ appToken: "app-token-2", userKey: "user-key-2", device: "device-2", priority: 1, sound: "magic" });
    expect(snapshot["call:getPushoverConfig"]).toEqual(snapshot.PUSHOVER_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("agent runtime config getter groups foreground and background timeout settings", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, [
      "AGENT_RUNTIME_CONFIG",
      "call:getAgentRuntimeConfig",
      "same:getAgentRuntimeConfig:AGENT_RUNTIME_CONFIG",
      "frozen:AGENT_RUNTIME_CONFIG",
    ], {
      env: { PICLAW_AGENT_TIMEOUT: "120000", PICLAW_BACKGROUND_AGENT_TIMEOUT: "45000" },
    });
    expect(snapshot["same:getAgentRuntimeConfig:AGENT_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot["frozen:AGENT_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot.AGENT_RUNTIME_CONFIG).toEqual({ timeoutMs: 120000, backgroundTimeoutMs: 45000 });
    expect(snapshot["call:getAgentRuntimeConfig"]).toEqual(snapshot.AGENT_RUNTIME_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("agent runtime config defaults to a one-hour foreground timeout", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, ["AGENT_RUNTIME_CONFIG"]);
    expect(snapshot.AGENT_RUNTIME_CONFIG.timeoutMs).toBe(3600000);
    expect(snapshot.AGENT_RUNTIME_CONFIG.backgroundTimeoutMs).toBe(0);
  } finally {
    ws.cleanup();
  }
});

test("runtime timing config getter groups poll intervals and timezone", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, [
      "RUNTIME_TIMING_CONFIG",
      "call:getRuntimeTimingConfig",
      "same:getRuntimeTimingConfig:RUNTIME_TIMING_CONFIG",
      "frozen:RUNTIME_TIMING_CONFIG",
    ], {
      env: { TZ: "UTC" },
    });
    expect(snapshot["same:getRuntimeTimingConfig:RUNTIME_TIMING_CONFIG"]).toBe(true);
    expect(snapshot["frozen:RUNTIME_TIMING_CONFIG"]).toBe(true);
    expect(snapshot.RUNTIME_TIMING_CONFIG).toEqual({ pollIntervalMs: 2000, schedulerPollIntervalMs: 60000, ipcPollIntervalMs: 1000, timezone: "UTC" });
    expect(snapshot["call:getRuntimeTimingConfig"]).toEqual(snapshot.RUNTIME_TIMING_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("logging config getter resolves the configured log level", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, [
      "LOGGING_CONFIG",
      "call:getLoggingConfig",
      "same:getLoggingConfig:LOGGING_CONFIG",
      "frozen:LOGGING_CONFIG",
    ], {
      env: { PICLAW_LOG_LEVEL: "warn", LOG_LEVEL: undefined },
    });
    expect(snapshot["same:getLoggingConfig:LOGGING_CONFIG"]).toBe(true);
    expect(snapshot["frozen:LOGGING_CONFIG"]).toBe(true);
    expect(snapshot.LOGGING_CONFIG).toEqual({ level: "warn" });
    expect(snapshot["call:getLoggingConfig"]).toEqual(snapshot.LOGGING_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("web server config getter groups host/port/idle-timeout/tls settings", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const snapshot = loadConfigInSubprocess(ws, [
      "WEB_SERVER_CONFIG",
      "call:getWebServerConfig",
      "same:getWebServerConfig:WEB_SERVER_CONFIG",
      "frozen:WEB_SERVER_CONFIG",
    ], {
      env: {
        PICLAW_WEB_PORT: "8081",
        PICLAW_WEB_HOST: "0.0.0.0",
        PICLAW_WEB_IDLE_TIMEOUT: "10",
        PICLAW_WEB_TLS_CERT: "/env-cert.pem",
        PICLAW_WEB_TLS_KEY: "/env-key.pem",
      },
      args: ["--port=9090", "--host", "127.0.0.1", "--idle-timeout", "25", "--tls-cert=/cli-cert.pem", "--tls-key", "/cli-key.pem"],
    });
    expect(snapshot["same:getWebServerConfig:WEB_SERVER_CONFIG"]).toBe(true);
    expect(snapshot["frozen:WEB_SERVER_CONFIG"]).toBe(true);
    expect(snapshot.WEB_SERVER_CONFIG).toEqual({ port: 9090, host: "127.0.0.1", idleTimeout: 25, tlsCert: "/cli-cert.pem", tlsKey: "/cli-key.pem" });
    expect(snapshot["call:getWebServerConfig"]).toEqual(snapshot.WEB_SERVER_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("web runtime config getter groups auth/session/proxy settings", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      web: {
        totpSecret: "config-secret",
        totpWindow: 4,
        sessionTtl: 60,
        internalSecret: "config-secret",
        passkeyMode: "PASSKEY-ONLY",
        terminalEnabled: true,
        vncAllowDirect: false,
        trustProxy: true,
      },
      debugCardSubmissions: false,
    });
    const snapshot = loadConfigInSubprocess(ws, [
      "WEB_RUNTIME_CONFIG",
      "call:getWebRuntimeConfig",
      "same:getWebRuntimeConfig:WEB_RUNTIME_CONFIG",
      "sealed:WEB_RUNTIME_CONFIG",
    ], {
      env: {
        PICLAW_WEB_SESSION_TTL: "120",
        PICLAW_WEB_INTERNAL_SECRET: "env-secret",
        PICLAW_TRUST_PROXY: "0",
        PICLAW_WEB_TERMINAL_ENABLED: "false",
        PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
        PICLAW_VNC_ALLOW_DIRECT: undefined,
        PICLAW_WEB_VNC_TARGETS: undefined,
        PICLAW_VNC_TARGETS: undefined,
        PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
        PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
        PICLAW_DEBUG_CARD_SUBMISSIONS: "yes",
      },
    });
    expect(snapshot["same:getWebRuntimeConfig:WEB_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot["sealed:WEB_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot.WEB_RUNTIME_CONFIG).toEqual({
      totpSecret: "config-secret",
      totpWindow: 4,
      sessionTtl: 120,
      internalSecret: "env-secret",
      widgetToken: "",
      passkeyMode: "passkey-only",
      terminalEnabled: false,
      terminalImageProtocol: "iterm2",
      pushSubscriptionCap: 32,
      pushVapidSubject: "mailto:notifications@localhost.invalid",
      notificationDebugLabels: false,
      sanitizeSvgFences: true,
      vncAllowDirect: false,
      vncTargetsRaw: "",
      debugCardSubmissions: true,
      trustProxy: false,
      composeUploadLimitMb: 256,
      workspaceUploadLimitMb: 256,
      uiMode: "classic",
    });
    expect(snapshot["call:getWebRuntimeConfig"]).toEqual(snapshot.WEB_RUNTIME_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("legacy top-level web terminal and VNC config keys still map into web runtime config", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      webTerminalEnabled: false,
      webVncAllowDirect: false,
      webVncTargets: '[{"id":"lab","host":"10.0.0.10","port":5901}]',
    });
    const snapshot = loadConfigInSubprocess(ws, ["WEB_RUNTIME_CONFIG"]);
    expect(snapshot.WEB_RUNTIME_CONFIG.terminalEnabled).toBe(false);
    expect(snapshot.WEB_RUNTIME_CONFIG.vncAllowDirect).toBe(false);
    expect(snapshot.WEB_RUNTIME_CONFIG.vncTargetsRaw).toBe('[{"id":"lab","host":"10.0.0.10","port":5901}]');
  } finally {
    ws.cleanup();
  }
});

test("in-process module init handles deprecated env warnings, argv parsing, and string coercions", () => {
  const ws = createTempWorkspace("piclaw-config-");
  try {
    const { snapshot, stderr } = runConfigSubprocess(
      ws,
      [
        "IDENTITY_CONFIG",
        "call:getIdentityConfig",
        "same:getIdentityConfig:IDENTITY_CONFIG",
        "ASSISTANT_NAME",
        "WEB_SERVER_CONFIG",
        "call:getWebServerConfig",
        "same:getWebServerConfig:WEB_SERVER_CONFIG",
        "WEB_RUNTIME_CONFIG",
        "call:getWebRuntimeConfig",
        "same:getWebRuntimeConfig:WEB_RUNTIME_CONFIG",
        "AGENT_RUNTIME_CONFIG",
        "call:getAgentRuntimeConfig",
        "same:getAgentRuntimeConfig:AGENT_RUNTIME_CONFIG",
        "RUNTIME_TIMING_CONFIG",
        "call:getRuntimeTimingConfig",
        "same:getRuntimeTimingConfig:RUNTIME_TIMING_CONFIG",
        "LOGGING_CONFIG",
        "call:getLoggingConfig",
        "same:getLoggingConfig:LOGGING_CONFIG",
      ],
      {
        env: {
          ASSISTANT_NAME: "Legacy Pi",
          PICLAW_ASSISTANT_NAME: undefined,
          PICLAW_WEB_PORT: "8181",
          PICLAW_WEB_IDLE_TIMEOUT: "12",
          PICLAW_INTERNAL_SECRET: undefined,
          PICLAW_WEB_INTERNAL_SECRET: undefined,
          PICLAW_WEB_TLS_CERT: "/env-cert-runtime.pem",
          PICLAW_WEB_TLS_KEY: "/env-key-runtime.pem",
          PICLAW_WEB_TERMINAL_ENABLED: "yes",
          PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
          PICLAW_VNC_ALLOW_DIRECT: undefined,
          PICLAW_WEB_VNC_TARGETS: undefined,
          PICLAW_VNC_TARGETS: undefined,
          PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_DEBUG_CARD_SUBMISSIONS: "off",
          PICLAW_SESSION_MAX_SIZE_MB: "64",
          PICLAW_SESSION_AUTO_ROTATE: "on",
          PICLAW_AGENT_TIMEOUT: "120000",
          PICLAW_BACKGROUND_AGENT_TIMEOUT: "45000",
          TZ: "UTC",
        },
        args: ["--port", "9001", "--host=127.0.0.1", "--idle-timeout=22"],
      },
    );

    expect(snapshot.IDENTITY_CONFIG).toEqual({
      assistantName: "Legacy Pi",
      assistantAvatar: "",
      userName: "",
      userAvatar: "",
      userAvatarBackground: "",
    });
    expect(snapshot["same:getIdentityConfig:IDENTITY_CONFIG"]).toBe(true);
    expect(snapshot["call:getIdentityConfig"]).toEqual(snapshot.IDENTITY_CONFIG);
    expect(snapshot.ASSISTANT_NAME).toBe("Legacy Pi");
    expect(snapshot.WEB_SERVER_CONFIG).toEqual({
      port: 9001,
      host: "127.0.0.1",
      idleTimeout: 22,
      tlsCert: "/env-cert-runtime.pem",
      tlsKey: "/env-key-runtime.pem",
    });
    expect(snapshot["same:getWebServerConfig:WEB_SERVER_CONFIG"]).toBe(true);
    expect(snapshot["call:getWebServerConfig"]).toEqual(snapshot.WEB_SERVER_CONFIG);
    expect(snapshot.WEB_RUNTIME_CONFIG).toEqual({
      totpSecret: "",
      totpWindow: 1,
      sessionTtl: 7 * 24 * 60 * 60,
      internalSecret: "",
      widgetToken: "",
      passkeyMode: "totp-fallback",
      terminalEnabled: true,
      terminalImageProtocol: "iterm2",
      pushSubscriptionCap: 32,
      pushVapidSubject: "mailto:notifications@localhost.invalid",
      notificationDebugLabels: false,
      sanitizeSvgFences: true,
      vncAllowDirect: true,
      vncTargetsRaw: "",
      debugCardSubmissions: false,
      trustProxy: false,
      composeUploadLimitMb: 256,
      workspaceUploadLimitMb: 256,
      uiMode: "classic",
    });
    expect(snapshot["same:getWebRuntimeConfig:WEB_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot["call:getWebRuntimeConfig"]).toEqual(snapshot.WEB_RUNTIME_CONFIG);
    expect(snapshot.AGENT_RUNTIME_CONFIG).toEqual({ timeoutMs: 120000, backgroundTimeoutMs: 45000 });
    expect(snapshot["same:getAgentRuntimeConfig:AGENT_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot["call:getAgentRuntimeConfig"]).toEqual(snapshot.AGENT_RUNTIME_CONFIG);
    expect(snapshot.RUNTIME_TIMING_CONFIG).toEqual({ pollIntervalMs: 2000, schedulerPollIntervalMs: 60000, ipcPollIntervalMs: 1000, timezone: "UTC" });
    expect(snapshot["same:getRuntimeTimingConfig:RUNTIME_TIMING_CONFIG"]).toBe(true);
    expect(snapshot["call:getRuntimeTimingConfig"]).toEqual(snapshot.RUNTIME_TIMING_CONFIG);
    expect(snapshot.LOGGING_CONFIG).toEqual({ level: "info" });
    expect(snapshot["same:getLoggingConfig:LOGGING_CONFIG"]).toBe(true);
    expect(snapshot["call:getLoggingConfig"]).toEqual(snapshot.LOGGING_CONFIG);

    expect(stderr).toContain("Deprecated environment variable is set");
    expect(stderr).toContain('"oldName":"ASSISTANT_NAME"');
    expect(stderr).toContain('"newName":"PICLAW_ASSISTANT_NAME"');
  } finally {
    ws.cleanup();
  }
});

test("runtime setters trim values, escape trigger regexes, and persist TOTP secrets", async () => {
  await withTempWorkspaceEnv(
    "piclaw-config-",
    { PICLAW_WEB_TOTP_SECRET: undefined, LOG_LEVEL: undefined },
    async (ws) => {
      const configPath = writeWorkspaceConfig(ws.workspace, {
        web: {
          totp_secret: "legacy-secret",
          keepMe: true,
        },
      });

      const cfg = await importFresh<typeof import("../../src/core/config.js")>("../src/core/config.js");

      cfg.setAssistantName("  Pi (Test) Bot  ");
      cfg.setAssistantAvatar("  /assistant.svg  ");
      cfg.setUserName("  Jordan  ");
      cfg.setUserAvatar("  /user.svg  ");
      cfg.setUserAvatarBackground("  #abcdef  ");

      expect(cfg.IDENTITY_CONFIG).toEqual({
        assistantName: "Pi (Test) Bot",
        assistantAvatar: "/assistant.svg",
        userName: "Jordan",
        userAvatar: "/user.svg",
        userAvatarBackground: "#abcdef",
      });
      expect(cfg.getIdentityConfig()).toBe(cfg.IDENTITY_CONFIG);
      expect(Object.isSealed(cfg.IDENTITY_CONFIG)).toBe(true);
      expect(cfg.ASSISTANT_NAME).toBe("Pi (Test) Bot");
      expect(cfg.ASSISTANT_AVATAR).toBe("/assistant.svg");
      expect(cfg.USER_NAME).toBe("Jordan");
      expect(cfg.USER_AVATAR).toBe("/user.svg");
      expect(cfg.USER_AVATAR_BACKGROUND).toBe("#abcdef");
      expect(cfg.getRoutingConfig()).toBe(cfg.ROUTING_CONFIG);
      expect(Object.isSealed(cfg.ROUTING_CONFIG)).toBe(true);
      expect(cfg.ROUTING_CONFIG.triggerPattern.test("hello @Pi (Test) Bot")).toBe(true);
      expect(cfg.ROUTING_CONFIG.triggerPattern.test("hello @Pi Test Bot")).toBe(false);

      expect(cfg.setWebTotpSecret("  fresh-secret  ")).toBe("fresh-secret");
      expect(cfg.WEB_RUNTIME_CONFIG.totpSecret).toBe("fresh-secret");
      expect(process.env.PICLAW_WEB_TOTP_SECRET).toBe("fresh-secret");

      const savedConfig = JSON.parse(readFileSync(configPath, "utf8"));
      expect(savedConfig.web.totpSecret).toBe("fresh-secret");
      expect(savedConfig.web.totp_secret).toBeUndefined();
      expect(savedConfig.web.keepMe).toBe(true);

      expect(cfg.setWebTotpSecret("   ")).toBe("");
      expect(cfg.WEB_RUNTIME_CONFIG.totpSecret).toBe("");
      expect(process.env.PICLAW_WEB_TOTP_SECRET).toBeUndefined();

      const clearedConfig = JSON.parse(readFileSync(configPath, "utf8"));
      expect(clearedConfig.web.keepMe).toBe(true);
      expect(clearedConfig.web.totpSecret).toBeUndefined();
      expect(clearedConfig.web.totp_secret).toBeUndefined();

      writeWorkspaceConfig(ws.workspace, {
        web: {
          totp_secret: "legacy-only-secret",
        },
      });
      expect(cfg.setWebTotpSecret("   ")).toBe("");
      expect(JSON.parse(readFileSync(configPath, "utf8")).web).toBeUndefined();
    },
  );
});
