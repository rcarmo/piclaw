import { admitSqliteWrite, type SyncSqliteOperation } from "../db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import { hasNativeRouting, assertNativeRootCreation } from "../db/native-routing-policy.js";
/**
 * agent-pool/branch-manager.ts – Admitted branch metadata and read-only inventory.
 * Native execution owns its contexts. Historical resident sessions are readable,
 * never hydrated, disposed or moved by branch metadata operations.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { getIdentityConfig } from "../core/config.js";
import {
  archiveChatBranch,
  ensureChatBranch,
  getChatBranchByAgentName,
  getChatBranchByChatJid,
  listChatBranches,
  renameChatBranchIdentity,
  storeChatMetadata,
  type ChatBranchRecord,
} from "../db.js";
import { SESSIONS_DIR } from "../core/config.js";
import { sanitiseJid } from "./session-paths.js";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { readAccessConfig } from "../core/config-access.js";
import { getDb, captureHostDatabaseBinding } from "../db/connection.js";
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
  isActive: (chatJid: string) => boolean;
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

/**
 * Offline maintenance retains the explicit artifact preview/apply helpers.
 */
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
    const { signal, authorise } = context, assertBinding = captureHostDatabaseBinding(database);
    const check = () => {
      assertBinding();
      authorise?.(); checkAction();
    };
    return admitSqliteWrite<T>(database, operation, check, signal, undefined, () => {
      if (getDb() !== database) throw new ChatAccessDenied();
      if (database.inTransaction) throw Error('Branch mutation requires an outermost transaction');
      check();
    });
  }

  async renameChatBranch(
    chatJid: string,
    options: BranchMutationContext & { agentName?: string | null } = {},
  ): Promise<ChatBranchRecord> {
    const database = getDb(), agentName = options.agentName;
    return this.admitMutation(database, () => {
      const owner = requireOwnedSessionExecution(chatJid);
      if (owner) {
        renameOwnedSessionHandle(database, owner, chatJid, agentName ?? "");
        return getChatBranchByChatJid(chatJid)!;
      }
      return renameChatBranchIdentity({ chat_jid: chatJid, agent_name: agentName });
    }, options, () => { requireOwnedSessionExecution(chatJid); });
  }

  async createRootChatSession(agentName: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    const database = getDb();
    return this.admitMutation(database, () => {
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
  }

  async pruneChatBranch(chatJid: string, context: BranchMutationContext = {}): Promise<ChatBranchRecord> {
    const database = getDb();
    return this.admitMutation(database, () => {
      if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
      const existing = getChatBranchByChatJid(chatJid);
      if (!existing) throw Error(`Unknown chat branch: ${chatJid}`);
      const isRootChat = existing.chat_jid === existing.root_chat_jid;
      if (isRootChat && existing.chat_jid === "web:default") {
        throw new Error("Cannot archive the default chat session.");
      }
      if (this.options.isActive(chatJid)) {
        throw new Error(isRootChat ? "Cannot archive a session while it is active." : "Cannot prune a branch while it is active.");
      }

      return archiveChatBranch(chatJid);
    }, context, () => { if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied(); });
  }

  listActiveChats(): ActiveChatAgent[] {
    if (readAccessConfig().mode !== "single-user") throw new ChatAccessDenied();
    const chats = [...this.options.pool.entries()]
      .flatMap(([chatJid, entry]): ActiveChatAgent[] => {
        const session = entry.runtime.session;
        const branch = getChatBranchByChatJid(chatJid) ?? createVolatileBranchRecord(chatJid, session);
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
      const branches = listChatBranches(rootChatJid || null, { includeArchived: Boolean(options?.includeArchived) });
      const stored = new Set(branches.map(branch => branch.chat_jid));
      const known: ActiveChatAgent[] = branches.map((branch) => {
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
        });
      return [...known, ...activeChats.filter(chat => !stored.has(chat.chat_jid)
        && (!rootChatJid || chat.root_chat_jid === rootChatJid))]
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
      return getChatBranchByChatJid(chatJid)?.agent_name
        ?? deriveAgentHandle(chatJid, this.options.pool.get(chatJid)?.runtime.session.sessionName);
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
