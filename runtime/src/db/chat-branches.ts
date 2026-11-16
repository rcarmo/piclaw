import { hasNativeRouting, requireLegacyRoutingMutation, assertNativeBranchPolicyIdle } from "./native-routing-policy.js";
/**
 * db/chat-branches.ts – Explicit branch/session registry for web chat branches.
 *
 * branch_id is the stable host identity; agent_name is a mutable friendly handle.
 * Native conversation/session routing belongs to the immutable SDK manifest.
 * Historical display_name data stays inert; native metadata never converts it.
 */

import { getDb } from "./connection.js";
import { canonicalScheduledTasksSql, readCanonicalScheduledTask } from "./scheduled-task-definitions.js";
import { ChatAccessDenied } from "./session-ownership.js";
import type { ChatBranchRecord } from "./types.js";
import { createUuid } from "../utils/ids.js";

interface ChatBranchRow {
  branch_id: string;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id: string | null;
  agent_name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function toRecord(row: ChatBranchRow | null | undefined): ChatBranchRecord | null {
  if (!row) return null;
  return {
    branch_id: row.branch_id,
    chat_jid: row.chat_jid,
    root_chat_jid: row.root_chat_jid,
    parent_branch_id: row.parent_branch_id,
    agent_name: row.agent_name,
    display_name: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

export function normalizeBranchAgentName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function deriveBaseAgentName(chatJid: string): string {
  const fromTail = normalizeBranchAgentName(chatJid.split(/[:/]/).filter(Boolean).pop() || chatJid);
  if (fromTail) return fromTail;
  return "agent";
}

function getUniqueAgentName(baseName: string, excludeBranchId?: string | null): string {
  const normalizedBase = normalizeBranchAgentName(baseName) || "agent";
  const db = getDb();

  const row = db.prepare(
    `SELECT agent_name, branch_id
       FROM chat_branches
      WHERE archived_at IS NULL AND handle_owner_id = ''
        AND (agent_name = ? OR agent_name GLOB ?)
      ORDER BY agent_name ASC`
  ).all(normalizedBase, `${normalizedBase}-*`) as Array<{ agent_name: string; branch_id: string }>;

  const used = new Set(
    row
      .filter((entry) => !excludeBranchId || entry.branch_id !== excludeBranchId)
      .map((entry) => entry.agent_name),
  );

  if (!used.has(normalizedBase)) return normalizedBase;

  let suffix = 2;
  while (used.has(`${normalizedBase}-${suffix}`)) suffix += 1;
  return `${normalizedBase}-${suffix}`;
}

function requireUniqueAgentName(agentName: string, excludeBranchId?: string | null): string {
  const normalized = normalizeBranchAgentName(agentName);
  if (!normalized) {
    throw new Error("Agent handle must contain at least one letter or number.");
  }

  const existing = getChatBranchByAgentName(normalized);
  if (existing && existing.branch_id !== excludeBranchId) {
    throw new Error(`Agent handle is already in use: @${normalized}`);
  }

  return normalized;
}

export function getChatBranchByChatJid(chatJid: string): ChatBranchRecord | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
       FROM chat_branches
      WHERE chat_jid = ?`
  ).get(chatJid) as ChatBranchRow | undefined;
  return toRecord(row);
}

export function getChatBranchByAgentName(agentName: string): ChatBranchRecord | null {
  const normalized = normalizeBranchAgentName(agentName);
  if (!normalized) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
       FROM chat_branches
      WHERE agent_name = ? AND handle_owner_id = ''
        AND archived_at IS NULL`
  ).get(normalized) as ChatBranchRow | undefined;
  return toRecord(row);
}

export function listChatBranches(
  rootChatJid?: string | null,
  options?: { includeArchived?: boolean }
): ChatBranchRecord[] {
  const db = getDb();
  const includeArchived = Boolean(options?.includeArchived);
  const rows = rootChatJid
    ? db.prepare(
      `SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
         FROM chat_branches
        WHERE root_chat_jid = ?
          AND (? = 1 OR archived_at IS NULL)
        ORDER BY created_at ASC, chat_jid ASC`
    ).all(rootChatJid, includeArchived ? 1 : 0)
    : db.prepare(
      `SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
         FROM chat_branches
        WHERE (? = 1 OR archived_at IS NULL)
        ORDER BY created_at ASC, chat_jid ASC`
    ).all(includeArchived ? 1 : 0);

  return (rows as ChatBranchRow[]).map((row) => toRecord(row)!).filter(Boolean);
}

/** Legacy mutation paths cannot alter an explicitly migrated owner's namespace. */
function requireLegacyHandleNamespace(chatJid: string): void {
  const row = getDb().query("SELECT handle_owner_id FROM chat_branches WHERE chat_jid=?").get(chatJid) as { handle_owner_id: string } | null;
  if (row?.handle_owner_id) throw new ChatAccessDenied();
}

export function ensureChatBranch(input: {
  chat_jid: string;
  root_chat_jid?: string | null;
  parent_branch_id?: string | null;
  agent_name?: string | null;
}): ChatBranchRecord {
  const chatJid = String(input.chat_jid || "").trim();
  if (!chatJid) throw new Error("chat_jid is required");

  const existing = getChatBranchByChatJid(chatJid);
  const now = new Date().toISOString();
  const db = getDb();

  if (existing) {
    requireLegacyHandleNamespace(chatJid);
    if (hasNativeRouting(db)) {
      if (input.root_chat_jid != null && input.root_chat_jid !== existing.root_chat_jid
        || input.parent_branch_id !== undefined && (input.parent_branch_id || null) !== existing.parent_branch_id) requireLegacyRoutingMutation(db, "reparent");
      if (input.agent_name && normalizeBranchAgentName(input.agent_name) !== existing.agent_name) throw Error("Native branch metadata requires explicit handle rename");
      return existing; // Registration never restores or rewrites a native identity.
    }
    const rootChatJid = String(input.root_chat_jid || existing.root_chat_jid || chatJid).trim() || chatJid;
    const parentBranchId = input.parent_branch_id === undefined ? existing.parent_branch_id : (input.parent_branch_id || null);
    const requestedAgentName = input.agent_name ? normalizeBranchAgentName(input.agent_name) : existing.agent_name;
    const nextAgentName = requestedAgentName !== existing.agent_name
      ? getUniqueAgentName(requestedAgentName, existing.branch_id)
      : existing.agent_name;

    if (
      rootChatJid !== existing.root_chat_jid ||
      parentBranchId !== existing.parent_branch_id ||
      nextAgentName !== existing.agent_name ||
      existing.archived_at
    ) {
      db.prepare(
        `UPDATE chat_branches
            SET root_chat_jid = ?,
                parent_branch_id = ?,
                agent_name = ?,
                updated_at = ?,
                archived_at = NULL
          WHERE branch_id = ?`
      ).run(rootChatJid, parentBranchId, nextAgentName, now, existing.branch_id);
    }

    return getChatBranchByChatJid(chatJid)!;
  }

  const rootChatJid = String(input.root_chat_jid || chatJid).trim() || chatJid;
  requireLegacyHandleNamespace(rootChatJid);
  if (hasNativeRouting(db) && (input.parent_branch_id || rootChatJid !== chatJid)) requireLegacyRoutingMutation(db, "legacy child fork");
  const branchId = createUuid("branch");
  const agentName = getUniqueAgentName(input.agent_name || deriveBaseAgentName(chatJid));
  const parentBranchId = input.parent_branch_id ? String(input.parent_branch_id).trim() : null;

  db.prepare(
    `INSERT INTO chat_branches (
      branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(branchId, chatJid, rootChatJid, parentBranchId, agentName, now, now);

  return getChatBranchByChatJid(chatJid)!;
}

export function renameChatBranchIdentity(input: {
  chat_jid: string;
  agent_name?: string | null;
}): ChatBranchRecord {
  const chatJid = String(input.chat_jid || "").trim();
  if (!chatJid) throw new Error("chat_jid is required");

  const existing = getChatBranchByChatJid(chatJid);
  if (!existing) throw new Error(`Unknown chat branch: ${chatJid}`);

  if (input.agent_name === undefined) {
    throw new Error("Nothing to rename.");
  }

  requireLegacyHandleNamespace(chatJid);
  const nextAgentName = requireUniqueAgentName(input.agent_name || "", existing.branch_id);

  if (nextAgentName === existing.agent_name) {
    return existing;
  }

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE chat_branches
        SET agent_name = ?,
            updated_at = ?
      WHERE branch_id = ?`
  ).run(nextAgentName, now, existing.branch_id);

  return getChatBranchByChatJid(chatJid)!;
}

export function archiveChatBranch(chatJid: string): ChatBranchRecord {
  return getDb().transaction(() => {
    const normalizedChatJid = String(chatJid || "").trim();
    if (!normalizedChatJid) throw new Error("chat_jid is required");

    const existing = getChatBranchByChatJid(normalizedChatJid);
    if (!existing) throw new Error(`Unknown chat branch: ${normalizedChatJid}`);

    const isRootChat = existing.chat_jid === existing.root_chat_jid;
    if (isRootChat && existing.chat_jid === "web:default") {
      throw new Error("Cannot archive the default chat session.");
    }
    if (isRootChat) {
      const db = getDb();
      const row = db.prepare(
        `SELECT COUNT(*) AS count
           FROM chat_branches
          WHERE root_chat_jid = ?
            AND chat_jid != ?
            AND archived_at IS NULL`
      ).get(existing.chat_jid, existing.chat_jid) as { count?: number } | undefined;
      if (Number(row?.count || 0) > 0) {
        throw new Error("Cannot archive a root chat session while it still has active branch sessions.");
      }
    }
    if (existing.archived_at) {
      return existing;
    }

    assertNativeBranchPolicyIdle(getDb(), existing.branch_id);
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `UPDATE chat_branches
          SET archived_at = ?,
              updated_at = ?
        WHERE branch_id = ?`
    ).run(now, now, existing.branch_id);

    return getChatBranchByChatJid(normalizedChatJid)!;
  }).immediate();
}

