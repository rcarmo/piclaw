import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { importFresh, withTempWorkspaceEnv } from "../helpers.js";

function writeWorkspaceConfig(workspace: string, config: Record<string, unknown>): void {
  const configDir = join(workspace, ".piclaw");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2), "utf8");
}

test("plain import covers config module init branches with isolated argv and env", async () => {
  await withTempWorkspaceEnv(
    "piclaw-config-plain-",
    {
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
      PICLAW_REMOTE_INTEROP_ENABLED: "1",
      PICLAW_REMOTE_INTEROP_ALLOW_HTTP: "0",
      PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK: undefined,
      PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED: "1",
      PICLAW_REMOTE_INSTANCE_NAME: "remote-c",
      PICLAW_REMOTE_INTEROP_DECISION_MODEL: "decision-model-c",
      PICLAW_TOOL_OUTPUT_RETENTION_MS: "14400000",
      PICLAW_TOOL_OUTPUT_CLEANUP_INTERVAL_MS: "60000",
      PICLAW_AGENT_TIMEOUT: "120000",
      PICLAW_BACKGROUND_AGENT_TIMEOUT: "45000",
      PUSHOVER_APP_TOKEN: "push-app",
      PUSHOVER_USER_KEY: "push-user",
      PUSHOVER_DEVICE: "push-device",
      PUSHOVER_PRIORITY: "1",
      PUSHOVER_SOUND: "magic",
      TZ: "UTC",
    },
    async (ws) => {
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
        whatsappPhone: "+15557650000",
      });

      const stderrChunks: string[] = [];
      const originalArgv = process.argv.slice();
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.argv = [
        originalArgv[0] || "bun",
        originalArgv[1] || "test",
        "--port",
        "9001",
        "--host=127.0.0.1",
        "--idle-timeout=22",
      ];
      (process.stderr.write as unknown as (chunk: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof process.stderr.write;

      try {
        const cfg = await importFresh<typeof import("../../src/core/config.js")>("../src/core/config.js");
        expect(cfg.IDENTITY_CONFIG).toEqual({
          assistantName: "Legacy Pi",
          assistantAvatar: "",
          userName: "",
          userAvatar: "",
          userAvatarBackground: "",
        });
        expect(cfg.getIdentityConfig()).toBe(cfg.IDENTITY_CONFIG);
        expect(cfg.ASSISTANT_NAME).toBe("Legacy Pi");
        expect(cfg.WEB_SERVER_CONFIG).toEqual({
          port: 9001,
          host: "127.0.0.1",
          idleTimeout: 22,
          tlsCert: "/env-cert-runtime.pem",
          tlsKey: "/env-key-runtime.pem",
        });
        expect(cfg.getWebServerConfig()).toBe(cfg.WEB_SERVER_CONFIG);
        expect(cfg.WEB_RUNTIME_CONFIG).toEqual({
          totpSecret: "",
          totpWindow: 4,
          sessionTtl: 60,
          internalSecret: "config-secret",
          passkeyMode: "passkey-only",
          terminalEnabled: true,
          notificationDebugLabels: false,
          vncAllowDirect: false,
          vncTargetsRaw: "",
          debugCardSubmissions: false,
          trustProxy: true,
        });
        expect(cfg.getWebRuntimeConfig()).toBe(cfg.WEB_RUNTIME_CONFIG);
        expect(cfg.SESSION_STORAGE_CONFIG).toEqual({
          maxSizeMb: 64,
          maxSizeBytes: 64 * 1024 * 1024,
          maxLines: 8000,
          autoRotate: true,
        });
        expect(cfg.getSessionStorageConfig()).toBe(cfg.SESSION_STORAGE_CONFIG);
        expect(cfg.AGENT_RUNTIME_CONFIG).toEqual({
          timeoutMs: 120000,
          backgroundTimeoutMs: 45000,
        });
        expect(cfg.getAgentRuntimeConfig()).toBe(cfg.AGENT_RUNTIME_CONFIG);
        expect(cfg.RUNTIME_TIMING_CONFIG).toEqual({
          pollIntervalMs: 2000,
          schedulerPollIntervalMs: 60000,
          ipcPollIntervalMs: 1000,
          timezone: "UTC",
        });
        expect(cfg.getRuntimeTimingConfig()).toBe(cfg.RUNTIME_TIMING_CONFIG);
        expect(cfg.LOGGING_CONFIG).toEqual({ level: "info" });
        expect(cfg.getLoggingConfig()).toBe(cfg.LOGGING_CONFIG);
        expect(cfg.REMOTE_INTEROP_CONFIG).toEqual({
          enabled: true,
          allowHttp: false,
          allowPrivateNetwork: false,
          shortCircuitEnabled: true,
          instanceName: "remote-c",
          decisionModel: "decision-model-c",
        });
        expect(cfg.getRemoteInteropConfig()).toBe(cfg.REMOTE_INTEROP_CONFIG);
        expect(cfg.TOOL_OUTPUT_CONFIG).toEqual({
          retentionMs: 14400000,
          cleanupIntervalMs: 60000,
        });
        expect(cfg.getToolOutputConfig()).toBe(cfg.TOOL_OUTPUT_CONFIG);
        expect(cfg.TOOL_ACTIVATION_CONFIG).toEqual({
          additionalDefaultTools: [],
        });
        expect(cfg.getToolActivationConfig()).toBe(cfg.TOOL_ACTIVATION_CONFIG);
        expect(cfg.PUSHOVER_CONFIG).toEqual({
          appToken: "push-app",
          userKey: "push-user",
          device: "push-device",
          priority: 1,
          sound: "magic",
        });
        expect(cfg.getPushoverConfig()).toBe(cfg.PUSHOVER_CONFIG);
        expect(cfg.WHATSAPP_CONFIG).toEqual({ phoneNumber: "+15557650000" });
        expect(cfg.getWhatsAppConfig()).toBe(cfg.WHATSAPP_CONFIG);

        const configPath = join(ws.workspace, ".piclaw", "config.json");
        cfg.setAssistantName("  Pi (Coverage) Bot  ");
        cfg.setAssistantAvatar("  /assistant.svg  ");
        cfg.setUserName("  Casey  ");
        cfg.setUserAvatar("  /user.svg  ");
        cfg.setUserAvatarBackground("  #123456  ");
        expect(cfg.IDENTITY_CONFIG).toEqual({
          assistantName: "Pi (Coverage) Bot",
          assistantAvatar: "/assistant.svg",
          userName: "Casey",
          userAvatar: "/user.svg",
          userAvatarBackground: "#123456",
        });
        expect(cfg.getIdentityConfig()).toBe(cfg.IDENTITY_CONFIG);

        expect(cfg.setWebTotpSecret("  fresh-secret  ")).toBe("fresh-secret");
        expect(cfg.WEB_RUNTIME_CONFIG.totpSecret).toBe("fresh-secret");
        expect(cfg.getRoutingConfig()).toBe(cfg.ROUTING_CONFIG);
        expect(process.env.PICLAW_WEB_TOTP_SECRET).toBe("fresh-secret");
        const savedConfig = JSON.parse(readFileSync(configPath, "utf8"));
        expect(savedConfig.web.totpSecret).toBe("fresh-secret");
        expect(savedConfig.web.passkeyMode).toBe("PASSKEY-ONLY");

        writeWorkspaceConfig(ws.workspace, { web: { totp_secret: "legacy-only-secret" } });
        expect(cfg.setWebTotpSecret("   ")).toBe("");
        expect(cfg.WEB_RUNTIME_CONFIG.totpSecret).toBe("");
        expect(process.env.PICLAW_WEB_TOTP_SECRET).toBeUndefined();
        expect(JSON.parse(readFileSync(configPath, "utf8")).web).toBeUndefined();
      } finally {
        process.argv = originalArgv;
        process.stderr.write = originalStderrWrite;
      }

      const stderr = stderrChunks.join("");
      expect(stderr).toContain("Deprecated environment variable is set");
      expect(stderr).toContain('"oldName":"ASSISTANT_NAME"');
    },
  );
});
