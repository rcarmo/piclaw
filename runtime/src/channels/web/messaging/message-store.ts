/**
 * web/message-store.ts – Database operations for web-channel messages.
 *
 * Wraps db/messages.ts with web-channel-specific logic: generating message
 * IDs, attaching media, and handling content blocks. Serves as the data
 * access layer for all web-channel message CRUD operations.
 *
 * Consumers: web/posts-service.ts, web/agent-message-service.ts.
 */

import {
  attachMediaToMessage,
  clampWebContent,
  createMedia,
  getChatBranchByChatJid,
  getDb,
  getMediaInfoById,
  getMessageByRowId,
  getDeferredQueuedFollowups,
  removeProtectedRecoveryContinuationForSourceMessageId,
  setDeferredQueuedFollowups,
  storeChatMetadata,
  storeMessage,
} from "../../../db.js";
import { getWebPreviewMaxChars, shouldPreviewWebContent } from "../../../db/web-content.js";
import { scheduleLinkPreviews, type LinkPreviewChannel } from "../media/link-previews.js";
import type { InteractionRow } from "../../../db.js";
import type { NewMessage } from "../../../types.js";
import type { Database } from "bun:sqlite";
import { readAccessConfig } from "../../../core/config-access.js";
import { requireOwnedSessionExecution } from "../../../agent-pool/owned-session-access.js";
import { createUuid } from "../../../utils/ids.js";
import { getDatabaseBinding } from '../../../db/connection.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { getWorkspaceDir, getStoreDir, getConfigPath } from '../../../core/config.js';
import { statSync } from 'node:fs';
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log = createLogger('web.message-store');

/** Host SQL-only binding of an existing accepted queue source, never re-admission.
 * sourceId must be item.source_id; payloadRef remains queued-source:<sourceId>.
 * Receives persisted queue bytes and the new row in the same transaction.
 * The host must verify chat/source identity and the accepted immutable input digest
 * (excluding retry/acceptance bookkeeping), throwing on conflict. Never mutate
 * the accepted source payloadRef or create a second source. Payload resolution
 * after consume uses messages.id = item.source_id, not the deleted queue row. */
export type QueuedInputMaterialization = (stored: Readonly<{
  chatJid: string; item: Readonly<import('../../../queued-followups.js').QueuedFollowupItem & { source_id: string }>;
  message: Readonly<NewMessage>; rowId: number; database: Database;
}>) => void;

/** Options for storing a web channel message (content, media, thread). */
export interface StoreWebMessageOptions {
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  threadId?: number | null;
  screenHint?: string | null;
  isTerminalAgentReply?: boolean;
  isSteeringMessage?: boolean;
  /** Remove stale protected intent atomically with this terminal row insert. */
  removeProtectedContinuationForSourceMessageId?: string | null;
  /** Atomically remove this deferred queue row with the user-message insert. */
  consumeDeferredFollowupRowId?: number | null;
  /** Fault-injection seam used to prove transaction rollback before consume. */
  beforeDeferredFollowupConsume?: () => void;
  /** Captured host callback only; never sourced from request/content blocks. */
  materializeQueuedSource?: QueuedInputMaterialization;
  /** Admit a legacy queued row atomically when it becomes durable normal input. */
  acceptMaterializedSource?: WebUserMessageStoreOptions["acceptSource"];
}

/** Host-only incoming admission options; never populated from HTTP fields. */
export interface WebUserMessageStoreOptions extends StoreWebMessageOptions {
  /**
   * Runs after row/media writes on the SAME owned SQL connection, before commit.
   * Trusted SQL-only, synchronous, retry-safe callback; return exactly undefined
   * or throw on failure to roll back everything. Never schedule work after await:
   * rollback cannot cancel arbitrary SQL in an asynchronous continuation.
   * The message identity/timestamp are prepared once and stable across retries.
   * Any receipt captured here is precommit only: do not publish/acknowledge here.
   */
  acceptSource?: (stored: Readonly<{ message: Readonly<NewMessage>; rowId: number; database: Database }>) => void;
}

/** Resolved parameters for storeWebMessage (after defaults applied). */
export interface StoreWebMessageParams {
  chatJid: string;
  content: string;
  isBot: boolean;
  mediaIds: number[];
  agentId: string;
  agentName: string;
  userName?: string | null;
}

