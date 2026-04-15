/**
 * test/extensions/extensions-scheduled-tasks.test.ts – Tests for the scheduled-tasks extension.
 *
 * Verifies /tasks and /scheduled slash commands list pending and
 * completed tasks from the database correctly.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import "../helpers.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { scheduledTasks } from "../../src/extensions/scheduled-tasks.js";
import { createTask, getDb, initDatabase, logTaskRun } from "../../src/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertTask(overrides: Record<string, any> = {}) {
  const defaults = {
    id: `task-${Date.now()}`,
    chat_jid: "test@chat",
    prompt: "Do something",
    model: null,
    schedule_type: "cron",
    schedule_value: "0 9 * * *",
    next_run: "2026-03-01T09:00:00Z",
    status: "active",
    created_at: new Date().toISOString(),
  };
  const row = { ...defaults, ...overrides };
  createTask(row);
  return row;
}

type CommandEntry = { name: string; handler: (args: string) => Promise<void> };

function createFakeApi() {
  const commands = new Map<string, CommandEntry>();
  const tools = new Map<string, any>();
  const messages: Array<{ customType: string; content: string; display: boolean }> = [];

  const api: ExtensionAPI = {
    on() {},
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, { name, handler: options.handler });
    },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return undefined; },
    registerMessageRenderer() {},
    sendMessage(msg: any) { messages.push(msg); },
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

  return { api, commands, tools, messages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduled-tasks extension", () => {
  let fake: ReturnType<typeof createFakeApi>;

  beforeEach(() => {
    initDatabase();
    fake = createFakeApi();
    scheduledTasks(fake.api);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch (_error) {
      void _error;
    }
  });

  test("registers /tasks and /scheduled commands", () => {
    expect(fake.commands.has("tasks")).toBe(true);
    expect(fake.commands.has("scheduled")).toBe(true);
  });

  test("registers schedule_task and scheduled_tasks tools", () => {
    expect(fake.tools.has("schedule_task")).toBe(true);
    expect(fake.tools.has("scheduled_tasks")).toBe(true);
  });

  test("/tasks lists all tasks when empty", async () => {
    await fake.commands.get("tasks")!.handler("");
    expect(fake.messages.length).toBe(1);
    expect(fake.messages[0].content).toContain("(no tasks found)");
    expect(fake.messages[0].content).toContain("Active 0");
  });

  test("/tasks lists active tasks", async () => {
    insertTask({ id: "t-1", status: "active", prompt: "Morning check" });
    insertTask({ id: "t-2", status: "paused", prompt: "Paused job" });

    await fake.commands.get("tasks")!.handler("active");
    expect(fake.messages.length).toBe(1);
    expect(fake.messages[0].content).toContain("t-1");
    expect(fake.messages[0].content).toContain("Morning check");
    // Should not include paused task
    expect(fake.messages[0].content).not.toContain("t-2");
  });

  test("/tasks all lists everything", async () => {
    insertTask({ id: "t-a", status: "active" });
    insertTask({ id: "t-p", status: "paused" });
    insertTask({ id: "t-c", status: "completed" });

    await fake.commands.get("tasks")!.handler("all");
    expect(fake.messages[0].content).toContain("t-a");
    expect(fake.messages[0].content).toContain("t-p");
    expect(fake.messages[0].content).toContain("t-c");
    expect(fake.messages[0].content).toContain("Active 1");
    expect(fake.messages[0].content).toContain("Paused 1");
    expect(fake.messages[0].content).toContain("Completed 1");
  });

  test("/tasks with invalid filter shows usage", async () => {
    await fake.commands.get("tasks")!.handler("bogus");
    expect(fake.messages[0].content).toContain("Usage:");
  });

  test("/scheduled is an alias for /tasks", async () => {
    insertTask({ id: "t-s", status: "active", prompt: "Scheduled thing" });

    await fake.commands.get("scheduled")!.handler("");
    expect(fake.messages[0].content).toContain("t-s");
    expect(fake.messages[0].content).toContain("Scheduled thing");
  });

  test("truncates long prompts", async () => {
    const longPrompt = "A".repeat(200);
    insertTask({ id: "t-long", prompt: longPrompt });

    await fake.commands.get("tasks")!.handler("");
    // Should be truncated (default 140 chars + ellipsis)
    expect(fake.messages[0].content).not.toContain(longPrompt);
    expect(fake.messages[0].content).toContain("…");
  });

  test("scheduled_tasks tool lists structured task records", async () => {
    insertTask({ id: "t-inspect", status: "active", prompt: "Inspect me", chat_jid: "web:test" });
    const tool = fake.tools.get("scheduled_tasks");
    expect(tool).toBeTruthy();

    const res = await tool.execute("call-list", { action: "list", chat_jid: "web:test", limit: 10 });
    expect(res.details.action).toBe("list");
    expect(res.details.count).toBe(1);
    expect(res.details.tasks[0]).toMatchObject({
      id: "t-inspect",
      chat_jid: "web:test",
      task_kind: "agent",
      status: "active",
      schedule_type: "cron",
    });
    expect(res.content?.[0]?.text).toContain("t-inspect");
  });

  test("scheduled_tasks tool gets latest run summary", async () => {
    insertTask({ id: "t-run", status: "active", prompt: "Run me" });
    logTaskRun({
      task_id: "t-run",
      run_at: "2026-04-14T17:00:00.000Z",
      duration_ms: 1234,
      status: "success",
      result: "Task finished successfully with a long body that should be summarized",
      error: null,
    });

    const tool = fake.tools.get("scheduled_tasks");
    const res = await tool.execute("call-get", { action: "get", id: "t-run", include_latest_run_log: true });
    expect(res.details.found).toBe(true);
    expect(res.details.task.latest_run_log).toMatchObject({
      task_id: "t-run",
      status: "success",
      duration_ms: 1234,
    });
    expect(res.content?.[0]?.text).toContain("latest_run: success");
  });

  test("schedule_task tool creates shell task", async () => {
    const tool = fake.tools.get("schedule_task");
    expect(tool).toBeTruthy();

    const res = await tool.execute("call-1", {
      chat_jid: "test@chat",
      task_kind: "shell",
      command: "echo hi",
      schedule_type: "once",
      schedule_value: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(res.content?.[0]?.text).toContain("Scheduled shell task");
    const tasks = getDb().query("SELECT * FROM scheduled_tasks WHERE task_kind = 'shell'").all() as any[];
    expect(tasks.length).toBeGreaterThan(0);
  });
});
