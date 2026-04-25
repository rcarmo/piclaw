/**
 * runtime/startup.ts – Runtime startup wiring helpers.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { AgentPool } from "../agent-pool.js";
import { WebChannel } from "../channels/web.js";
import { PushoverChannel } from "../channels/pushover.js";
import { WhatsAppChannel } from "../channels/whatsapp.js";
import { setMessagesPostFn } from "../extensions/messages-crud.js";
import {
  DATA_DIR,
  STORE_DIR,
  WORKSPACE_DIR,
  getPushoverConfig,
  getToolOutputConfig,
  getWhatsAppConfig,
} from "../core/config.js";
import { getDb, initDatabase, storeChatMetadata, storeMessage } from "../db.js";
import type { AgentQueue } from "../queue.js";
import { startToolOutputCleanup } from "../tool-output.js";
import { createUuid } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";
import { patchConsoleTimestamps } from "./console-timestamps.js";
import type { RuntimeState } from "./state.js";
import { launchWorkspaceIndexProcess } from "../workspace-index-process.js";
import { SystemMetricsSampler } from "../channels/web/agent/system-metrics.js";
import { registerLazyViewerRoutes } from "../channels/web/http/lazy-viewer-routes.js";

const log = createLogger("runtime.startup");
const WORKSPACE_SKEL_DIR = resolve(import.meta.dir, "../../../skel");
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
    // Run an immediate pending-resume scan at startup so deferred queued
    // follow-ups are picked up even before IPC workers process resume tasks.
    // Queue dedupe keeps this safe when IPC-driven resume_pending runs too.
    web.resumePendingChats();
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
  registerLazyViewerRoutes();
  captureStartupMemorySnapshot(agentPool, { label: "post-web-start" });
  queueStartupSessionWarmup(agentPool, resolveStartupSessionWarmupOptions());
  runWebStartupRecoveryBootstrap(web);

  // Wire the messages tool post action to use the web channel for broadcast.
  setMessagesPostFn((chatJid, content, isBot, mediaIds, contentBlocks) => {
    const interaction = web.storeMessage(chatJid, content, isBot, mediaIds, {
      contentBlocks,
    });
    if (!interaction) return null;
    web.broadcastEvent(isBot ? "agent_response" : "new_post", interaction);
    return interaction.id;
  });

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

/** Build WhatsApp channel with runtime callbacks and pairing IPC integration. */
export function createWhatsAppChannel(state: RuntimeState): WhatsAppChannel {
  const whatsAppConfig = getWhatsAppConfig();
  if (!whatsAppConfig.phoneNumber) {
    // Return a no-op stub when WhatsApp is not configured.
    // The runtime expects a whatsapp object with connect/disconnect/sendMessage/setTyping.
    return {
      connect: async () => {},
      disconnect: async () => {},
      sendMessage: async () => {},
      setTyping: async () => {},
      isConnected: () => false,
    } as unknown as WhatsAppChannel;
  }

  return new WhatsAppChannel({
    chatJids: () => state.chatJids,
    phoneNumber: whatsAppConfig.phoneNumber || undefined,
    onPairingCode: (code) => {
      try {
        const ipcDir = join(DATA_DIR, "ipc", "messages");
        mkdirSync(ipcDir, { recursive: true });
        const payload = {
          type: "message",
          chatJid: "web:default",
          text: code,
        };
        const filePath = join(ipcDir, `${createUuid("pairing")}.json`);
        writeFileSync(filePath, JSON.stringify(payload));
      } catch (error) {
        log.error("Failed to write pairing code IPC message", {
          operation: "pairing_code_ipc",
          err: error,
        });
      }
    },
    onMessage: (chatJid, msg) => {
      if (!state.chatJids.has(chatJid) && msg.is_from_me) {
        state.chatJids.add(chatJid);
        state.saveChats();
      }
      storeMessage(msg);
    },
    onChatMetadata: (chatJid, timestamp) => storeChatMetadata(chatJid, timestamp),
  });
}
