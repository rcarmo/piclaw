/** Public task facade. Definitions/payloads and S07 heads own execution data;
 * scheduled_tasks contains only the compatibility/UI projection. */
import type { ScheduledRunRecord } from "../service-effects/contracts/scheduled-run-store.js";
import type Database from "bun:sqlite";
import type { ScheduledTask, TaskRunLog } from "../types.js";
import { getDb } from "./connection.js";
import { canonicalScheduledTasksSql, projectScheduledTask, readCanonicalScheduledTask } from "./scheduled-task-definitions.js";
import { createScheduledTaskAuthorityRecord, deleteScheduledTaskAuthorityRecord, reviseScheduledTaskAuthorityRecord,
  setScheduledTaskAuthorityStatus, settleDirectScheduledTask } from "./scheduled-task-authority.js";

type TaskUpdate = Partial<Pick<ScheduledTask,
  "chat_jid" | "prompt" | "model" | "task_kind" | "command" | "cwd" | "timeout_sec" | "notify_on_complete" |
  "schedule_type" | "schedule_value" | "next_run" | "status"
>>;
const CONFIG_FIELDS: ReadonlyArray<keyof TaskUpdate> = ["chat_jid", "prompt", "model", "task_kind", "command", "cwd", "timeout_sec",
  "notify_on_complete", "schedule_type", "schedule_value", "next_run"];
function equivalent(field: keyof TaskUpdate, left: unknown, right: unknown): boolean {
  if (field === "notify_on_complete") return (left !== false && left !== 0) === (right !== false && right !== 0);
  return (left ?? null) === (right ?? null);
}

export function createTask(task: Omit<ScheduledTask, "last_run" | "last_result" | "revision">, db: Database = getDb()): void {
  const next = task.next_run ? new Date(task.next_run).toISOString() : null;
  createScheduledTaskAuthorityRecord(db, { ...task, schedule_value: task.schedule_type === "once" && next ? next : task.schedule_value,
    next_run: next, revision: 1, last_run: null, last_result: null });
}
export function getTaskById(id: string): ScheduledTask | undefined {
  // Keep the legacy SQLite facade's runtime null for a missing/deleted task.
  return (readCanonicalScheduledTask(getDb(), id) ?? null) as ScheduledTask | undefined;
}

/** Optional caller revision preserves optimistic edits; owner CAS also fences
 * every actual head write, including a concurrent occurrence completion. */
export function updateTask(id: string, updates: TaskUpdate, expectedRevision?: number): void {
  if (Object.keys(updates).length === 0) return;
  const db = getDb();
  db.transaction(() => {
    const previous = readCanonicalScheduledTask(db, id);
    if (!previous) return;
    if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw Error("Scheduled task revision mismatch");
    const changed = CONFIG_FIELDS.some(field => updates[field] !== undefined && !equivalent(field, previous[field], updates[field]));
    const now = new Date().toISOString();
    if (changed) {
      const current = { ...previous };
      for (const field of [...CONFIG_FIELDS, "status"] as const) {
        if (updates[field] !== undefined) Object.assign(current, { [field]: updates[field] });
      }
      if (current.next_run) current.next_run = new Date(current.next_run).toISOString();
      current.revision++;
      reviseScheduledTaskAuthorityRecord(db, current, now);
    } else if (updates.status !== undefined && updates.status !== previous.status) {
      setScheduledTaskAuthorityStatus(db, id, updates.status, now);
    }
  }).immediate();
}

export function deleteTask(id: string): void {
  deleteScheduledTaskAuthorityRecord(getDb(), id, new Date().toISOString());
}

/** Management compatibility query; occurrence admission belongs to S07. */
export function getDueTasks(): ScheduledTask[] {
  const db = getDb();
  const ids = db.query(`WITH tasks AS (${canonicalScheduledTasksSql}) SELECT id FROM tasks
    WHERE status='active' AND next_run IS NOT NULL AND next_run<=? ORDER BY next_run`).all(new Date().toISOString()) as { id: string }[];
  return ids.map(row => readCanonicalScheduledTask(db, row.id)!);
}

/** Direct/unadmitted compatibility settlement shares the head owner and cannot
 * advance a newer definition after a concurrent edit. */
export function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string, expectedRevision?: number): void {
  settleDirectScheduledTask(getDb(), id, nextRun, lastResult, new Date().toISOString(), expectedRevision);
}

/** Compatibility repair derives from stored authority; caller text/next-run is
 * never an independent projection authority. Admitted completion projects in its transaction. */
export function applyScheduledRunToTask(record: ScheduledRunRecord, _lastResult: string): void {
  const db = getDb();
  db.transaction(() => projectScheduledTask(db, record.taskId, record.runId)).immediate();
}

/** Record an unlinked legacy/direct execution. Admitted S07 result payloads
 * and their history projection are written inside its completion transaction. */
export function logTaskRun(log: TaskRunLog): number {
  const result = getDb().prepare(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(log.task_id, log.run_at, log.duration_ms, log.status, log.result, log.error);
  return Number(result.lastInsertRowid);
}
export function getTaskRunLogs(taskId: string): TaskRunLog[] {
  return getDb().prepare("SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at").all(taskId) as TaskRunLog[];
}
