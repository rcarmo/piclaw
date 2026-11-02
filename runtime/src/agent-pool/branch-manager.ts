import { admitSqliteWrite, type SyncSqliteOperation } from "../db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import { hasNativeRouting, requireLegacyRoutingMutation, assertNativeRootCreation } from "../db/native-routing-policy.js";
/**
 * agent-pool/branch-manager.ts – Branch identity, listing, and fork lifecycle helpers.
 *
 * Keeps chat-branch registration and branch/session coordination out of the
 * top-level AgentPool coordinator while preserving the existing branch semantics.
 */

import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { getIdentityConfig } from "../core/config.js";
import {
  archiveChatBranch,
  ensureChatBranch,
  getChatBranchByAgentName,
  getChatBranchByChatJid,
  listChatBranches,
  mergeChatBranchIntoParent as mergeChatBranchIntoParentDb,
  permanentDeleteArchivedBranch,
  renameChatBranchIdentity,
  renameChatJid as renameChatJidDb,
  restoreChatBranchIdentity,
  storeChatMetadata,
  type ChatBranchRecord,
} from "../db.js";
import { SESSIONS_DIR } from "../core/config.js";
import { sanitiseJid } from "./session-paths.js";
import { existsSync, readdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { readAccessConfig } from "../core/config-access.js";
import { getDb } from "../db/connection.js";
import { commitOwnedFork, findOwnedFork } from "../db/owned-forks.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { requireOwnedSessionExecution } from "./owned-session-access.js";
import { renameOwnedSessionHandle } from "../db/session-handles.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
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
  context_tokens: number | null;
  context_window: number | null;
  context_percent: number | null;
  is_active: boolean;
  is_streaming: boolean;
  is_compacting: boolean;
  is_retrying: boolean;
  is_bash_running: boolean;
  activity_status: "idle" | "streaming" | "compacting" | "retrying" | "bash_running";
  activity_label: string;
  has_side_session: boolean;
}

/** Captured server request authority. Checks must be synchronous, read-only and repeatable. */
export interface BranchMutationContext {
  readonly signal?: AbortSignal;
  readonly authorise?: () => void;
}

