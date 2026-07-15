/**
 * test/extensions/optional-bundled-extensions.test.ts – Smoke tests for bundled optional extensions.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

  test("minimax-video registers the MiniMax video command", async () => {
    const { default: registerMiniMaxVideo } = await import("../../extensions/integrations/minimax-video/index.ts");
    const fake = createFakeApi();

    registerMiniMaxVideo(fake.api);

    expect(fake.state.commands.has("minimax-video")).toBe(true);
    expect(fake.state.commands.get("minimax-video")?.description).toContain("MiniMax video");
  });
});
