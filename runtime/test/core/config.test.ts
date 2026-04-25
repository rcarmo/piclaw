import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import "../helpers.js";
import { importFresh, withTempWorkspaceEnv } from "../helpers.js";

type ConfigModule = typeof import("../../src/core/config.js");

const originalCwd = process.cwd();
const originalArgv = [...process.argv];

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

  test("loads grouped settings from env, .env, and config file using the documented precedence", async () => {
    await withFreshConfig(
      {
        env: {
          PICLAW_ASSISTANT_NAME: "Env Assistant",
          PICLAW_WEB_PASSKEY_MODE: "totp-only",
          PICLAW_WEB_TERMINAL_ENABLED: "0",
          PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
          PICLAW_VNC_ALLOW_DIRECT: undefined,
          PICLAW_WEB_VNC_TARGETS: undefined,
          PICLAW_VNC_TARGETS: undefined,
          PICLAW_TRUST_PROXY: "0",
          // Unset remote interop env vars so the config file values are authoritative
          PICLAW_REMOTE_INTEROP_ENABLED: undefined,
          PICLAW_REMOTE_INTEROP_ALLOW_HTTP: undefined,
          PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK: undefined,
          PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED: undefined,
          PICLAW_REMOTE_INSTANCE_NAME: undefined,
          PICLAW_REMOTE_INTEROP_DECISION_MODEL: undefined,
        },
        dotEnv: [
          "PICLAW_LOG_LEVEL=debug",
          "PICLAW_ASSISTANT_AVATAR=https://env-file.example/avatar.png",
        ].join("\n"),
        config: {
          assistant: {
            assistantName: "Config Assistant",
            assistantAvatar: "https://config.example/avatar.png",
          },
          user: {
            userName: "Config User",
            userAvatar: "https://config.example/user.png",
            userAvatarBackground: "#123456",
          },
          web: {
            passkeyMode: "passkey-only",
            sessionTtl: 99,
            totpWindow: 3,
            internalSecret: "cfg-secret",
            terminalEnabled: true,
            vncAllowDirect: false,
            trustProxy: true,
          },
          debugCardSubmissions: true,
          tools: {
            additionalDefaultTools: ["search_workspace", "introspect_sql"],
            workspaceSearchRoots: ["notes", ".pi/skills", "docs"],
          },
          remoteInteropEnabled: true,
          remoteInteropAllowHttp: true,
          remoteInteropShortCircuitEnabled: true,
          remoteInstanceName: "relay",
          remoteInteropDecisionModel: "openai/gpt-4o",
        },
      },
      async ({ workspace, config }) => {
        expect(config.WORKSPACE_DIR).toBe(workspace.workspace);
        expect(config.STORE_DIR).toBe(workspace.store);
        expect(config.DATA_DIR).toBe(workspace.data);

        expect(config.getIdentityConfig()).toEqual({
          assistantName: "Env Assistant",
          assistantAvatar: "https://env-file.example/avatar.png",
          userName: "Config User",
          userAvatar: "https://config.example/user.png",
          userAvatarBackground: "#123456",
        });

        expect(config.getLoggingConfig().level).toBe("debug");
        expect(config.getWebRuntimeConfig()).toMatchObject({
          passkeyMode: "totp-only",
          sessionTtl: 99,
          totpWindow: 3,
          internalSecret: "cfg-secret",
          terminalEnabled: false,
          vncAllowDirect: false,
          vncTargetsRaw: "",
          debugCardSubmissions: true,
          trustProxy: false,
        });
        expect(config.getToolActivationConfig()).toEqual({
          additionalDefaultTools: ["search_workspace", "introspect_sql"],
        });
        expect(config.getWorkspaceSearchConfig()).toEqual({
          roots: ["notes", ".pi/skills", "docs"],
          extraExtensions: [],
        });
        expect(config.getRemoteInteropConfig()).toEqual({
          enabled: true,
          allowHttp: true,
          allowPrivateNetwork: false,
          shortCircuitEnabled: true,
          instanceName: "relay",
          decisionModel: "openai/gpt-4o",
        });
      },
    );
  });

  test("CLI flags override env-derived web server settings", async () => {
    await withFreshConfig(
      {
        env: {
          PICLAW_WEB_PORT: "8080",
          PICLAW_WEB_HOST: "0.0.0.0",
          PICLAW_WEB_IDLE_TIMEOUT: "15",
          PICLAW_WEB_TLS_CERT: "/env/cert.pem",
          PICLAW_WEB_TLS_KEY: "/env/key.pem",
        },
        argv: [
          "--port",
          "9090",
          "--host=127.0.0.1",
          "--idle-timeout",
          "45",
          "--tls-cert",
          "/cli/cert.pem",
          "--tls-key=/cli/key.pem",
        ],
      },
      async ({ config }) => {
        expect(config.getWebServerConfig()).toEqual({
          port: 9090,
          host: "127.0.0.1",
          idleTimeout: 45,
          tlsCert: "/cli/cert.pem",
          tlsKey: "/cli/key.pem",
        });
      },
    );
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
