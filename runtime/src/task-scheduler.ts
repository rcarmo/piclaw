/**
 * task-scheduler.ts – Polls for due scheduled tasks and executes them.
 *
 * Runs a periodic loop (every SCHEDULER_POLL_INTERVAL ms) that queries the
 * database for active tasks whose `next_run` is in the past, then enqueues
 * each task on the AgentQueue for lane-aware execution.
 *
 * Each task run:
 *   1. Saves the current session tree position so the user's conversation
 *      context is not polluted.
 *   2. Optionally switches the LLM model if the task specifies one.
 *   3. Runs the agent with the task's prompt.
 *   4. Sends the response to the task's chat and triggers a nudge notification.
 *   5. Restores the original session position and model.
 *   6. Logs the run result and computes the next_run timestamp.
 *
 * Consumers:
 *   - runtime.ts calls startSchedulerLoop() at startup.
 *   - The AgentQueue (queue.ts) serialises task execution with user messages per chat lane while allowing unrelated chats to progress in parallel.
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import Database from "bun:sqlite";

import { WORKSPACE_DIR, getRuntimeTimingConfig } from "./core/config.js";
import { drainScheduledBudgetNotifications } from "./budget/scheduled-notifications.js";
import { readAccessConfig } from "./core/config-access.js";
import { getExecutionIdentity } from "./core/execution-context.js";
import { formatRecoverySummary } from "./agent-pool/automatic-recovery.js";
import { DREAM_TASK_ID, parseDreamPromptToken, runDreamAgentTurn, runDreamMaintenance } from "./dream.js";
import { computeNextRun } from "./task-scheduler-utils.js";
import type { AgentPool } from "./agent-pool.js";
import { applyScheduledRunToTask, getDb, getTaskById, logTaskRun, updateTaskAfterRun } from "./db.js";
import { AgentQueue } from "./queue.js";
import { detectChannel, formatOutbound } from "./router.js";
import type {
  ScheduledRunLease,
  ScheduledRunReclaimAuthority,
  ScheduledRunStore,
} from "./service-effects/contracts/scheduled-run-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue, type EffectIdentity } from "./service-effects/contracts/common.js";
import { createCurrentPiclawScheduledRunStore } from "./service-effects/current-piclaw/scheduled-run-store.js";
import { addCanonicalDuration } from "./service-effects/current-piclaw/scheduled-run-values.js";
import type { ScheduledTask } from "./types.js";
import { createTrackedBashOperations } from "./tools/tracked-bash.js";
import { createLogger } from "./utils/logger.js";
import { buildPiSessionEnv } from "./utils/pi-session-env.js";
import { validateShellCommand, validateShellCwd } from "./utils/task-validation.js";

const log = createLogger("scheduler");

/** Legacy task records cannot authorise multi-user work. No caller identity can enable it. */
function canRunLegacyScheduledWork(): boolean {
  try {
    const mode = readAccessConfig().mode;
    const identity = getExecutionIdentity();
    return mode === "single-user" && (!identity || identity.mode === "single-user");
  } catch {
    log.warn("Scheduled work denied because access configuration is invalid", { operation: "scheduler.access_denied" });
    return false;
  }
}

function unsupportedScheduledRun(): ScheduledTaskRunOutcome {
  return { status: "skipped", result: null, error: "Scheduled work requires valid single-user configuration and context.", durationMs: 0, taskRunLogId: null };
}

/**
 * Dependency injection interface provided by runtime.ts.
 * Keeps the scheduler decoupled from concrete channel implementations.
 */
export interface SchedulerDeps {
  /** The shared lane-aware execution queue. */
  queue: AgentQueue;
  /** The agent pool for running agent turns. */
  agentPool: AgentPool;
  /** Send a text message to a chat. */
  sendMessage: (jid: string, text: string, options?: {
    forceRoot?: boolean;
    threadId?: number | null;
    source?: string;
    mediaIds?: number[];
    contentBlocks?: Array<Record<string, unknown>>;
  }) => Promise<void>;
  /** Send a push notification nudge (optional). */
  sendNudge?: (text: string) => Promise<void>;
}

/** Lightweight runtime metrics for scheduler observability. */
export { computeNextRun } from "./task-scheduler-utils.js";

export interface SchedulerMetrics {
  polls: number;
  tasksEnqueued: number;
  taskRunsStarted: number;
  taskRunsSucceeded: number;
  taskRunsFailed: number;
  lastPollAt: string | null;
}

const schedulerMetrics: SchedulerMetrics = {
  polls: 0,
  tasksEnqueued: 0,
  taskRunsStarted: 0,
  taskRunsSucceeded: 0,
  taskRunsFailed: 0,
  lastPollAt: null,
};

/** Return an immutable snapshot of scheduler metrics counters. */
export function getSchedulerMetrics(): SchedulerMetrics {
  return { ...schedulerMetrics };
}

/** Reset scheduler metrics (used by tests to isolate assertions). */
export function resetSchedulerMetricsForTests(): void {
  schedulerMetrics.polls = 0;
  schedulerMetrics.tasksEnqueued = 0;
  schedulerMetrics.taskRunsStarted = 0;
  schedulerMetrics.taskRunsSucceeded = 0;
  schedulerMetrics.taskRunsFailed = 0;
  schedulerMetrics.lastPollAt = null;
}

