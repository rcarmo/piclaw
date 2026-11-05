import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { deleteTask, getDb, getTaskById, updateTask } from "../../../db.js";
import { getScheduledTaskInspection, listScheduledTasks } from "../../../scheduled-task-query-service.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import type { ScheduledTask } from "../../../types.js";

const VALID_STATUSES = new Set(["active", "paused", "completed"]);

function stringParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim() || "";
  return value || null;
}

function numberParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolParam(url: URL, name: string): boolean {
  const value = (url.searchParams.get(name) || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function json(channel: WebChannelLike, body: Record<string, unknown>, status = 200): Response {
  return channel.json(body, status);
}

function taskKind(task: ScheduledTask): ScheduledTask["task_kind"] {
  return task.task_kind ?? "agent";
}

function mutationError(action: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { body: { ok: false, action, error: message, ...extra }, status };
}

function getMutableTask(action: "pause" | "resume" | "delete", id: string, allowInternal: boolean): ScheduledTask | ReturnType<typeof mutationError> {
  if (!id) return mutationError(action, "Missing scheduled task id.", 400, { id: null });
  const task = getTaskById(id);
  if (!task) return mutationError(action, `No scheduled task found for ${id}.`, 404, { id });
  if (taskKind(task) === "internal" && !allowInternal) {
    return mutationError(action, `Task ${id} is internal and requires allow_internal=true.`, 403, {
      id,
      protected: true,
      task_kind: taskKind(task),
      status: task.status,
    });
  }
  return task;
}

export function handleScheduledTasksManagementList(channel: WebChannelLike, _req: Request, url: URL): Response {
  const id = stringParam(url, "id");
  const status = stringParam(url, "status");
  const query = {
    id: id || undefined,
    chat_jid: stringParam(url, "chat_jid"),
    status: status && VALID_STATUSES.has(status) ? status as ScheduledTask["status"] : null,
    limit: numberParam(url, "limit", 50),
    include_latest_run_log: true,
    include_run_logs: boolParam(url, "include_run_logs") || Boolean(id),
    run_log_limit: numberParam(url, "run_log_limit", 5),
  };

  if (id) {
    const task = getScheduledTaskInspection(id, query);
    if (!task) return json(channel, { ok: false, found: false, error: `No scheduled task found for ${id}.`, task: null }, 404);
    return json(channel, { ok: true, found: true, task });
  }

  const result = listScheduledTasks(query);
  return json(channel, { ok: true, ...result, filters: query });
}

export async function handleScheduledTasksManagementAction(channel: WebChannelLike, req: Request): Promise<Response> {
  const authorise = captureWebRequestAuthority(channel.authGateway, req);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const allowInternal = body.allow_internal === true;

  if (action !== "pause" && action !== "resume" && action !== "delete") {
    return json(channel, { ok: false, action: action || "unknown", error: "Unsupported scheduled task action." }, 400);
  }
  const allowedKeys = new Set(["action", "id", "allow_internal"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return json(channel, { ok: false, action, error: "Scheduled task request contains unsupported fields." }, 400);
  }

  // Include receipt projection in the mutation transaction. A failed read must
  // not report failure after a durable task change has committed.
  const receipt = await admitSqliteWrite(getDb(), (): { body: Record<string, unknown>; status?: number } => {
  const loaded = getMutableTask(action, id, allowInternal);
  if ("body" in loaded) return loaded;
  const task = loaded;

  if (action === "pause") {
    if (task.status === "completed") return mutationError(action, `Task ${id} is completed and cannot be paused.`, 409, { id, status: task.status });
    if (task.status !== "paused") updateTask(id, { status: "paused" });
  } else if (action === "resume") {
    if (!task.next_run) return mutationError(action, `Task ${id} has no next_run and cannot be resumed.`, 409, { id, status: task.status });
    if (task.status !== "active") updateTask(id, { status: "active" });
  } else {
    deleteTask(id);
    return { body: { ok: true, action, id, deleted: true, task_kind: taskKind(task), old_status: task.status } };
  }

  const updated = getScheduledTaskInspection(id, { include_latest_run_log: true, include_run_logs: true });
  return { body: { ok: true, action, id, task: updated, old_status: task.status, new_status: updated?.status ?? null } };
  }, authorise, req.signal);
  return json(channel, receipt.body, receipt.status);
}
