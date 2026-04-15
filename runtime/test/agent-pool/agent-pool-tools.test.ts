/**
 * test/agent-pool/agent-pool-tools.test.ts – Tests for built-in extension tool registration.
 *
 * Verifies that builtinExtensionFactories register the expected tools
 * (attach_file, messages, model control, tool discovery + activation, SQL introspection, workspace search,
 * adaptive cards, dashboard widget posting, graceful exit, and autoresearch controls).
 * bun_run, keychain, ssh, and proxmox are provided by packaged runtime extensions rather than builtin factories.
 * and slash commands (/tasks, /scheduled, /theme, /tint) on a mock ExtensionAPI.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { builtinExtensionFactories } from "../../src/extensions/index.js";

function makeFakeApi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  return {
    api: {
      on() {},
      registerTool(tool: any) { tools.set(tool.name, tool); },
      registerCommand(name: string, opts: any) { commands.set(name, opts); },
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
    } as unknown as ExtensionAPI,
    tools,
    commands,
  };
}

describe("builtin extension factories", () => {
  test("register all expected tools and commands", () => {
    const fake = makeFakeApi();
    for (const factory of builtinExtensionFactories) {
      factory(fake.api);
    }

    // Tools from extensions
    expect(fake.tools.has("attach_file")).toBe(true);
    expect(fake.tools.has("messages")).toBe(true);
    expect(fake.tools.has("search_workspace")).toBe(true);
    expect(fake.tools.has("get_model_state")).toBe(true);
    expect(fake.tools.has("list_models")).toBe(true);
    expect(fake.tools.has("switch_model")).toBe(true);
    expect(fake.tools.has("switch_thinking")).toBe(true);
    expect(fake.tools.has("list_internal_tools")).toBe(true);
    expect(fake.tools.has("activate_tools")).toBe(true);
    expect(fake.tools.has("reset_active_tools")).toBe(true);
    expect(fake.tools.has("introspect_sql")).toBe(true);
    expect(fake.tools.has("send_adaptive_card")).toBe(true);
    expect(fake.tools.has("send_dashboard_widget")).toBe(true);
    expect(fake.tools.has("exit_process")).toBe(true);
    expect(fake.tools.has("scheduled_tasks")).toBe(true);
    expect(fake.tools.has("open_workspace_file")).toBe(true);
    expect(fake.tools.has("start_autoresearch")).toBe(true);
    expect(fake.tools.has("stop_autoresearch")).toBe(true);
    expect(fake.tools.has("autoresearch_status")).toBe(true);

    // Commands from scheduled-tasks + ui-theme extensions
    expect(fake.commands.has("tasks")).toBe(true);
    expect(fake.commands.has("scheduled")).toBe(true);
    expect(fake.commands.has("theme")).toBe(true);
    expect(fake.commands.has("tint")).toBe(true);
  });

  test("factories array has expected length", () => {
    expect(builtinExtensionFactories.length).toBe(17);
  });
});