/** Parse a "provider/modelId" label into its components. */
function parseModelLabel(label: string): { provider?: string; modelId: string } {
  const trimmed = label.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    return {
      provider: trimmed.slice(0, slash),
      modelId: trimmed.slice(slash + 1),
    };
  }
  return { provider: undefined, modelId: trimmed };
}

/** Apply a model label to the agent pool for a specific chat. */
async function applyModelLabel(agentPool: AgentPool, chatJid: string, label: string) {
  const { provider, modelId } = parseModelLabel(label);
  return agentPool.applyControlCommand(chatJid, {
    type: "model",
    provider,
    modelId,
    raw: `/model ${label}`,
  });
}

/**
 * Switch the agent to the task's model override.
 * Returns an error message string on failure, or null on success.
 */
async function switchTaskModel(task: ScheduledTask, deps: SchedulerDeps): Promise<string | null> {
  if (!task.model) return null;
  const control = await applyModelLabel(deps.agentPool, task.chat_jid, task.model);
  if (control.status === "error") {
    return `Model switch failed: ${control.message}`;
  }
  return null;
}

/** Restore the agent's model to what it was before the task ran. */
async function restoreOriginalModel(
  task: ScheduledTask,
  deps: SchedulerDeps,
  savedModel: string | null,
  mayContinue: () => boolean,
): Promise<void> {
  if (!task.model || !savedModel || savedModel === task.model) return;
  const control = await applyModelLabel(deps.agentPool, task.chat_jid, savedModel);
  if (!mayContinue()) return;
  if (control.status === "error") {
    log.error("Failed to restore model after scheduled task", {
      operation: "restore_original_model",
      chatJid: task.chat_jid,
      model: savedModel,
      errorMessage: control.message,
    });
  }
}

const MAX_SHELL_OUTPUT_CHARS = 8000;

async function runInternalTask(task: ScheduledTask, deps: SchedulerDeps): Promise<{ result: string | null; error: string | null; notify: boolean }> {
  const action = (task.prompt || "").trim().toLowerCase();
  const dreamToken = parseDreamPromptToken(action);

  if (dreamToken.matched && task.id === DREAM_TASK_ID) {
    try {
      const result = await runDreamAgentTurn({
        chatJid: task.chat_jid,
        days: dreamToken.days,
        mode: "auto",
        model: task.model,
        agentPool: deps.agentPool,
      });
      return {
        result: result.result,
        error: null,
        notify: false,
      };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
        notify: false,
      };
    }
  }

  if (dreamToken.matched) {
    try {
      const result = await runDreamMaintenance({
        chatJid: task.chat_jid,
        days: dreamToken.days,
        mode: dreamToken.mode,
      });
      return {
        result: result.skipped
          ? `${result.mode === "auto" ? "AutoDream" : "Dream"} skipped: ${result.skip_reason}`
          : `${result.mode === "auto" ? "AutoDream" : "Dream"} updated ${result.memory_path} (${result.complete_days} complete, ${result.partial_days} partial, ${result.unsummarised_days} unsummarised).`,
        error: null,
        notify: false,
      };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
        notify: false,
      };
    }
  }

  return { result: null, error: `Unknown internal task: ${task.prompt || "(empty)"}`, notify: false };
}

async function runShellTask(task: ScheduledTask): Promise<{ result: string | null; error: string | null; notify: boolean }> {
  const validated = validateShellCommand(task.command);
  if (!validated.ok) return { result: null, error: validated.error || "Invalid command.", notify: false };

  const cwdResult = validateShellCwd(task.cwd);
  if (!cwdResult.ok) return { result: null, error: cwdResult.error || "Invalid cwd.", notify: false };

  const exec = createTrackedBashOperations();
  let output = "";
  let outputChars = 0;
  let previewChars = 0;
  let truncated = false;
  const decoder = new TextDecoder();

  const appendDecodedText = (text: string) => {
    for (const char of text) {
      outputChars += 1;
      if (previewChars < MAX_SHELL_OUTPUT_CHARS) {
        output += char;
        previewChars += 1;
      } else {
        truncated = true;
      }
    }
  };

  try {
    const res = await exec.exec(validated.command!, cwdResult.cwd || WORKSPACE_DIR, {
      onData: (chunk: Buffer) => {
        appendDecodedText(decoder.decode(chunk, { stream: true }));
      },
      timeout: task.timeout_sec ?? undefined,
      env: buildPiSessionEnv({
        sessionId: task.id,
        modelLabel: task.model,
      }),
    });
    appendDecodedText(decoder.decode());

    const trimmed = output.trim();
    const summary = trimmed ? trimmed : "(no output)";
    const suffix = truncated ? `\n…(truncated; ${outputChars} characters total)` : "";
    const formatted = `\`\`\`\n${summary}${suffix}\n\`\`\``;

    if (res.exitCode && res.exitCode !== 0) {
      return { result: null, error: `Command failed (exit ${res.exitCode}).\n${formatted}`, notify: false };
    }
    return { result: formatted, error: null, notify: Boolean(trimmed || truncated) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, error: `Command error: ${message}`, notify: false };
  }
}

