/**
 * agent-pool/branch-manager.ts – Branch identity, listing, and fork lifecycle helpers.
 *
 * Keeps chat-branch registration and branch/session coordination out of the
 * top-level AgentPool coordinator while preserving the existing branch semantics.
 */

import type { AgentSession, AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

import { getIdentityConfig } from "../core/config.js";
import {
  archiveChatBranch,
  ensureChatBranch,
  getChatBranchByAgentName,
  getChatBranchByChatJid,
  listChatBranches,
  permanentDeleteArchivedBranch,
  renameChatBranchIdentity,
  renameChatJid as renameChatJidDb,
  restoreChatBranchIdentity,
  storeChatMetadata,
  type ChatBranchRecord,
} from "../db.js";
import { SESSIONS_DIR } from "../core/config.js";
import { sanitiseJid } from "./session.js";
import { existsSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { createUuid } from "../utils/ids.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { createDeferredBranchSeed, writeDeferredBranchSeed } from "./branch-seeding.js";
import type { PoolEntry } from "./session-manager.js";

/** Active/known chat metadata surfaced by AgentPool. */
export interface ActiveChatAgent {
  branch_id: string | null;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id: string | null;
  agent_name: string;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  session_id: string | null;
  session_name: string | null;
  model: string | null;
  is_active: boolean;
  has_side_session: boolean;
}

/** Dependencies required for branch/session coordination. */
export interface AgentBranchManagerOptions {
  pool: Map<string, PoolEntry>;
  sidePool: Map<string, PoolEntry>;
  activeForkBaseLeafByChat: Map<string, string | null>;
  getOrCreateRuntime: (chatJid: string) => Promise<AgentSessionRuntime>;
  refreshRuntime: (chatJid: string, runtime: AgentSessionRuntime) => Promise<void>;
  isActive: (chatJid: string) => boolean;
  scheduleSessionWarmup?: (chatJid: string) => void;
  cancelSessionWarmup?: (chatJid: string) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
}

function normalizeAgentHandlePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function deriveAgentHandle(chatJid: string, sessionName?: string | null): string {
  const sessionHandle = sessionName ? normalizeAgentHandlePart(sessionName) : "";
  if (sessionHandle) return sessionHandle;

  const jidTail = chatJid.split(/[:/]/).filter(Boolean).pop() || chatJid;
  if (jidTail === "default") {
    const configHandle = normalizeAgentHandlePart(getIdentityConfig().assistantName || "");
    if (configHandle) return configHandle;
  }

  const jidHandle = normalizeAgentHandlePart(jidTail);
  if (jidHandle) return jidHandle;

  return "agent";
}

function buildForkedChatJid(sourceChatJid: string): string {
  const root = sourceChatJid.startsWith("web:") ? sourceChatJid : `web:${sourceChatJid}`;
  return `${root}:branch:${createUuid("chat").split("-").pop()}`;
}

function createVolatileBranchRecord(chatJid: string, session?: AgentSession | null): ChatBranchRecord {
  return {
    branch_id: `volatile:${chatJid}`,
    chat_jid: chatJid,
    root_chat_jid: chatJid,
    parent_branch_id: null,
    agent_name: deriveAgentHandle(chatJid, session?.sessionName?.trim() || null),
    display_name: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    archived_at: null,
  };
}

function isSessionActive(session: AgentSession): boolean {
  return Boolean(session.isStreaming || session.isCompacting || session.isRetrying || session.isBashRunning);
}

/**
 * Coordinates chat-branch registration, branch lookup, and fork/prune behavior.
 */
const log = createLogger("agent-pool.branch-manager");

export function listSessionArtifactPaths(chatJid: string): string[] {
  const sanitizedChatJid = sanitiseJid(chatJid);
  const directPaths = [join(SESSIONS_DIR, sanitizedChatJid)];
  if (!existsSync(SESSIONS_DIR)) return directPaths;

  const variantPrefix = `${sanitizedChatJid}__`;
  const variantPaths = readdirSync(SESSIONS_DIR)
    .filter((entry) => entry.startsWith(variantPrefix))
    .map((entry) => join(SESSIONS_DIR, entry));

  return [...new Set([...directPaths, ...variantPaths])];
}

export function removeSessionArtifacts(chatJid: string): string[] {
  const removed: string[] = [];
  for (const path of listSessionArtifactPaths(chatJid)) {
    if (!existsSync(path)) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}

export class AgentBranchManager {
  constructor(private readonly options: AgentBranchManagerOptions) {}

  ensureBranchRegistration(chatJid: string, session?: AgentSession | null): ChatBranchRecord {
    try {
      const existing = getChatBranchByChatJid(chatJid);
      if (existing) return existing;
      const created = ensureChatBranch({
        chat_jid: chatJid,
        agent_name: deriveAgentHandle(chatJid, session?.sessionName?.trim() || null),
      });
      storeChatMetadata(chatJid, new Date().toISOString(), created.agent_name || chatJid);
      return created;
    } catch (err) {
      this.options.onWarn?.("Falling back to volatile branch record", {
        operation: "ensure_branch_registration",
        chatJid,
        err,
      });
      return createVolatileBranchRecord(chatJid, session);
    }
  }

  async renameChatBranch(
    chatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    const session = this.options.pool.get(chatJid)?.runtime.session ?? null;
    this.ensureBranchRegistration(chatJid, session);
    const nextAgentName = options.agentName !== undefined ? options.agentName : undefined;
    const renamed = renameChatBranchIdentity({
      chat_jid: chatJid,
      agent_name: nextAgentName,
    });

    if (session) {
      try {
        session.setSessionName(renamed.agent_name);
      } catch (err) {
        this.options.onWarn?.("Failed to sync renamed branch session name", {
          operation: "rename_chat_branch.sync_session_name",
          chatJid,
          err,
        });
      }
    }

    // Auto-rename the JID to web:<agent_name> so @-mentions work naturally.
    const desiredJid = `web:${renamed.agent_name}`;
    if (renamed.chat_jid !== desiredJid) {
      try {
        const jidResult = await this.renameChatJid(renamed.chat_jid, desiredJid);
        return jidResult.branch;
      } catch (err) {
        this.options.onWarn?.("JID auto-rename after agent rename failed; agent_name updated but JID unchanged", {
          operation: "rename_chat_branch.auto_rename_jid",
          chatJid: renamed.chat_jid,
          desiredJid,
          err,
        });
      }
    }

    return renamed;
  }

  /**
   * Rename a chat's JID across DB and session directories.
   *
   * The session is evicted from the in-memory pool first, then the DB is
   * migrated in a single transaction, and finally session directories are
   * renamed on disk.
   */
  async renameChatJid(
    oldJid: string,
    newJid: string,
  ): Promise<{ oldJid: string; newJid: string; branch: ChatBranchRecord }> {
    const old = String(oldJid || "").trim();
    const next = String(newJid || "").trim();
    if (!old) throw new Error("Old JID is required.");
    if (!next) throw new Error("New JID is required.");
    if (old === next) throw new Error("Old and new JID are identical.");

    if (this.options.isActive(old)) {
      throw new Error("Cannot rename a chat while it has an active turn.");
    }

    // 1. Evict from in-memory pools.
    const mainEntry = this.options.pool.get(old);
    if (mainEntry) {
    try { await mainEntry.runtime.dispose(); } catch (e) { log.debug("best-effort dispose failed for main session", { jid: old, err: e }); }
      this.options.pool.delete(old);
    }
    const sideEntry = this.options.sidePool.get(old);
    if (sideEntry) {
      try { await sideEntry.runtime.dispose(); } catch (e) { debugSuppressedError(log, "best-effort dispose failed for side session", e, { jid: old }); }
      this.options.sidePool.delete(old);
    }
    this.options.activeForkBaseLeafByChat.delete(old);
    this.options.cancelSessionWarmup?.(old);

    // Also evict any child branches that live under old + ":branch:".
    const childPrefix = old + ":branch:";
    for (const [jid, entry] of this.options.pool) {
      if (jid.startsWith(childPrefix)) {
        try { await entry.runtime.dispose(); } catch (e) { debugSuppressedError(log, "best-effort dispose failed for child pool session", e, { jid }); }
        this.options.pool.delete(jid);
      }
    }
    for (const [jid, entry] of this.options.sidePool) {
      if (jid.startsWith(childPrefix)) {
        try { await entry.runtime.dispose(); } catch (e) { debugSuppressedError(log, "best-effort dispose failed for child side-pool session", e, { jid }); }
        this.options.sidePool.delete(jid);
      }
    }

    // 2. Migrate all DB tables in a single transaction.
    const result = renameChatJidDb(old, next);

    // 3. Rename session directories on disk.
    const oldDir = join(SESSIONS_DIR, sanitiseJid(old));
    const newDir = join(SESSIONS_DIR, sanitiseJid(next));
    if (existsSync(oldDir) && !existsSync(newDir)) {
      renameSync(oldDir, newDir);
    }
    // Rename the btw-side directory if it exists.
    const oldSideDir = oldDir + "__btw-side";
    const newSideDir = newDir + "__btw-side";
    if (existsSync(oldSideDir) && !existsSync(newSideDir)) {
      renameSync(oldSideDir, newSideDir);
    }
    // Rename child branch session directories.
    const oldDirPrefix = sanitiseJid(old) + "_branch_";
    const newDirPrefix = sanitiseJid(next) + "_branch_";
    try {
      const { readdirSync } = await import("fs");
      for (const entry of readdirSync(SESSIONS_DIR)) {
        if (entry.startsWith(oldDirPrefix)) {
          const suffix = entry.slice(oldDirPrefix.length);
          const src = join(SESSIONS_DIR, entry);
          const dst = join(SESSIONS_DIR, newDirPrefix + suffix);
          if (!existsSync(dst)) renameSync(src, dst);
        }
      }
    } catch (e) { debugSuppressedError(log, "best-effort child branch directory rename failed", e, { old, next }); }

    return result;
  }

  async pruneChatBranch(chatJid: string): Promise<ChatBranchRecord> {
    const session = this.options.pool.get(chatJid)?.runtime.session ?? null;
    const existing = this.ensureBranchRegistration(chatJid, session);
    const isRootChat = existing.chat_jid === existing.root_chat_jid;
    if (isRootChat && existing.chat_jid === "web:default") {
      throw new Error("Cannot archive the default chat session.");
    }
    if (this.options.isActive(chatJid)) {
      throw new Error(isRootChat ? "Cannot archive a session while it is active." : "Cannot prune a branch while it is active.");
    }

    const archived = archiveChatBranch(chatJid);
    const mainEntry = this.options.pool.get(chatJid);
    if (mainEntry) {
      try {
        await mainEntry.runtime.dispose();
      } catch (err) {
        this.options.onWarn?.("Failed to dispose pruned session", {
          operation: "prune_chat_branch.dispose_main",
          chatJid,
          err,
        });
      }
      this.options.pool.delete(chatJid);
    }
    const sideEntry = this.options.sidePool.get(chatJid);
    if (sideEntry) {
      try {
        await sideEntry.runtime.dispose();
      } catch (err) {
        this.options.onWarn?.("Failed to dispose pruned side session", {
          operation: "prune_chat_branch.dispose_side",
          chatJid,
          err,
        });
      }
      this.options.sidePool.delete(chatJid);
    }
    this.options.activeForkBaseLeafByChat.delete(chatJid);
    // Cancel any queued prewarm so a background realization does not
    // materialize a blank runtime (or realize the deferred seed) for an
    // archived chat between prune and restore.
    this.options.cancelSessionWarmup?.(chatJid);
    // NOTE: do not clearDeferredBranchSeed here — .branch-seed.json is the
    // only persisted copy of the forked context until the session is realized,
    // and a subsequent restoreChatBranch() must be able to pick it back up.

    return archived;
  }

  async permanentPurgeChatBranch(
    chatJid: string,
  ): Promise<{ branch: ChatBranchRecord; removedSessionArtifacts: string[] }> {
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) throw new Error("chat_jid is required");
    if (this.options.isActive(normalizedChatJid)) {
      throw new Error("Cannot permanently delete a branch while it is active.");
    }

    const branch = getChatBranchByChatJid(normalizedChatJid);
    if (!branch) {
      throw new Error(`Unknown chat branch: ${normalizedChatJid}`);
    }

    const mainEntry = this.options.pool.get(normalizedChatJid);
    if (mainEntry) {
      try {
        await mainEntry.runtime.dispose();
      } catch (err) {
        this.options.onWarn?.("Failed to dispose purged session", {
          operation: "purge_chat_branch.dispose_main",
          chatJid: normalizedChatJid,
          err,
        });
      }
      this.options.pool.delete(normalizedChatJid);
    }
    const sideEntry = this.options.sidePool.get(normalizedChatJid);
    if (sideEntry) {
      try {
        await sideEntry.runtime.dispose();
      } catch (err) {
        this.options.onWarn?.("Failed to dispose purged side session", {
          operation: "purge_chat_branch.dispose_side",
          chatJid: normalizedChatJid,
          err,
        });
      }
      this.options.sidePool.delete(normalizedChatJid);
    }

    this.options.activeForkBaseLeafByChat.delete(normalizedChatJid);
    this.options.cancelSessionWarmup?.(normalizedChatJid);
    const result = permanentDeleteArchivedBranch(normalizedChatJid);

    let removedSessionArtifacts: string[] = [];
    try {
      removedSessionArtifacts = removeSessionArtifacts(normalizedChatJid);
    } catch (err) {
      this.options.onWarn?.("Failed to remove purged session artifacts", {
        operation: "purge_chat_branch.remove_session_artifacts",
        chatJid: normalizedChatJid,
        err,
      });
    }

    return {
      branch: result.branch,
      removedSessionArtifacts,
    };
  }

  async restoreChatBranch(
    chatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    const restored = restoreChatBranchIdentity({
      chat_jid: chatJid,
      ...(options.agentName !== undefined ? { agent_name: options.agentName } : {}),
    });

    try {
      await this.options.getOrCreateRuntime(chatJid);
    } catch (err) {
      this.options.onWarn?.("Restored branch but failed to warm its session", {
        operation: "restore_chat_branch.warm_session",
        chatJid,
        err,
      });
    }

    return restored;
  }

  async createForkedChatBranch(
    sourceChatJid: string,
    options: { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    const sourceSession = (await this.options.getOrCreateRuntime(sourceChatJid)).session;
    const sourceIsActive = isSessionActive(sourceSession);
    const stableForkLeafId = this.options.activeForkBaseLeafByChat.has(sourceChatJid)
      ? this.options.activeForkBaseLeafByChat.get(sourceChatJid) ?? null
      : null;
    if (sourceIsActive && !this.options.activeForkBaseLeafByChat.has(sourceChatJid)) {
      throw new Error("Cannot fork this branch yet because no stable turn boundary is available.");
    }

    const sourceBranch = this.ensureBranchRegistration(sourceChatJid, sourceSession);
    const nextChatJid = buildForkedChatJid(sourceChatJid);
    const requestedAgentName = typeof options.agentName === "string" && options.agentName.trim()
      ? options.agentName.trim()
      : sourceBranch.agent_name;
    storeChatMetadata(nextChatJid, new Date().toISOString(), requestedAgentName || nextChatJid);
    const nextBranch = ensureChatBranch({
      chat_jid: nextChatJid,
      root_chat_jid: sourceBranch.root_chat_jid || sourceBranch.chat_jid,
      parent_branch_id: sourceBranch.branch_id,
      agent_name: requestedAgentName,
    });

    writeDeferredBranchSeed(nextChatJid, createDeferredBranchSeed(sourceSession, {
      stableLeafId: stableForkLeafId,
      sessionName: nextBranch.agent_name,
      sourceIsActive,
    }));
    this.options.scheduleSessionWarmup?.(nextChatJid);

    return ensureChatBranch({
      chat_jid: nextChatJid,
      root_chat_jid: nextBranch.root_chat_jid,
      parent_branch_id: nextBranch.parent_branch_id,
      agent_name: nextBranch.agent_name,
    });
  }

  listActiveChats(): ActiveChatAgent[] {
    const chats = [...this.options.pool.entries()]
      .flatMap(([chatJid, entry]): ActiveChatAgent[] => {
        const session = entry.runtime.session;
        const branch = this.ensureBranchRegistration(chatJid, session);
        if (branch.archived_at) return [];
        return [{
          branch_id: branch.branch_id,
          chat_jid: chatJid,
          root_chat_jid: branch.root_chat_jid,
          parent_branch_id: branch.parent_branch_id,
          agent_name: branch.agent_name,
          created_at: branch.created_at ?? null,
          updated_at: branch.updated_at ?? null,
          archived_at: branch.archived_at ?? null,
          session_id: session.sessionId,
          session_name: session.sessionName?.trim() || null,
          model: session.model ? `${session.model.provider}/${session.model.id}` : null,
          is_active: isSessionActive(session),
          has_side_session: this.options.sidePool.has(chatJid),
        }];
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.chat_jid.localeCompare(b.chat_jid);
      });

    return chats;
  }

  listKnownChats(rootChatJid?: string | null, options?: { includeArchived?: boolean }): ActiveChatAgent[] {
    const activeChats = this.listActiveChats();
    const activeByChat = new Map(activeChats.map((chat) => [chat.chat_jid, chat]));
    try {
      return listChatBranches(rootChatJid || null, { includeArchived: Boolean(options?.includeArchived) })
        .map((branch) => {
          const active = activeByChat.get(branch.chat_jid);
          return {
            branch_id: branch.branch_id,
            chat_jid: branch.chat_jid,
            root_chat_jid: branch.root_chat_jid,
            parent_branch_id: branch.parent_branch_id,
            agent_name: branch.agent_name,
            created_at: branch.created_at ?? null,
            updated_at: branch.updated_at ?? null,
            archived_at: branch.archived_at ?? null,
            session_id: active?.session_id ?? null,
            session_name: active?.session_name ?? null,
            model: active?.model ?? null,
            is_active: active?.is_active ?? false,
            has_side_session: active?.has_side_session ?? false,
          } satisfies ActiveChatAgent;
        })
        .sort((a, b) => {
          if (a.chat_jid === rootChatJid && b.chat_jid !== rootChatJid) return -1;
          if (b.chat_jid === rootChatJid && a.chat_jid !== rootChatJid) return 1;
          if (Boolean(a.archived_at) !== Boolean(b.archived_at)) return a.archived_at ? 1 : -1;
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
          return a.chat_jid.localeCompare(b.chat_jid);
        });
    } catch (err) {
      this.options.onWarn?.("Failed to list known chats; falling back to active sessions only", {
        operation: "list_known_chats",
        rootChatJid: rootChatJid || null,
        err,
      });
      return activeChats;
    }
  }

  findActiveChatByAgentName(agentName: string): ActiveChatAgent | null {
    const normalized = normalizeAgentHandlePart(agentName);
    if (!normalized) return null;
    return this.listActiveChats().find((chat) => chat.agent_name === normalized) ?? null;
  }

  findChatByAgentName(agentName: string): { chat_jid: string; agent_name: string } | null {
    const normalized = normalizeAgentHandlePart(agentName);
    if (!normalized) return null;
    try {
      const branch = getChatBranchByAgentName(normalized);
      if (branch) return { chat_jid: branch.chat_jid, agent_name: branch.agent_name };
    } catch (err) {
      this.options.onWarn?.("Failed to look up agent handle; falling back to active sessions", {
        operation: "find_chat_by_agent_name",
        agentHandle: normalized,
        err,
      });
    }
    const active = this.listActiveChats().find((chat) => chat.agent_name === normalized) ?? null;
    return active ? { chat_jid: active.chat_jid, agent_name: active.agent_name } : null;
  }

  getAgentHandleForChat(chatJid: string): string {
    try {
      return getChatBranchByChatJid(chatJid)?.agent_name ?? deriveAgentHandle(chatJid);
    } catch (err) {
      this.options.onWarn?.("Failed to read stored handle; deriving one from chat id instead", {
        operation: "get_agent_handle_for_chat",
        chatJid,
        err,
      });
      return deriveAgentHandle(chatJid);
    }
  }
}
