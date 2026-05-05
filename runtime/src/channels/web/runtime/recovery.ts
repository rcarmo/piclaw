/**
 * channels/web/recovery.ts – crash recovery and pending-resume orchestration.
 */

import {
  clearChatCompactionActive,
  clearChatPreflight,
  clearInflightMarker,
  getActiveChatCompactions,
  getAgentReplyStateAfter,
  getAllChatCursors,
  getChatCompactionBackoff,
  getDb,
  getDeferredQueuedFollowups,
  getInflightRuns,
  getMessageThreadRootIdById,
  getMessagesSince,
  getPreflightRuns,
  quarantineStalePreflightRun,
  rollbackInflightRun,
  setChatCompactionBackoff,
  storeMessage,
  type ActiveCompactionState,
  type AgentReplyState,
  type DeferredQueuedFollowupRecord,
  type InflightRun,
  type PreflightRun,
  type StalePreflightRecoveryRecord,
} from "../../../db.js";
import { createUuid } from "../../../utils/ids.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.recovery");

export interface PersistedDraftRecoveryEntry {
  turnId?: string;
  text: string;
  totalLines: number;
  updatedAt: number;
}

function persistInterruptedTurnOutcome(chatJid: string, inflight: InflightRun, assistantName: string): void {
  try {
    storeMessage({
      id: createUuid("web"),
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: assistantName,
      content: "",
      content_blocks: [{
        type: "turn_outcome_marker",
        kind: "interrupted",
        label: "interrupted",
        title: "Turn interrupted",
        detail: "The service restarted before the reply finished.",
        severity: "warning",
      }],
      thread_id: getMessageThreadRootIdById(chatJid, inflight.messageId) ?? undefined,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: true,
    });
  } catch (error) {
    log.warn("Failed to persist interrupted-turn outcome", {
      operation: "recover_inflight_runs.persist_interrupted_outcome",
      chatJid,
      inflightMessageId: inflight.messageId,
      err: error,
    });
  }
}

function persistRecoveredDraft(chatJid: string, inflight: InflightRun, assistantName: string, draft: PersistedDraftRecoveryEntry): void {
  const text = typeof draft?.text === "string" ? draft.text.trim() : "";
  if (!text) return;
  try {
    storeMessage({
      id: createUuid("web"),
      chat_jid: chatJid,
      sender: "web-agent",
      sender_name: assistantName,
      content: text,
      thread_id: getMessageThreadRootIdById(chatJid, inflight.messageId) ?? undefined,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      is_terminal_agent_reply: true,
    });
  } catch (error) {
    log.warn("Failed to persist recovered draft after restart", {
      operation: "recover_inflight_runs.persist_recovered_draft",
      chatJid,
      inflightMessageId: inflight.messageId,
      err: error,
    });
  }
}

function recoveryLaneKey(chatJid: string): string {
  return `chat:${chatJid}`;
}

/** Runtime callbacks required for inflight recovery/pending resume orchestration. */
export interface WebRecoveryContext {
  assistantName: string;
  defaultAgentId: string;
  enqueue(task: () => Promise<void>, key: string, laneKey?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number): Promise<void>;
  getDraftRecovery?: (chatJid: string) => PersistedDraftRecoveryEntry | null;
  clearDraftRecovery?: (chatJid: string) => void;
  now?: () => number;
  recoveryDelayMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}

/** Persistence contract used by web recovery helpers. */
export interface WebRecoveryStore {
  getPreflightRuns?(): PreflightRun[];
  getActiveChatCompactions?(): ActiveCompactionState[];
  getInflightRuns(): InflightRun[];
  transaction(run: () => void): void;
  getAgentReplyStateAfter(chatJid: string, prevTs: string): AgentReplyState;
  clearChatPreflight?(chatJid: string): void;
  clearChatCompactionActive?(chatJid: string): void;
  getChatCompactionBackoff?(chatJid: string): { failureCount: number } | null;
  setChatCompactionBackoff?(chatJid: string, backoff: { failureCount: number; lastFailedAt: string; backoffUntil: string; lastErrorMessage?: string | null }): void;
  quarantineStalePreflightRun?(preflight: PreflightRun, options: { createdAt: string; reason: string; backoffUntil?: string | null }): StalePreflightRecoveryRecord | null;
  clearInflightMarker(chatJid: string): void;
  rollbackInflightRun(chatJid: string, prevTs: string): void;
  getAllChatCursors(): Record<string, string>;
  getKnownChatJids(): string[];
  getDeferredQueuedFollowups(chatJid: string): DeferredQueuedFollowupRecord[];
  getMessagesSince(chatJid: string, since: string, assistantName: string): unknown[];
}

