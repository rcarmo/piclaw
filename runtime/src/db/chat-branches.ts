/**
 * db/chat-branches.ts – Explicit branch/session registry for web chat branches.
 *
 * Branch identity is defined entirely by the `agent_name` handle.
 * The legacy `display_name` column is dropped on first startup via migration.
 */

import { getDb } from "./connection.js";
import { attachMediaToMessage, deleteUnreferencedMedia } from "./media.js";
import { deleteThinkingContentByChatJid } from "./thinking-cleanup.js";
import type { ChatBranchRecord } from "./types.js";
import { createUuid } from "../utils/ids.js";

interface QueuedFollowupForMerge {
  rowId: number;
  queuedContent: string;
  threadId: number | null;
  queuedAt: string;
  mediaIds?: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
}

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
      WHERE archived_at IS NULL
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
      WHERE agent_name = ?
        AND archived_at IS NULL`
  ).get(normalized) as ChatBranchRow | undefined;
  return toRecord(row);
}

function getChatBranchByBranchId(branchId: string): ChatBranchRecord | null {
  const normalized = String(branchId || "").trim();
  if (!normalized) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at
       FROM chat_branches
      WHERE branch_id = ?`
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

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE chat_branches
        SET archived_at = ?,
            updated_at = ?
      WHERE branch_id = ?`
  ).run(now, now, existing.branch_id);

  return getChatBranchByChatJid(normalizedChatJid)!;
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

export interface PermanentDeleteArchivedBranchResult {
  branch: ChatBranchRecord;
  counts: ArchivedBranchPurgePreview["counts"] & {
    media_deleted: number;
  };
}

export interface ArchivedBranchDownloadData {
  schema: "piclaw.archived-session.v1";
  exported_at: string;
  branch: ChatBranchRecord;
  chat: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
  message_media: Record<string, unknown>[];
  chat_cursor: Record<string, unknown> | null;
  token_usage: Record<string, unknown>[];
  scheduled_tasks: Record<string, unknown>[];
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
    `SELECT id
       FROM scheduled_tasks
      WHERE chat_jid = ?
      ORDER BY id ASC`
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
    chat_cursor: db.prepare(`SELECT * FROM chat_cursors WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
    token_usage: db.prepare(`SELECT * FROM token_usage WHERE chat_jid = ? ORDER BY run_at ASC, id ASC`).all(branch.chat_jid) as Record<string, unknown>[],
    scheduled_tasks: taskIds.length > 0
      ? db.prepare(`SELECT * FROM scheduled_tasks WHERE chat_jid = ? ORDER BY id ASC`).all(branch.chat_jid) as Record<string, unknown>[]
      : [],
    task_run_logs: taskIds.length > 0
      ? db.prepare(`SELECT * FROM task_run_logs WHERE task_id IN (${taskPlaceholders}) ORDER BY run_at ASC, id ASC`).all(...taskIds) as Record<string, unknown>[]
      : [],
    configs: {
      ssh: db.prepare(`SELECT * FROM ssh_configs WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
      proxmox: db.prepare(`SELECT * FROM proxmox_configs WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
      portainer: db.prepare(`SELECT * FROM portainer_configs WHERE chat_jid = ?`).get(branch.chat_jid) as Record<string, unknown> | null,
    },
    extension_kv: db.prepare(`SELECT * FROM extension_kv WHERE scope = 'chat' AND scope_key = ? ORDER BY extension_id ASC, key ASC`).all(branch.chat_jid) as Record<string, unknown>[],
  };
}

export function previewPermanentDeleteArchivedBranch(chatJid: string): ArchivedBranchPurgePreview {
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
      proxmox_configs: countRows(`SELECT COUNT(*) AS count FROM proxmox_configs WHERE chat_jid = ?`, branch.chat_jid),
      portainer_configs: countRows(`SELECT COUNT(*) AS count FROM portainer_configs WHERE chat_jid = ?`, branch.chat_jid),
      extension_kv: countRows(`SELECT COUNT(*) AS count FROM extension_kv WHERE scope = 'chat' AND scope_key = ?`, branch.chat_jid),
      media_candidates: mediaIds.length,
    },
  };
}

