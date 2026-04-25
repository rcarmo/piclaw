/**
 * ipc.ts – Inter-Process Communication watcher for file-based task commands.
 *
 * External processes (skills, scripts, the reload flow) communicate with the
 * running piclaw instance by dropping JSON files into the IPC directories:
 *   - `<DATA_DIR>/ipc/messages/*.json` – outbound messages to send.
 *   - `<DATA_DIR>/ipc/tasks/*.json`    – task lifecycle commands (schedule,
 *     pause, resume, cancel, update, cleanup, resume_chat, resume_pending,
 *     execute_proposal, reject_proposal).
 *
 * The watcher polls these directories every IPC_POLL_INTERVAL ms, processes
 * each file, and deletes it on success (or renames it to `error-*` on failure).
 *
 * Consumers:
 *   - runtime.ts calls startIpcWatcher() at startup, passing in the required
 *     dependency functions (sendMessage, sendNudge, resolveModel, etc.).
 *   - The `schedule` skill writes task files to trigger scheduled tasks.
 *   - The `send-message` skill writes message files for immediate delivery.
 *   - The reload script writes `resume_pending` tasks to resume after restart.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { CronExpressionParser } from "cron-parser";
import { DATA_DIR, getRuntimeTimingConfig } from "./core/config.js";
import { MediaService } from "./channels/web/media/media-service.js";
import { createTask, deleteTask, getTaskById, updateTask } from "./db.js";
import type { ScheduledTask } from "./types.js";
import { createUuid } from "./utils/ids.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import { validateShellCommand, validateShellCwd } from "./utils/task-validation.js";

const log = createLogger("ipc");

/**
 * Options bag accepted by the injected `sendMessage` callback.
 * Kept local to IPC so runtime wiring can evolve without cross-module coupling.
 */
interface IpcMessageOptions {
  forceRoot?: boolean;
  threadId?: number | null;
  source?: string;
  mediaIds?: number[];
  contentBlocks?: Array<Record<string, unknown>>;
}

/**
 * Dependency injection contract for IPC command handlers.
 *
 * Provided by runtime wiring so IPC can send messages, resolve models,
 * and resume chats without importing runtime modules directly.
 */
export interface IpcDeps {
  /** Send a text message to a specific chat JID. */
  sendMessage: (jid: string, text: string, options?: IpcMessageOptions) => Promise<void>;
  /** Send a push notification nudge (Pushover). */
  sendNudge?: (text: string) => Promise<void>;
  /** Validate and resolve a model identifier string. */
  resolveModel?: (input: string) => { model?: string; error?: string };
  /** Resume processing a chat (after restart or pause). */
  resumeChat?: (data: Record<string, unknown>) => Promise<void>;
  /** Resume any pending agent turns after a restart. */
  resumePending?: (data?: Record<string, unknown>) => Promise<void>;
  /** Run a Dream/AutoDream cycle out of band. */
  runDream?: (data: Record<string, unknown>) => Promise<void>;
  /** Execute an approved mediated proposal via the agent pool. */
  executeProposal?: (proposalId: string) => Promise<void>;
  /** Reject a pending mediated proposal and push rejection callback. */
  rejectProposal?: (proposalId: string, reason?: string | null) => Promise<void>;
}

/** Guard to prevent starting the watcher more than once. */
let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activePoll: Promise<void> | null = null;
let activePollController: AbortController | null = null;