function getKnownChatJids(): string[] {
  const rows = getDb().prepare(`
    SELECT chat_jid FROM chat_cursors
    UNION
    SELECT jid as chat_jid FROM chats
    UNION
    SELECT chat_jid FROM messages
  `).all() as Array<{ chat_jid: string | null | undefined }>;

  return rows
    .map((row) => (typeof row.chat_jid === "string" ? row.chat_jid.trim() : ""))
    .filter((jid) => jid.length > 0);
}

const defaultStore: WebRecoveryStore = {
  getPreflightRuns,
  getActiveChatCompactions,
  getInflightRuns,
  transaction: (run) => {
    getDb().transaction(run)();
  },
  getAgentReplyStateAfter,
  clearChatPreflight,
  clearChatCompactionActive,
  getChatCompactionBackoff,
  setChatCompactionBackoff,
  quarantineStalePreflightRun,
  clearInflightMarker,
  rollbackInflightRun,
  getAllChatCursors,
  getKnownChatJids,
  getDeferredQueuedFollowups,
  getMessagesSince,
};

/**
 * Maximum age (ms) at which we log inflight markers as stale.
 *
 * We replay all interrupted no-output markers to preserve pending user turns,
 * but emit a stronger warning for very old markers so operators can spot
 * pathological restart loops.
 */
const MAX_INFLIGHT_AGE_MS = 30 * 60 * 1000;
const RUNTIME_STALE_INFLIGHT_GRACE_MS = 15_000;
const DEFAULT_STALE_PREFLIGHT_AGE_MS = 4 * 60 * 1000;
const DEFAULT_STALE_PREFLIGHT_BACKOFF_MS = 4 * 60 * 60 * 1000;
const DEFAULT_STALE_ACTIVE_COMPACTION_AGE_MS = 4 * 60 * 1000;
const DEFAULT_STALE_ACTIVE_COMPACTION_BACKOFF_MS = 4 * 60 * 60 * 1000;