/** Dependencies required for branch/session coordination. */
export interface AgentBranchManagerOptions {
  pool: Map<string, PoolEntry>;
  activeForkBaseLeafByChat: Map<string, string | null>;
  getOrCreateRuntime?: (chatJid: string) => Promise<AgentSessionRuntime>;
  isActive: (chatJid: string) => boolean;
  scheduleSessionWarmup?: (chatJid: string) => void;
  cancelSessionWarmup?: (chatJid: string) => void;
  hasPendingSessionWork?: (chatJid: string) => boolean;
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

function buildBranchVisualPrefix(sourceBranch: ChatBranchRecord, branches: ChatBranchRecord[]): string {
  const rootChatJid = sourceBranch.root_chat_jid || sourceBranch.chat_jid;
  const rootPrefix = rootChatJid.startsWith("web:") ? rootChatJid : `web:${rootChatJid}`;
  if (sourceBranch.chat_jid === rootChatJid) return rootPrefix;

  // Preserve already-readable JID paths. Renaming a session updates only
  // metadata, so descendants should append to the stable existing path rather
  // than rebuilding ancestor path segments from renamed handles.
  if (sourceBranch.chat_jid.startsWith(`${rootPrefix}:`) && !sourceBranch.chat_jid.includes(":branch:")) {
    return sourceBranch.chat_jid;
  }

  const byId = new Map(branches.map((branch) => [branch.branch_id, branch]));
  const segments: string[] = [];
  let cursor: ChatBranchRecord | null = sourceBranch;
  const seen = new Set<string>();

  while (cursor && cursor.chat_jid !== rootChatJid && !seen.has(cursor.branch_id)) {
    seen.add(cursor.branch_id);
    const handle = normalizeAgentHandlePart(cursor.agent_name || "");
    if (handle) segments.unshift(handle);
    cursor = cursor.parent_branch_id ? byId.get(cursor.parent_branch_id) ?? null : null;
  }

  if (segments.length === 0) {
    return sourceBranch.chat_jid.startsWith("web:") ? sourceBranch.chat_jid : `web:${sourceBranch.chat_jid}`;
  }

  return `${rootPrefix}:${segments.join(":")}`;
}

function buildForkedChatIdentity(sourceBranch: ChatBranchRecord, requestedAgentName: string, branches: ChatBranchRecord[]): { chatJid: string; agentName: string } {
  const base = normalizeAgentHandlePart(requestedAgentName) || "branch";
  const prefix = buildBranchVisualPrefix(sourceBranch, branches);
  const usedActiveHandles = new Set(
    branches
      .filter((branch) => !branch.archived_at)
      .map((branch) => normalizeAgentHandlePart(branch.agent_name || ""))
      .filter(Boolean),
  );
  const usedChatJids = new Set(branches.map((branch) => branch.chat_jid));

  let suffix = 0;
  for (;;) {
    const agentName = suffix === 0 ? base : `${base}-${suffix}`;
    const chatJid = `${prefix}:${agentName}`;
    if (!usedActiveHandles.has(agentName) && !usedChatJids.has(chatJid)) {
      return { chatJid, agentName };
    }
    suffix = suffix === 0 ? 2 : suffix + 1;
  }
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

function getSessionActivityStatus(session: AgentSession): ActiveChatAgent["activity_status"] {
  if (session.isCompacting) return "compacting";
  if (session.isRetrying) return "retrying";
  if (session.isBashRunning) return "bash_running";
  if (session.isStreaming) return "streaming";
  return "idle";
}

function getSessionActivityLabel(status: ActiveChatAgent["activity_status"]): string {
  switch (status) {
    case "compacting":
      return "Compacting";
    case "retrying":
      return "Retrying";
    case "bash_running":
      return "Running shell";
    case "streaming":
      return "Active";
    default:
      return "Idle";
  }
}

function isDescendantChatJid(parentChatJid: string, candidateChatJid: string): boolean {
  return candidateChatJid.startsWith(`${parentChatJid}:`);
}

function mapRenamedSessionArtifactEntry(entryName: string, oldChatJid: string, newChatJid: string): string | null {
  const oldSanitized = sanitiseJid(oldChatJid);
  const newSanitized = sanitiseJid(newChatJid);
  if (entryName === oldSanitized) return newSanitized;
  if (entryName.startsWith(`${oldSanitized}__`)) return `${newSanitized}${entryName.slice(oldSanitized.length)}`;

  const oldDescendantPrefix = `${oldSanitized}_`;
  if (!entryName.startsWith(oldDescendantPrefix)) return null;

  const descendantSuffix = entryName.slice(oldDescendantPrefix.length).replace(/_/g, ":");
  const descendantJid = `${oldChatJid}:${descendantSuffix}`;
  if (!isDescendantChatJid(oldChatJid, descendantJid)) return null;

  return `${newSanitized}_${entryName.slice(oldDescendantPrefix.length)}`;
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

  /** Lifecycle publication requires this admission to own the physical commit. */
  private admitMutation<T>(database: Database, operation: SyncSqliteOperation<T>,
    context: BranchMutationContext, checkAction: () => void): Promise<T> {
    const { signal, authorise } = context;
    const check = () => {
      if (getDb() !== database) throw new ChatAccessDenied();
      authorise?.(); checkAction();
    };
    return admitSqliteWrite<T>(database, operation, check, signal, undefined, () => {
      if (getDb() !== database) throw new ChatAccessDenied();
      if (database.inTransaction) throw Error('Branch mutation requires an outermost transaction');
      check();
    });
  }

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
    options: BranchMutationContext & { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    const session = this.options.pool.get(chatJid)?.runtime.session ?? null;
    const database = getDb(), agentName = options.agentName;
    const renamed = await this.admitMutation(database, () => {
      const owner = requireOwnedSessionExecution(chatJid);
      if (owner) {
        renameOwnedSessionHandle(database, owner, chatJid, agentName ?? "");
        return getChatBranchByChatJid(chatJid)!;
      }
      this.ensureBranchRegistration(chatJid, session);
      return renameChatBranchIdentity({ chat_jid: chatJid, agent_name: agentName });
    }, options, () => { requireOwnedSessionExecution(chatJid); });

    if (session && !hasNativeRouting(getDb())) {
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

    return renamed;
  }

  /**
   * Rename a chat's JID across DB and session directories.
   *
   * Commit the DB migration before disposing or evicting cached sessions,
   * then rename session directories on disk.
   */
  async renameChatJid(
    oldJid: string,
    newJid: string,
    context: BranchMutationContext = {},
  ): Promise<{ oldJid: string; newJid: string; branch: ChatBranchRecord }> {
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    const old = String(oldJid || "").trim();
    const next = String(newJid || "").trim();
    if (!old) throw new Error("Old JID is required.");
    if (!next) throw new Error("New JID is required.");
    if (old === next) throw new Error("Old and new JID are identical.");

    requireLegacyRoutingMutation(getDb(), "address rename");
    const activeChild = [...this.options.pool.keys()].some(jid => isDescendantChatJid(old, jid) && this.options.isActive(jid));
    if (this.options.isActive(old) || activeChild) {
      throw new Error("Cannot rename a chat while it has an active turn.");
    }

    const database = getDb();
    const { result, entries } = await this.admitMutation(database, () => ({
      result: renameChatJidDb(old, next),
      entries: [...this.options.pool].filter(([jid]) => jid === old || isDescendantChatJid(old, jid)),
    }), context, () => {
      if (readAccessConfig().mode !== 'single-user') throw new ChatAccessDenied();
      requireLegacyRoutingMutation(database, 'address rename');
      if (this.options.isActive(old) || [...this.options.pool.keys()].some(jid => isDescendantChatJid(old, jid) && this.options.isActive(jid)))
        throw Error('Cannot rename a chat while it has an active turn.');
    });
    // Entries were captured in SQL scope, before admission can yield after
    // commit. Do not adopt a replacement or clear its freshly published state.
    const mainEntry = entries.find(([jid]) => jid === old)?.[1];
    if (this.options.pool.get(old) === mainEntry) {
      this.options.activeForkBaseLeafByChat.delete(old);
      this.options.cancelSessionWarmup?.(old);
    }
    for (const [jid, entry] of entries) {
      try { await entry.runtime.dispose(); }
      catch (e) { debugSuppressedError(log, "best-effort dispose failed for renamed session", e, { jid }); }
      if (this.options.pool.get(jid) === entry) this.options.pool.delete(jid);
    }

    // Rename session directories only after the DB migration committed.
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
    // Rename child/variant session directories that derive from this chat JID.
    try {
      const { readdirSync } = await import("fs");
      for (const entry of readdirSync(SESSIONS_DIR)) {
        const mapped = mapRenamedSessionArtifactEntry(entry, old, next);
        if (!mapped || mapped === entry) continue;
        const src = join(SESSIONS_DIR, entry);
        const dst = join(SESSIONS_DIR, mapped);
        if (!existsSync(dst)) renameSync(src, dst);
      }
    } catch (e) { debugSuppressedError(log, "best-effort child branch directory rename failed", e, { old, next }); }

    return result;
  }

  async createRootChatSession(agentName: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    const database = getDb();
    const branch = await this.admitMutation(database, () => {
      const native = hasNativeRouting(database);
      if (native) assertNativeRootCreation(database);
      if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
      const normalized = normalizeAgentHandlePart(agentName || "");
      if (!normalized) throw new Error("Root session handle must contain at least one letter or number.");
      if (normalized === "branch") throw new Error("Root session handle cannot be 'branch'.");
      const chatJid = `web:${normalized}`;
      if (getChatBranchByChatJid(chatJid)) throw new Error(`Root session already exists: ${chatJid}`);
      const byHandle = getChatBranchByAgentName(normalized);
      if (byHandle && !byHandle.archived_at) throw new Error(`Session handle already exists: @${normalized}`);
      storeChatMetadata(chatJid, new Date().toISOString(), normalized);
      return ensureChatBranch({chat_jid:chatJid, root_chat_jid:chatJid, parent_branch_id:null, agent_name:normalized});
    }, context, () => { if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied(); });
    if (!hasNativeRouting(database)) this.options.scheduleSessionWarmup?.(branch.chat_jid);
    return branch;
  }

  async mergeChatBranchIntoParent(
    chatJid: string,
    context: BranchMutationContext = {},
  ): Promise<ReturnType<typeof mergeChatBranchIntoParentDb>> {
    requireLegacyRoutingMutation(getDb(), "legacy merge");
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) throw new Error("chat_jid is required");
    if (this.options.isActive(normalizedChatJid)) {
      throw new Error("Cannot merge a chat branch while it has an active turn.");
    }

    const database = getDb();
    const { result, mainEntry } = await this.admitMutation(database, () => ({
      result: mergeChatBranchIntoParentDb(normalizedChatJid),
      mainEntry: this.options.pool.get(normalizedChatJid),
    }), context, () => {
      if (readAccessConfig().mode !== 'single-user') throw new ChatAccessDenied();
      requireLegacyRoutingMutation(database, 'legacy merge');
      if (this.options.isActive(normalizedChatJid)) throw Error('Cannot merge a chat branch while it has an active turn.');
    });
    if (this.options.pool.get(normalizedChatJid) === mainEntry) {
      this.options.activeForkBaseLeafByChat.delete(normalizedChatJid);
      this.options.cancelSessionWarmup?.(normalizedChatJid);
    }
    if (mainEntry) {
      try { await mainEntry.runtime.dispose(); } catch (e) { debugSuppressedError(log, "best-effort dispose failed for merged session", e, { jid: normalizedChatJid }); }
      if (this.options.pool.get(normalizedChatJid) === mainEntry) this.options.pool.delete(normalizedChatJid);
    }
    try {
      removeSessionArtifacts(normalizedChatJid);
    } catch (err) {
      this.options.onWarn?.("Failed to remove merged session artifacts", {
        operation: "merge_chat_branch.remove_session_artifacts",
        chatJid: normalizedChatJid,
        err,
      });
    }
    return result;
  }

  async pruneChatBranch(chatJid: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    const database = getDb();
    const { archived, mainEntry } = await this.admitMutation(database, () => {
      if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
      const session = this.options.pool.get(chatJid)?.runtime.session ?? null;
      const existing = this.ensureBranchRegistration(chatJid, session);
      const isRootChat = existing.chat_jid === existing.root_chat_jid;
      if (isRootChat && existing.chat_jid === "web:default") {
        throw new Error("Cannot archive the default chat session.");
      }
      if (this.options.isActive(chatJid)) {
        throw new Error(isRootChat ? "Cannot archive a session while it is active." : "Cannot prune a branch while it is active.");
      }

      return { archived: archiveChatBranch(chatJid), mainEntry: this.options.pool.get(chatJid) };
    }, context, () => { if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied(); });
    if (this.options.pool.get(chatJid) === mainEntry) {
      this.options.activeForkBaseLeafByChat.delete(chatJid);
      // Cancel prewarm only for the generation captured before commit.
      this.options.cancelSessionWarmup?.(chatJid);
    }
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
      if (this.options.pool.get(chatJid) === mainEntry) this.options.pool.delete(chatJid);
    }
    // Keep .branch-seed.json here: it is the only persisted copy of the
    // forked context until the session is realized,
    // and a subsequent restoreChatBranch() must be able to pick it back up.

    return archived;
  }

  async permanentPurgeChatBranch(
    chatJid: string,
    context: BranchMutationContext = {},
  ): Promise<{ branch: ChatBranchRecord; removedSessionArtifacts: string[] }> {
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    requireLegacyRoutingMutation(getDb(), "legacy purge");
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) throw new Error("chat_jid is required");
    if (this.options.isActive(normalizedChatJid)) {
      throw new Error("Cannot permanently delete a branch while it is active.");
    }

    const branch = getChatBranchByChatJid(normalizedChatJid);
    if (!branch) {
      throw new Error(`Unknown chat branch: ${normalizedChatJid}`);
    }

    const database = getDb();
    const { result, mainEntry } = await this.admitMutation(database, () => ({
      result: permanentDeleteArchivedBranch(normalizedChatJid),
      mainEntry: this.options.pool.get(normalizedChatJid),
    }), context, () => {
      if (readAccessConfig().mode !== 'single-user') throw new ChatAccessDenied();
      requireLegacyRoutingMutation(database, 'legacy purge');
      if (this.options.isActive(normalizedChatJid)) throw Error('Cannot permanently delete a branch while it is active.');
    });
    if (this.options.pool.get(normalizedChatJid) === mainEntry) {
      this.options.activeForkBaseLeafByChat.delete(normalizedChatJid);
      this.options.cancelSessionWarmup?.(normalizedChatJid);
    }
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
      if (this.options.pool.get(normalizedChatJid) === mainEntry) this.options.pool.delete(normalizedChatJid);
    }

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
    options: BranchMutationContext & { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    const database = getDb(), agentName = options.agentName;
    const restored = await this.admitMutation(database, () => restoreChatBranchIdentity({
      chat_jid: chatJid,
      ...(agentName !== undefined ? { agent_name: agentName } : {}),
    }), options, () => {
      if (readAccessConfig().mode !== 'single-user') throw new ChatAccessDenied();
      requireLegacyRoutingMutation(database, 'legacy restore');
    });

    try {
      if (!this.options.getOrCreateRuntime) throw Error("Native session restoration does not construct legacy sessions");
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
    options: { agentName?: string | null; requestId?: string } = {},
  ): Promise<ChatBranchRecord> {
    requireLegacyRoutingMutation(getDb(), "legacy child fork");
    const owner = requireOwnedSessionExecution(sourceChatJid);
    if (owner) {
      const existing = findOwnedFork(getDb(), owner, sourceChatJid, options.requestId ?? "");
      if (existing) return { ...existing, display_name: null };
    }
    if (!this.options.getOrCreateRuntime) throw Error("Native branch fork does not construct legacy sessions");
    const sourceSession = (await this.options.getOrCreateRuntime(sourceChatJid)).session;
    const sourceIsActive = isSessionActive(sourceSession);
    const stableForkLeafId = this.options.activeForkBaseLeafByChat.has(sourceChatJid)
      ? this.options.activeForkBaseLeafByChat.get(sourceChatJid) ?? null
      : null;
    if (sourceIsActive && !this.options.activeForkBaseLeafByChat.has(sourceChatJid)) {
      throw new Error("Cannot fork this branch yet because no stable turn boundary is available.");
    }

    const sourceBranch = this.ensureBranchRegistration(sourceChatJid, sourceSession);
    const requestedAgentName = typeof options.agentName === "string" && options.agentName.trim()
      ? options.agentName.trim()
      : sourceBranch.agent_name;
    const { createDeferredBranchSeed, writeDeferredBranchSeed } = await import("./branch-seeding.js");
    if (owner) {
      const seed = await createDeferredBranchSeed(sourceSession, {
        stableLeafId: stableForkLeafId, sessionName: requestedAgentName, sourceIsActive,
      });
      const current = requireOwnedSessionExecution(sourceChatJid);
      if (!current) throw new ChatAccessDenied();
      const child = commitOwnedFork(getDb(), current, sourceChatJid, options.requestId ?? "", requestedAgentName, JSON.stringify(seed));
      // No eager warmup: the eventual caller must carry its own live execution identity.
      return { ...child, display_name: null };
    }
    const knownBranches = listChatBranches(null, { includeArchived: true });
    const { chatJid: nextChatJid, agentName: nextAgentName } = buildForkedChatIdentity(sourceBranch, requestedAgentName, knownBranches);
    storeChatMetadata(nextChatJid, new Date().toISOString(), nextAgentName || nextChatJid);
    const nextBranch = ensureChatBranch({
      chat_jid: nextChatJid,
      root_chat_jid: sourceBranch.root_chat_jid || sourceBranch.chat_jid,
      parent_branch_id: sourceBranch.branch_id,
      agent_name: nextAgentName,
    });

    writeDeferredBranchSeed(nextChatJid, await createDeferredBranchSeed(sourceSession, {
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
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    const chats = [...this.options.pool.entries()]
      .flatMap(([chatJid, entry]): ActiveChatAgent[] => {
        const session = entry.runtime.session;
        const branch = this.ensureBranchRegistration(chatJid, session);
        if (branch.archived_at) return [];
        const activityStatus = getSessionActivityStatus(session);
        const contextUsage = session.getContextUsage?.() ?? null;
        const contextTokens = typeof contextUsage?.tokens === "number" && Number.isFinite(contextUsage.tokens) && contextUsage.tokens >= 0
          ? contextUsage.tokens
          : null;
        const contextWindow = typeof contextUsage?.contextWindow === "number" && Number.isFinite(contextUsage.contextWindow) && contextUsage.contextWindow > 0
          ? contextUsage.contextWindow
          : null;
        const contextPercent = typeof contextUsage?.percent === "number" && Number.isFinite(contextUsage.percent)
          ? Math.max(0, Math.min(100, contextUsage.percent))
          : contextTokens !== null && contextWindow !== null
            ? Math.max(0, Math.min(100, (contextTokens / contextWindow) * 100))
            : null;
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
          context_tokens: contextTokens,
          context_window: contextWindow,
          context_percent: contextPercent,
          is_active: activityStatus !== "idle",
          is_streaming: Boolean(session.isStreaming),
          is_compacting: Boolean(session.isCompacting),
          is_retrying: Boolean(session.isRetrying),
          is_bash_running: Boolean(session.isBashRunning),
          activity_status: activityStatus,
          activity_label: getSessionActivityLabel(activityStatus),
          has_side_session: false,
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
            context_tokens: active?.context_tokens ?? null,
            context_window: active?.context_window ?? null,
            context_percent: active?.context_percent ?? null,
            is_active: active?.is_active ?? false,
            is_streaming: active?.is_streaming ?? false,
            is_compacting: active?.is_compacting ?? false,
            is_retrying: active?.is_retrying ?? false,
            is_bash_running: active?.is_bash_running ?? false,
            activity_status: active?.activity_status ?? "idle",
            activity_label: active?.activity_label ?? "Idle",
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
    if (readAccessConfig().mode !== "single-user") {
      const target = this.findChatByAgentName(agentName);
      return target ? this.listActiveChats().find(chat => chat.chat_jid === target.chat_jid) ?? null : null;
    }
    const normalized = normalizeAgentHandlePart(agentName);
    if (!normalized) return null;
    return this.listActiveChats().find((chat) => chat.agent_name === normalized) ?? null;
  }

  findChatByAgentName(agentName: string): { chat_jid: string; agent_name: string } | null {
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
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
    const mode = readAccessConfig().mode;
    const identity = getExecutionIdentity();
    if (mode !== "single-user" || (identity && identity.mode !== "single-user")) throw new ChatAccessDenied();
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
