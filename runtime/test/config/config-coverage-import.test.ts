import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createTempWorkspace } from "../helpers.js";

const RUNTIME_DIR = resolve(import.meta.dir, "../..");
const CONFIG_SUBPROCESS = join(RUNTIME_DIR, "test", "config", "config-subprocess.ts");

function loadConfigInSubprocess(
  workspace: { workspace: string; store: string; data: string },
  exports: string[],
  options: { args?: string[]; env?: Record<string, string | undefined> } = {},
): { snapshot: Record<string, any>; stderr: string } {
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
  return { snapshot: JSON.parse(stdout || "{}"), stderr };
}

function writeWorkspaceConfig(workspace: string, config: Record<string, unknown>): void {
  const configDir = join(workspace, ".piclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2), "utf8");
}

test("plain import covers config module init branches with isolated argv and env", () => {
  const ws = createTempWorkspace("piclaw-config-plain-");
  try {
    writeWorkspaceConfig(ws.workspace, {
      web: {
        trustProxy: "yes",
        totpWindow: "4",
        sessionTtl: "60",
        internalSecret: "config-secret",
        passkeyMode: "PASSKEY-ONLY",
        terminalEnabled: "on",
        vncAllowDirect: "off",
      },
      debugCardSubmissions: "off",
      sessionMaxSizeMb: "64",
      sessionAutoRotate: "true",
    });

    const { snapshot, stderr } = loadConfigInSubprocess(
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
        "TOOL_OUTPUT_CONFIG",
        "call:getToolOutputConfig",
        "call:getToolUseBudget",
        "same:getToolOutputConfig:TOOL_OUTPUT_CONFIG",
        "TOOL_ACTIVATION_CONFIG",
        "call:getToolActivationConfig",
        "same:getToolActivationConfig:TOOL_ACTIVATION_CONFIG",
        "PUSHOVER_CONFIG",
        "call:getPushoverConfig",
        "same:getPushoverConfig:PUSHOVER_CONFIG",
      ],
      {
        env: {
          ASSISTANT_NAME: "Legacy Pi",
          PICLAW_ASSISTANT_NAME: undefined,
          PICLAW_INTERNAL_SECRET: undefined,
          PICLAW_WEB_INTERNAL_SECRET: undefined,
          PICLAW_WEB_PORT: "8181",
          PICLAW_WEB_IDLE_TIMEOUT: "12",
          PICLAW_WEB_TLS_CERT: "/env-cert-runtime.pem",
          PICLAW_WEB_TLS_KEY: "/env-key-runtime.pem",
          PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
          PICLAW_VNC_ALLOW_DIRECT: undefined,
          PICLAW_WEB_VNC_TARGETS: undefined,
          PICLAW_VNC_TARGETS: undefined,
          PICLAW_WEB_COMPOSE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB: undefined,
          PICLAW_TOOL_OUTPUT_RETENTION_MS: "14400000",
          PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "60000",
          PICLAW_TURN_MAX_TOOL_EXECUTIONS: "96",
          PICLAW_TURN_MAX_TOOL_USE_MESSAGES: undefined,
          PICLAW_AGENT_TIMEOUT: "120000",
          PICLAW_BACKGROUND_AGENT_TIMEOUT: "45000",
          PICLAW_SESSION_MAX_SIZE_MB: undefined,
          PICLAW_SESSION_AUTO_ROTATE: undefined,
          PUSHOVER_APP_TOKEN: "push-app",
          PUSHOVER_USER_KEY: "push-user",
          PUSHOVER_DEVICE: "push-device",
          PUSHOVER_PRIORITY: "1",
          PUSHOVER_SOUND: "magic",
          TZ: "UTC",
        },
        args: ["--port", "9001", "--host=127.0.0.1", "--idle-timeout=22"],
      },
    );

    expect(snapshot.IDENTITY_CONFIG).toEqual({ assistantName: "Legacy Pi", assistantAvatar: "", userName: "", userAvatar: "", userAvatarBackground: "" });
    expect(snapshot["same:getIdentityConfig:IDENTITY_CONFIG"]).toBe(true);
    expect(snapshot.ASSISTANT_NAME).toBe("Legacy Pi");
    expect(snapshot.WEB_SERVER_CONFIG).toEqual({ port: 9001, host: "127.0.0.1", idleTimeout: 22, tlsCert: "/env-cert-runtime.pem", tlsKey: "/env-key-runtime.pem" });
    expect(snapshot["same:getWebServerConfig:WEB_SERVER_CONFIG"]).toBe(true);
    expect(snapshot.WEB_RUNTIME_CONFIG).toEqual({
      totpSecret: "",
      totpWindow: 4,
      sessionTtl: 60,
      internalSecret: "config-secret",
      widgetToken: "",
      passkeyMode: "passkey-only",
      terminalEnabled: true,
      terminalImageProtocol: "iterm2",
      pushSubscriptionCap: 32,
      pushVapidSubject: "mailto:notifications@localhost.invalid",
      notificationDebugLabels: false,
      sanitizeSvgFences: true,
      vncAllowDirect: false,
      vncTargetsRaw: "",
      debugCardSubmissions: false,
      trustProxy: true,
      composeUploadLimitMb: 256,
      workspaceUploadLimitMb: 256,
    });
    expect(snapshot["same:getWebRuntimeConfig:WEB_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot.AGENT_RUNTIME_CONFIG).toEqual({ timeoutMs: 120000, backgroundTimeoutMs: 45000 });
    expect(snapshot["same:getAgentRuntimeConfig:AGENT_RUNTIME_CONFIG"]).toBe(true);
    expect(snapshot.RUNTIME_TIMING_CONFIG).toEqual({ pollIntervalMs: 2000, schedulerPollIntervalMs: 60000, ipcPollIntervalMs: 1000, timezone: "UTC" });
    expect(snapshot["same:getRuntimeTimingConfig:RUNTIME_TIMING_CONFIG"]).toBe(true);
    expect(snapshot.LOGGING_CONFIG).toEqual({ level: "info" });
    expect(snapshot["same:getLoggingConfig:LOGGING_CONFIG"]).toBe(true);
    expect(snapshot.TOOL_OUTPUT_CONFIG).toEqual({ retentionMs: 14400000, cleanupIntervalMs: 60000 });
    expect(snapshot["same:getToolOutputConfig:TOOL_OUTPUT_CONFIG"]).toBe(true);
    expect(snapshot["call:getToolUseBudget"]).toBe(96);
    expect(snapshot.TOOL_ACTIVATION_CONFIG).toEqual({ additionalDefaultTools: [] });
    expect(snapshot["same:getToolActivationConfig:TOOL_ACTIVATION_CONFIG"]).toBe(true);
    expect(snapshot.PUSHOVER_CONFIG).toEqual({ appToken: "push-app", userKey: "push-user", device: "push-device", priority: 1, sound: "magic" });
    expect(snapshot["same:getPushoverConfig:PUSHOVER_CONFIG"]).toBe(true);

    expect(stderr).toContain("Deprecated environment variable is set");
    expect(stderr).toContain('"oldName":"ASSISTANT_NAME"');
  } finally {
    ws.cleanup();
  }
});