function parsePositiveDurationMs(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStalePreflightAgeMs(): number {
  return parsePositiveDurationMs(process.env.PICLAW_STALE_PREFLIGHT_RECOVERY_MS, DEFAULT_STALE_PREFLIGHT_AGE_MS);
}

function getStalePreflightBackoffMs(): number {
  return parsePositiveDurationMs(process.env.PICLAW_STALE_PREFLIGHT_BACKOFF_MS, DEFAULT_STALE_PREFLIGHT_BACKOFF_MS);
}

function getStaleActiveCompactionAgeMs(): number {
  return parsePositiveDurationMs(process.env.PICLAW_STALE_ACTIVE_COMPACTION_RECOVERY_MS, DEFAULT_STALE_ACTIVE_COMPACTION_AGE_MS);
}

function getStaleActiveCompactionBackoffMs(): number {
  return parsePositiveDurationMs(process.env.PICLAW_STALE_ACTIVE_COMPACTION_BACKOFF_MS, DEFAULT_STALE_ACTIVE_COMPACTION_BACKOFF_MS);
}

function getRunAgeMs(startedAt: string, nowMs: number): number {
  const startedMs = Date.parse(startedAt);
  return Number.isFinite(startedMs) ? nowMs - startedMs : Number.POSITIVE_INFINITY;
}

export interface RecoverStaleInflightRunOptions {
  hasActiveStatus?: boolean;
  minAgeMs?: number;
}

/** Recover one stale inflight run during normal runtime, not only on startup. */
export function recoverStaleInflightRun(
  ctx: WebRecoveryContext,
  chatJid: string,
  options: RecoverStaleInflightRunOptions = {},
  store: WebRecoveryStore = defaultStore,
): boolean {
  if (!chatJid || options.hasActiveStatus) return false;

  const inflight = store.getInflightRuns().find((entry) => entry.chatJid === chatJid);
  if (!inflight) return false;

  const replyState = store.getAgentReplyStateAfter(inflight.chatJid, inflight.startedAt);
  const now = typeof ctx.now === "function" ? ctx.now() : Date.now();
  const inflightAge = now - new Date(inflight.startedAt).getTime();
  const minAgeMs = Number.isFinite(options.minAgeMs) ? Number(options.minAgeMs) : RUNTIME_STALE_INFLIGHT_GRACE_MS;

  try {
    store.transaction(() => {
      if (replyState === "terminal") {
        log.info("Runtime stale-inflight recovery cleared terminal marker", {
          operation: "recover_stale_inflight_run.clear_terminal",
          chatJid: inflight.chatJid,
          startedAt: inflight.startedAt,
        });
        store.clearInflightMarker(inflight.chatJid);
        return;
      }

      if (replyState === "partial") {
        log.info("Runtime stale-inflight recovery cleared partial marker", {
          operation: "recover_stale_inflight_run.clear_partial",
          chatJid: inflight.chatJid,
          startedAt: inflight.startedAt,
        });
        store.clearInflightMarker(inflight.chatJid);
        return;
      }

      if (inflightAge < minAgeMs) {
        return;
      }

      log.warn("Runtime stale-inflight recovery marked turn as interrupted", {
        operation: "recover_stale_inflight_run.clear_interrupted",
        chatJid: inflight.chatJid,
        startedAt: inflight.startedAt,
        inflightAgeSeconds: Math.round(inflightAge / 1000),
      });
      store.clearInflightMarker(inflight.chatJid);
    });
  } catch (error) {
    log.error("Runtime stale-inflight recovery failed", {
      operation: "recover_stale_inflight_run",
      chatJid,
      err: error,
    });
    return false;
  }

  if (replyState === "none" && inflightAge >= minAgeMs) {
    const draft = ctx.getDraftRecovery?.(inflight.chatJid) ?? null;
    if (draft?.text?.trim()) {
      persistRecoveredDraft(inflight.chatJid, inflight, ctx.assistantName, draft);
      ctx.clearDraftRecovery?.(inflight.chatJid);
      return true;
    }
    persistInterruptedTurnOutcome(inflight.chatJid, inflight, ctx.assistantName);
    ctx.clearDraftRecovery?.(inflight.chatJid);
    return true;
  }

  if (replyState === "partial" || replyState === "terminal") {
    ctx.clearDraftRecovery?.(inflight.chatJid);
    return true;
  }

  return false;
}

/** Recover interrupted runs left inflight after a restart. */
export function recoverInflightRuns(
  ctx: WebRecoveryContext,
  store: WebRecoveryStore = defaultStore
): void {
  const preflights = store.getPreflightRuns?.() ?? [];
  if (preflights.length > 0) {
    const now = typeof ctx.now === "function" ? ctx.now() : Date.now();
    const staleAgeMs = getStalePreflightAgeMs();
    const backoffUntil = new Date(now + getStalePreflightBackoffMs()).toISOString();
    const recoveredAt = new Date(now).toISOString();
    try {
      store.transaction(() => {
        for (const preflight of preflights) {
          const preflightAgeMs = getRunAgeMs(preflight.startedAt, now);
          if (preflightAgeMs >= staleAgeMs && store.quarantineStalePreflightRun) {
            const reason = `Stale preflight recovered after ${Math.round(preflightAgeMs / 1000)}s; skipping pending message to avoid startup compaction loop`;
            const recovered = store.quarantineStalePreflightRun(preflight, { createdAt: recoveredAt, reason, backoffUntil });
            if (recovered) {
              log.warn("Stale preflight exceeded recovery age; quarantined pending message", {
                operation: "recover_preflight_runs.quarantine_stale",
                chatJid: preflight.chatJid,
                messageId: preflight.messageId,
                startedAt: preflight.startedAt,
                preflightAgeSeconds: Math.round(preflightAgeMs / 1000),
                staleAgeSeconds: Math.round(staleAgeMs / 1000),
                failedTs: recovered.failedTs,
                backoffUntil,
              });
              continue;
            }
            log.warn("Stale preflight exceeded recovery age but message was unavailable; clearing marker only", {
              operation: "recover_preflight_runs.clear_missing_stale",
              chatJid: preflight.chatJid,
              messageId: preflight.messageId,
              startedAt: preflight.startedAt,
              preflightAgeSeconds: Math.round(preflightAgeMs / 1000),
            });
          } else {
            log.info("Preflight run never reached prompt execution; clearing marker", {
              operation: "recover_preflight_runs.clear_pending",
              chatJid: preflight.chatJid,
              startedAt: preflight.startedAt,
              preflightAgeSeconds: Math.round(preflightAgeMs / 1000),
            });
          }
          store.clearChatPreflight?.(preflight.chatJid);
        }
      });
    } catch (error) {
      log.error("Failed to clear preflight run markers; will retry on next startup", {
        operation: "recover_preflight_runs",
        err: error,
      });
      return;
    }
  }

  const now = typeof ctx.now === "function" ? ctx.now() : Date.now();
  const activeCompactions = store.getActiveChatCompactions?.() ?? [];
  if (activeCompactions.length > 0) {
    const staleAgeMs = getStaleActiveCompactionAgeMs();
    const backoffMs = getStaleActiveCompactionBackoffMs();
    const recoveredAt = new Date(now).toISOString();
    try {
      store.transaction(() => {
        for (const compaction of activeCompactions) {
          const compactionAgeMs = getRunAgeMs(compaction.startedAt, now);
          if (compactionAgeMs < staleAgeMs) {
            log.info("Active compaction marker recovered before stale age; clearing marker", {
              operation: "recover_active_compactions.clear_fresh",
              chatJid: compaction.chatJid,
              startedAt: compaction.startedAt,
              reason: compaction.reason,
              compactionAgeSeconds: Math.round(compactionAgeMs / 1000),
            });
            store.clearChatCompactionActive?.(compaction.chatJid);
            continue;
          }

          const previous = store.getChatCompactionBackoff?.(compaction.chatJid) ?? null;
          const failureCount = (previous?.failureCount ?? 0) + 1;
          const backoffUntil = new Date(now + backoffMs).toISOString();
          const detail = `Stale ${compaction.reason || "unknown"} compaction recovered after ${Math.round(compactionAgeMs / 1000)}s; clearing active turn and entering compaction backoff`;
          store.setChatCompactionBackoff?.(compaction.chatJid, {
            failureCount,
            lastFailedAt: recoveredAt,
            backoffUntil,
            lastErrorMessage: detail,
          });
          store.clearChatCompactionActive?.(compaction.chatJid);
          store.clearInflightMarker(compaction.chatJid);
          log.warn("Stale active compaction marker quarantined", {
            operation: "recover_active_compactions.quarantine_stale",
            chatJid: compaction.chatJid,
            startedAt: compaction.startedAt,
            reason: compaction.reason,
            compactionAgeSeconds: Math.round(compactionAgeMs / 1000),
            staleAgeSeconds: Math.round(staleAgeMs / 1000),
            failureCount,
            backoffUntil,
          });
        }
      });
    } catch (error) {
      log.error("Failed to recover active compaction markers; will retry on next startup", {
        operation: "recover_active_compactions",
        err: error,
      });
      return;
    }
  }

  const inflights = store.getInflightRuns();
  if (inflights.length === 0) return;

  const decisions = inflights.map((inflight) => ({
    inflight,
    replyState: store.getAgentReplyStateAfter(inflight.chatJid, inflight.startedAt),
  }));

  try {
    store.transaction(() => {
      for (const { inflight, replyState } of decisions) {
        // If assistant output was already persisted after this inflight start,
        // preserve it as committed history. Terminal output means the run fully
        // completed; partial output means the run was interrupted after already
        // publishing visible timeline content. In both cases, clearing the
        // inflight marker without rollback avoids replaying the same user turn.
        if (replyState === "terminal") {
          log.info("Inflight run already has a terminal reply; clearing marker", {
            operation: "recover_inflight_runs.clear_terminal",
            chatJid: inflight.chatJid,
            startedAt: inflight.startedAt,
          });
          store.clearInflightMarker(inflight.chatJid);
          continue;
        }

        if (replyState === "partial") {
          log.info("Inflight run already has partial output; clearing marker", {
            operation: "recover_inflight_runs.clear_partial",
            chatJid: inflight.chatJid,
            startedAt: inflight.startedAt,
          });
          store.clearInflightMarker(inflight.chatJid);
          continue;
        }

        const inflightAge = now - new Date(inflight.startedAt).getTime();
        log.info("Inflight run has no agent output yet; marking turn as interrupted", {
          operation: inflightAge > MAX_INFLIGHT_AGE_MS
            ? "recover_inflight_runs.clear_interrupted_stale"
            : "recover_inflight_runs.clear_interrupted_pending",
          chatJid: inflight.chatJid,
          startedAt: inflight.startedAt,
          inflightAgeSeconds: Math.round(inflightAge / 1000),
        });
        store.clearInflightMarker(inflight.chatJid);
      }
    });
  } catch (error) {
    log.error("Failed to roll back inflight runs; will retry on next startup", {
      operation: "recover_inflight_runs",
      err: error,
    });
    return;
  }

  for (const { inflight, replyState } of decisions) {
    if (replyState !== "none") {
      ctx.clearDraftRecovery?.(inflight.chatJid);
      continue;
    }

    const draft = ctx.getDraftRecovery?.(inflight.chatJid) ?? null;
    if (draft?.text?.trim()) {
      persistRecoveredDraft(inflight.chatJid, inflight, ctx.assistantName, draft);
      ctx.clearDraftRecovery?.(inflight.chatJid);
      continue;
    }

    persistInterruptedTurnOutcome(inflight.chatJid, inflight, ctx.assistantName);
    ctx.clearDraftRecovery?.(inflight.chatJid);
  }
}

/** Resume chats with pending messages after a restart. */
export function resumePendingChats(
  ctx: WebRecoveryContext,
  chatJid?: string,
  store: WebRecoveryStore = defaultStore
): void {
  const cursors = store.getAllChatCursors();
  const resolvedJids = chatJid && chatJid !== "all"
    ? [chatJid]
    : Array.from(new Set([...Object.keys(cursors), ...store.getKnownChatJids()]));

  for (const jid of resolvedJids) {
    const since = Object.prototype.hasOwnProperty.call(cursors, jid) ? cursors[jid] : "";
    const messages = store.getMessagesSince(jid, since, ctx.assistantName);
    const deferred = store.getDeferredQueuedFollowups(jid);
    const hasDeferredQueued = deferred.some((item) => typeof item.queuedContent === "string" && item.queuedContent.trim().length > 0);
    if (messages.length === 0 && !hasDeferredQueued) continue;
    // Use a stable per-chat key so repeated resume_pending triggers (for
    // example, reload IPC plus startup self-queued IPC) collapse to one queued
    // recovery task instead of duplicating the same chat turn.
    log.info("Queuing resume for pending chat", {
      operation: "resume_pending_chats.enqueue",
      chatJid: jid,
    });
    ctx.enqueue(async () => {
      if ((ctx.recoveryDelayMs ?? 0) > 0) {
        await (ctx.sleep ? ctx.sleep(ctx.recoveryDelayMs!) : Bun.sleep(ctx.recoveryDelayMs!));
      }
      await ctx.processChat(jid, ctx.defaultAgentId);
    }, `resume:${jid}`, recoveryLaneKey(jid));
  }
}
