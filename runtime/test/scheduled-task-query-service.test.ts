import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import "./helpers.js";
import { createTask, getDb, initDatabase, logTaskRun } from "../src/db.js";
import { getScheduledTaskInspection, listScheduledTasks } from "../src/scheduled-task-query-service.js";

function insertTask(overrides: Record<string, any> = {}) {
  const task = {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: "web:test",
    prompt: "Do a useful thing",
    model: null,
    task_kind: "agent",
    command: null,
    cwd: null,
    timeout_sec: null,
    schedule_type: "cron",
    schedule_value: "0 9 * * *",
    next_run: "2026-04-15T09:00:00.000Z",
    status: "active",
    created_at: new Date().toISOString(),
  };
  createTask({ ...task, ...overrides });
  return { ...task, ...overrides };
}

describe("scheduled task query service", () => {
  beforeEach(() => {
    initDatabase();
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch (_error) {
      void _error;
    }
  });

  test("lists tasks with status and chat filters", () => {
    insertTask({ id: "t-active", chat_jid: "web:a", status: "active" });
    insertTask({ id: "t-paused", chat_jid: "web:a", status: "paused" });
    insertTask({ id: "t-other", chat_jid: "web:b", status: "active" });

    const result = listScheduledTasks({ chat_jid: "web:a", status: "active", limit: 10 });
    expect(result.counts).toEqual({ active: 2, paused: 1, completed: 0 });
    expect(result.tasks.map((task) => task.id)).toEqual(["t-active"]);
  });

  test("returns summary fields for shell and internal tasks", () => {
    insertTask({ id: "t-shell", task_kind: "shell", command: "echo hello from shell", prompt: "echo hello from shell" });
    insertTask({ id: "t-internal", task_kind: "internal", prompt: "/dream" });

    const result = listScheduledTasks({ limit: 10 });
    const shell = result.tasks.find((task) => task.id === "t-shell");
    const internal = result.tasks.find((task) => task.id === "t-internal");

    expect(shell?.command_summary).toContain("echo hello from shell");
    expect(shell?.summary).toContain("echo hello from shell");
    expect(internal?.summary).toBe("dream maintenance");
  });

  test("get returns latest run log summary when requested", () => {
    insertTask({ id: "t-run" });
    logTaskRun({
      task_id: "t-run",
      run_at: "2026-04-14T17:00:00.000Z",
      duration_ms: 250,
      status: "error",
      result: null,
      error: "Task exploded with a detailed stack trace that should be summarized for inspection output.",
    });

    const task = getScheduledTaskInspection("t-run", { include_latest_run_log: true });
    expect(task).toBeTruthy();
    expect(task?.latest_run_log).toMatchObject({
      task_id: "t-run",
      status: "error",
      duration_ms: 250,
    });
    expect(task?.latest_run_log?.error_summary).toContain("Task exploded");
  });
});