interface PreparedWebMessage {
  params: StoreWebMessageParams;
  options: StoreWebMessageOptions;
  messageId: string;
  timestamp: string;
  spill?: { filename: string; data: Uint8Array; maxChars: number };
}
interface CommittedWebMessage {
  params: StoreWebMessageParams;
  options: StoreWebMessageOptions;
  msg: NewMessage;
  rowId: number;
  contentBlocks: unknown[] | undefined;
  allMediaIds: number[];
  interaction: InteractionRow;
}

/** No DB or preview side effects. Identity and spill bytes remain stable on retry. */
function prepareWebMessage(params: StoreWebMessageParams, options: StoreWebMessageOptions): PreparedWebMessage {
  const messageId = createUuid("web");
  return {
    params: { ...params, mediaIds: [...params.mediaIds] },
    options: { ...options, contentBlocks: options.contentBlocks ? structuredClone(options.contentBlocks) : undefined,
      linkPreviews: options.linkPreviews ? structuredClone(options.linkPreviews) : undefined },
    messageId,
    timestamp: new Date().toISOString(),
    ...(shouldPreviewWebContent(params.content) ? { spill: {
      filename: `message-${messageId}.md`, data: new TextEncoder().encode(params.content), maxChars: getWebPreviewMaxChars(),
    } } : {}),
  };
}