function sanitizeQueuedFollowupForMerge(value: unknown): QueuedFollowupForMerge | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.queuedContent !== "string" || !record.queuedContent.trim()) return null;
  return {
    rowId: Number.isFinite(record.rowId) ? Number(record.rowId) : 0,
    queuedContent: record.queuedContent,
    threadId: Number.isFinite(record.threadId) ? Number(record.threadId) : null,
    queuedAt: typeof record.queuedAt === "string" && record.queuedAt.trim()
      ? record.queuedAt.trim()
      : new Date().toISOString(),
    mediaIds: Array.isArray(record.mediaIds)
      ? record.mediaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : undefined,
    contentBlocks: Array.isArray(record.contentBlocks) ? [...record.contentBlocks] : undefined,
    linkPreviews: Array.isArray(record.linkPreviews) ? [...record.linkPreviews] : undefined,
  };
}

function readQueuedFollowupsForMerge(chatJid: string): QueuedFollowupForMerge[] {
  const db = getDb();
  const row = db.prepare(
    `SELECT queued_followups_json FROM chat_cursors WHERE chat_jid = ?`
  ).get(chatJid) as { queued_followups_json: string | null } | undefined;
  if (!row?.queued_followups_json) return [];
  try {
    const parsed = JSON.parse(row.queued_followups_json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeQueuedFollowupForMerge(item))
      .filter((item): item is QueuedFollowupForMerge => Boolean(item));
  } catch {
    return [];
  }
}

function getLatestChatPosition(chatJid: string): string {
  const db = getDb();
  const row = db.prepare(
    `SELECT MAX(timestamp) AS ts FROM messages WHERE chat_jid = ?`
  ).get(chatJid) as { ts: string | null } | undefined;
  if (typeof row?.ts === "string" && row.ts.trim()) return row.ts;

  const chat = db.prepare(
    `SELECT last_message_time AS ts FROM chats WHERE jid = ?`
  ).get(chatJid) as { ts: string | null } | undefined;
  return typeof chat?.ts === "string" ? chat.ts : "";
}

function moveChatCursorToLastPosition(chatJid: string): void {
  const ts = getLatestChatPosition(chatJid);
  if (!ts) return;
  getDb().prepare(`
    INSERT INTO chat_cursors (chat_jid, cursor_ts, queued_followups_json)
    VALUES (?, ?, NULL)
    ON CONFLICT(chat_jid) DO UPDATE SET
      cursor_ts = excluded.cursor_ts
  `).run(chatJid, ts);
}

