/**
 * test/agent-pool/agent-pool-tools.test.ts – Tests for built-in extension tool registration.
 *
 * Verifies that builtinExtensionFactories register the expected tools
 * (attach_file, messages, model control, tool discovery + activation, SQL introspection, workspace search,
 * adaptive cards, dashboard widget posting, graceful exit, and autoresearch controls).
 * bun_run, keychain, ssh, and proxmox are provided by packaged runtime extensions rather than builtin factories.
 * and slash commands (/tasks, /scheduled, /theme, /tint) on a mock ExtensionAPI.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../helpers.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { builtinExtensionFactories } from "../../src/extensions/index.js";
import { closeDbQuietly } from "../helpers.js";

let dbModule: typeof import("../../src/db.js") | null = null;

beforeEach(async () => {
  dbModule = await import("../../src/db.js");
  dbModule.initDatabase();
});

afterEach(() => {
  closeDbQuietly(dbModule);
  dbModule = null;
});

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
    expect(fake.tools.has("list_tools")).toBe(true);
    expect(fake.tools.has("list_internal_tools")).toBe(true);
    expect(fake.tools.has("list_scripts")).toBe(true);
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
    expect(builtinExtensionFactories.length).toBe(21);
  });

  test("scheduled_tasks unifies create pause resume and delete", async () => {
    const fake = makeFakeApi();
    for (const factory of builtinExtensionFactories) {
      factory(fake.api);
    }

    const tool = fake.tools.get("scheduled_tasks");
    expect(tool).toBeTruthy();

    const created = await tool.execute("call-1", {
      action: "create",
      chat_jid: "web:test",
      schedule_type: "once",
      schedule_value: "2099-01-01T00:00:00.000Z",
      prompt: "say hi",
    });
    expect(created.details.ok).toBe(true);
    const taskId = created.details.id;
    expect(typeof taskId).toBe("string");

    const paused = await tool.execute("call-2", { action: "pause", id: taskId });
    expect(paused.details.ok).toBe(true);
    expect(paused.details.old_status).toBe("active");
    expect(paused.details.new_status).toBe("paused");

    const resumed = await tool.execute("call-3", { action: "resume", id: taskId });
    expect(resumed.details.ok).toBe(true);
    expect(resumed.details.old_status).toBe("paused");
    expect(resumed.details.new_status).toBe("active");

    const deleted = await tool.execute("call-4", { action: "delete", id: taskId });
    expect(deleted.details.ok).toBe(true);
    expect(deleted.details.deleted).toBe(true);
    expect(deleted.details.new_status).toBe("deleted");

    const fetched = await tool.execute("call-5", { action: "get", id: taskId });
    expect(fetched.details.found).toBe(false);
  });

  test("scheduled_tasks protects internal tasks unless explicitly allowed", async () => {
    const fake = makeFakeApi();
    for (const factory of builtinExtensionFactories) {
      factory(fake.api);
    }

    const db = await import("../../src/db.js");
    db.createTask({
      id: "task-internal-protected",
      chat_jid: "web:test",
      prompt: "/dream",
      model: null,
      task_kind: "internal",
      command: null,
      cwd: null,
      timeout_sec: null,
      schedule_type: "cron",
      schedule_value: "0 1 * * *",
      next_run: "2099-01-01T01:00:00.000Z",
      status: "active",
      created_at: new Date().toISOString(),
    });

    const tool = fake.tools.get("scheduled_tasks");
    const blocked = await tool.execute("call-6", { action: "delete", id: "task-internal-protected" });
    expect(blocked.details.ok).toBe(false);
    expect(blocked.details.protected).toBe(true);

    const allowed = await tool.execute("call-7", {
      action: "delete",
      id: "task-internal-protected",
      allow_internal: true,
    });
    expect(allowed.details.ok).toBe(true);
    expect(allowed.details.deleted).toBe(true);
  });
});