/** Caller owns the transaction. All generated media and metadata roll back together. */
function writePreparedWebMessage(prepared: PreparedWebMessage): CommittedWebMessage {
  const { params, options } = prepared;
  const consumeId = options.consumeDeferredFollowupRowId;
  const queued = !params.isBot && typeof consumeId === 'number' && Number.isFinite(consumeId)
    ? getDeferredQueuedFollowups(params.chatJid) : undefined;
  const queueIndex = queued?.findIndex(item => item.rowId === consumeId) ?? -1;
  const queuedItem = queued?.[queueIndex];
  if (queued && !queuedItem) throw Error('Deferred follow-up intent disappeared before materialization');
  let messageId = prepared.messageId;
  if (queuedItem?.source_accepted) {
    if (!queuedItem.source_id || !/^source-[0-9a-f-]{36}$/i.test(queuedItem.source_id) || !options.materializeQueuedSource)
      throw Error('Accepted queued input requires its host materialization binding');
    if (params.content !== queuedItem.queuedContent || JSON.stringify(params.mediaIds) !== JSON.stringify(queuedItem.mediaIds ?? []) ||
      JSON.stringify(options.contentBlocks ?? []) !== JSON.stringify(queuedItem.contentBlocks ?? []) ||
      JSON.stringify(options.linkPreviews ?? []) !== JSON.stringify(queuedItem.linkPreviews ?? []) ||
      (options.threadId ?? null) !== (queuedItem.threadId ?? null) || (options.screenHint ?? null) !== (queuedItem.screenHint ?? null))
      throw Error('Accepted queued input payload conflict');
    messageId = queuedItem.source_id;
    // storeMessage upserts: never permit materialization to overwrite any existing row.
    if (getDb().query('SELECT 1 FROM messages WHERE id = ?').get(messageId)) throw Error('Accepted queued input identity collision');
  }
  let contentBlocks = Array.isArray(options.contentBlocks)
    ? [...options.contentBlocks]
    : undefined;
  const allMediaIds = [...params.mediaIds];

  if (!contentBlocks && params.mediaIds.length > 0) {
    contentBlocks = params.mediaIds.map((mediaId) => {
      const info = getMediaInfoById(mediaId);
      const mimeType = typeof info?.content_type === "string" ? info.content_type : "application/octet-stream";
      const filename = typeof info?.filename === "string" ? info.filename : null;
      const isImage = mimeType.toLowerCase().startsWith("image/");
      return {
        type: isImage ? "image" : "file",
        ...(filename ? { name: filename, filename } : {}),
        ...(mimeType ? { mime_type: mimeType } : {}),
      };
    });
  }

  if (prepared.spill) {
    const { maxChars, filename, data } = prepared.spill;
    const mediaId = createMedia(filename, "text/markdown", data, null, {
      size: data.length,
      kind: "file",
      source: "message",
      original_length: params.content.length,
      preview_limit: maxChars,
    });
    if (mediaId > 0) {
      allMediaIds.push(mediaId);
      const block = {
        type: "file",
        name: filename,
        filename,
        mime_type: "text/markdown",
        size: data.length,
      };
      if (contentBlocks) contentBlocks.push(block);
      else contentBlocks = [block];
    }
  }

  const msg: NewMessage = {
    id: messageId,
    chat_jid: params.chatJid,
    sender: params.isBot ? "web-agent" : "web-user",
    sender_name: params.isBot ? params.agentName : (typeof params.userName === "string" && params.userName.trim() ? params.userName.trim() : "You"),
    content: params.content,
    screen_hint: typeof options.screenHint === "string" && options.screenHint.trim() ? options.screenHint.trim() : null,
    timestamp: prepared.timestamp,
    is_from_me: false,
    is_bot_message: params.isBot,
    content_blocks: contentBlocks,
    link_previews: options.linkPreviews,
    thread_id: options.threadId ?? null,
    is_terminal_agent_reply: options.isTerminalAgentReply,
    is_steering_message: options.isSteeringMessage,
  };

  const rowId = storeMessage(msg);
  if (rowId <= 0) throw new Error("Failed to persist web message row");

  if (allMediaIds.length > 0) {
    attachMediaToMessage(rowId, allMediaIds);
  }

  // Ensure user messages are threaded to themselves when no explicit threadId
  // is provided. This creates a consistent thread root for replies.
  if (!params.isBot && (options.threadId === null || options.threadId === undefined)) {
    getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rowId, rowId);
  }

  const sourceMessageId = typeof options.removeProtectedContinuationForSourceMessageId === "string"
    ? options.removeProtectedContinuationForSourceMessageId.trim()
    : "";
  if (params.isBot && options.isTerminalAgentReply && sourceMessageId) {
    removeProtectedRecoveryContinuationForSourceMessageId(params.chatJid, sourceMessageId);
  }

  const consumeDeferredRowId = typeof options.consumeDeferredFollowupRowId === "number"
    ? options.consumeDeferredFollowupRowId
    : null;
  if (!params.isBot && consumeDeferredRowId !== null && Number.isFinite(consumeDeferredRowId)) {
    options.beforeDeferredFollowupConsume?.();
    if (!queued || !queuedItem || queueIndex < 0) throw Error('Deferred follow-up intent disappeared before materialization');
    if (queuedItem.source_accepted) {
      const result: unknown = options.materializeQueuedSource!({ chatJid: params.chatJid,
        item: { ...structuredClone(queuedItem), source_id: queuedItem.source_id! }, message: { ...msg }, rowId, database: getDb() });
      if (result !== undefined) {
        void Promise.resolve(result).then(() => undefined, () => undefined);
        throw Error('Queued materialization callback must be synchronous');
      }
    }
    if (!queuedItem.source_accepted) {
      const result: unknown = options.acceptMaterializedSource?.({ message: { ...msg }, rowId, database: getDb() });
      if (result !== undefined) {
        void Promise.resolve(result).then(() => undefined, () => undefined);
        throw Error('Queued admission callback must be synchronous');
      }
    }
    queued.splice(queueIndex, 1);
    setDeferredQueuedFollowups(params.chatJid, queued);
  }

  if (readAccessConfig().mode === "single-user") {
    storeChatMetadata(params.chatJid, msg.timestamp, getChatBranchByChatJid(params.chatJid)?.agent_name || undefined);
  } else {
    requireOwnedSessionExecution(params.chatJid);
    getDb().query("UPDATE chats SET last_message_time=MAX(COALESCE(last_message_time,''),?) WHERE jid=?").run(msg.timestamp, params.chatJid);
  }

  const committed = { params, options, msg, rowId, contentBlocks, allMediaIds };
  return { ...committed, interaction: buildWebInteraction(committed) };
}