export interface ScheduledTaskRunOutcome {
  status: "success" | "error" | "skipped";
  result: string | null;
  error: string | null;
  durationMs: number;
  taskRunLogId: number | null;
}

/**
 * Execute a single scheduled task and preserve the existing delivery/log format.
 * Direct callers retain legacy recurrence advancement; the durable scheduler
 * disables it and lets EF-S07 settle the claimed occurrence instead.
 */
export async function runScheduledTask(
  task: ScheduledTask,
  deps: SchedulerDeps,
  options: { advanceTask?: boolean } = {},
): Promise<ScheduledTaskRunOutcome> {
  return executeScheduledTask(task, deps, options);
}

async function executeScheduledTask(
  task: ScheduledTask,
  deps: SchedulerDeps,
  options: { advanceTask?: boolean },
  claimActive: () => boolean = () => true,
  scheduledLease?: ScheduledRunLease,
): Promise<ScheduledTaskRunOutcome> {
  if (!canRunLegacyScheduledWork()) return unsupportedScheduledRun();
  // Once denied, finally/catch paths must not restore models or persist results.
  let allowed = true;
  const mayContinue = () => allowed && (allowed = claimActive() && canRunLegacyScheduledWork());
  // Re-check task status (may have been paused/cancelled while queued).
  const fresh = getTaskById(task.id);
  if (!fresh || fresh.status !== "active" || fresh.revision !== task.revision) {
    return { status: "skipped", result: null, error: null, durationMs: 0, taskRunLogId: null };
  }
  const notifyOnComplete = fresh.notify_on_complete !== false && fresh.notify_on_complete !== 0;

  const appendRecoverySummary = (text: string | null, recoverySummary: string | null): string | null => {
    const normalizedText = typeof text === "string" && text.trim() ? text.trim() : "";
    const normalizedSummary = typeof recoverySummary === "string" && recoverySummary.trim() ? recoverySummary.trim() : "";
    if (normalizedText && normalizedSummary) return `${normalizedText}\n\n${normalizedSummary}`;
    if (normalizedText) return normalizedText;
    if (normalizedSummary) return normalizedSummary;
    return null;
  };

  const start = Date.now();
  const budgetWorkId = `scheduled:${task.id}:${start}`;
  schedulerMetrics.taskRunsStarted += 1;
  let result: string | null = null;
  let error: string | null = null;
  let loggedResult: string | null = null;
  let loggedError: string | null = null;
  let budgetBlocked = false;
  try {
    const kind = task.task_kind === "internal"
      ? "internal"
      : task.task_kind === "shell" || task.command
        ? "shell"
        : "agent";

    if (kind === "internal") {
      // Switch model if the internal task specifies one (e.g. Dream).
      const savedModel = task.model ? await deps.agentPool.getCurrentModelLabel(task.chat_jid) : null;
      if (!mayContinue()) return unsupportedScheduledRun();
      if (task.model && (!savedModel || savedModel !== task.model)) {
        const switchErr = await switchTaskModel(task, deps);
        if (!mayContinue()) return unsupportedScheduledRun();
        if (switchErr) { error = switchErr; }
      }
      if (!error) {
        const out = await runInternalTask(task, deps);
        if (!mayContinue()) return unsupportedScheduledRun();
        if (out.error) {
          error = out.error;
        } else {
          result = out.result;
        }
      }
      // Restore original model after internal task completes.
      if (task.model) {
        await restoreOriginalModel(task, deps, savedModel, mayContinue);
      }
    } else if (kind === "shell") {
      const out = await runShellTask(task);
      if (!mayContinue()) return unsupportedScheduledRun();
      if (out.error) {
        error = out.error;
      } else if (out.result) {
        result = out.result;
        if (out.notify) {
          const t = formatOutbound(result, detectChannel(task.chat_jid));
          if (t) {
            await deps.sendMessage(task.chat_jid, t, { forceRoot: true, source: "scheduled" });
            if (!mayContinue()) return unsupportedScheduledRun();
            if (notifyOnComplete) await deps.sendNudge?.(t);
          }
        }
      }
    } else {
      if (!mayContinue()) return unsupportedScheduledRun();
      // A durable dispatcher returns its isolated run; a legacy pool returns undefined.
      const native = scheduledLease ? deps.agentPool.dispatchScheduledAgent?.(scheduledLease) : undefined;
      const savedLeafId = native ? null : await deps.agentPool.saveSessionPosition(task.chat_jid);
      if (!native && !mayContinue()) return unsupportedScheduledRun();
      const savedModel = native ? null : await deps.agentPool.getCurrentModelLabel(task.chat_jid);
      if (!native && !mayContinue()) return unsupportedScheduledRun();

      try {
        // Switch model if task specifies one.
        if (!native && task.model) {
          if (!savedModel || savedModel !== task.model) {
            error = await switchTaskModel(task, deps);
            if (!mayContinue()) return unsupportedScheduledRun();
          }
        }

        if (!error) {
          // Once started, native work must be joined even if authority is revoked.
          if (!native && !mayContinue()) return unsupportedScheduledRun();
          const out = await (native ?? deps.agentPool.runAgent(task.prompt, task.chat_jid, {
            budgetWorkId,
            budgetExecutionKind: "scheduled",
            budgetScheduledTaskId: task.id,
          }));
          if (!mayContinue()) return unsupportedScheduledRun();
          const recoverySummary = formatRecoverySummary(out.recovery);
          if (out.status === "error") {
            error = out.error || "Unknown";
            loggedError = appendRecoverySummary(error, recoverySummary);
            budgetBlocked = out.failureCategory === "provider_budget";
            // The budget decision persists its own pending notification identity.
            // Delivery happens after the run log below so a send failure cannot
            // erase the blocked/error execution receipt.
          } else {
            loggedResult = appendRecoverySummary(out.result, recoverySummary);
            if (out.result) {
              result = out.result;
              const t = formatOutbound(result, detectChannel(task.chat_jid));
              if (t) {
                await deps.sendMessage(task.chat_jid, t, { forceRoot: true, source: "scheduled" });
                if (!mayContinue()) return unsupportedScheduledRun();
                if (notifyOnComplete) await deps.sendNudge?.(t);
              }
            }
          }
        }
      } finally {
        // Navigate back to the saved position — the task's prompt and response
        // stay in a side branch and won't pollute the user's conversation context.
        if (!native && mayContinue()) {
          await deps.agentPool.restoreSessionPosition(task.chat_jid, savedLeafId);
          // Restore the original model only while the legacy path is still allowed.
          if (mayContinue()) await restoreOriginalModel(task, deps, savedModel, mayContinue);
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!mayContinue()) return unsupportedScheduledRun();
  if (error) schedulerMetrics.taskRunsFailed += 1;
  else schedulerMetrics.taskRunsSucceeded += 1;

  // Record the run in the task_run_logs table.
  const effectiveResult = loggedResult ?? result;
  const effectiveError = loggedError ?? error;
  const durationMs = Date.now() - start;
  const taskRunLogId = logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? "error" : "success",
    result: effectiveResult,
    error: effectiveError,
  });

  if (options.advanceTask !== false) {
    const nextRun = computeNextRun(task.schedule_type, task.schedule_value, {
      currentDate: task.next_run,
    });
    updateTaskAfterRun(task.id, nextRun, error ? `Error: ${effectiveError || error}` : ((effectiveResult || result)?.slice(0, 200) || "Completed"));
  }

  if (budgetBlocked) await drainScheduledBudgetNotifications(deps);

  return {
    status: error ? "error" : "success",
    result: effectiveResult,
    error: effectiveError,
    durationMs,
    taskRunLogId,
  };
}

const SCHEDULED_LEASE_DURATION_MS = 60_000;
const SCHEDULED_LEASE_RENEW_MS = 20_000;
const schedulerWorkerId = `scheduler:${hostname()}:${process.pid}:${randomUUID()}`;
let claimSequence = 0;

function scheduledEffect(
  idempotencyKey: string,
  operationId: string | null,
  sourceSeq: number | null,
  provenanceRef: string,
): EffectIdentity {
  return {
    idempotencyKey,
    requestHash: "",
    operationId,
    sourceSeq,
    provenanceRef,
    redactionClass: "private" as const,
  };
}

function sealScheduledEffect<T extends { effect: EffectIdentity }>(request: T): T {
  (request.effect as { requestHash: string }).requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}

const primaryStores = new WeakMap<Database, { users: number; foreignKeysWereEnabled: boolean }>();

function productionScheduledRunStore(): { store: ScheduledRunStore; close: () => void } {
  const primary = getDb();
  const databaseRow = primary.query("PRAGMA database_list").all() as Array<{ name: string; file: string }>;
  const filename = databaseRow.find((row) => row.name === "main")?.file || "";
  let database: Database;
  let primaryState = primaryStores.get(primary);
  if (filename) {
    database = new Database(filename);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
  } else {
    if (!primaryState) {
      primaryState = { users: 0, foreignKeysWereEnabled: (primary.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined)?.foreign_keys === 1 };
      primaryStores.set(primary, primaryState);
    }
    primaryState.users++;
    primary.exec("PRAGMA foreign_keys=ON");
    database = primary;
  }
  const built = createCurrentPiclawScheduledRunStore(database, {
    hitFault: () => false,
    recordTrace: () => undefined,
  });
  const close = () => {
    if (filename) database.close();
    else if (primaryState && --primaryState.users === 0) {
      primaryStores.delete(primary);
      if (!primaryState.foreignKeysWereEnabled) primary.exec("PRAGMA foreign_keys=OFF");
    }
  };
  if (!built.ok) {
    close();
    throw new Error(`Scheduled run store unavailable: ${built.error._tag}`);
  }
  return { store: built.value, close };
}

function reconcileExpiredScheduledAgentSources(now: string): void {
  const db = getDb();
  const rows = db.query(
    `SELECT o.operation_id,o.chat_jid,o.primary_source_seq,r.state,r.lease_expires_at
     FROM service_effect_s01_operations o
     JOIN service_effect_s01_sources s
       ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq AND s.kind='scheduled_agent'
     LEFT JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id
     WHERE o.phase<>'terminal'`,
  ).all() as Array<{
    operation_id: string;
    chat_jid: string;
    primary_source_seq: number;
    state: string | null;
    lease_expires_at: string | null;
  }>;

  db.transaction(() => {
    for (const row of rows) {
      const terminalRun = row.state === "completed" || row.state === "abandoned";
      const expiredRun = row.lease_expires_at !== null && row.lease_expires_at <= now;
      if (!terminalRun && !expiredRun) continue;
      db.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid=? AND active_operation_id=?").run(row.chat_jid, row.operation_id);
      db.query(
        `UPDATE service_effect_s01_operations
         SET version=version+1,phase='terminal',terminal_disposition='failed',terminal_error_code='scheduled_run_interrupted',terminal_committed_at=?
         WHERE operation_id=? AND phase<>'terminal'`,
      ).run(now, row.operation_id);
      db.query(
        `UPDATE service_effect_s01_sources SET state='disposed',disposition_reason='scheduled_run_interrupted'
         WHERE chat_jid=? AND source_seq=? AND state NOT IN ('consumed','disposed')`,
      ).run(row.chat_jid, row.primary_source_seq);
    }
  }).immediate();
}

function scheduledReclaimAuthorities(now: string): ScheduledRunReclaimAuthority[] {
  const db = getDb();
  const rows = db.query(
    `SELECT r.run_id,r.attempt,v.snapshot_json
     FROM service_effect_s07_occurrences r
     JOIN service_effect_s07_task_revisions v
       ON v.task_id=r.task_id AND v.revision=r.task_revision
     WHERE r.state IN ('claimed','source_bound') AND r.lease_expires_at<=?
     ORDER BY r.scheduled_for,r.task_id`,
  ).all(now) as Array<{ run_id: string; attempt: number; snapshot_json: string }>;
  const authorities: ScheduledRunReclaimAuthority[] = [];
  for (const row of rows) {
    let snapshot: { executionRepeatability?: string; chatJid?: string };
    try { snapshot = JSON.parse(row.snapshot_json); } catch { continue; }
    if (snapshot.executionRepeatability === "agent_source" && typeof snapshot.chatJid === "string") {
      const accepted = db.query(
        "SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=? AND kind='scheduled_agent'",
      ).get(snapshot.chatJid, row.run_id);
      if (!accepted) {
        authorities.push({
          runId: row.run_id,
          expectedAttempt: row.attempt,
          kind: "agent_reconciled_absent",
          reconciliationRef: `scheduled_source_absent:${row.run_id}:attempt:${row.attempt}`,
        });
      }
    } else if (snapshot.executionRepeatability === "repeatable") {
      authorities.push({ runId: row.run_id, expectedAttempt: row.attempt, kind: "repeatable", reconciliationRef: null });
    }
  }
  return authorities;
}

interface ScheduledAgentSource {
  sourceSeq: number;
  operationId: string;
}

function acceptScheduledAgentSource(lease: ScheduledRunLease, acceptedAt: string): ScheduledAgentSource {
  const db = getDb();
  const runId = lease.record.runId;
  const existing = db.query(
    `SELECT s.source_seq,o.operation_id
     FROM service_effect_s01_sources s
     JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
     JOIN service_effect_s01_operations o ON o.chat_jid=os.chat_jid AND o.operation_id=os.operation_id
     WHERE s.chat_jid=? AND s.source_id=? AND s.kind='scheduled_agent'`,
  ).get(lease.task.chatJid, runId) as { source_seq: number; operation_id: string } | undefined;
  if (existing) return { sourceSeq: existing.source_seq, operationId: existing.operation_id };

  const operationId = `scheduled_operation:${runId.slice("scheduled_run:".length)}`;
  const sourceHash = hashCanonicalRequest({
    chatJid: lease.task.chatJid,
    sourceId: runId,
    kind: "scheduled_agent",
    payloadRef: lease.task.payloadRef,
  });
  let sourceSeq = 0;
  db.transaction(() => {
    db.query(
      "INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,1,0,NULL)",
    ).run(lease.task.chatJid);
    const chat = db.query(
      "SELECT next_source_seq,active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?",
    ).get(lease.task.chatJid) as { next_source_seq: number; active_operation_id: string | null };
    if (chat.active_operation_id) throw new Error(`Scheduled source owner conflict for ${lease.task.chatJid}.`);
    sourceSeq = chat.next_source_seq;
    db.query("UPDATE service_effect_s01_chats SET next_source_seq=next_source_seq+1 WHERE chat_jid=? AND next_source_seq=?").run(lease.task.chatJid, sourceSeq);
    db.query(
      `INSERT INTO service_effect_s01_sources(
         chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,
         accepted_at,disposition_reason,provenance_ref,create_wake_intent
       ) VALUES(?,?,?,?,'scheduled_agent','claimed',?,NULL,NULL,?,NULL,?,0)`,
    ).run(lease.task.chatJid, sourceSeq, runId, sourceHash, lease.task.payloadRef, acceptedAt, `scheduled_run:${runId}`);
    db.query(
      "INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',?)",
    ).run(operationId, lease.task.chatJid, sourceSeq);
    db.query(
      "INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,?)",
    ).run(lease.task.chatJid, operationId, sourceSeq);
    db.query("UPDATE service_effect_s01_chats SET active_operation_id=? WHERE chat_jid=?").run(operationId, lease.task.chatJid);
  }).immediate();
  return { sourceSeq, operationId };
}

function settleScheduledAgentSource(
  lease: ScheduledRunLease,
  source: ScheduledAgentSource,
  status: "success" | "error",
  settledAt: string,
): void {
  const db = getDb();
  db.transaction(() => {
    db.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid=? AND active_operation_id=?").run(lease.task.chatJid, source.operationId);
    db.query(
      `UPDATE service_effect_s01_operations
       SET version=version+1,phase='terminal',terminal_disposition=?,terminal_error_code=?,terminal_committed_at=?
       WHERE operation_id=? AND phase<>'terminal'`,
    ).run(status === "success" ? "completed" : "failed", status === "success" ? null : "scheduled_task_failed", settledAt, source.operationId);
    db.query(
      `UPDATE service_effect_s01_sources SET state=?,disposition_reason=?
       WHERE chat_jid=? AND source_seq=?`,
    ).run(status === "success" ? "consumed" : "disposed", status === "success" ? null : "scheduled_task_failed", lease.task.chatJid, source.sourceSeq);
    if (status === "success") {
      db.query(
        "UPDATE service_effect_s01_chats SET consumed_through_source_seq=MAX(consumed_through_source_seq,?) WHERE chat_jid=?",
      ).run(source.sourceSeq, lease.task.chatJid);
    }
  }).immediate();
}

interface LeaseController {
  lease: ScheduledRunLease;
  valid: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  stop: () => void;
}

function mayContinueClaim(controller: LeaseController): boolean {
  if (!canRunLegacyScheduledWork()) controller.stop();
  return controller.valid;
}

function startLeaseController(store: ScheduledRunStore, initial: ScheduledRunLease): LeaseController {
  const controller: LeaseController = {
    lease: initial,
    valid: true,
    timer: null,
    stop: () => {
      controller.valid = false;
      if (controller.timer) clearTimeout(controller.timer);
      controller.timer = null;
    },
  };
  const schedule = () => {
    if (!controller.valid) return;
    controller.timer = setTimeout(async () => {
      if (!mayContinueClaim(controller)) return;
      const now = new Date().toISOString();
      const leaseExpiresAt = addCanonicalDuration(now, SCHEDULED_LEASE_DURATION_MS);
      if (!leaseExpiresAt) { controller.stop(); return; }
      let renewed;
      try {
        renewed = await store.renew({
          runId: controller.lease.record.runId,
          workerId: controller.lease.record.workerId,
          expectedAttempt: controller.lease.record.attempt,
          expectedTaskRevision: controller.lease.record.taskRevision,
          leaseToken: controller.lease.leaseToken,
          now,
          leaseExpiresAt,
        });
      } catch (error) {
        controller.stop();
        if (canRunLegacyScheduledWork()) log.warn("Scheduled run lease renewal threw", { operation: "renew_scheduled_run", err: error });
        return;
      }
      if (!mayContinueClaim(controller)) return;
      if (!renewed.ok) {
        log.warn("Scheduled run lease renewal failed", {
          operation: "renew_scheduled_run",
          runId: controller.lease.record.runId,
          taskId: controller.lease.record.taskId,
          taskRevision: controller.lease.record.taskRevision,
          attempt: controller.lease.record.attempt,
          errorTag: renewed.error._tag,
        });
        controller.stop();
        return;
      }
      controller.lease = renewed.value;
      schedule();
    }, SCHEDULED_LEASE_RENEW_MS);
    controller.timer.unref?.();
  };
  schedule();
  return controller;
}

async function abandonClaimedRun(
  store: ScheduledRunStore,
  controller: LeaseController,
  reasonTag: string,
  source: ScheduledAgentSource | null = null,
): Promise<void> {
  if (!mayContinueClaim(controller)) return;
  const lease = controller.lease;
  controller.stop();
  const now = new Date().toISOString();
  const effect = scheduledEffect(`abandon:${lease.record.runId}:attempt:${lease.record.attempt}`, source?.operationId ?? null, source?.sourceSeq ?? null, `scheduled_run:${lease.record.runId}`);
  const abandonRequest = sealScheduledEffect({
    effect,
    runId: lease.record.runId,
    workerId: lease.record.workerId,
    expectedAttempt: lease.record.attempt,
    expectedTaskRevision: lease.record.taskRevision,
    leaseToken: lease.leaseToken,
    now,
    reasonTag,
    abandonedAt: now,
    retryAt: null,
  });
  const abandoned = await store.abandon(abandonRequest);
  if (!canRunLegacyScheduledWork()) return;
  if (source) settleScheduledAgentSource(lease, source, "error", now);
  if (abandoned.ok) applyScheduledRunToTask(abandoned.value, `Skipped: ${reasonTag}`);
  else log.error("Failed to abandon scheduled run", { operation: "abandon_scheduled_run", runId: lease.record.runId, errorTag: abandoned.error._tag });
}

async function runClaimedScheduledTask(
  store: ScheduledRunStore,
  controller: LeaseController,
  deps: SchedulerDeps,
): Promise<void> {
  let source: ScheduledAgentSource | null = null;
  try {
    if (!mayContinueClaim(controller)) return;
    const lease = controller.lease;
    const task = getTaskById(lease.record.taskId);
    if (!task || task.status !== "active" || task.revision !== lease.record.taskRevision || task.next_run !== lease.record.scheduledFor) {
      log.info("Scheduled occurrence no longer matches its task head", {
        operation: "skip_stale_scheduled_run",
        runId: lease.record.runId,
        taskId: lease.record.taskId,
        expectedRevision: lease.record.taskRevision,
        observedRevision: task?.revision ?? null,
        expectedScheduledFor: lease.record.scheduledFor,
        observedNextRun: task?.next_run ?? null,
        observedStatus: task?.status ?? null,
      });
      await abandonClaimedRun(store, controller, "task_inactive_before_execution");
      return;
    }

    if (lease.task.kind === "agent") {
      const acceptedAt = new Date().toISOString();
      source = acceptScheduledAgentSource(lease, acceptedAt);
      const effect = scheduledEffect(`bind:${lease.record.runId}:attempt:${lease.record.attempt}`, source.operationId, source.sourceSeq, `scheduled_run:${lease.record.runId}`);
      const bindRequest = sealScheduledEffect({
        effect,
        runId: lease.record.runId,
        workerId: lease.record.workerId,
        expectedAttempt: lease.record.attempt,
        expectedTaskRevision: lease.record.taskRevision,
        leaseToken: lease.leaseToken,
        now: acceptedAt,
        sourceSeq: source.sourceSeq,
        operationId: source.operationId,
        boundAt: acceptedAt,
      });
      const bound = await store.bindAcceptedSource(bindRequest);
      if (!mayContinueClaim(controller)) return;
      if (!bound.ok) {
        await abandonClaimedRun(store, controller, "source_binding_failed", source);
        return;
      }
    }

    const outcome = await executeScheduledTask(task, deps, { advanceTask: false }, () => controller.valid, controller.lease);
    if (outcome.status === "skipped" && outcome.error !== null) { controller.stop(); return; }
    if (!mayContinueClaim(controller)) return;
    if (outcome.status === "skipped") {
      await abandonClaimedRun(store, controller, "task_inactive_before_execution", source);
      return;
    }
    if (!controller.valid) return;
    const finalLease = controller.lease;
    controller.stop();
    const completedAt = new Date().toISOString();
    const effect = scheduledEffect(
      `complete:${finalLease.record.runId}:attempt:${finalLease.record.attempt}`,
      source?.operationId ?? null,
      source?.sourceSeq ?? null,
      `scheduled_run:${finalLease.record.runId}`,
    );
    const completeRequest = sealScheduledEffect({
      effect,
      runId: finalLease.record.runId,
      workerId: finalLease.record.workerId,
      expectedAttempt: finalLease.record.attempt,
      expectedTaskRevision: finalLease.record.taskRevision,
      leaseToken: finalLease.leaseToken,
      now: completedAt,
      status: outcome.status,
      durationMs: outcome.durationMs,
      resultRef: outcome.status === "success" ? `task_run_log:${outcome.taskRunLogId}` : null,
      errorCode: outcome.status === "error" ? "scheduled_task_failed" : null,
      completedAt,
      outboxIntents: [],
    });
    const completed = await store.complete(completeRequest);
    if (!canRunLegacyScheduledWork()) return;
    if (!completed.ok) {
      log.error("Failed to settle scheduled run", {
        operation: "complete_scheduled_run",
        runId: finalLease.record.runId,
        taskId: finalLease.record.taskId,
        taskRevision: finalLease.record.taskRevision,
        attempt: finalLease.record.attempt,
        errorTag: completed.error._tag,
      });
      if (source) settleScheduledAgentSource(finalLease, source, "error", completedAt);
      return;
    }
    const summary = outcome.status === "error"
      ? `Error: ${outcome.error || "Unknown"}`
      : (outcome.result?.slice(0, 200) || "Completed");
    applyScheduledRunToTask(completed.value, summary);
    if (source) settleScheduledAgentSource(finalLease, source, outcome.status, completedAt);
    log.info("Scheduled run settled", {
      operation: "complete_scheduled_run",
      runId: finalLease.record.runId,
      taskId: finalLease.record.taskId,
      taskRevision: finalLease.record.taskRevision,
      scheduledFor: finalLease.record.scheduledFor,
      attempt: finalLease.record.attempt,
      status: outcome.status,
      headDisposition: completed.value.headDisposition,
    });
  } catch (error) {
    if (!canRunLegacyScheduledWork()) { controller.stop(); return; }
    log.error("Claimed scheduled run failed before settlement", {
      operation: "run_claimed_scheduled_task",
      runId: controller.lease.record.runId,
      taskId: controller.lease.record.taskId,
      taskRevision: controller.lease.record.taskRevision,
      attempt: controller.lease.record.attempt,
      err: error,
    });
    await abandonClaimedRun(store, controller, "pre_effect_failure", source);
  }
}

export async function pollScheduledRunsOnce(deps: SchedulerDeps, store: ScheduledRunStore): Promise<void> {
  await runSchedulerPoll(deps, store, () => true);
}

async function runSchedulerPoll(deps: SchedulerDeps, store: ScheduledRunStore, isCurrent: () => boolean): Promise<void> {
  const mayPoll = () => isCurrent() && canRunLegacyScheduledWork();
  if (!mayPoll()) return;
  schedulerMetrics.polls += 1;
  await drainScheduledBudgetNotifications(deps);
  if (!mayPoll()) return;
  const now = new Date().toISOString();
  schedulerMetrics.lastPollAt = now;
  reconcileExpiredScheduledAgentSources(now);
  claimSequence += 1;
  const claimed = await store.claimDue({
    now,
    limit: 100,
    workerId: schedulerWorkerId,
    leaseTokenPrefix: `scheduler_claim:${process.pid}:${claimSequence}:${randomUUID()}`,
    leaseDurationMs: SCHEDULED_LEASE_DURATION_MS,
    reclaimAuthorities: scheduledReclaimAuthorities(now),
  });
  if (!mayPoll()) return;
  if (!claimed.ok) throw new Error(`claimDue failed: ${claimed.error._tag}`);
  for (const lease of claimed.value) {
    if (!mayPoll()) return;
    const controller = startLeaseController(store, lease);
    deps.queue.enqueueTask(
      lease.record.runId,
      () => runClaimedScheduledTask(store, controller, deps),
      `chat:${lease.task.chatJid}`,
    );
    schedulerMetrics.tasksEnqueued += 1;
    log.info("Scheduled occurrence claimed", {
      operation: "claim_scheduled_run",
      runId: lease.record.runId,
      taskId: lease.record.taskId,
      taskRevision: lease.record.taskRevision,
      scheduledFor: lease.record.scheduledFor,
      attempt: lease.record.attempt,
      leaseExpiresAt: lease.record.leaseExpiresAt,
    });
  }
}

/** One polling generation owns admission; accepted tasks remain queue-owned. */
interface SchedulerLoop {
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  active: Promise<void>;
  stop: () => Promise<void>;
}
let schedulerLoop: SchedulerLoop | null = null;
const stoppedScheduler = Promise.resolve();

/** Poll admission has joined; only releasing its store failed. */
export class SchedulerStoreReleaseError extends Error {
  constructor(cause: unknown) {
    super("Scheduler store release failed after poll join", { cause });
  }
}

/**
 * Start the scheduler polling loop. Checks for due tasks every
 * SCHEDULER_POLL_INTERVAL ms and enqueues them on the shared AgentQueue.
 *
 * Called once by runtime.ts during startup.
 */
export function startSchedulerLoop(deps: SchedulerDeps): () => Promise<void> {
  if (schedulerLoop) return schedulerLoop.stop;
  if (!canRunLegacyScheduledWork()) return () => stoppedScheduler;
  const resource = productionScheduledRunStore();
  let pendingTasks = 0;
  let pollJoined = false;
  let closed = false;
  const releaseStore = () => {
    if (!closed && pollJoined && pendingTasks === 0) {
      closed = true;
      resource.close();
    }
  };
  // Keep the store alive for work already handed to the queue, without making
  // stop/join wait for agent execution (or cancelling its lease controller).
  const pollDeps = { ...deps, queue: {
    enqueueTask: (id: string, run: () => Promise<void>, lane?: string) => {
      pendingTasks++;
      deps.queue.enqueueTask(id, async () => {
        try { await run(); }
        finally { pendingTasks--; releaseStore(); }
      }, lane);
    },
  } as AgentQueue };
  let stopPromise: Promise<void> | null = null;
  const instance: SchedulerLoop = {
    stopped: false,
    timer: null,
    active: stoppedScheduler,
    stop: () => {
      if (stopPromise) return stopPromise;
      instance.stopped = true;
      if (instance.timer) clearTimeout(instance.timer);
      instance.timer = null;
      stopPromise = instance.active.then(() => {
        pollJoined = true;
        try {
          releaseStore();
        } catch (error) {
          throw new SchedulerStoreReleaseError(error);
        } finally {
          if (schedulerLoop === instance) schedulerLoop = null;
        }
      });
      // Observe legacy fire-and-forget callers without changing their promise.
      void stopPromise.catch((error) => {
        log.error("Scheduler stop failed", { operation: "stop_scheduler_loop", err: error });
      });
      return stopPromise;
    },
  };
  schedulerLoop = instance;
  const isCurrent = () => schedulerLoop === instance && !instance.stopped;
  log.info("Scheduler loop started", { operation: "start_scheduler_loop", workerId: schedulerWorkerId });
  const loop = (): Promise<void> => {
    if (!isCurrent()) return stoppedScheduler;
    instance.timer = null;
    instance.active = (async () => {
      try {
        await runSchedulerPoll(pollDeps, resource.store, isCurrent);
      } catch (e) {
        log.error("Scheduler poll failed", { operation: "start_scheduler_loop.poll", err: e });
      }
      if (!isCurrent()) return;
      if (!canRunLegacyScheduledWork()) {
        void instance.stop();
        return;
      }
      instance.timer = setTimeout(loop, getRuntimeTimingConfig().schedulerPollIntervalMs);
    })();
    return instance.active;
  };
  void loop();
  return instance.stop;
}

/** Stop new admission and join the active poll, not queue-owned task execution. */
export function stopSchedulerLoop(): Promise<void> {
  return schedulerLoop?.stop() ?? stoppedScheduler;
}
