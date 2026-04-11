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

import { WORKSPACE_DIR, getRuntimeTimingConfig } from "./core/config.js";
import { DREAM_TASK_ID, parseDreamPromptToken, runDreamAgentTurn, runDreamMaintenance } from "./dream.js";
import { computeNextRun } from "./task-scheduler-utils.js";
import type { AgentPool } from "./agent-pool.js";
import { getDueTasks, getTaskById, logTaskRun, updateTaskAfterRun } from "./db.js";
import { AgentQueue } from "./queue.js";
import { detectChannel, formatOutbound } from "./router.js";
import type { ScheduledTask } from "./types.js";
import { createTrackedBashOperations } from "./tools/tracked-bash.js";
import { createLogger } from "./utils/logger.js";
import { validateShellCommand, validateShellCwd } from "./utils/task-validation.js";

const log = createLogger("scheduler");

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
  savedModel: string | null
): Promise<void> {
  if (!task.model || !savedModel || savedModel === task.model) return;
  const control = await applyModelLabel(deps.agentPool, task.chat_jid, savedModel);
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
  let outputBytes = 0;
  let truncated = false;

  try {
    const res = await exec.exec(validated.command!, cwdResult.cwd || WORKSPACE_DIR, {
      onData: (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (output.length < MAX_SHELL_OUTPUT_CHARS) {
          const text = chunk.toString("utf8");
          output += text.slice(0, MAX_SHELL_OUTPUT_CHARS - output.length);
        } else {
          truncated = true;
        }
      },
      timeout: task.timeout_sec ?? undefined,
      env: undefined,
    });

    const trimmed = output.trim();
    const summary = trimmed ? trimmed : "(no output)";
    const suffix = truncated ? `\n…(truncated; ${outputBytes} bytes total)` : "";
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

/**
 * Execute a single scheduled task: run the agent or shell command, deliver the response,
 * log the result, and update the task's next_run.
 */
export async function runScheduledTask(task: ScheduledTask, deps: SchedulerDeps): Promise<void> {
  // Re-check task status (may have been paused/cancelled while queued).
  const fresh = getTaskById(task.id);
  if (!fresh || fresh.status !== "active") return;

  const start = Date.now();
  schedulerMetrics.taskRunsStarted += 1;
  let result: string | null = null;
  let error: string | null = null;

  const kind = task.task_kind === "internal"
    ? "internal"
    : task.task_kind === "shell" || task.command
      ? "shell"
      : "agent";

  if (kind === "internal") {
    // Switch model if the internal task specifies one (e.g. Dream).
    const savedModel = task.model ? await deps.agentPool.getCurrentModelLabel(task.chat_jid) : null;
    if (task.model && (!savedModel || savedModel !== task.model)) {
      const switchErr = await switchTaskModel(task, deps);
      if (switchErr) { error = switchErr; }
    }
    if (!error) {
      const out = await runInternalTask(task, deps);
      if (out.error) {
        error = out.error;
      } else {
        result = out.result;
      }
    }
    // Restore original model after internal task completes.
    if (task.model) {
      await restoreOriginalModel(task, deps, savedModel);
    }
  } else if (kind === "shell") {
    const out = await runShellTask(task);
    if (out.error) {
      error = out.error;
    } else if (out.result) {
      result = out.result;
      if (out.notify) {
        const t = formatOutbound(result, detectChannel(task.chat_jid));
        if (t) {
          await deps.sendMessage(task.chat_jid, t, { forceRoot: true, source: "scheduled" });
          await deps.sendNudge?.(t);
        }
      }
    }
  } else {
    // Save session position so we can restore after the task.
    // This isolates the task's prompt/response in a side branch of the session
    // tree, preventing context pollution of the user's conversation.
    const savedLeafId = await deps.agentPool.saveSessionPosition(task.chat_jid);
    const savedModel = await deps.agentPool.getCurrentModelLabel(task.chat_jid);

    try {
      // Switch model if task specifies one.
      if (task.model) {
        if (!savedModel || savedModel !== task.model) {
          error = await switchTaskModel(task, deps);
        }
      }

      if (!error) {
        const out = await deps.agentPool.runAgent(task.prompt, task.chat_jid);
        if (out.status === "error") {
          error = out.error || "Unknown";
        } else if (out.result) {
          result = out.result;
          const t = formatOutbound(result, detectChannel(task.chat_jid));
          if (t) {
            await deps.sendMessage(task.chat_jid, t, { forceRoot: true, source: "scheduled" });
            await deps.sendNudge?.(t);
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      // Navigate back to the saved position — the task's prompt and response
      // stay in a side branch and won't pollute the user's conversation context.
      await deps.agentPool.restoreSessionPosition(task.chat_jid, savedLeafId);

      // Restore the original model if it was changed.
      await restoreOriginalModel(task, deps, savedModel);
    }
  }

  if (error) schedulerMetrics.taskRunsFailed += 1;
  else schedulerMetrics.taskRunsSucceeded += 1;

  // Record the run in the task_run_logs table.
  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
    status: error ? "error" : "success",
    result,
    error,
  });

  // Compute and persist the next execution time (null for one-shot tasks).
  const nextRun = computeNextRun(task.schedule_type, task.schedule_value);
  updateTaskAfterRun(task.id, nextRun, error ? `Error: ${error}` : (result?.slice(0, 200) || "Completed"));
}

/** Guard to prevent starting the loop more than once. */
let started = false;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the scheduler polling loop. Checks for due tasks every
 * SCHEDULER_POLL_INTERVAL ms and enqueues them on the shared AgentQueue.
 *
 * Called once by runtime.ts during startup.
 */
export function startSchedulerLoop(deps: SchedulerDeps): () => void {
  if (started) return stopSchedulerLoop;
  started = true;
  log.info("Scheduler loop started", { operation: "start_scheduler_loop" });
  const loop = async () => {
    try {
      schedulerMetrics.polls += 1;
      schedulerMetrics.lastPollAt = new Date().toISOString();
      for (const task of getDueTasks()) {
        const cur = getTaskById(task.id);
        if (!cur || cur.status !== "active") continue;
        deps.queue.enqueueTask(cur.id, () => runScheduledTask(cur, deps), `chat:${cur.chat_jid}`);
        schedulerMetrics.tasksEnqueued += 1;
      }
    } catch (e) {
      log.error("Scheduler poll failed", {
        operation: "start_scheduler_loop.poll",
        err: e,
      });
    }
    if (!started) return;
    schedulerTimer = setTimeout(loop, getRuntimeTimingConfig().schedulerPollIntervalMs);
  };
  loop();
  return stopSchedulerLoop;
}

/** Stop the global scheduler timer loop if currently running. */
export function stopSchedulerLoop(): void {
  started = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
