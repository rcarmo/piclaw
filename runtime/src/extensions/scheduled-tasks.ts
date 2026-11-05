/**
 * scheduled-tasks – registers /tasks and /scheduled commands plus the unified
 * scheduled_tasks tool surface for create/list/get/pause/resume/mute/unmute/delete.
 */
import { Type } from "typebox";
import { readAccessConfig } from "../core/config-access.js";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createTask, deleteTask, getTaskById, updateTask } from "../db.js";
import {
  getScheduledTaskInspection,
  listScheduledTasks,
  type ScheduledTaskInspectionRecord,
} from "../scheduled-task-query-service.js";
import { computeNextRun } from "../task-scheduler-utils.js";
import type { ScheduledTask } from "../types.js";
import { createUuid } from "../utils/ids.js";
import { validateShellCommand, validateShellCwd } from "../utils/task-validation.js";

type TaskStatus = ScheduledTask["status"];
type TaskKind = Exclude<ScheduledTask["task_kind"], "internal"> | "internal";
type ScheduleType = ScheduledTask["schedule_type"];
type ScheduledTasksAction = "create" | "list" | "get" | "pause" | "resume" | "mute" | "unmute" | "delete";

type ScheduledTaskToolParams = {
  action?: ScheduledTasksAction;
  id?: string;
  chat_jid?: string;
  status?: TaskStatus;
  limit?: number;
  include_latest_run_log?: boolean;
  allow_internal?: boolean;
  notify?: boolean;
  muted?: boolean;
  no_nudge?: boolean;
  schedule_type?: ScheduleType;
  schedule_value?: string | number;
  prompt?: string;
  model?: string;
  task_kind?: "agent" | "shell";
  command?: string;
  cwd?: string;
  timeout_sec?: number;
};

function computeInitialRun(scheduleType: ScheduleType, scheduleValue: string): string | null {
  if (scheduleType === "once") {
    const d = new Date(scheduleValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return computeNextRun(scheduleType, scheduleValue);
}

const STATUS_VALUES = new Set(["active", "paused", "completed"] as const);

function normalizeChatJid(chatJid: unknown): string {
  return typeof chatJid === "string" && chatJid.trim() ? chatJid.trim() : "web:default";
}

function normalizeScheduleValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeScheduleType(value: unknown): ScheduleType | null {
  return value === "cron" || value === "interval" || value === "once" ? value : null;
}

function normalizeNotifyOnComplete(params: Pick<ScheduledTaskToolParams, "notify" | "muted" | "no_nudge">): boolean {
  if (params.muted === true || params.no_nudge === true) return false;
  if (params.notify === false) return false;
  return true;
}

function formatTask(row: ScheduledTaskInspectionRecord): string {
  const next = row.next_run ? `next ${row.next_run}` : "next n/a";
  const model = row.model ? ` model ${row.model}` : "";
  const muted = row.muted ? " muted" : "";
  const kind = row.task_kind === "shell"
    ? "shell"
    : row.task_kind === "internal"
      ? "internal"
      : "agent";
  return `• ${row.id} (${row.status}${muted}) — ${kind} ${row.schedule_type} ${row.schedule_value}, ${next}${model} — ${row.summary}`;
}

function listTasks(filter: string | null): { summary: string; lines: string[] } {
  const result = listScheduledTasks({ status: filter && STATUS_VALUES.has(filter as TaskStatus) ? filter as TaskStatus : null, limit: 50 });
  const header =
    filter && STATUS_VALUES.has(filter as TaskStatus)
      ? `Scheduled tasks (${filter})`
      : "Scheduled tasks";
  const summary = `Active ${result.counts.active} • Paused ${result.counts.paused} • Completed ${result.counts.completed}`;

  return {
    summary: `${header}\n${summary}`,
    lines: result.tasks.map(formatTask),
  };
}

const ScheduleTypeSchema = Type.Union([
  Type.Literal("cron"),
  Type.Literal("interval"),
  Type.Literal("once"),
], { description: "Schedule type." });

const ScheduleValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
], { description: "Cron expression, interval ms, or ISO timestamp." });

const TaskKindSchema = Type.Union([
  Type.Literal("agent"),
  Type.Literal("shell"),
], { description: "Task kind: agent or shell." });

