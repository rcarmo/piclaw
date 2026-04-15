/**
 * scheduled-tasks – registers /tasks and /scheduled commands that query
 * the SQLite scheduled_tasks table.
 */
import { Type } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { createTask } from "../db.js";
import { computeNextRun } from "../task-scheduler-utils.js";
import { validateShellCommand, validateShellCwd } from "../utils/task-validation.js";
import { createUuid } from "../utils/ids.js";
import {
  getScheduledTaskInspection,
  listScheduledTasks,
  type ScheduledTaskInspectionRecord,
} from "../scheduled-task-query-service.js";

function computeInitialRun(scheduleType: string, scheduleValue: string): string | null {
  if (scheduleType === "once") {
    const d = new Date(scheduleValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return computeNextRun(scheduleType, scheduleValue);
}

const STATUS_VALUES = new Set(["active", "paused", "completed"]);

function formatTask(row: ScheduledTaskInspectionRecord): string {
  const next = row.next_run ? `next ${row.next_run}` : "next n/a";
  const model = row.model ? ` model ${row.model}` : "";
  const kind = row.task_kind === "shell"
    ? "shell"
    : row.task_kind === "internal"
      ? "internal"
      : "agent";
  return `• ${row.id} (${row.status}) — ${kind} ${row.schedule_type} ${row.schedule_value}, ${next}${model} — ${row.summary}`;
}

function listTasks(filter: string | null): { summary: string; lines: string[] } {
  const result = listScheduledTasks({ status: filter && STATUS_VALUES.has(filter) ? filter as "active" | "paused" | "completed" : null, limit: 50 });
  const header =
    filter && STATUS_VALUES.has(filter)
      ? `Scheduled tasks (${filter})`
      : "Scheduled tasks";
  const summary = `Active ${result.counts.active} • Paused ${result.counts.paused} • Completed ${result.counts.completed}`;

  return {
    summary: `${header}\n${summary}`,
    lines: result.tasks.map(formatTask),
  };
}

/** Parameters for the schedule_task internal tool. */
const ScheduleTaskSchema = Type.Object({
  chat_jid: Type.Optional(Type.String({ description: "Target chat JID (default: web:default)." })),
  schedule_type: Type.Union([
    Type.Literal("cron"),
    Type.Literal("interval"),
    Type.Literal("once"),
  ], { description: "Schedule type." }),
  schedule_value: Type.String({ description: "Cron expression, interval ms, or ISO timestamp." }),
  prompt: Type.Optional(Type.String({ description: "Agent prompt (for task_kind=agent)." })),
  model: Type.Optional(Type.String({ description: "Model override (agent tasks only)." })),
  task_kind: Type.Optional(Type.Union([
    Type.Literal("agent"),
    Type.Literal("shell"),
  ], { description: "Task kind: agent or shell." })),
  command: Type.Optional(Type.String({ description: "Shell command to execute using the host shell (bash/sh on POSIX, PowerShell/cmd on Windows)." })),
  cwd: Type.Optional(Type.String({ description: "Working directory for shell tasks (relative to workspace)." })),
  timeout_sec: Type.Optional(Type.Integer({ description: "Shell timeout in seconds.", minimum: 1, maximum: 3600 })),
});

type ScheduleTaskDetails = {
  ok: boolean;
  id: string | null;
  task_kind: "agent" | "shell" | null;
  next_run: string | null;
};

const failureDetails: ScheduleTaskDetails = {
  ok: false,
  id: null,
  task_kind: null,
  next_run: null,
};

const ScheduledTaskInspectionSchema = Type.Object({
  action: Type.Optional(Type.Union([
    Type.Literal("list"),
    Type.Literal("get"),
  ])),
  id: Type.Optional(Type.String({ description: "Specific task ID for action=get or list filtering." })),
  chat_jid: Type.Optional(Type.String({ description: "Optional chat JID filter." })),
  status: Type.Optional(Type.Union([
    Type.Literal("active"),
    Type.Literal("paused"),
    Type.Literal("completed"),
  ], { description: "Optional task status filter." })),
  limit: Type.Optional(Type.Integer({ description: "Max tasks to return for action=list (1-50).", minimum: 1, maximum: 50 })),
  include_latest_run_log: Type.Optional(Type.Boolean({ description: "Include the most recent task run log summary when available." })),
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

/** Extension factory that registers /tasks and /scheduled slash commands. */
export const scheduledTasks: ExtensionFactory = (pi: ExtensionAPI) => {
  const handler = async (args: string) => {
    const token = (args || "").trim().toLowerCase();
    const filter = token === "all" || token === "" ? null : token;

    if (filter && !STATUS_VALUES.has(filter)) {
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
    description: "List or inspect scheduled tasks via the shared scheduled-task query service.",
    promptSnippet: "scheduled_tasks: list/get structured scheduled task records and latest run summaries.",
    parameters: ScheduledTaskInspectionSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const action = params.action || "list";
      const includeLatestRunLog = params.include_latest_run_log === true;
      if (action === "get") {
        const id = typeof params.id === "string" ? params.id.trim() : "";
        if (!id) {
          return {
            content: [{ type: "text", text: "Provide id for action=get." }],
            details: { action: "get", found: false, task: null },
          };
        }
        const task = getScheduledTaskInspection(id, {
          chat_jid: typeof params.chat_jid === "string" ? params.chat_jid.trim() : null,
          status: typeof params.status === "string" ? params.status as "active" | "paused" | "completed" : null,
          include_latest_run_log: includeLatestRunLog,
        });
        if (!task) {
          return {
            content: [{ type: "text", text: `No scheduled task found for ${id}.` }],
            details: { action: "get", found: false, task: null, id },
          };
        }
        return {
          content: [{ type: "text", text: formatTaskDetail(task) }],
          details: { action: "get", found: true, task },
        };
      }

      const result = listScheduledTasks({
        id: typeof params.id === "string" ? params.id.trim() : undefined,
        chat_jid: typeof params.chat_jid === "string" ? params.chat_jid.trim() : null,
        status: typeof params.status === "string" ? params.status as "active" | "paused" | "completed" : null,
        limit: typeof params.limit === "number" ? params.limit : undefined,
        include_latest_run_log: includeLatestRunLog,
      });
      const header = `Scheduled tasks\nActive ${result.counts.active} • Paused ${result.counts.paused} • Completed ${result.counts.completed}`;
      const body = result.tasks.length > 0 ? result.tasks.map(formatTask).join("\n") : "(no tasks found)";
      return {
        content: [{ type: "text", text: `${header}\n${body}` }],
        details: {
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
        },
      };
    },
  });

  pi.registerTool({
    name: "schedule_task",
    label: "schedule_task",
    description: "Schedule an agent prompt or host-shell command to run later or on a recurring basis. Shell tasks use bash/sh on POSIX and PowerShell/cmd on Windows.",
    promptSnippet: "schedule_task: create one-time, interval, or cron agent/shell tasks.",
    parameters: ScheduleTaskSchema,
    async execute(_toolCallId, params) {
      const chatJid = typeof params.chat_jid === "string" && params.chat_jid.trim()
        ? params.chat_jid.trim()
        : "web:default";

      const taskKind = params.task_kind === "shell" || params.command ? "shell" : "agent";
      if (taskKind === "agent") {
        const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
        if (!prompt) {
          return { content: [{ type: "text", text: "Missing prompt for agent task." }], details: failureDetails };
        }

        const nextRun = computeInitialRun(params.schedule_type, params.schedule_value);
        if (!nextRun) {
          return { content: [{ type: "text", text: "Invalid schedule value." }], details: failureDetails };
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
          schedule_type: params.schedule_type,
          schedule_value: params.schedule_value,
          next_run: nextRun,
          status: "active",
          created_at: new Date().toISOString(),
        });

        const details: ScheduleTaskDetails = { ok: true, id: taskId, task_kind: "agent", next_run: nextRun };
        return {
          content: [{ type: "text", text: `Scheduled agent task for ${chatJid}.` }],
          details,
        };
      }

      const validated = validateShellCommand(params.command);
      if (!validated.ok) {
        return { content: [{ type: "text", text: validated.error || "Invalid shell command." }], details: failureDetails };
      }
      if (params.model) {
        return { content: [{ type: "text", text: "Model overrides are not supported for shell tasks." }], details: failureDetails };
      }

      const cwdResult = validateShellCwd(params.cwd);
      if (!cwdResult.ok) {
        return { content: [{ type: "text", text: cwdResult.error || "Invalid cwd." }], details: failureDetails };
      }

      const nextRun = computeInitialRun(params.schedule_type, params.schedule_value);
      if (!nextRun) {
        return { content: [{ type: "text", text: "Invalid schedule value." }], details: failureDetails };
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
        schedule_type: params.schedule_type,
        schedule_value: params.schedule_value,
        next_run: nextRun,
        status: "active",
        created_at: new Date().toISOString(),
      });

      const details: ScheduleTaskDetails = { ok: true, id: taskId, task_kind: "shell", next_run: nextRun };
      return {
        content: [{ type: "text", text: `Scheduled shell task for ${chatJid}.` }],
        details,
      };
    },
  });
};
