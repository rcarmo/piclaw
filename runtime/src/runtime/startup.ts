/**
 * runtime/startup.ts – Runtime startup wiring helpers.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "fs";
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
import { initDatabase, storeChatMetadata, storeMessage } from "../db.js";
import type { AgentQueue } from "../queue.js";
import { startToolOutputCleanup } from "../tool-output.js";
import { createUuid } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";
import { patchConsoleTimestamps } from "./console-timestamps.js";
import type { RuntimeState } from "./state.js";

const log = createLogger("runtime.startup");
const WORKSPACE_SKEL_DIR = resolve(import.meta.dir, "../../../skel");
const WORKSPACE_BOOTSTRAP_ENTRIES = [
  "AGENTS.md",
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
  const toolOutputConfig = getToolOutputConfig();
  startToolOutputCleanup(toolOutputConfig.retentionDays, toolOutputConfig.cleanupIntervalMs);
  state.loadTimestamps();
  state.loadChats();
}

export function queueStartupSessionWarmup(
  agentPool: AgentPool & {
    scheduleChatWarmup?: (chatJid: string, options?: { priority?: boolean }) => boolean;
    scheduleRecentChatWarmup?: (options?: { limit?: number; excludeChatJids?: string[] }) => string[];
  },
  options: { defaultChatJid?: string; recentLimit?: number } = {},
): void {
  const defaultChatJid = typeof options.defaultChatJid === "string" && options.defaultChatJid.trim()
    ? options.defaultChatJid.trim()
    : "web:default";
  const recentLimit = Math.max(0, Math.min(8, Math.trunc(options.recentLimit ?? 5) || 5));

  agentPool.scheduleChatWarmup?.(defaultChatJid, { priority: true });
  if (recentLimit > 0) {
    agentPool.scheduleRecentChatWarmup?.({
      limit: recentLimit,
      excludeChatJids: [defaultChatJid],
    });
  }
}

/** Start web channel and run immediate crash-recovery bootstrap. */
export async function startWebChannel(queue: AgentQueue, agentPool: AgentPool): Promise<WebChannel> {
  const web = new WebChannel({ queue, agentPool });
  await web.start();
  queueStartupSessionWarmup(agentPool);
  web.recoverInflightRuns();
  // Run an immediate pending-resume scan at startup so deferred queued
  // follow-ups are picked up even before IPC workers process resume tasks.
  // Queue dedupe keeps this safe when IPC-driven resume_pending runs too.
  web.resumePendingChats();

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