/** Parameters for the backward-compatible schedule_task alias. */
const ScheduleTaskSchema = Type.Object({
  chat_jid: Type.Optional(Type.String({ description: "Target chat JID (default: web:default)." })),
  schedule_type: ScheduleTypeSchema,
  schedule_value: ScheduleValueSchema,
  prompt: Type.Optional(Type.String({ description: "Agent prompt (for task_kind=agent)." })),
  model: Type.Optional(Type.String({ description: "Model override (agent tasks only)." })),
  task_kind: Type.Optional(TaskKindSchema),
  command: Type.Optional(Type.String({ description: "Shell command to execute using the host shell (bash/sh on POSIX, PowerShell/cmd on Windows)." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for shell tasks (relative to workspace)." })),
  timeout_sec: Type.Optional(Type.Integer({ description: "Shell timeout in seconds.", minimum: 1, maximum: 3600 })),
  notify: Type.Optional(Type.Boolean({ description: "Whether successful task output should trigger a Pushover nudge. Defaults true." })),
  muted: Type.Optional(Type.Boolean({ description: "Set true to suppress Pushover nudges for this task." })),
  no_nudge: Type.Optional(Type.Boolean({ description: "Compatibility alias for muted=true." })),
});

const ScheduledTaskToolSchema = Type.Object({
  action: Type.Optional(Type.Union([
    Type.Literal("create"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("pause"),
    Type.Literal("resume"),
    Type.Literal("mute"),
    Type.Literal("unmute"),
    Type.Literal("delete"),
  ], { description: "Scheduled task action." })),
  id: Type.Optional(Type.String({ description: "Specific task ID for get/pause/resume/mute/unmute/delete." })),
  chat_jid: Type.Optional(Type.String({ description: "Optional chat JID filter or create target." })),
  status: Type.Optional(Type.Union([
    Type.Literal("active"),
    Type.Literal("paused"),
    Type.Literal("completed"),
  ], { description: "Optional task status filter for list/get." })),
  limit: Type.Optional(Type.Integer({ description: "Max tasks to return for action=list (1-50).", minimum: 1, maximum: 50 })),
  include_latest_run_log: Type.Optional(Type.Boolean({ description: "Include the most recent task run log summary when available." })),
  allow_internal: Type.Optional(Type.Boolean({ description: "Allow pause/resume/delete/mute/unmute for builtin internal tasks." })),
  notify: Type.Optional(Type.Boolean({ description: "For action=create, whether successful task output should trigger a Pushover nudge. Defaults true." })),
  muted: Type.Optional(Type.Boolean({ description: "For action=create, set true to suppress Pushover nudges for this task." })),
  no_nudge: Type.Optional(Type.Boolean({ description: "For action=create, compatibility alias for muted=true." })),
  schedule_type: Type.Optional(ScheduleTypeSchema),
  schedule_value: Type.Optional(ScheduleValueSchema),
  prompt: Type.Optional(Type.String({ description: "Agent prompt (for action=create and task_kind=agent)." })),
  model: Type.Optional(Type.String({ description: "Model override (create only; agent tasks only)." })),
  task_kind: Type.Optional(TaskKindSchema),
  command: Type.Optional(Type.String({ description: "Shell command for action=create and task_kind=shell." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for shell tasks (relative to workspace)." })),
  timeout_sec: Type.Optional(Type.Integer({ description: "Shell timeout in seconds.", minimum: 1, maximum: 3600 })),
});

function formatTaskDetail(row: ScheduledTaskInspectionRecord): string {
  const lines = [
    `Task ${row.id}`,
    `chat: ${row.chat_jid}`,
    `kind: ${row.task_kind}`,
    `status: ${row.status}`,
    `schedule: ${row.schedule_type} ${row.schedule_value}`,
    `next_run: ${row.next_run ?? "n/a"}`,
    `last_run: ${row.last_run ?? "n/a"}`,
    `last_result: ${row.last_result ?? "n/a"}`,
    `created_at: ${row.created_at}`,
    `model: ${row.model ?? "n/a"}`,
    `notify_on_complete: ${row.notify_on_complete ? "true" : "false"}`,
    `summary: ${row.summary}`,
  ];
  if (row.latest_run_log) {
    lines.push(
      `latest_run: ${row.latest_run_log.status} at ${row.latest_run_log.run_at} (${row.latest_run_log.duration_ms} ms)`,
    );
    if (row.latest_run_log.result_summary) lines.push(`latest_result: ${row.latest_run_log.result_summary}`);
    if (row.latest_run_log.error_summary) lines.push(`latest_error: ${row.latest_run_log.error_summary}`);
  }
  return lines.join("\n");
}

function failureDetails(action: ScheduledTasksAction, extra: Record<string, unknown> = {}) {
  return {
    action,
    ok: false,
    confirmed: false,
    id: null,
    task_kind: null,
    next_run: null,
    ...extra,
  };
}

function successDetails(action: ScheduledTasksAction, extra: Record<string, unknown> = {}) {
  return {
    action,
    ok: true,
    confirmed: true,
    ...extra,
  };
}

function asTaskKind(task: ScheduledTask | null | undefined): TaskKind | null {
  if (!task) return null;
  return (task.task_kind ?? "agent") as TaskKind;
}

function makeTextResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function createScheduledTask(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  const chatJid = normalizeChatJid(params.chat_jid);
  const scheduleType = normalizeScheduleType(params.schedule_type);
  if (!scheduleType) {
    return makeTextResult("Invalid schedule type.", failureDetails("create", { chat_jid: chatJid }));
  }

  const scheduleValue = normalizeScheduleValue(params.schedule_value);
  if (!scheduleValue) {
    return makeTextResult("Invalid schedule value.", failureDetails("create", { chat_jid: chatJid }));
  }

  const taskKind = params.task_kind === "shell" || params.command ? "shell" : "agent";
  if (taskKind === "agent") {
    const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
    if (!prompt) {
      return makeTextResult("Missing prompt for agent task.", failureDetails("create", { chat_jid: chatJid }));
    }

    const nextRun = computeInitialRun(scheduleType, scheduleValue);
    if (!nextRun) {
      return makeTextResult("Invalid schedule value.", failureDetails("create", { chat_jid: chatJid }));
    }
    const taskId = createUuid("task");
    createTask({
      id: taskId,
      chat_jid: chatJid,
      prompt,
      model: typeof params.model === "string" && params.model.trim() ? params.model.trim() : null,
      task_kind: "agent",
      command: null,
      cwd: null,
      timeout_sec: null,
      notify_on_complete: normalizeNotifyOnComplete(params),
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      next_run: nextRun,
      status: "active",
      created_at: new Date().toISOString(),
    });
    return makeTextResult(
      `Scheduled agent task for ${chatJid}.`,
      successDetails("create", {
        schedule_accepted: true,
        id: taskId,
        task_kind: "agent",
        next_run: nextRun,
        chat_jid: chatJid,
        notify_on_complete: normalizeNotifyOnComplete(params),
      }),
    );
  }

  const validated = validateShellCommand(params.command);
  if (!validated.ok) {
    return makeTextResult(validated.error || "Invalid shell command.", failureDetails("create", { chat_jid: chatJid }));
  }
  if (params.model) {
    return makeTextResult(
      "Model overrides are not supported for shell tasks.",
      failureDetails("create", { chat_jid: chatJid, task_kind: "shell" }),
    );
  }
  const cwdResult = validateShellCwd(params.cwd);
  if (!cwdResult.ok) {
    return makeTextResult(cwdResult.error || "Invalid cwd.", failureDetails("create", { chat_jid: chatJid, task_kind: "shell" }));
  }

  const nextRun = computeInitialRun(scheduleType, scheduleValue);
  if (!nextRun) {
    return makeTextResult("Invalid schedule value.", failureDetails("create", { chat_jid: chatJid, task_kind: "shell" }));
  }

  const taskId = createUuid("task");
  createTask({
    id: taskId,
    chat_jid: chatJid,
    prompt: validated.command || "",
    model: null,
    task_kind: "shell",
    command: validated.command || null,
    cwd: cwdResult.cwd,
    timeout_sec: params.timeout_sec ?? null,
    notify_on_complete: normalizeNotifyOnComplete(params),
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    next_run: nextRun,
    status: "active",
    created_at: new Date().toISOString(),
  });

  return makeTextResult(
    `Scheduled shell task for ${chatJid}.`,
    successDetails("create", {
      id: taskId,
      task_kind: "shell",
      next_run: nextRun,
      chat_jid: chatJid,
      notify_on_complete: normalizeNotifyOnComplete(params),
    }),
  );
}

function getTaskForMutation(action: "pause" | "resume" | "mute" | "unmute" | "delete", params: ScheduledTaskToolParams):
  | { task: ScheduledTask; id: string; allowInternal: boolean }
  | AgentToolResult<Record<string, unknown>> {
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    return makeTextResult(`Provide id for action=${action}.`, failureDetails(action, { found: false, id: null }));
  }

  const task = getTaskById(id);
  if (!task) {
    return makeTextResult(`No scheduled task found for ${id}.`, failureDetails(action, { found: false, id }));
  }

  const allowInternal = params.allow_internal === true;
  if ((task.task_kind ?? "agent") === "internal" && !allowInternal) {
    return makeTextResult(
      `Task ${id} is internal and cannot be ${action}d unless allow_internal=true.`,
      failureDetails(action, {
        found: true,
        id,
        protected: true,
        allow_internal: false,
        task_kind: asTaskKind(task),
        old_status: task.status,
        new_status: task.status,
      }),
    );
  }

  return { task, id, allowInternal };
}

function pauseTask(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  const loaded = getTaskForMutation("pause", params);
  if ("content" in loaded) return loaded;

  const { task, id } = loaded;
  if (task.status === "paused") {
    return makeTextResult(
      `Task ${id} is already paused.`,
      successDetails("pause", {
        id,
        found: true,
        noop: true,
        task_kind: asTaskKind(task),
        old_status: task.status,
        new_status: task.status,
      }),
    );
  }
  if (task.status === "completed") {
    return makeTextResult(
      `Task ${id} is completed and cannot be paused.`,
      failureDetails("pause", {
        found: true,
        id,
        task_kind: asTaskKind(task),
        old_status: task.status,
        new_status: task.status,
      }),
    );
  }

  updateTask(id, { status: "paused" });
  const updated = getTaskById(id)!;
  return makeTextResult(
    `Paused task ${id}.`,
    successDetails("pause", {
      id,
      found: true,
      task_kind: asTaskKind(updated),
      old_status: task.status,
      new_status: updated.status,
    }),
  );
}

function resumeTask(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  const loaded = getTaskForMutation("resume", params);
  if ("content" in loaded) return loaded;

  const { task, id } = loaded;
  if (task.status === "active") {
    return makeTextResult(
      `Task ${id} is already active.`,
      successDetails("resume", {
        id,
        found: true,
        noop: true,
        task_kind: asTaskKind(task),
        old_status: task.status,
        new_status: task.status,
      }),
    );
  }
  if (!task.next_run) {
    return makeTextResult(
      `Task ${id} has no next_run and cannot be resumed.`,
      failureDetails("resume", {
        found: true,
        id,
        task_kind: asTaskKind(task),
        old_status: task.status,
        new_status: task.status,
      }),
    );
  }

  updateTask(id, { status: "active" });
  const updated = getTaskById(id)!;
  return makeTextResult(
    `Resumed task ${id}.`,
    successDetails("resume", {
      id,
      found: true,
      task_kind: asTaskKind(updated),
      old_status: task.status,
      new_status: updated.status,
      next_run: updated.next_run,
    }),
  );
}

function muteTask(params: ScheduledTaskToolParams, muted: boolean): AgentToolResult<Record<string, unknown>> {
  const action = muted ? "mute" : "unmute";
  const loaded = getTaskForMutation(action, params);
  if ("content" in loaded) return loaded;

  const { task, id } = loaded;
  const oldNotify = task.notify_on_complete !== false && task.notify_on_complete !== 0;
  const nextNotify = !muted;
  if (oldNotify === nextNotify) {
    return makeTextResult(
      `Task ${id} is already ${muted ? "muted" : "unmuted"}.`,
      successDetails(action, {
        id,
        found: true,
        noop: true,
        task_kind: asTaskKind(task),
        old_notify_on_complete: oldNotify,
        new_notify_on_complete: nextNotify,
      }),
    );
  }

  updateTask(id, { notify_on_complete: nextNotify });
  const updated = getTaskById(id)!;
  const updatedNotify = updated.notify_on_complete !== false && updated.notify_on_complete !== 0;
  return makeTextResult(
    `${muted ? "Muted" : "Unmuted"} task ${id}.`,
    successDetails(action, {
      id,
      found: true,
      task_kind: asTaskKind(updated),
      old_notify_on_complete: oldNotify,
      new_notify_on_complete: updatedNotify,
    }),
  );
}

function deleteScheduledTask(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  const loaded = getTaskForMutation("delete", params);
  if ("content" in loaded) return loaded;

  const { task, id } = loaded;
  deleteTask(id);
  return makeTextResult(
    `Deleted task ${id}.`,
    successDetails("delete", {
      id,
      found: true,
      deleted: true,
      task_kind: asTaskKind(task),
      old_status: task.status,
      new_status: "deleted",
    }),
  );
}

function inspectScheduledTasks(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  const action = params.action || "list";
  const includeLatestRunLog = params.include_latest_run_log === true;
  if (action === "get") {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      return makeTextResult("Provide id for action=get.", {
        action: "get",
        found: false,
        task: null,
      });
    }
    const task = getScheduledTaskInspection(id, {
      chat_jid: typeof params.chat_jid === "string" ? params.chat_jid.trim() : null,
      status: typeof params.status === "string" ? params.status as TaskStatus : null,
      include_latest_run_log: includeLatestRunLog,
    });
    if (!task) {
      return makeTextResult(`No scheduled task found for ${id}.`, {
        action: "get",
        found: false,
        task: null,
        id,
      });
    }
    return makeTextResult(formatTaskDetail(task), {
      action: "get",
      found: true,
      task,
    });
  }

  const result = listScheduledTasks({
    id: typeof params.id === "string" ? params.id.trim() : undefined,
    chat_jid: typeof params.chat_jid === "string" ? params.chat_jid.trim() : null,
    status: typeof params.status === "string" ? params.status as TaskStatus : null,
    limit: typeof params.limit === "number" ? params.limit : undefined,
    include_latest_run_log: includeLatestRunLog,
  });
  const header = `Scheduled tasks\nActive ${result.counts.active} • Paused ${result.counts.paused} • Completed ${result.counts.completed}`;
  const body = result.tasks.length > 0 ? result.tasks.map(formatTask).join("\n") : "(no tasks found)";
  return makeTextResult(`${header}\n${body}`, {
    action: "list",
    count: result.tasks.length,
    counts: result.counts,
    tasks: result.tasks,
    filters: {
      id: typeof params.id === "string" ? params.id.trim() || null : null,
      chat_jid: typeof params.chat_jid === "string" ? params.chat_jid.trim() || null : null,
      status: typeof params.status === "string" ? params.status : null,
      limit: typeof params.limit === "number" ? params.limit : null,
      include_latest_run_log: includeLatestRunLog,
    },
  });
}

function executeScheduledTasks(params: ScheduledTaskToolParams): AgentToolResult<Record<string, unknown>> {
  if (readAccessConfig().mode !== "single-user") return makeTextResult("Scheduling tools are disabled until owner-bound task and queue authority is integrated.", { error: "access_denied" });
  const action = params.action || "list";
  switch (action) {
    case "create":
      return createScheduledTask(params);
    case "pause":
      return pauseTask(params);
    case "resume":
      return resumeTask(params);
    case "mute":
      return muteTask(params, true);
    case "unmute":
      return muteTask(params, false);
    case "delete":
      return deleteScheduledTask(params);
    case "get":
    case "list":
    default:
      return inspectScheduledTasks(params);
  }
}

/** Extension factory that registers /tasks, /scheduled, and task-management tools. */
export const scheduledTasks: ExtensionFactory = (pi: ExtensionAPI) => {
  const handler = async (args: string) => {
    if (readAccessConfig().mode !== "single-user") {
      pi.sendMessage({ customType: "scheduled-tasks", content: "Task listing is disabled until owner-bound scheduling is integrated.", display: true });
      return;
    }
    const token = (args || "").trim().toLowerCase();
    const filter = token === "all" || token === "" ? null : token;

    if (filter && !STATUS_VALUES.has(filter as TaskStatus)) {
      const message = "Usage: /tasks [all|active|paused|completed]";
      pi.sendMessage({ customType: "scheduled-tasks", content: message, display: true });
      return;
    }

    const { summary, lines } = listTasks(filter);
    const body = lines.length > 0 ? lines.join("\n") : "(no tasks found)";
    const message = `${summary}\n${body}`;
    pi.sendMessage({ customType: "scheduled-tasks", content: message, display: true });
  };

  pi.registerCommand("tasks", {
    description: "List scheduled tasks (all|active|paused|completed)",
    handler,
  });

  pi.registerCommand("scheduled", {
    description: "Alias for /tasks",
    handler,
  });

  pi.registerTool({
    name: "scheduled_tasks",
    label: "scheduled_tasks",
    description: "Unified scheduled task management: create, list, inspect, pause, resume, mute/unmute Pushover nudges, and delete scheduled tasks. For recurring or deferred local work only — not for remote command execution (use ssh + bash for that).",
    promptSnippet: "scheduled_tasks: create/list/get/pause/resume/mute/unmute/delete structured scheduled task records. Use notify=false or muted=true to suppress Pushover nudges for task results. Not for remote execution — use ssh + bash instead.",
    parameters: ScheduledTaskToolSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      return executeScheduledTasks(params as ScheduledTaskToolParams);
    },
  });

  pi.registerTool({
    name: "schedule_task",
    label: "schedule_task",
    description: "Deprecated compatibility alias for creating scheduled tasks. Prefer scheduled_tasks with action=create.",
    promptSnippet: "schedule_task (compat): create one-time, interval, or cron agent/shell tasks.",
    parameters: ScheduleTaskSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      return executeScheduledTasks({ ...(params as ScheduledTaskToolParams), action: "create" });
    },
  });
};