type IpcScheduleType = "cron" | "interval" | "once";
type JsonRecord = Record<string, unknown>;
type TaskUpdates = Parameters<typeof updateTask>[1];

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(data: JsonRecord, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function getFiniteNumberField(data: JsonRecord, key: string): number | undefined {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getStringOrFiniteNumberField(data: JsonRecord, key: string): string | undefined {
  const stringValue = getStringField(data, key);
  if (typeof stringValue === "string") return stringValue;

  const numericValue = getFiniteNumberField(data, key);
  if (numericValue !== undefined) return String(numericValue);
  return undefined;
}

function getBooleanField(data: JsonRecord, key: string): boolean | undefined {
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  return undefined;
}

function normalizeMediaContentType(value: string | undefined): string {
  if (!value) return "";
  return value.split(";")[0].trim().toLowerCase();
}

function getArrayField(data: JsonRecord, key: string): unknown[] | undefined {
  const value = data[key];
  return Array.isArray(value) ? value : undefined;
}

function resolveIpcChatJid(data: JsonRecord): string {
  return (
    getStringField(data, "chatJid") ||
    getStringField(data, "chat_jid") ||
    process.env.PICLAW_CHAT_JID ||
    "web:default"
  );
}

function isScheduleType(value: string): value is IpcScheduleType {
  return value === "cron" || value === "interval" || value === "once";
}

const ipcMediaService = new MediaService();

async function buildMediaPayloadFromIpcEntries(media: unknown[]): Promise<{
  mediaIds: number[];
  contentBlocks: Array<Record<string, unknown>>;
  warnings: string[];
}> {
  const mediaEntries = media;
  const mediaIds: number[] = [];
  const contentBlocks: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const item of mediaEntries) {
    if (!item || typeof item !== "object") {
      warnings.push("Skipped invalid media entry.");
      continue;
    }

    const normalized = item as Record<string, unknown>;
    const mediaPath = getStringField(normalized, "path");
    if (!mediaPath) {
      warnings.push("Skipped media entry with missing path.");
      continue;
    }

    const filename = getStringField(normalized, "filename") || basename(mediaPath);
    const contentType = getStringField(normalized, "content_type");
    const inline = getBooleanField(normalized, "inline");

    const result = await ipcMediaService.createFromPath(mediaPath, contentType, filename);
    if (result.status !== 200) {
      warnings.push(
        `Failed to attach ${filename}: ${(result.body as { error?: string }).error || `HTTP ${result.status}`}`,
      );
      continue;
    }

    const body = result.body as { id?: number; contentType?: string };
    const mediaId = Number(body.id);
    const mediaContentType = normalizeMediaContentType(
      (typeof body.contentType === "string" ? body.contentType : contentType) || ""
    );
    if (!Number.isFinite(mediaId) || mediaId <= 0) {
      warnings.push(`Failed to attach ${filename}: invalid media id`);
      continue;
    }

    const isImage = mediaContentType.startsWith("image/");
    const finalInline = inline === undefined ? isImage : inline && isImage;
    mediaIds.push(mediaId);
    contentBlocks.push({
      type: finalInline ? "image" : "file",
      media_id: mediaId,
      name: filename,
      mime_type: mediaContentType,
    });
  }

  return { mediaIds, contentBlocks, warnings };
}

async function processIpcDir(
  dirPath: string,
  ipcDir: string,
  kind: "message" | "task",
  handler: (data: JsonRecord) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!existsSync(dirPath)) return;

  for (const file of readdirSync(dirPath).filter((f) => f.endsWith(".json"))) {
    if (signal?.aborted) return;
    const fp = join(dirPath, file);
    try {
      const parsed = JSON.parse(readFileSync(fp, "utf-8"));
      if (!isJsonRecord(parsed)) {
        throw new Error("IPC payload must be a JSON object.");
      }
      await handler(parsed);
      unlinkSync(fp);
    } catch (e) {
      log.error("Failed to process IPC payload", {
        operation: "process_ipc_dir",
        kind,
        file,
        err: e,
      });
      try {
        renameSync(fp, join(ipcDir, `error-${file}`));
      } catch (renameErr) {
        debugSuppressedError(log, "Failed to rename a broken IPC payload into the error bucket; leaving the original file in place.", renameErr, {
          operation: "process_ipc_dir.rename_failed_payload",
          kind,
          file,
        });
      }
    }
  }
}

