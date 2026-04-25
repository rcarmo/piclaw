/**
 * runtime/wiring.ts – Runtime message/scheduler wiring helpers.
 */

import { existsSync } from "fs";
import { resolve } from "path";

import { ensureDreamTask, runDreamAgentTurn } from "../dream.js";
import { WORKSPACE_DIR } from "../core/config.js";
import { AUTO_DREAM_DEFAULT_DAYS } from "../dream-defaults.js";
import { startIpcWatcher, type IpcDeps } from "../ipc.js";
import { startSchedulerLoop, type SchedulerDeps } from "../task-scheduler.js";
import { createUuid } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";
import { executeApprovedProposal, rejectProposal } from "../remote/service-operations.js";

const log = createLogger("runtime.wiring");

const DREAM_BOOTSTRAP_RELATIVE_FILES = [
  "notes/memory/MEMORY.md",
  "notes/memory/current-state.md",
  "notes/memory/recent-context.md",
];

/** Queue-lane key for out-of-band Dream work; separate from the interactive chat lane. */
export function getDreamQueueLane(chatJid: string): string {
  return `dream:${chatJid || "web:default"}`;
}

export function getDreamBootstrapFiles(): string[] {
  const workspaceRoot = resolve(process.env.PICLAW_WORKSPACE || WORKSPACE_DIR);
  return DREAM_BOOTSTRAP_RELATIVE_FILES.map((path) => resolve(workspaceRoot, path));
}

export function workspaceNeedsDreamBootstrap(): boolean {
  return getDreamBootstrapFiles().some((path) => !existsSync(path));
}

/** Minimal sender contract exposed to runtime worker wiring. */
export type RuntimeSenders = Pick<IpcDeps, "sendMessage" | "sendNudge">;

/** Optional sendMessage options accepted by web message dispatch. */
export type RuntimeSendMessageOptions = Parameters<RuntimeSenders["sendMessage"]>[2];

/** Web-channel capabilities required by runtime worker startup. */
export interface RuntimeWebWorkerChannel {
  sendMessage: RuntimeSenders["sendMessage"];
  resumeChat: (chatJid: string, threadRootId?: number | null) => void;
  resumePendingChats: (chatJid?: string) => void;
}

/** WhatsApp-channel capability required by runtime worker startup. */
export interface RuntimeWhatsAppWorkerChannel {
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** Optional Pushover-channel capability required by runtime worker startup. */
export interface RuntimePushoverWorkerChannel {
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** Agent-pool model resolution capability required by IPC update_task handling. */
export interface RuntimeModelResolver {
  resolveModelInput: NonNullable<IpcDeps["resolveModel"]>;
}

/** Build sendMessage/sendNudge closures for runtime workers. */
export function createRuntimeSenders(
  web: RuntimeWebWorkerChannel,
  whatsapp: RuntimeWhatsAppWorkerChannel,
  pushover: RuntimePushoverWorkerChannel | null
): RuntimeSenders {
  const sendMessage = async (jid: string, text: string, options?: RuntimeSendMessageOptions) => {
    if (jid.startsWith("web:")) {
      await web.sendMessage(jid, text, options);
      return;
    }
    await whatsapp.sendMessage(jid, text);
  };

  const sendNudge = pushover
    ? async (text: string) => {
        await pushover.sendMessage("", text).catch((err) =>
          log.error("Failed to send pushover nudge", {
            operation: "send_nudge",
            err,
          })
        );
      }
    : undefined;

  return { sendMessage, sendNudge };
}

/** Start IPC and scheduler background workers with runtime callbacks. */
export function startRuntimeWorkers(
  queue: SchedulerDeps["queue"],
  agentPool: SchedulerDeps["agentPool"] & RuntimeModelResolver,
  web: RuntimeWebWorkerChannel,
  senders: RuntimeSenders
): void {
  ensureDreamTask("web:default");

  if (workspaceNeedsDreamBootstrap()) {
    const chatJid = "web:default";
    const taskId = `dream-bootstrap:${createUuid("dream")}`;
    log.info("Queueing initial Dream bootstrap", {
      operation: "start_runtime_workers.queue_dream_bootstrap",
      chatJid,
      days: AUTO_DREAM_DEFAULT_DAYS,
      missingFiles: getDreamBootstrapFiles().filter((path) => !existsSync(path)),
    });
    queue.enqueueTask(taskId, async () => {
      const result = await runDreamAgentTurn({
        chatJid,
        days: AUTO_DREAM_DEFAULT_DAYS,
        mode: "auto",
        agentPool,
      });
      log.info("Initial Dream bootstrap finished", {
        operation: "start_runtime_workers.complete_dream_bootstrap",
        chatJid,
        skipped: result.skipped,
      });
    }, getDreamQueueLane(chatJid));
  }

  startIpcWatcher({
    sendMessage: senders.sendMessage,
    sendNudge: senders.sendNudge,
    resolveModel: (input) => agentPool.resolveModelInput(input),
    resumeChat: async (data) => {
      const chatJid = typeof data.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : "web:default";
      const threadRootId = typeof data.threadRootId === "number" ? data.threadRootId : null;
      web.resumeChat(chatJid, threadRootId);
    },
    resumePending: async (data) => {
      const chatJid = typeof data?.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : undefined;
      web.resumePendingChats(chatJid);
    },
    runDream: async (data) => {
      const chatJid = typeof data.chatJid === "string" && data.chatJid.trim()
        ? data.chatJid.trim()
        : typeof data.chat_jid === "string" && data.chat_jid.trim()
          ? data.chat_jid.trim()
          : "web:default";
      const mode = data.mode === "auto" ? "auto" : "manual";
      const days = typeof data.days === "number" && Number.isFinite(data.days)
        ? Math.max(1, Math.floor(data.days))
        : typeof data.days === "string" && data.days.trim()
          ? Math.max(1, Number.parseInt(data.days, 10) || 7)
          : 7;
      const taskId = `dream-ipc:${createUuid("dream")}`;
      queue.enqueueTask(taskId, async () => {
        const result = await runDreamAgentTurn({
          chatJid,
          days,
          mode,
          agentPool,
        });
        if (mode !== "auto") {
          await senders.sendMessage(chatJid, result.result, { forceRoot: true, source: "dream" });
        }
      }, getDreamQueueLane(chatJid));
    },
    executeProposal: async (proposalId) => {
      const taskId = `proposal:${proposalId}`;
      queue.enqueueTask(taskId, async () => {
        await executeApprovedProposal(proposalId, agentPool, async (text) => {
          await senders.sendMessage("web:default", text, { forceRoot: true, source: "remote-proposal" });
        });
      });
    },
    rejectProposal: async (proposalId, reason) => {
      await rejectProposal(proposalId, reason, async (text) => {
        await senders.sendMessage("web:default", text, { forceRoot: true, source: "remote-proposal" });
      });
    },
  });

  startSchedulerLoop({
    queue,
    agentPool,
    sendMessage: senders.sendMessage,
    sendNudge: senders.sendNudge,
  });
}