function materializeQueuedFollowupsForTimelineMove(chatJid: string): number {
  const queued = readQueuedFollowupsForMerge(chatJid);
  if (queued.length === 0) return 0;

  const db = getDb();
  let inserted = 0;
  let latestTimestamp = "";
  const existingRow = db.prepare(`SELECT rowid FROM messages WHERE chat_jid = ? AND rowid = ?`);
  const insertMessage = db.prepare(`INSERT INTO messages (
      id, chat_jid, sender, sender_name, content, content_blocks, link_previews,
      thread_id, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply, is_steering_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getInsertedRow = db.prepare(`SELECT rowid FROM messages WHERE chat_jid = ? AND id = ?`);
  const threadExists = db.prepare(`SELECT rowid FROM messages WHERE chat_jid = ? AND rowid = ?`);

  for (const item of queued) {
    if (item.rowId > 0 && existingRow.get(chatJid, item.rowId)) {
      if (item.queuedAt > latestTimestamp) latestTimestamp = item.queuedAt;
      continue;
    }

    const messageId = createUuid("web");
    const contentBlocks = Array.isArray(item.contentBlocks) ? JSON.stringify(item.contentBlocks) : null;
    const linkPreviews = Array.isArray(item.linkPreviews) ? JSON.stringify(item.linkPreviews) : null;
    const explicitThreadId = item.threadId && threadExists.get(chatJid, item.threadId) ? item.threadId : null;
    insertMessage.run(
      messageId,
      chatJid,
      "web-user",
      "You",
      item.queuedContent,
      contentBlocks,
      linkPreviews,
      explicitThreadId,
      item.queuedAt,
      0,
      0,
      0,
      0,
    );
    const row = getInsertedRow.get(chatJid, messageId) as { rowid: number } | undefined;
    const rowId = row?.rowid ?? 0;
    if (rowId > 0) {
      if (!explicitThreadId) db.prepare(`UPDATE messages SET thread_id = ? WHERE rowid = ?`).run(rowId, rowId);
      if (item.mediaIds?.length) attachMediaToMessage(rowId, item.mediaIds);
      inserted += 1;
    }
    if (item.queuedAt > latestTimestamp) latestTimestamp = item.queuedAt;
  }

  db.prepare(`UPDATE chat_cursors SET queued_followups_json = NULL WHERE chat_jid = ?`).run(chatJid);
  if (latestTimestamp) {
    db.prepare(
      `UPDATE chats
          SET last_message_time = CASE
                WHEN last_message_time IS NULL OR ? > last_message_time THEN ?
                ELSE last_message_time
              END
        WHERE jid = ?`
    ).run(latestTimestamp, latestTimestamp, chatJid);
  }
  return inserted;
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

export function mergeChatBranchIntoParent(chatJid: string): MergeChatBranchIntoParentResult {
  const normalizedChatJid = String(chatJid || "").trim();
  if (!normalizedChatJid) throw new Error("chat_jid is required");

  const source = getChatBranchByChatJid(normalizedChatJid);
  if (!source) throw new Error(`Unknown chat branch: ${normalizedChatJid}`);
  if (!source.parent_branch_id) {
    throw new Error(`Cannot merge a root chat session into a parent: ${normalizedChatJid}`);
  }

  const parent = getChatBranchByBranchId(source.parent_branch_id);
  if (!parent) throw new Error(`Missing parent branch for chat: ${normalizedChatJid}`);
  if (parent.archived_at) throw new Error(`Cannot merge into an archived parent chat: ${parent.chat_jid}`);

  const childCount = countRows(
    `SELECT COUNT(*) AS count FROM chat_branches WHERE parent_branch_id = ?`,
    source.branch_id,
  );
  if (childCount > 0) {
    throw new Error(`Cannot merge a chat branch that still has child branches: ${normalizedChatJid}`);
  }

  const messageCollisionCount = countRows(
    `SELECT COUNT(*) AS count
       FROM messages source
       JOIN messages parent ON parent.chat_jid = ? AND parent.id = source.id
      WHERE source.chat_jid = ?`,
    parent.chat_jid,
    source.chat_jid,
  );
  if (messageCollisionCount > 0) {
    throw new Error(`Cannot merge chat branch because ${messageCollisionCount} message id(s) already exist in the parent chat.`);
  }

  const db = getDb();
  let counts: MergeChatBranchIntoParentResult["counts"];

  db.exec("BEGIN IMMEDIATE");
  try {
    materializeQueuedFollowupsForTimelineMove(source.chat_jid);

    counts = {
      messages: countRows(`SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ?`, source.chat_jid),
      token_usage: countRows(`SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?`, source.chat_jid),
      scheduled_tasks: countRows(`SELECT COUNT(*) AS count FROM scheduled_tasks WHERE chat_jid = ?`, source.chat_jid),
      chat_cursors: countRows(`SELECT COUNT(*) AS count FROM chat_cursors WHERE chat_jid = ?`, source.chat_jid),
      ssh_configs: countRows(`SELECT COUNT(*) AS count FROM ssh_configs WHERE chat_jid = ?`, source.chat_jid),
      proxmox_configs: countRows(`SELECT COUNT(*) AS count FROM proxmox_configs WHERE chat_jid = ?`, source.chat_jid),
      portainer_configs: countRows(`SELECT COUNT(*) AS count FROM portainer_configs WHERE chat_jid = ?`, source.chat_jid),
      extension_kv: countRows(`SELECT COUNT(*) AS count FROM extension_kv WHERE scope = 'chat' AND scope_key = ?`, source.chat_jid),
      chat_branches_deleted: 1,
      chats_deleted: countRows(`SELECT COUNT(*) AS count FROM chats WHERE jid = ?`, source.chat_jid),
    };

    db.prepare(`UPDATE messages SET chat_jid = ? WHERE chat_jid = ?`).run(parent.chat_jid, source.chat_jid);
    db.prepare(`UPDATE token_usage SET chat_jid = ? WHERE chat_jid = ?`).run(parent.chat_jid, source.chat_jid);
    db.prepare(`UPDATE scheduled_tasks SET chat_jid = ? WHERE chat_jid = ?`).run(parent.chat_jid, source.chat_jid);

    moveChatCursorToLastPosition(parent.chat_jid);
    db.prepare(`DELETE FROM chat_cursors WHERE chat_jid = ?`).run(source.chat_jid);

    db.prepare(
      `INSERT OR IGNORE INTO ssh_configs (
         chat_jid, ssh_target, ssh_port, private_key_keychain, known_hosts_keychain,
         strict_host_key_checking, created_at, updated_at
       )
       SELECT ?, ssh_target, ssh_port, private_key_keychain, known_hosts_keychain,
              strict_host_key_checking, created_at, updated_at
         FROM ssh_configs
        WHERE chat_jid = ?`
    ).run(parent.chat_jid, source.chat_jid);
    db.prepare(`DELETE FROM ssh_configs WHERE chat_jid = ?`).run(source.chat_jid);

    db.prepare(
      `INSERT OR IGNORE INTO proxmox_configs (
         chat_jid, base_url, api_token_keychain, allow_insecure_tls, created_at, updated_at
       )
       SELECT ?, base_url, api_token_keychain, allow_insecure_tls, created_at, updated_at
         FROM proxmox_configs
        WHERE chat_jid = ?`
    ).run(parent.chat_jid, source.chat_jid);
    db.prepare(`DELETE FROM proxmox_configs WHERE chat_jid = ?`).run(source.chat_jid);

    db.prepare(
      `INSERT OR IGNORE INTO portainer_configs (
         chat_jid, base_url, api_token_keychain, allow_insecure_tls, created_at, updated_at
       )
       SELECT ?, base_url, api_token_keychain, allow_insecure_tls, created_at, updated_at
         FROM portainer_configs
        WHERE chat_jid = ?`
    ).run(parent.chat_jid, source.chat_jid);
    db.prepare(`DELETE FROM portainer_configs WHERE chat_jid = ?`).run(source.chat_jid);

    db.prepare(
      `INSERT OR IGNORE INTO extension_kv (extension_id, scope, scope_key, key, value, created_at, updated_at)
       SELECT extension_id, scope, ?, key, value, created_at, updated_at
         FROM extension_kv
        WHERE scope = 'chat'
          AND scope_key = ?`
    ).run(parent.chat_jid, source.chat_jid);
    db.prepare(`DELETE FROM extension_kv WHERE scope = 'chat' AND scope_key = ?`).run(source.chat_jid);

    db.prepare(
      `UPDATE chats
          SET last_message_time = CASE
                WHEN (SELECT last_message_time FROM chats WHERE jid = ?) > last_message_time
                  THEN (SELECT last_message_time FROM chats WHERE jid = ?)
                ELSE last_message_time
              END
        WHERE jid = ?`
    ).run(source.chat_jid, source.chat_jid, parent.chat_jid);
    db.prepare(`DELETE FROM chat_branches WHERE branch_id = ?`).run(source.branch_id);
    db.prepare(`DELETE FROM chats WHERE jid = ?`).run(source.chat_jid);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { source, parent, counts };
}

export function permanentDeleteArchivedBranch(chatJid: string): PermanentDeleteArchivedBranchResult {
  const preview = previewPermanentDeleteArchivedBranch(chatJid);
  const branch = preview.branch;
  const mediaIds = getArchivedBranchMediaIds(branch.chat_jid);
  const taskIds = getArchivedBranchTaskIds(branch.chat_jid);
  const db = getDb();

  const deleted = {
    ...preview.counts,
    media_deleted: 0,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (taskIds.length > 0) {
      const taskPlaceholders = taskIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM task_run_logs WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
      db.prepare(`DELETE FROM scheduled_tasks WHERE id IN (${taskPlaceholders})`).run(...taskIds);
    }

    db.prepare(
      `DELETE FROM message_media
        WHERE message_rowid IN (SELECT rowid FROM messages WHERE chat_jid = ?)`
    ).run(branch.chat_jid);
    // Purge thinking_content for messages we're about to delete (no FK
    // cascade is possible; see I2 in PR #655 issues tracker). Must run
    // BEFORE the messages DELETE so the subquery still resolves.
    deleteThinkingContentByChatJid(branch.chat_jid);
    db.prepare(`DELETE FROM messages WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM chat_cursors WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM token_usage WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM ssh_configs WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM proxmox_configs WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM portainer_configs WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM extension_kv WHERE scope = 'chat' AND scope_key = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM chat_branches WHERE chat_jid = ?`).run(branch.chat_jid);
    db.prepare(`DELETE FROM chats WHERE jid = ?`).run(branch.chat_jid);
    deleted.media_deleted = deleteUnreferencedMedia(mediaIds);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    branch,
    counts: deleted,
  };
}

// ---------------------------------------------------------------------------
// JID rename — migrate a chat's JID across every referencing table.
// ---------------------------------------------------------------------------

export interface RenameChatJidResult {
  oldJid: string;
  newJid: string;
  branch: ChatBranchRecord;
  /** Tables that had rows updated (excludes FTS shadow tables). */
  updatedTables: string[];
}

/**
 * Rename a chat JID across *all* DB tables in a single transaction.
 *
 * The caller is responsible for:
 *   - evicting the session from the in-memory agent pool *before* calling this
 *   - renaming the session directory on disk *after* this succeeds
 *
 * Child branches whose `chat_jid` starts with `oldJid + ":"` are
 * rewritten to start with `newJid + ":"` so the tree stays intact for both
 * legacy `:branch:` and modern hierarchical JID forms.
 */
export function renameChatJid(oldJid: string, newJid: string): RenameChatJidResult {
  const old = String(oldJid || "").trim();
  const next = String(newJid || "").trim();
  if (!old) throw new Error("oldJid is required");
  if (!next) throw new Error("newJid is required");
  if (old === next) throw new Error("Old and new JID are identical.");

  // Disallow reserved characters that would break the branch-tree model.
  if (/[\s]/.test(next)) throw new Error("JID must not contain whitespace.");

  const existing = getChatBranchByChatJid(old);
  if (!existing) throw new Error(`Unknown chat: ${old}`);

  // Make sure the target JID is not already in use.
  const collision = getChatBranchByChatJid(next);
  if (collision) throw new Error(`Target JID already exists: ${next}`);

  const db = getDb();
  const now = new Date().toISOString();
  const updated: string[] = [];
  const childPrefix = `${old}:`;
  const childNextPrefix = `${next}:`;
  const childPrefixLength = childPrefix.length;

  db.exec("BEGIN IMMEDIATE");
  try {
    // --- chats (PK = jid) -----------------------------------------------
    const chatsRows = db.prepare(
      `UPDATE chats SET jid = ? WHERE jid = ?`
    ).run(next, old);
    // Also update any children whose JID starts with the old prefix.
    db.prepare(
      `UPDATE chats
          SET jid = ? || substr(jid, ?)
        WHERE substr(jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);
    if ((chatsRows as any)?.changes > 0) updated.push("chats");

    // --- messages -------------------------------------------------------
    const msgRows = db.prepare(
      `UPDATE messages SET chat_jid = ? WHERE chat_jid = ?`
    ).run(next, old);
    db.prepare(
      `UPDATE messages
          SET chat_jid = ? || substr(chat_jid, ?)
        WHERE substr(chat_jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);
    if ((msgRows as any)?.changes > 0) updated.push("messages");

    // --- chat_cursors ---------------------------------------------------
    const cursorRows = db.prepare(
      `UPDATE chat_cursors SET chat_jid = ? WHERE chat_jid = ?`
    ).run(next, old);
    db.prepare(
      `UPDATE chat_cursors
          SET chat_jid = ? || substr(chat_jid, ?)
        WHERE substr(chat_jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);
    if ((cursorRows as any)?.changes > 0) updated.push("chat_cursors");

    // --- chat_branches (chat_jid + root_chat_jid) ----------------------
    db.prepare(
      `UPDATE chat_branches SET chat_jid = ?, root_chat_jid = CASE WHEN root_chat_jid = ? THEN ? ELSE root_chat_jid END, updated_at = ? WHERE chat_jid = ?`
    ).run(next, old, next, now, old);
    // Children: update chat_jid prefix and root_chat_jid if it pointed to old.
    db.prepare(
      `UPDATE chat_branches
         SET chat_jid = ? || substr(chat_jid, ?),
             root_chat_jid = CASE WHEN root_chat_jid = ? THEN ? ELSE root_chat_jid END,
             updated_at = ?
       WHERE substr(chat_jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, old, next, now, childPrefixLength, childPrefix);
    updated.push("chat_branches");

    // --- token_usage ----------------------------------------------------
    db.prepare(
      `UPDATE token_usage SET chat_jid = ? WHERE chat_jid = ?`
    ).run(next, old);
    db.prepare(
      `UPDATE token_usage
          SET chat_jid = ? || substr(chat_jid, ?)
        WHERE substr(chat_jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);
    updated.push("token_usage");

    // --- scheduled_tasks ------------------------------------------------
    db.prepare(
      `UPDATE scheduled_tasks SET chat_jid = ? WHERE chat_jid = ?`
    ).run(next, old);
    db.prepare(
      `UPDATE scheduled_tasks
          SET chat_jid = ? || substr(chat_jid, ?)
        WHERE substr(chat_jid, 1, ?) = ?`
    ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);

    // --- config tables (ssh, proxmox, portainer) -----------------------
    for (const tbl of ["ssh_configs", "proxmox_configs", "portainer_configs"]) {
      db.prepare(
        `UPDATE ${tbl} SET chat_jid = ? WHERE chat_jid = ?`
      ).run(next, old);
      db.prepare(
        `UPDATE ${tbl}
            SET chat_jid = ? || substr(chat_jid, ?)
          WHERE substr(chat_jid, 1, ?) = ?`
      ).run(childNextPrefix, childPrefixLength + 1, childPrefixLength, childPrefix);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Rebuild the FTS index for the renamed rows so full-text search stays
  // accurate. The content-sync FTS5 table reads through to `messages`, so
  // after the UPDATE above the shadow table chat_jid column is stale.
  // A targeted rebuild is safest:
  try {
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
  } catch (_ftsErr) {
    // Non-fatal: search may lag until the next natural rebuild.
    console.debug("[chat-branches] FTS rebuild after rename failed — search may lag", _ftsErr);
  }

  return {
    oldJid: old,
    newJid: next,
    branch: getChatBranchByChatJid(next)!,
    updatedTables: updated,
  };
}

export function restoreChatBranchIdentity(input: {
  chat_jid: string;
  agent_name?: string | null;
}): ChatBranchRecord {
  const chatJid = String(input.chat_jid || "").trim();
  if (!chatJid) throw new Error("chat_jid is required");

  const existing = getChatBranchByChatJid(chatJid);
  if (!existing) throw new Error(`Unknown chat branch: ${chatJid}`);

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
