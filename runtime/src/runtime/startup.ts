/**
 * runtime/startup.ts – Runtime startup wiring helpers.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { AgentPool } from "../agent-pool.js";
import { WebChannel } from "../channels/web.js";
import { PushoverChannel } from "../channels/pushover.js";
import { setMessagesPostFn } from "../extensions/messages-crud.js";
import { setChatToolRelayFn } from "../extensions/chat-tool.js";
import { createDirectChatToolRelayHandler } from "../extensions/chat-tool-runtime.js";
import { setSessionControlHandler, type SessionControlRequest, type SessionControlResult } from "../extensions/session-control.js";
import { getSessionActivitySnapshot, getSessionIsolationLevel } from "../extensions/session-status.js";
import {
  DATA_DIR,
  STORE_DIR,
  WORKSPACE_DIR,
  getPushoverConfig,
  getToolOutputConfig,
  getProgressWatchdogSafetyWarning,
} from "../core/config.js";
import { getChatBranchByAgentName, getChatBranchByChatJid, getChatCursor, getDb, getFailedRun, initDatabase } from "../db.js";
import type { AgentQueue } from "../queue.js";
import { startToolOutputCleanup } from "../tool-output.js";
import { createUuid } from "../utils/ids.js";
import { applyEnvironmentOverrides } from "../environment-overrides.js";
import { createLogger } from "../utils/logger.js";
import { patchConsoleTimestamps } from "./console-timestamps.js";
import { startExternalProgressWatchdogMonitor } from "./progress-watchdog-supervisor.js";
import type { RuntimeState } from "./state.js";
import { launchWorkspaceIndexProcess } from "../workspace-index-process.js";
import { SystemMetricsSampler } from "../channels/web/agent/system-metrics.js";
import { installAddonRuntimeApi, setAddonAgentMessageEnqueuer } from "../addons/runtime-contributions.js";
// import { registerLazyViewerRoutes } from "../channels/web/http/lazy-viewer-routes.js"; // removed: office-viewer is now @rcarmo/piclaw-addon-office-viewer

const log = createLogger("runtime.startup");
const WORKSPACE_SKEL_DIR = resolve(process.env.PICLAW_SKEL_DIR || resolve(import.meta.dir, "../../../skel"));
const STARTUP_MEMORY_SNAPSHOT_DIR = join(DATA_DIR, "startup-memory-snapshots");
export const STARTUP_STATUS_CHAT_JID = "web:default";
export const STARTUP_STATUS_TURN_ID = "startup:web:default";

function parseStartupWarmupBoolean(value: string | undefined, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseStartupWarmupLimit(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(8, parsed));
}
const WORKSPACE_BOOTSTRAP_ENTRIES = [
  "AGENTS.md",
  ".mcp.json.example",
  ".pi/skills",
  ".pi/mcp.json.example",
  ".piclaw/README.md",
  ".piclaw/config.json.example",
  "notes/index.md",
  "notes/memory/README.md",
  "notes/daily/.gitkeep",
  "notes/memory/days/.gitkeep",
  "notes/preferences/.gitkeep",
] as const;

function sanitizeSessionDirName(chatJid: string): string {
  return String(chatJid || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isDirectoryEmpty(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

export function cleanupOrphanedActiveChatArtifacts(): number {
  const db = getDb();
  const rows = db.prepare(
    `SELECT b.chat_jid
       FROM chat_branches b
       LEFT JOIN chat_cursors cc ON cc.chat_jid = b.chat_jid
       LEFT JOIN (
         SELECT chat_jid, COUNT(*) AS cnt
           FROM messages
          GROUP BY chat_jid
       ) m ON m.chat_jid = b.chat_jid
      WHERE b.archived_at IS NULL
        AND cc.chat_jid IS NULL
        AND COALESCE(m.cnt, 0) = 0`
  ).all() as Array<{ chat_jid: string }>;

  let cleaned = 0;
  for (const row of rows) {
    const chatJid = String(row.chat_jid || "").trim();
    if (!chatJid) continue;

    const mainDir = join(DATA_DIR, "sessions", sanitizeSessionDirName(chatJid));
    const sideDir = join(DATA_DIR, "sessions", `${sanitizeSessionDirName(chatJid)}__btw-side`);
    const mainDirExists = existsSync(mainDir);
    const sideDirExists = existsSync(sideDir);
    const mainDirEmpty = !mainDirExists || isDirectoryEmpty(mainDir);
    const sideDirEmpty = !sideDirExists || isDirectoryEmpty(sideDir);

    if (!mainDirEmpty || !sideDirEmpty) {
      continue;
    }

    db.prepare("DELETE FROM chat_branches WHERE chat_jid = ?").run(chatJid);
    db.prepare("DELETE FROM chats WHERE jid = ?").run(chatJid);
    db.prepare("DELETE FROM token_usage WHERE chat_jid = ?").run(chatJid);

    if (mainDirExists) rmSync(mainDir, { recursive: true, force: true });
    if (sideDirExists) rmSync(sideDir, { recursive: true, force: true });

    cleaned += 1;
  }

  return cleaned;
}

function bootstrapWorkspaceFromSkel(): void {
  if (!existsSync(WORKSPACE_SKEL_DIR)) return;

  for (const entry of WORKSPACE_BOOTSTRAP_ENTRIES) {
    const source = join(WORKSPACE_SKEL_DIR, entry);
    const target = join(WORKSPACE_DIR, entry);
    if (!existsSync(source) || existsSync(target)) continue;

    mkdirSync(dirname(target), { recursive: true });
    try {
      if (statSync(source).isDirectory()) {
        cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
      } else {
        copyFileSync(source, target);
      }
    } catch (error) {
      log.warn("Failed to seed workspace bootstrap entry", {
        operation: "workspace_bootstrap.seed",
        entry,
        err: error,
      });
    }
  }
}

/** Initialize directories, database, and persisted runtime state. */
export function initializeRuntimeEnvironment(state: RuntimeState): void {
  patchConsoleTimestamps();
  mkdirSync(STORE_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  bootstrapWorkspaceFromSkel();

  initDatabase();
  installAddonRuntimeApi();
  applyEnvironmentOverrides();
  const watchdogWarning = getProgressWatchdogSafetyWarning();
  if (watchdogWarning) {
    log.warn(watchdogWarning, {
      operation: "progress_watchdog.safety_enforced",
    });
  }
  startExternalProgressWatchdogMonitor();
  const cleanedOrphans = cleanupOrphanedActiveChatArtifacts();
  if (cleanedOrphans > 0) {
    log.info("Cleaned orphaned active chat artifacts at startup", {
      operation: "cleanup_orphaned_active_chat_artifacts",
      cleaned: cleanedOrphans,
    });
  }
  launchWorkspaceIndexProcess({ scope: "all" });
  const toolOutputConfig = getToolOutputConfig();
  startToolOutputCleanup(toolOutputConfig.retentionMs, toolOutputConfig.cleanupIntervalMs);
  state.loadTimestamps();
  state.loadChats();
}

export function resolveStartupSessionWarmupOptions(env: NodeJS.ProcessEnv = process.env): {
  warmDefaultChat: boolean;
  recentLimit: number;
} {
  return {
    warmDefaultChat: parseStartupWarmupBoolean(env.PICLAW_STARTUP_WARM_DEFAULT_CHAT, false),
    recentLimit: parseStartupWarmupLimit(env.PICLAW_STARTUP_WARMUP_RECENT_LIMIT, 0),
  };
}

export function queueStartupSessionWarmup(
  agentPool: AgentPool & {
    scheduleChatWarmup?: (chatJid: string, options?: { priority?: boolean }) => boolean;
    scheduleRecentChatWarmup?: (options?: { limit?: number; excludeChatJids?: string[] }) => string[];
  },
  options: { defaultChatJid?: string; recentLimit?: number; warmDefaultChat?: boolean } = {},
): void {
  const defaultChatJid = typeof options.defaultChatJid === "string" && options.defaultChatJid.trim()
    ? options.defaultChatJid.trim()
    : "web:default";
  const warmDefaultChat = options.warmDefaultChat ?? false;
  const recentLimit = Math.max(0, Math.min(8, Math.trunc(options.recentLimit ?? 0) || 0));

  if (warmDefaultChat) {
    agentPool.scheduleChatWarmup?.(defaultChatJid, { priority: true });
  }
  if (recentLimit > 0) {
    agentPool.scheduleRecentChatWarmup?.({
      limit: recentLimit,
      excludeChatJids: warmDefaultChat ? [defaultChatJid] : [],
    });
  }
}

function sanitizeStartupSnapshotLabel(label: string): string {
  return label.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "startup";
}

export function captureStartupMemorySnapshot(
  agentPool: Pick<AgentPool, "getMemoryInstrumentationSnapshot">,
  options: { label?: string } = {},
): string | null {
  try {
    mkdirSync(STARTUP_MEMORY_SNAPSHOT_DIR, { recursive: true });
    const capturedAt = new Date();
    const stamp = capturedAt.toISOString().replace(/[:.]/g, "-");
    const label = sanitizeStartupSnapshotLabel(options.label || "startup");
    const filePath = join(STARTUP_MEMORY_SNAPSHOT_DIR, `${stamp}_${label}.json`);
    const sampler = new SystemMetricsSampler(1, 2000);
    const snapshot = sampler.readSnapshot(agentPool.getMemoryInstrumentationSnapshot());
    writeFileSync(filePath, `${JSON.stringify({
      captured_at: capturedAt.toISOString(),
      pid: process.pid,
      label,
      snapshot,
    }, null, 2)}\n`, "utf8");
    log.info("Captured startup memory snapshot", {
      operation: "startup_memory_snapshot.capture",
      filePath,
      label,
      rssBytes: snapshot.process_memory.rss_bytes,
      activeChats: snapshot.runtime_memory?.active_chats ?? null,
    });
    return filePath;
  } catch (error) {
    log.warn("Failed to capture startup memory snapshot", {
      operation: "startup_memory_snapshot.capture",
      label: options.label || "startup",
      err: error,
    });
    return null;
  }
}

export function buildStartupAgentStatus(options: {
  phase: string;
  detail: string;
  startedAt?: string;
  title?: string;
  blocking?: boolean;
}): Record<string, unknown> {
  const startedAt = typeof options.startedAt === "string" && options.startedAt.trim()
    ? options.startedAt.trim()
    : new Date().toISOString();
  return {
    type: "intent",
    kind: "info",
    intent_key: "startup",
    source: "startup",
    phase: options.phase,
    title: options.title || "Starting up…",
    detail: options.detail,
    blocking: options.blocking ?? true,
    started_at: startedAt,
    last_event_at: new Date().toISOString(),
    turn_id: STARTUP_STATUS_TURN_ID,
  };
}

interface StartupRecoveryWebChannel {
  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void;
  recoverInflightRuns(): void;
  resumePendingChats(chatJid?: string): void;
}

function parseModelLabel(label: string): { provider?: string; modelId: string } {
  const trimmed = label.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) return { provider: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
  return { modelId: trimmed };
}

function summarizeFailedRun(chatJid: string): Record<string, unknown> | null {
  try {
    const failed = getFailedRun(chatJid);
    return failed ? { ...failed } as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getCursorSnapshot(chatJid: string): string | null {
  try {
    return getChatCursor(chatJid) || null;
  } catch {
    return null;
  }
}

async function buildSessionControlSnapshot(agentPool: AgentPool, chatJid: string): Promise<Record<string, unknown>> {
  const models = await agentPool.getAvailableModels(chatJid).catch(() => null);
  const activity = getSessionActivitySnapshot(chatJid);
  const context = await agentPool.getContextUsageForChat(chatJid).catch(() => null);
  const tree = agentPool.getSessionTreeForChat(chatJid);
  return {
    chat_jid: chatJid,
    active: agentPool.isActive(chatJid),
    streaming: agentPool.isStreaming(chatJid),
    compacting: Boolean(activity?.isCompacting),
    active_tools: activity?.activeTools?.map((tool) => ({
      name: tool.toolName,
      running_for_ms: Date.now() - tool.startedAt,
    })) ?? [],
    last_event_at: activity?.lastEventAt ? new Date(activity.lastEventAt).toISOString() : null,
    model: models?.current ?? null,
    thinking_level: models?.thinking_level ?? null,
    context_usage: context,
    failed_run: summarizeFailedRun(chatJid),
    cursor: getCursorSnapshot(chatJid),
    tree: tree ? { leaf_id: tree.leafId, total: tree.total, capped: tree.capped ?? false } : null,
  };
}

function assessSessionSnapshot(snapshot: Record<string, unknown>): string {
  const failed = snapshot.failed_run as Record<string, unknown> | null;
  if (failed) return "failed_run";
  if (snapshot.compacting) {
    const lastEvent = snapshot.last_event_at ? Date.parse(String(snapshot.last_event_at)) : 0;
    if (lastEvent && Date.now() - lastEvent > 5 * 60_000) return "stale_compaction";
    return "compacting";
  }
  if (snapshot.streaming) {
    const lastEvent = snapshot.last_event_at ? Date.parse(String(snapshot.last_event_at)) : 0;
    if (lastEvent && Date.now() - lastEvent > 5 * 60_000) return "stale_stream";
    return "streaming";
  }
  const activeTools = Array.isArray(snapshot.active_tools) ? snapshot.active_tools : [];
  if (activeTools.length > 0) return "tool_running";
  return "idle";
}

function buildSessionControlTreeDescriptor(branch: {
  branch_id?: string | null;
  chat_jid: string;
  root_chat_jid?: string | null;
  parent_branch_id?: string | null;
  agent_name?: string | null;
}): Record<string, unknown> {
  return {
    branch_id: branch.branch_id ?? null,
    chat_jid: branch.chat_jid,
    root_chat_jid: branch.root_chat_jid ?? branch.chat_jid,
    parent_branch_id: branch.parent_branch_id ?? null,
    agent_name: branch.agent_name ?? null,
  };
}

function resolveSessionControlTarget(agentPool: AgentPool, request: SessionControlRequest): { chatJid: string; agentName: string | null; sessionTree: Record<string, unknown> | null } {
  const chatJid = request.target_chat_jid?.trim();
  if (chatJid) {
    const branch = getChatBranchByChatJid(chatJid) || agentPool.listKnownChats().find((chat) => chat.chat_jid === chatJid) || null;
    if (!branch) throw new Error(`No chat session found for ${chatJid}. Prefer target_agent_name (@alias) when available.`);
    return { chatJid: branch.chat_jid, agentName: branch.agent_name || null, sessionTree: buildSessionControlTreeDescriptor(branch) };
  }
  const agentName = String(request.target_agent_name || "").trim().replace(/^@+/, "").trim();
  if (!agentName) throw new Error("Provide target_agent_name (@alias preferred) or target_chat_jid.");
  const branch = getChatBranchByAgentName(agentName) || null;
  if (branch) return { chatJid: branch.chat_jid, agentName: branch.agent_name || agentName, sessionTree: buildSessionControlTreeDescriptor(branch) };
  const found = agentPool.findChatByAgentName(agentName);
  if (!found?.chat_jid) throw new Error(`No chat session found for @${agentName}.`);
  const known = agentPool.listKnownChats().find((chat) => chat.chat_jid === found.chat_jid) || found;
  return { chatJid: found.chat_jid, agentName: found.agent_name || agentName, sessionTree: buildSessionControlTreeDescriptor(known) };
}

function registerSessionControlHandler(agentPool: AgentPool, web: WebChannel): void {
  setSessionControlHandler(async (request): Promise<SessionControlResult> => {
    if (getSessionIsolationLevel() === "full") throw new Error("Session isolation is full; session_control is disabled.");
    const target = resolveSessionControlTarget(agentPool, request);
    const base = {
      action: request.action,
      source_chat_jid: request.source_chat_jid,
      target_chat_jid: target.chatJid,
      target_agent_name: target.agentName,
      target_session_tree: target.sessionTree,
    };
    const before = await buildSessionControlSnapshot(agentPool, target.chatJid);

    if (request.action === "inspect") return { ok: true, ...base, before };
    if (request.action === "assess_stuck") return { ok: true, ...base, before, assessment: assessSessionSnapshot(before) };

    let message: string;
    let extra: Record<string, unknown>;
    if (request.action === "compact") {
      if (before.streaming && !request.force) throw new Error("Target session is streaming; pass force=true to compact anyway.");
      const result = await agentPool.applyControlCommand(target.chatJid, {
        type: "compact",
        instructions: request.instructions,
        raw: request.instructions ? `/compact ${request.instructions}` : "/compact",
      });
      message = result.message || `Compaction ${result.status}.`;
      extra = { control_status: result.status };
    } else if (request.action === "abort") {
      const result = await agentPool.applyControlCommand(target.chatJid, { type: "abort", raw: "/abort" });
      message = result.message || `Abort ${result.status}.`;
      extra = { control_status: result.status };
    } else if (request.action === "switch_model") {
      const model = request.model?.trim();
      if (!model) throw new Error("switch_model requires model.");
      const resolved = agentPool.resolveModelInput(model);
      if (!resolved.model) throw new Error(resolved.error || `Invalid model: ${model}`);
      const { provider, modelId } = parseModelLabel(resolved.model);
      const result = await agentPool.applyControlCommand(target.chatJid, {
        type: "model",
        provider,
        modelId,
        raw: `/model ${resolved.model}`,
      });
      const retried = web.retryFailedOnModelSwitch(target.chatJid);
      if (retried) web.resumeChat(target.chatJid);
      message = result.message || `Model switch ${result.status}.`;
      extra = { control_status: result.status, requested_model: model, resolved_model: resolved.model, retried_failed_run: retried };
    } else if (request.action === "retry_failed") {
      const retried = web.retryFailedOnModelSwitch(target.chatJid);
      if (retried) web.resumeChat(target.chatJid);
      message = retried ? "Failed run marked for retry and chat resumed." : "No failed run to retry.";
      extra = { retried };
    } else if (request.action === "skip_failed") {
      const skipped = web.skipFailedOnModelSwitch(target.chatJid);
      message = skipped ? "Failed run skipped." : "No failed run to skip.";
      extra = { skipped };
    } else if (request.action === "wake") {
      web.resumeChat(target.chatJid);
      message = "Chat wake/resume queued.";
      extra = { resumed: true };
    } else if (request.action === "unblock") {
      const assessment = assessSessionSnapshot(before);
      const steps: Record<string, unknown>[] = [];
      if (request.model?.trim()) {
        const resolved = agentPool.resolveModelInput(request.model.trim());
        if (!resolved.model) throw new Error(resolved.error || `Invalid model: ${request.model}`);
        const { provider, modelId } = parseModelLabel(resolved.model);
        const result = await agentPool.applyControlCommand(target.chatJid, {
          type: "model",
          provider,
          modelId,
          raw: `/model ${resolved.model}`,
        });
        steps.push({ action: "switch_model", status: result.status, requested_model: request.model.trim(), resolved_model: resolved.model });
      }

      const retried = web.retryFailedOnModelSwitch(target.chatJid);
      if (retried) {
        web.resumeChat(target.chatJid);
        steps.push({ action: "retry_failed", retried: true });
        steps.push({ action: "wake", resumed: true });
        message = "Failed run marked for retry and chat resumed.";
      } else if (before.streaming || before.compacting || before.active || (Array.isArray(before.active_tools) && before.active_tools.length > 0)) {
        const result = await agentPool.applyControlCommand(target.chatJid, { type: "abort", raw: "/abort" });
        steps.push({ action: "abort", status: result.status });
        web.resumeChat(target.chatJid);
        steps.push({ action: "wake", resumed: true });
        message = "Active target work aborted and chat resumed.";
      } else {
        web.resumeChat(target.chatJid);
        steps.push({ action: "wake", resumed: true });
        message = "Chat wake/resume queued.";
      }
      extra = { assessment_before: assessment, steps, retried_failed_run: retried };
    } else {
      throw new Error(`Unsupported session_control action: ${request.action}`);
    }

    const after = await buildSessionControlSnapshot(agentPool, target.chatJid);
    return { ok: true, ...base, before, after, message, ...extra };
  });
}

export function runWebStartupRecoveryBootstrap(web: StartupRecoveryWebChannel): void {
  const startedAt = new Date().toISOString();
  web.updateAgentStatus(STARTUP_STATUS_CHAT_JID, buildStartupAgentStatus({
    phase: "recovering_inflight",
    detail: "Restoring runtime state and recovering interrupted chats.",
    startedAt,
  }));

  try {
    web.recoverInflightRuns();
    web.updateAgentStatus(STARTUP_STATUS_CHAT_JID, buildStartupAgentStatus({
      phase: "resuming_pending",
      detail: "Resuming pending chats and queued follow-ups.",
      startedAt,
    }));
    // Defer the pending-resume scan so the HTTP server can bind and start
    // accepting connections before heavy chat processing begins. Queue
    // dedupe keeps this safe when IPC-driven resume_pending runs too.
    setTimeout(() => web.resumePendingChats(), 0);
  } finally {
    web.updateAgentStatus(STARTUP_STATUS_CHAT_JID, {
      type: "done",
      source: "startup",
      turn_id: STARTUP_STATUS_TURN_ID,
      title: "Startup ready",
      detail: "Runtime recovery complete.",
    });
  }
}

/** Start web channel and run immediate crash-recovery bootstrap. */
export async function startWebChannel(queue: AgentQueue, agentPool: AgentPool): Promise<WebChannel> {
  const web = new WebChannel({ queue, agentPool });
  await web.start();
  // office-viewer route removed: now registered by @rcarmo/piclaw-addon-office-viewer
  // Do not freeze extension routes here: workspace/add-on extension factories
  // register their HTTP routes during the first session resource reload.
  // createSessionInDir() freezes the registry after that initial load pass.
  captureStartupMemorySnapshot(agentPool, { label: "post-web-start" });
  queueStartupSessionWarmup(agentPool, resolveStartupSessionWarmupOptions());
  runWebStartupRecoveryBootstrap(web);

  // Wire the first-class add-on runtime API to the web channel's in-process
  // message storage/queue/run path. Add-ons should use this instead of
  // synthesizing authenticated localhost HTTP requests to /agent/:id/message.
  setAddonAgentMessageEnqueuer((request) => web.enqueueAgentMessage(request));

  // Wire the messages tool post action to use the web channel for broadcast.
  setMessagesPostFn((chatJid, content, isBot, mediaIds, contentBlocks) => {
    const interaction = web.storeMessage(chatJid, content, isBot, mediaIds, {
      contentBlocks,
    });
    if (!interaction) return null;
    web.broadcastEvent(isBot ? "agent_response" : "new_post", interaction);
    return interaction.id;
  });

  // Wire the cross-session chat tool directly to the target chat message route.
  // Do not use the web peer relay endpoint here: the tool runs with a trusted current
  // chat context, so sender and destination identities are resolved and checked
  // locally before delivery to avoid spoofing.
  setChatToolRelayFn(createDirectChatToolRelayHandler(agentPool, web));

  // Wire session_control separately from chat relay. This tool controls target
  // session runtime state (inspect/compact/abort/model/failed-run/wake).
  registerSessionControlHandler(agentPool, web);

  return web;
}

/**
 * Queue a self-addressed IPC task to resume pending chats once background
 * workers and external channels are fully online.
 */
export function queueStartupResumePendingIpc(): void {
  try {
    const tasksDir = join(DATA_DIR, "ipc", "tasks");
    mkdirSync(tasksDir, { recursive: true });

    const payload = {
      type: "resume_pending",
      chatJid: "all",
      reason: "startup",
    };
    const filePath = join(tasksDir, `resume_pending_${createUuid("startup")}.json`);
    writeFileSync(filePath, JSON.stringify(payload));
    log.info("Queued startup resume_pending IPC", {
      operation: "queue_resume_pending_ipc",
      filePath,
    });
  } catch (error) {
    log.error("Failed to queue resume_pending IPC", {
      operation: "queue_resume_pending_ipc",
      err: error,
    });
  }
}

/** Start optional Pushover channel if configured. */
export async function startOptionalPushoverChannel(): Promise<PushoverChannel | null> {
  const pushoverConfig = getPushoverConfig();
  if (!pushoverConfig.appToken || !pushoverConfig.userKey) {
    return null;
  }

  const pushover = new PushoverChannel({
    appToken: pushoverConfig.appToken,
    userKey: pushoverConfig.userKey,
    device: pushoverConfig.device || undefined,
    priority: pushoverConfig.priority,
    sound: pushoverConfig.sound || undefined,
  });
  await pushover.start();
  return pushover;
}



