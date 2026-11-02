import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createCliArgReader } from "../../src/core/config-cli.js";
import {
  readRuntimeBootstrapPathOverrides,
  resolveConfigPath,
  resolveRuntimeConfigPaths,
  resolveRuntimeRoot,
} from "../../src/core/config-paths.js";
import { loadPiclawEnvConfig, nestedConfig } from "../../src/core/config-sources.js";
import {
  DATA_DIR,
  getConfigPath,
  getDataDir,
  getDomainConfigOptions,
  getRuntimeRoot,
  getStoreDir,
  getWorkspaceDir,
  PICLAW_CONFIG_PATH,
  STORE_DIR,
  WORKSPACE_DIR,
} from "../../src/core/config-context.js";
import {
  getLoggingConfig,
  getPushoverConfig,
} from "../../src/core/config-integrations.js";
import {
  getIdentityConfig,
  getRoutingConfig,
  getUiThemeConfig,
} from "../../src/core/config-identity.js";
import {
  getAgentRuntimeConfig,
  getCompactionRuntimeConfig,
  getDreamConfig,
  getProgressWatchdogConfig,
  getSessionPoolConfig,
} from "../../src/core/config-runtime.js";
import {
  getSearchMatchMode,
  getScopedModelsOnly,
  getToolOutputPresentationConfig,
  getToolResultCompactionTools,
  getToolsIntegrationConfig,
  getWorkspaceSearchConfig,
} from "../../src/core/config-tools.js";
import {
  getWebContentConfig,
  getWebRuntimeConfig,
  getWebServerConfig,
  isDefaultWebTerminalEnabled,
  isDefaultWebVncDirectEnabled,
} from "../../src/core/config-web.js";

test("createCliArgReader supports separated, assigned, and aliased flags", () => {
  const read = createCliArgReader(["--port", "8081", "--host=127.0.0.1", "-w", "/tmp/ws"]);
  expect(read("--port", "-p")).toBe("8081");
  expect(read("--host")).toBe("127.0.0.1");
  expect(read("--workspace", "-w")).toBe("/tmp/ws");
  expect(read("--missing")).toBeUndefined();
});

test("resolveRuntimeConfigPaths preserves CLI workspace and environment precedence", () => {
  const env = {
    PICLAW_WORKSPACE: "/env/ws",
    PICLAW_STORE: "/env/store",
    PICLAW_DATA: "/env/data",
  } as NodeJS.ProcessEnv;
  const envPaths = resolveRuntimeConfigPaths({ env });
  expect(envPaths.workspaceDir).toBe("/env/ws");
  expect(envPaths.storeDir).toBe("/env/store");
  expect(envPaths.dataDir).toBe("/env/data");
  expect(envPaths.databasePath).toBe("/env/store/messages.db");

  const cliPaths = resolveRuntimeConfigPaths({ cliWorkspace: "/cli/ws", env });
  expect(cliPaths.workspaceDir).toBe("/cli/ws");
  expect(cliPaths.storeDir).toBe("/cli/ws/.piclaw/store");
  expect(cliPaths.dataDir).toBe("/cli/ws/.piclaw/data");
  expect(cliPaths.configPath).toBe("/cli/ws/.piclaw/config.json");
  expect(cliPaths.databasePath).toBe("/cli/ws/.piclaw/store/messages.db");
});

test("bootstrap path helpers preserve sentinels, trimming, and runtime-root fallbacks", () => {
  const env = {
    PICLAW_WORKSPACE: " /dynamic/ws ",
    PICLAW_STORE: ":memory:",
    PICLAW_DATA: " /dynamic/data ",
    PICLAW_RUNTIME_ROOT: " /runtime/root ",
  } as NodeJS.ProcessEnv;
  expect(readRuntimeBootstrapPathOverrides(env)).toEqual({
    workspace: "/dynamic/ws",
    store: ":memory:",
    data: "/dynamic/data",
    runtimeRoot: "/runtime/root",
  });
  expect(resolveRuntimeConfigPaths({ env }).storeDir).toBe(resolve(":memory:"));
  expect(resolveRuntimeConfigPaths({ env }).databasePath).toBe(":memory:");
  expect(resolveRuntimeRoot("/fallback", env)).toBe("/runtime/root");
  expect(resolveRuntimeRoot("/fallback", {} as NodeJS.ProcessEnv)).toBe("/fallback");
});

test("resolveConfigPath and source helpers stay stateless", () => {
  expect(resolveConfigPath("/default/config.json", { PICLAW_WORKSPACE: "/dynamic/ws" } as NodeJS.ProcessEnv)).toBe("/dynamic/ws/.piclaw/config.json");
  expect(resolveConfigPath("/default/config.json", {} as NodeJS.ProcessEnv)).toBe("/default/config.json");
  const root = { web: { terminalEnabled: true }, other: 1 };
  expect(nestedConfig(root, "web")).toEqual({ terminalEnabled: true });
  expect(nestedConfig(root, "missing")).toBe(root);
});