/** Store a web channel message synchronously for existing internal callers. */
export function storeWebMessage(channel: LinkPreviewChannel, params: StoreWebMessageParams, options: StoreWebMessageOptions = {}): InteractionRow | null {
  if (readAccessConfig().mode !== "single-user") {
    if (!params.isBot) return null;
    try { requireOwnedSessionExecution(params.chatJid); } catch { return null; }
  }
  const prepared = prepareWebMessage(params, options);
  let committed: CommittedWebMessage;
  try { committed = getDb().transaction(() => writePreparedWebMessage(prepared)).immediate(); }
  catch { return null; }
  return finishWebMessage(channel, committed);
}

/** Single-user incoming messages only; every retry owns a complete atomic write. */
export async function admitWebUserMessage(channel: LinkPreviewChannel, params: StoreWebMessageParams, options: WebUserMessageStoreOptions,
  authorise: (phase?: 'before' | 'after') => void, signal: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null> {
  if (params.isBot || readAccessConfig().mode !== 'single-user') throw Error('Incoming web admission requires single-user authority.');
  const database = getDb(), binding = getDatabaseBinding();
  const paths = JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]);
  const assertBinding = () => {
    if (getDb() !== database || JSON.stringify(getDatabaseBinding()) !== JSON.stringify(binding)
      || JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]) !== paths) throw Error('Message database binding changed.');
    if (binding) { const stat=statSync(binding.path); if(`${stat.dev}:${stat.ino}` !== binding.identity) throw Error('Message database file changed.'); }
  };
  const check = (phase: 'before' | 'after') => {
    assertBinding();
    if (readAccessConfig().mode !== 'single-user') throw Error('Incoming message authority changed.');
    authorise(phase);
  };
  const prepared = prepareWebMessage(params, options);
  const acceptSource = options.acceptSource;
  const committed = await admitSqliteWrite(database, () => {
    for (const mediaId of prepared.params.mediaIds) if (!getMediaInfoById(mediaId)) throw Error('Incoming media is unavailable.');
    if (deferBeforeInsert?.()) return null;
    const stored = writePreparedWebMessage(prepared);
    const result: unknown = acceptSource?.({ message: stored.msg, rowId: stored.rowId, database });
    if (result !== undefined) {
      // Observe rejected promises/thenables without awaiting or exposing their payloads.
      void Promise.resolve(result).then(() => undefined, () => undefined);
      throw new Error('Source admission callback must be synchronous');
    }
    return stored;
  }, check, signal, 5000, assertBinding);
  return committed ? finishWebMessage(channel, committed) : null;
}

/** Resolve the authoritative acknowledgement while the transaction is owned. */
function buildWebInteraction(committed: Omit<CommittedWebMessage, 'interaction'>): InteractionRow {
  const { params, options, msg, rowId, contentBlocks, allMediaIds } = committed;
  const interaction = getMessageByRowId(params.chatJid, rowId);
  if (interaction) {
    interaction.data.agent_id = params.agentId;
    if (options.threadId) interaction.data.thread_id = options.threadId;
    else if (!params.isBot) interaction.data.thread_id = rowId;
    return interaction;
  }

  const { content: safeContent, meta } = clampWebContent(params.content);
  const data: InteractionRow["data"] = {
    type: params.isBot ? "agent_response" : "user_message",
    content: safeContent,
    content_meta: meta,
    agent_id: params.agentId,
    media_ids: allMediaIds,
  };
  if (msg.screen_hint) data.screen_hint = msg.screen_hint;
  if (options.threadId) data.thread_id = options.threadId;
  else if (!params.isBot) data.thread_id = rowId;
  if (contentBlocks?.length) data.content_blocks = contentBlocks;
  if (options.linkPreviews?.length) data.link_previews = options.linkPreviews;
  return {
    id: rowId,
    chat_jid: params.chatJid,
    timestamp: msg.timestamp,
    data,
  };
}

/** Optional publication cannot turn a committed input into a rejected one. */
function finishWebMessage(channel: LinkPreviewChannel, committed: CommittedWebMessage): InteractionRow {
  try {
    scheduleLinkPreviews(channel, committed.params.chatJid, committed.rowId, committed.params.content, committed.options.linkPreviews);
  } catch (error) {
    debugSuppressedError(log, 'Optional preview scheduling failed after message commit.', error, { operation: 'web_message_store.preview_after_commit', rowId: committed.rowId });
  }
  return committed.interaction;
}