export interface ArchivedBranchPurgePreview {
  branch: ChatBranchRecord;
  counts: {
    chat_branches: number;
    chats: number;
    messages: number;
    message_media: number;
    chat_cursors: number;
    token_usage: number;
    scheduled_tasks: number;
    task_run_logs: number;
    ssh_configs: number;
    proxmox_configs: number;
    portainer_configs: number;
    extension_kv: number;
    media_candidates: number;
  };
}

export interface ArchivedBranchDownloadData {
  schema: "piclaw.archived-session.v1";
  exported_at: string;
  branch: ChatBranchRecord;
  chat: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
  message_media: Record<string, unknown>[];
  /** Derived inline media (link-preview images, tool image previews) per message. */
  message_inline_media: Record<string, unknown>[];
  chat_cursor: Record<string, unknown> | null;
  token_usage: Record<string, unknown>[];
  scheduled_tasks: Record<string, unknown>[];
  scheduled_definition_revisions: Record<string, unknown>[];
  task_run_logs: Record<string, unknown>[];
  configs: {
    ssh: Record<string, unknown> | null;
    proxmox: Record<string, unknown> | null;
    portainer: Record<string, unknown> | null;
  };
  extension_kv: Record<string, unknown>[];
}

function requireArchivedDownloadTarget(chatJid: string): ChatBranchRecord {
  const normalizedChatJid = String(chatJid || "").trim();
  if (!normalizedChatJid) throw new Error("chat_jid is required");
  const branch = getChatBranchByChatJid(normalizedChatJid);
  if (!branch) throw new Error(`Unknown chat branch: ${normalizedChatJid}`);
  if (!branch.archived_at) throw new Error(`Cannot download a branch that is not archived: ${normalizedChatJid}`);
  return branch;
}