function computeScheduledNextRun(
  scheduleType: IpcScheduleType,
  scheduleValue: string
): string | undefined {
  if (scheduleType === "cron") {
    try {
      const timezone = process.env.TZ || getRuntimeTimingConfig().timezone;
      const next = CronExpressionParser.parse(scheduleValue, { tz: timezone }).next().toISOString();
      return next ?? undefined;
    } catch {
      return undefined;
    }
  }

  if (scheduleType === "interval") {
    const ms = parseInt(scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) return undefined;
    return new Date(Date.now() + ms).toISOString();
  }

  const d = new Date(scheduleValue);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Start the IPC directory watcher. Polls for new JSON files in the messages
 * and tasks directories on a recurring timer.
 *
 * Called once by runtime.ts during application startup.
 */
export function startIpcWatcher(deps: IpcDeps): () => Promise<void> {
  if (running) return stopIpcWatcher;
  running = true;

  const ipcDir = join(DATA_DIR, "ipc");
  const tasksDir = join(ipcDir, "tasks");
  const messagesDir = join(ipcDir, "messages");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(messagesDir, { recursive: true });

  const poll = async () => {
    activePollController = new AbortController();
    const { signal } = activePollController;

    // --- Process outbound message files ---
    try {
      await processIpcDir(messagesDir, ipcDir, "message", (data) => processMessageCommand(data, deps), signal);
    } catch (e) {
      log.error("Failed to read IPC messages directory", {
        operation: "start_ipc_watcher.poll_messages",
        err: e,
      });
    }

    // --- Process task command files ---
    try {
      await processIpcDir(tasksDir, ipcDir, "task", (data) => processTaskCommand(data, deps), signal);
    } catch (e) {
      log.error("Failed to read IPC tasks directory", {
        operation: "start_ipc_watcher.poll_tasks",
        err: e,
      });
    }

    if (!running) return;
    pollTimer = setTimeout(() => {
      activePoll = poll().finally(() => {
        activePoll = null;
        activePollController = null;
      });
    }, getRuntimeTimingConfig().ipcPollIntervalMs);
  };

  activePoll = poll().finally(() => {
    activePoll = null;
    activePollController = null;
  });
  log.info("IPC watcher started", { operation: "start_ipc_watcher" });
  return stopIpcWatcher;
}

/** Stop the active IPC watcher and clear associated runtime state. */
export async function stopIpcWatcher(): Promise<void> {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  activePollController?.abort();
  if (activePoll) await activePoll;
}

/**
 * Dispatch a single IPC message command.
 */
export async function processMessageCommand(data: JsonRecord, deps: IpcDeps): Promise<void> {
  const type = getStringField(data, "type");
  const chatJid = resolveIpcChatJid(data);
  const text = getStringField(data, "text") || "";

  if (type !== "message") {
    throw new Error(`Unsupported IPC message type: ${type || "missing"}`);
  }

  const media = getArrayField(data, "media") || [];
  const { mediaIds, contentBlocks, warnings } = await buildMediaPayloadFromIpcEntries(media);

  const warningSuffix = warnings.length > 0
    ? `\n\n⚠️ Media attachment warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  const finalText = `${text}${warningSuffix}`;
  const hasPayload = Boolean(text) || warnings.length > 0 || mediaIds.length > 0;

  if (!hasPayload) return;

  const options: IpcMessageOptions = {};
  if (mediaIds.length > 0) options.mediaIds = mediaIds;
  if (contentBlocks.length > 0) options.contentBlocks = contentBlocks;

  await deps.sendMessage(chatJid, finalText, options);
  if (data.noNudge !== true) {
    await deps.sendNudge?.(finalText || "Message with attachment(s)");
  }
}

/**
 * Dispatch a single IPC task command. The `data.type` field determines
 * which operation is performed (schedule, pause, resume, cancel, etc.).
 */
export async function processTaskCommand(data: JsonRecord, deps: IpcDeps): Promise<void> {
  const commandType = getStringField(data, "type");

  switch (commandType) {
    // --- Create a new scheduled task ---
    case "schedule_task": {
      const scheduleTypeValue = getStringField(data, "schedule_type");
      const scheduleValue = getStringOrFiniteNumberField(data, "schedule_value");
      const chatJid = resolveIpcChatJid(data);
      if (!scheduleTypeValue || !scheduleValue || !isScheduleType(scheduleTypeValue)) return;

      const taskKind = data.task_kind === "shell" || Boolean(data.command) ? "shell" : "agent";
      const nextRun = computeScheduledNextRun(scheduleTypeValue, String(scheduleValue));
      if (nextRun === undefined) return;

      if (taskKind === "shell") {
        const validated = validateShellCommand(data.command);
        if (!validated.ok) {
          await deps.sendMessage(chatJid, `Cannot schedule shell task: ${validated.error || "Invalid command."}`);
          return;
        }

        const cwdResult = validateShellCwd(data.cwd);
        if (!cwdResult.ok) {
          await deps.sendMessage(chatJid, `Cannot schedule shell task: ${cwdResult.error || "Invalid cwd."}`);
          return;
        }

        if (data.model) {
          await deps.sendMessage(chatJid, "Cannot schedule shell task with a model override.");
          return;
        }

        createTask({
          id: createUuid("task"),
          chat_jid: chatJid,
          prompt: validated.command || "",
          model: null,
          task_kind: "shell",
          command: validated.command || null,
          cwd: cwdResult.cwd,
          timeout_sec: getFiniteNumberField(data, "timeout_sec") ?? null,
          schedule_type: scheduleTypeValue,
          schedule_value: String(scheduleValue),
          next_run: nextRun,
          status: "active",
          created_at: new Date().toISOString(),
        });
        break;
      }

      const prompt = getStringField(data, "prompt");
      if (!prompt?.trim()) return;

      // Validate the model override if one was requested.
      const modelInput = getStringField(data, "model");
      const requested = modelInput?.trim() ? modelInput.trim() : null;
      let model: string | null = null;

      if (requested) {
        if (!deps.resolveModel) {
          await deps.sendMessage(chatJid, `Cannot schedule task: model validation unavailable for "${requested}".`);
          return;
        }
        const resolved = deps.resolveModel(requested);
        if (!resolved.model) {
          await deps.sendMessage(chatJid, `Cannot schedule task: ${resolved.error || "Invalid model."}`);
          return;
        }
        model = resolved.model;
      }

      createTask({
        id: createUuid("task"),
        chat_jid: chatJid,
        prompt,
        model,
        task_kind: "agent",
        command: null,
        cwd: null,
        timeout_sec: null,
        schedule_type: scheduleTypeValue,
        schedule_value: String(scheduleValue),
        next_run: nextRun,
        status: "active",
        created_at: new Date().toISOString(),
      });
      break;
    }

    // --- Pause an active task ---
    case "pause_task": {
      const taskId = getStringField(data, "taskId");
      if (!taskId) return;
      const t = getTaskById(taskId);
      if (t) updateTask(taskId, { status: "paused" });
      break;
    }

    // --- Resume a paused task ---
    case "resume_task": {
      const taskId = getStringField(data, "taskId");
      if (!taskId) return;
      const t = getTaskById(taskId);
      if (t) updateTask(taskId, { status: "active" });
      break;
    }

    // --- Delete a task and its run logs ---
    case "cancel_task": {
      const taskId = getStringField(data, "taskId");
      if (!taskId) return;
      const t = getTaskById(taskId);
      if (t) deleteTask(taskId);
      break;
    }

    // --- Partially update a task (prompt, schedule, model) ---
    case "update_task": {
      const taskId = getStringField(data, "taskId");
      const chatJid = getStringField(data, "chatJid");
      if (!taskId) return;

      const t = getTaskById(taskId);
      if (!t) return;

      const updates: TaskUpdates = {};

      const prompt = getStringField(data, "prompt");
      if (typeof prompt === "string") updates.prompt = prompt;

      const scheduleType = getStringField(data, "schedule_type");
      if (typeof scheduleType === "string") {
        if (!isScheduleType(scheduleType)) {
          if (chatJid) await deps.sendMessage(chatJid, `Cannot update task: invalid schedule_type "${scheduleType}".`);
          return;
        }
        updates.schedule_type = scheduleType as ScheduledTask["schedule_type"];
      }

      const scheduleValue = getStringOrFiniteNumberField(data, "schedule_value");
      if (typeof scheduleValue === "string") updates.schedule_value = scheduleValue;

      const taskKind = getStringField(data, "task_kind");
      if (typeof taskKind === "string") {
        updates.task_kind = taskKind as ScheduledTask["task_kind"];
      }

      const command = getStringField(data, "command");
      if (typeof command === "string") updates.command = command;

      const cwd = getStringField(data, "cwd");
      if (typeof cwd === "string") updates.cwd = cwd;

      const timeoutSec = getFiniteNumberField(data, "timeout_sec");
      if (timeoutSec !== undefined) updates.timeout_sec = timeoutSec;

      const modelInput = getStringField(data, "model");
      if (typeof modelInput === "string") {
        if (modelInput === "") {
          updates.model = null;
        } else if (deps.resolveModel) {
          const resolved = deps.resolveModel(modelInput.trim());
          if (!resolved.model) {
            if (chatJid) await deps.sendMessage(chatJid, `Cannot update task: ${resolved.error || "Invalid model."}`);
            return;
          }
          updates.model = resolved.model;
        } else {
          updates.model = modelInput.trim();
        }
      }

      // Validate shell command changes if applicable
      const kind = updates.task_kind ?? t.task_kind ?? (t.command ? "shell" : "agent");
      if (kind === "shell") {
        if (updates.command !== undefined) {
          const validated = validateShellCommand(updates.command);
          if (!validated.ok) {
            if (chatJid) await deps.sendMessage(chatJid, `Cannot update task: ${validated.error || "Invalid command."}`);
            return;
          }
          const validatedCommand = validated.command || "";
          updates.command = validatedCommand;
          updates.prompt = validatedCommand;
        }

        if (updates.cwd !== undefined) {
          const cwdResult = validateShellCwd(updates.cwd);
          if (!cwdResult.ok) {
            if (chatJid) await deps.sendMessage(chatJid, `Cannot update task: ${cwdResult.error || "Invalid cwd."}`);
            return;
          }
          updates.cwd = cwdResult.cwd;
        }

        if (updates.model !== undefined && updates.model) {
          if (chatJid) await deps.sendMessage(chatJid, "Cannot set model override on shell tasks.");
          return;
        }
      }

      // Recalculate next_run if schedule changed.
      if (updates.schedule_type || updates.schedule_value) {
        const currentScheduleType = String(updates.schedule_type ?? t.schedule_type);
        const currentScheduleValue = String(updates.schedule_value ?? t.schedule_value);
        if (isScheduleType(currentScheduleType)) {
          const nextRun = computeScheduledNextRun(currentScheduleType, currentScheduleValue);
          if (nextRun !== undefined) {
            updates.next_run = nextRun;
          }
        }
      }

      if (Object.keys(updates).length > 0) updateTask(taskId, updates);
      break;
    }

    // --- Bulk-delete all completed tasks ---
    case "cleanup_tasks": {
      const chatJid = getStringField(data, "chatJid");
      const db = (await import("./db/connection.js")).getDb();
      const completed = db.prepare("SELECT id FROM scheduled_tasks WHERE status = 'completed'").all() as { id: string }[];

      for (const { id } of completed) {
        db.prepare("DELETE FROM task_run_logs WHERE task_id = ?").run(id);
      }

      const result = db.prepare("DELETE FROM scheduled_tasks WHERE status = 'completed'").run();
      const countValue = (result as { changes?: unknown }).changes;
      const count = typeof countValue === "number" ? countValue : 0;
      if (chatJid) {
        try {
          await deps.sendMessage(chatJid, `Cleaned up ${count} completed task(s).`);
        } catch (error) {
          debugSuppressedError(log, "Cleanup completed but IPC cleanup notification failed to send.", error, {
            operation: "process_task_command.cleanup_tasks.send_message",
            chatJid,
            deletedCount: count,
          });
        }
      }
      break;
    }

    // --- Resume a specific chat after restart ---
    case "resume_chat": {
      if (deps.resumeChat) {
        await deps.resumeChat(data);
      }
      break;
    }

    // --- Resume any pending agent turns after restart ---
    case "resume_pending": {
      log.info("Processing resume_pending IPC task", {
        operation: "process_task_command.resume_pending",
        chatJid: getStringField(data, "chatJid") || "all",
      });
      if (deps.resumePending) {
        await deps.resumePending(data);
      }
      break;
    }

    case "run_dream": {
      log.info("Processing run_dream IPC task", {
        operation: "process_task_command.run_dream",
        chatJid: getStringField(data, "chatJid") || getStringField(data, "chat_jid") || "web:default",
      });
      if (deps.runDream) {
        await deps.runDream(data);
      }
      break;
    }

    case "execute_proposal": {
      const proposalId = getStringField(data, "proposal_id");
      if (!proposalId) {
        log.warn("execute_proposal task missing proposal_id", { operation: "process_task_command.execute_proposal" });
        break;
      }
      log.info("Processing execute_proposal IPC task", {
        operation: "process_task_command.execute_proposal",
        proposalId,
      });
      if (deps.executeProposal) {
        await deps.executeProposal(proposalId);
      }
      break;
    }

    case "reject_proposal": {
      const proposalId = getStringField(data, "proposal_id");
      if (!proposalId) {
        log.warn("reject_proposal task missing proposal_id", { operation: "process_task_command.reject_proposal" });
        break;
      }
      const reason = getStringField(data, "reason") || undefined;
      log.info("Processing reject_proposal IPC task", {
        operation: "process_task_command.reject_proposal",
        proposalId,
        reason,
      });
      if (deps.rejectProposal) {
        await deps.rejectProposal(proposalId, reason);
      }
      break;
    }

    default:
      throw new Error(`Unsupported IPC task type: ${commandType || "missing"}`);
  }
}
