/**
 * test/extensions/optional-bundled-extensions.test.ts – Smoke tests for bundled optional extensions.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type FakeState = {
  tools: Map<string, any>;
  commands: Map<string, any>;
  routes: Array<{ prefix: string; extensionDir: string }>;
  routeRegistrations: Map<string, number>;
};

function createFakeApi(): { api: ExtensionAPI; state: FakeState } {
  const state: FakeState = {
    tools: new Map<string, any>(),
    commands: new Map<string, any>(),
    routes: [],
    routeRegistrations: new Map<string, number>(),
  };

  const api: ExtensionAPI = {
    on() {},
    registerTool(tool: any) {
      state.tools.set(tool.name, tool);
    },
    registerCommand(name: string, options: any) {
      state.commands.set(name, options);
    },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return undefined; },
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
    setSessionName() {},
    getSessionName() { return undefined; },
    setLabel() {},
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools() {},
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => "off" as any,
    setThinkingLevel() {},
    registerProvider() {},
    unregisterProvider() {},
  } as unknown as ExtensionAPI;

  return { api, state };
}

function withRouteCapture<T>(state: FakeState, fn: () => Promise<T>): Promise<T> {
  const previous = (globalThis as any).__piclaw_registerRoute;
  (globalThis as any).__piclaw_registerRoute = (prefix: string, _handler: unknown, extensionDir: string) => {
    const key = `${prefix}::${extensionDir}`;
    const count = (state.routeRegistrations.get(key) ?? 0) + 1;
    state.routeRegistrations.set(key, count);
    if (count === 1) {
      state.routes.push({ prefix, extensionDir });
      return "created";
    }
    return "updated";
  };
  return fn().finally(() => {
    if (previous === undefined) delete (globalThis as any).__piclaw_registerRoute;
    else (globalThis as any).__piclaw_registerRoute = previous;
  });
}

describe("bundled optional extensions", () => {
  test("bun-runner registers the bun_run tool", async () => {
    const { default: registerBunRunner } = await import("../../extensions/integrations/bun-runner/index.ts");
    const fake = createFakeApi();

    registerBunRunner(fake.api);

    expect(fake.state.tools.has("bun_run")).toBe(true);
    expect(fake.state.tools.get("bun_run")?.description).toContain("workspace Bun script");
  });

  test("ssh-core registers the remote-capable core tool overrides and flags", async () => {
    const { default: registerSshCore } = await import("../../extensions/integrations/ssh-core/index.ts");
    const fake = createFakeApi();

    registerSshCore(fake.api);

    expect(fake.state.tools.has("read")).toBe(true);
    expect(fake.state.tools.has("write")).toBe(true);
    expect(fake.state.tools.has("edit")).toBe(true);
    expect(fake.state.tools.has("bash")).toBe(true);
  });

  test("cdp-browser registers the cdp_browser tool and cdp-tabs command", async () => {
    const { default: registerCdpBrowser } = await import("../../extensions/browser/cdp-browser/index.ts");
    const fake = createFakeApi();

    registerCdpBrowser(fake.api);

    expect(fake.state.tools.has("cdp_browser")).toBe(true);
    expect(fake.state.commands.has("cdp-tabs")).toBe(true);
    expect(fake.state.tools.get("cdp_browser")?.description).toContain("Chrome DevTools Protocol");
  });

  test("win-ui stays a safe no-op off Windows", async () => {
    const { default: registerWinUi } = await import("../../extensions/platform/windows/win-ui/index.ts");
    const fake = createFakeApi();

    registerWinUi(fake.api);

    if (process.platform === "win32") {
      expect(fake.state.tools.has("win_list_windows")).toBe(true);
      expect(fake.state.tools.has("win_screenshot")).toBe(true);
      expect(fake.state.tools.has("win_desktop_screenshot")).toBe(true);
      expect(fake.state.tools.has("win_list_monitors")).toBe(true);
      expect(fake.state.tools.has("win_monitor_screenshot")).toBe(true);
      expect(fake.state.tools.has("win_region_screenshot")).toBe(true);
      expect(fake.state.tools.has("win_kill")).toBe(true);
    } else {
      expect(fake.state.tools.size).toBe(0);
      expect(fake.state.commands.size).toBe(0);
    }
  });

  test("office-viewer only logs route registration on first registration", async () => {
    const { default: registerOfficeViewer } = await import("../../extensions/viewers/office-viewer/index.ts");
    const fake = createFakeApi();
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => {
      logs.push(args.map((value) => String(value)).join(" "));
    };

    try {
      await withRouteCapture(fake.state, async () => {
        registerOfficeViewer(fake.api);
        registerOfficeViewer(fake.api);
      });
    } finally {
      console.log = originalLog;
    }

    expect(fake.state.routeRegistrations.size).toBe(1);
    expect(fake.state.routeRegistrations.get(`${"/office-viewer"}::${fake.state.routes[0]?.extensionDir}`)).toBe(2);
    expect(logs.filter((line) => line.includes("[office-viewer] Route registered")).length).toBe(1);
  });
});