function requireArchivedPurgeTarget(chatJid: string): ChatBranchRecord {
  const normalizedChatJid = String(chatJid || "").trim();
  if (!normalizedChatJid) throw new Error("chat_jid is required");

  const branch = getChatBranchByChatJid(normalizedChatJid);
  if (!branch) throw new Error(`Unknown chat branch: ${normalizedChatJid}`);
  if (!branch.archived_at) {
    throw new Error(`Cannot permanently delete a branch that is not archived: ${normalizedChatJid}`);
  }
  if (branch.chat_jid === branch.root_chat_jid) {
    const childCount = countRows(
      `SELECT COUNT(*) AS count
         FROM chat_branches
        WHERE root_chat_jid = ?
          AND chat_jid != ?`,
      branch.chat_jid,
      branch.chat_jid,
    );
    if (childCount > 0) {
      throw new Error(`Cannot permanently delete an archived root chat session while child branch sessions still exist: ${normalizedChatJid}`);
    }
  }

  return branch;
}

function getArchivedBranchTaskIds(chatJid: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `WITH tasks AS (${canonicalScheduledTasksSql}) SELECT id FROM tasks WHERE chat_jid = ? ORDER BY id ASC`
  ).all(chatJid) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function getArchivedBranchMediaIds(chatJid: string): number[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT mm.media_id AS media_id
       FROM message_media mm
       JOIN messages m ON m.rowid = mm.message_rowid
      WHERE m.chat_jid = ?
      ORDER BY mm.media_id ASC`
  ).all(chatJid) as Array<{ media_id: number }>;
  return rows.map((row) => Number(row.media_id)).filter((value) => Number.isFinite(value));
}

function countRows(sql: string, ...params: Array<string | number>): number {
  const db = getDb();
  const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

export function exportArchivedBranchDownloadData(chatJid: string): ArchivedBranchDownloadData {
  const branch = requireArchivedDownloadTarget(chatJid);
  const db = getDb();
  const taskIds = getArchivedBranchTaskIds(branch.chat_jid);
  const taskPlaceholders = taskIds.map(() => "?").join(",");
  const messages = db.prepare(`SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp ASC, rowid ASC`).all(branch.chat_jid) as Record<string, unknown>[];
  const messageMedia = db.prepare(
    `SELECT mm.*
       FROM message_media mm
       JOIN messages m ON m.rowid = mm.message_rowid
      WHERE m.chat_jid = ?
      ORDER BY mm.message_rowid ASC, mm.media_id ASC`
  ).all(branch.chat_jid) as Record<string, unknown>[];

  return {
    schema: "piclaw.archived-session.v1",
    exported_at: new Date().toISOString(),
    branch,
    chat: db.prepare(`SELECT * FROM chats WHERE jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
    messages,
    message_media: messageMedia,
    message_inline_media: db.prepare(
      `SELECT i.*
         FROM message_inline_media i
         JOIN messages m ON m.rowid = i.message_rowid
        WHERE m.chat_jid = ?
        ORDER BY i.message_rowid ASC, i.kind ASC, i.ref ASC`
    ).all(branch.chat_jid) as Record<string, unknown>[],
    chat_cursor: db.prepare(`SELECT * FROM chat_cursors WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
    token_usage: db.prepare(`SELECT * FROM token_usage WHERE chat_jid = ? ORDER BY run_at ASC, id ASC`).all(branch.chat_jid) as Record<string, unknown>[],
    scheduled_tasks: taskIds.map(id => readCanonicalScheduledTask(db, id) as unknown as Record<string, unknown>),
    scheduled_definition_revisions: taskIds.length > 0
      ? db.prepare(`SELECT d.*,r.config_hash,r.snapshot_json,r.authored_at FROM main.host_scheduled_task_definitions d
          JOIN main.service_effect_s07_task_revisions r ON r.task_id=d.task_id AND r.revision=d.revision
          WHERE d.task_id IN (${taskPlaceholders}) ORDER BY d.task_id,d.revision`).all(...taskIds) as Record<string, unknown>[]
      : [],
    task_run_logs: taskIds.length > 0
      ? db.prepare(`SELECT * FROM task_run_logs WHERE task_id IN (${taskPlaceholders}) ORDER BY run_at ASC, id ASC`).all(...taskIds) as Record<string, unknown>[]
      : [],
    configs: {
      ssh: db.prepare(`SELECT * FROM ssh_configs WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
      proxmox: (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxmox_configs'").get() ? db.prepare(`SELECT * FROM proxmox_configs WHERE chat_jid = ?`).get(branch.chat_jid) : null) as Record<string, unknown> | null,
      portainer: (db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portainer_configs'").get() ? db.prepare(`SELECT * FROM portainer_configs WHERE chat_jid = ?`).get(branch.chat_jid) : null) as Record<string, unknown> | null,
    },
    extension_kv: db.prepare(`SELECT * FROM extension_kv WHERE scope = 'chat' AND scope_key = ? ORDER BY extension_id ASC, key ASC`).all(branch.chat_jid) as Record<string, unknown>[],
  };
}

export function previewPermanentDeleteArchivedBranch(chatJid: string): ArchivedBranchPurgePreview {
  const db = getDb();
  const branch = requireArchivedPurgeTarget(chatJid);
  const taskIds = getArchivedBranchTaskIds(branch.chat_jid);
  const mediaIds = getArchivedBranchMediaIds(branch.chat_jid);
  const taskPlaceholders = taskIds.map(() => "?").join(",");

  return {
    branch,
    counts: {
      chat_branches: countRows(`SELECT COUNT(*) AS count FROM chat_branches WHERE chat_jid = ?`, branch.chat_jid),
      chats: countRows(`SELECT COUNT(*) AS count FROM chats WHERE jid = ?`, branch.chat_jid),
      messages: countRows(`SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ?`, branch.chat_jid),
      message_media: countRows(
        `SELECT COUNT(*) AS count
           FROM message_media
          WHERE message_rowid IN (SELECT rowid FROM messages WHERE chat_jid = ?)`,
        branch.chat_jid,
      ),
      chat_cursors: countRows(`SELECT COUNT(*) AS count FROM chat_cursors WHERE chat_jid = ?`, branch.chat_jid),
      token_usage: countRows(`SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?`, branch.chat_jid),
      scheduled_tasks: taskIds.length,
      task_run_logs: taskIds.length > 0
        ? countRows(`SELECT COUNT(*) AS count FROM task_run_logs WHERE task_id IN (${taskPlaceholders})`, ...taskIds)
        : 0,
      ssh_configs: countRows(`SELECT COUNT(*) AS count FROM ssh_configs WHERE chat_jid = ?`, branch.chat_jid),
      proxmox_configs: db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proxmox_configs'").get() ? countRows(`SELECT COUNT(*) AS count FROM proxmox_configs WHERE chat_jid = ?`, branch.chat_jid) : 0,
      portainer_configs: db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portainer_configs'").get() ? countRows(`SELECT COUNT(*) AS count FROM portainer_configs WHERE chat_jid = ?`, branch.chat_jid) : 0,
      extension_kv: countRows(`SELECT COUNT(*) AS count FROM extension_kv WHERE scope = 'chat' AND scope_key = ?`, branch.chat_jid),
      media_candidates: mediaIds.length,
    },
  };
}

export interface MergeChatBranchIntoParentResult {
  source: ChatBranchRecord;
  parent: ChatBranchRecord;
  counts: {
    messages: number;
    token_usage: number;
    scheduled_tasks: number;
    chat_cursors: number;
    ssh_configs: number;
    proxmox_configs: number;
    portainer_configs: number;
    extension_kv: number;
    chat_branches_deleted: number;
    chats_deleted: number;
  };
}

/** SQL-only helpers borrow an outer transaction through a savepoint, or own an
 * immediate transaction when called standalone. Returning from a borrowed scope
 * does not certify physical commit; the outer owner controls publication. */
export function restoreChatBranchIdentity(input: {
  chat_jid: string;
  agent_name?: string | null;
}): ChatBranchRecord {
  const chatJid = String(input.chat_jid || "").trim();
  if (!chatJid) throw new Error("chat_jid is required");

  const existing = getChatBranchByChatJid(chatJid);
  if (!existing) throw new Error(`Unknown chat branch: ${chatJid}`);

  requireLegacyHandleNamespace(chatJid);
  const requestedAgent = input.agent_name === undefined
    ? existing.agent_name
    : normalizeBranchAgentName(input.agent_name || "");
  const nextAgentName = getUniqueAgentName(requestedAgent || existing.agent_name, existing.branch_id);

  if (!existing.archived_at && nextAgentName === existing.agent_name) {
    return existing;
  }

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE chat_branches
        SET agent_name = ?,
            archived_at = NULL,
            updated_at = ?
      WHERE branch_id = ?`
  ).run(nextAgentName, now, existing.branch_id);

  return getChatBranchByChatJid(chatJid)!;
}