test("config context exposes one coherent bootstrap snapshot", () => {
  expect(WORKSPACE_DIR).toBeTruthy();
  expect(STORE_DIR).toStartWith(WORKSPACE_DIR);
  expect(DATA_DIR).toStartWith(WORKSPACE_DIR);
  expect(PICLAW_CONFIG_PATH).toStartWith(WORKSPACE_DIR);
  expect(getConfigPath()).toBeTruthy();
  expect(getDomainConfigOptions().configPath).toBe(getConfigPath());
});

test("config context resolves path overrides at call time", () => {
  const previous = {
    workspace: process.env.PICLAW_WORKSPACE,
    store: process.env.PICLAW_STORE,
    data: process.env.PICLAW_DATA,
    runtimeRoot: process.env.PICLAW_RUNTIME_ROOT,
  };
  try {
    process.env.PICLAW_WORKSPACE = "/live/ws";
    process.env.PICLAW_STORE = "/live/store";
    process.env.PICLAW_DATA = "/live/data";
    process.env.PICLAW_RUNTIME_ROOT = "/live/runtime";
    expect(getWorkspaceDir()).toBe("/live/ws");
    expect(getStoreDir()).toBe("/live/store");
    expect(getDataDir()).toBe("/live/data");
    expect(getRuntimeRoot("/fallback")).toBe("/live/runtime");
    expect(readRuntimeBootstrapPathOverrides()).toEqual({
      workspace: "/live/ws",
      store: "/live/store",
      data: "/live/data",
      runtimeRoot: "/live/runtime",
    });
  } finally {
    for (const [key, value] of Object.entries({
      PICLAW_WORKSPACE: previous.workspace,
      PICLAW_STORE: previous.store,
      PICLAW_DATA: previous.data,
      PICLAW_RUNTIME_ROOT: previous.runtimeRoot,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("config web module preserves grouped runtime and platform defaults", () => {
  expect(getWebServerConfig().port).toBeGreaterThan(0);
  expect(getWebRuntimeConfig().sessionTtl).toBeGreaterThan(0);
  expect(getWebContentConfig().previewChars).toBeLessThanOrEqual(getWebContentConfig().maxChars);
  expect(isDefaultWebTerminalEnabled("linux")).toBe(true);
  expect(isDefaultWebTerminalEnabled("win32")).toBe(false);
  expect(isDefaultWebVncDirectEnabled("win32")).toBe(true);
});

test("config tools module preserves live grouped policy contracts", () => {
  const tools = getToolsIntegrationConfig();
  expect(tools.toolOutputStoreBytes).toBeGreaterThanOrEqual(500);
  expect(getToolOutputPresentationConfig().previewLines).toBeGreaterThan(0);
  expect(getToolResultCompactionTools()).toEqual(tools.toolResultCompactionTools);
  expect(getWorkspaceSearchConfig().roots).toEqual(tools.workspaceSearchRoots);
  expect(getSearchMatchMode()).toBe(tools.searchMatchMode);
  expect(getScopedModelsOnly()).toBe(tools.scopedModelsOnly);
});

test("config runtime module preserves grouped session and recovery contracts", () => {
  expect(getAgentRuntimeConfig().timeoutMs).toBeGreaterThan(0);
  expect(getDreamConfig().agentTimeoutMs).toBeGreaterThan(0);
  expect(getSessionPoolConfig().cleanupIntervalMs).toBeGreaterThan(0);
  expect(getCompactionRuntimeConfig()).not.toHaveProperty("backoffMaxMs");
  expect(typeof getCompactionRuntimeConfig().autoCompactionEnabled).toBe("boolean");
  expect(getProgressWatchdogConfig().timeoutMs).toBeGreaterThanOrEqual(0);
});

test("identity and integration modules preserve grouped facade contracts", () => {
  expect(getIdentityConfig().assistantName).toBeTruthy();
  expect(getRoutingConfig().triggerPattern).toBeInstanceOf(RegExp);
  expect(getUiThemeConfig().theme).toBeTruthy();
  expect(["debug", "info", "warn", "error"]).toContain(getLoggingConfig().level);
  expect(Number.isFinite(getPushoverConfig().priority)).toBe(true);
});

test("loadPiclawEnvConfig reads only Piclaw's allowlisted dotenv keys", () => {
  const previousCwd = process.cwd();
  const dir = join("/tmp", `piclaw-config-sources-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".env"), "PICLAW_DREAM_CRON=45 3 * * *\nUNRELATED_SECRET=hidden\n", "utf8");
  try {
    process.chdir(dir);
    const config = loadPiclawEnvConfig();
    expect(config.PICLAW_DREAM_CRON).toBe("45 3 * * *");
    expect(config.UNRELATED_SECRET).toBeUndefined();
  } finally {
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
