/**
 * test/task-scheduler-shell.test.ts – Scheduled shell task execution.
 */
import { beforeEach, afterEach, expect, test, setDefaultTimeout } from "bun:test";
import { getTestWorkspace, importFresh, setEnv } from "./helpers.js";

setDefaultTimeout(15_000);

const sentMessages: Array<{ jid: string; text: string }> = [];
const sentNudges: string[] = [];
let restoreEnv: (() => void) | null = null;
let db: typeof import("../src/db.js") | null = null;
let scheduler: typeof import("../src/task-scheduler.js") | null = null;

afterEach(() => {
  sentMessages.length = 0;
  sentNudges.length = 0;
  restoreEnv?.();
  restoreEnv = null;
  try { db?.getDb().close(); } catch (_error) { void _error; }
  db = null;
  scheduler = null;
});

beforeEach(async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });
  db = await importFresh("../src/db.js");
  scheduler = await importFresh("../src/task-scheduler.js");
  db.initDatabase();
});

test("runScheduledTask executes shell command and sends output", async () => {
  const taskId = `task-shell-${Date.now()}`;
  db!.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "echo hi",
    model: null,
    task_kind: "shell",
    command: "echo hi",
    cwd: ".",
    timeout_sec: 10,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const task = db!.getTaskById(taskId);
  expect(task?.task_kind).toBe("shell");

  await scheduler!.runScheduledTask(task!, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
    sendNudge: async (text) => { sentNudges.push(text); },
  });

  expect(sentMessages.length).toBe(1);
  expect(sentMessages[0].text).toContain("```");
  expect(sentMessages[0].text).toContain("hi");
  expect(sentNudges).toEqual([sentMessages[0].text]);
});

test("runScheduledTask injects upstream-compatible PI metadata for shell tasks", async () => {
  const taskId = `task-shell-env-${Date.now()}`;
  db!.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "print env",
    model: "openrouter/moonshotai/kimi-k2.6",
    task_kind: "shell",
    command: "printf '%s %s %s' \"$PI_SESSION_ID\" \"$PI_PROVIDER\" \"$PI_MODEL\"",
    cwd: ".",
    timeout_sec: 10,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const task = db!.getTaskById(taskId)!;
  await scheduler!.runScheduledTask(task, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
    sendNudge: async (text) => { sentNudges.push(text); },
  });

  expect(sentMessages.length).toBe(1);
  expect(sentMessages[0].text).toContain(`${taskId} openrouter moonshotai/kimi-k2.6`);
});

test("runScheduledTask can suppress Pushover nudges for shell output", async () => {
  const taskId = `task-shell-muted-${Date.now()}`;
  db!.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "echo hi",
    model: null,
    task_kind: "shell",
    command: "echo hi",
    cwd: ".",
    timeout_sec: 10,
    notify_on_complete: false,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const task = db!.getTaskById(taskId)!;
  await scheduler!.runScheduledTask(task, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
    sendNudge: async (text) => { sentNudges.push(text); },
  });

  expect(sentMessages.length).toBe(1);
  expect(sentMessages[0].text).toContain("hi");
  expect(sentNudges).toEqual([]);
});

test("runScheduledTask keeps empty shell output silent", async () => {
  const taskId = `task-shell-empty-${Date.now()}`;
  db!.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "true",
    model: null,
    task_kind: "shell",
    command: "true",
    cwd: ".",
    timeout_sec: 10,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const task = db!.getTaskById(taskId);
  expect(task?.task_kind).toBe("shell");

  await scheduler!.runScheduledTask(task!, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
  });

  expect(sentMessages.length).toBe(0);
  expect(db!.getTaskById(taskId)?.last_result).toBe("```\n(no output)\n```");
});

test("runScheduledTask truncates shell output on code-point boundaries", async () => {
  const taskId = `task-shell-unicode-${Date.now()}`;
  db!.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "unicode",
    model: null,
    task_kind: "shell",
    command: "bun -e 'process.stdout.write(\"🙂\".repeat(9000))'",
    cwd: ".",
    timeout_sec: 10,
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date().toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const task = db!.getTaskById(taskId);
  expect(task?.task_kind).toBe("shell");

  await scheduler!.runScheduledTask(task!, {
    queue: {} as any,
    agentPool: {} as any,
    sendMessage: async (jid, text) => { sentMessages.push({ jid, text }); },
  });

  expect(sentMessages.length).toBe(1);
  expect(sentMessages[0].text).toContain("…(truncated; 9000 characters total)");
  expect(sentMessages[0].text).not.toContain("\uFFFD");
});
