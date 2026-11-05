import { getExecutionIdentity } from "../../../core/execution-context.js";
import { bindAddonLocalMessage } from "../../../addons/local-dispatch.js";
/** Admitted web timeline writes. Message, media and source attachment
 * share one synchronous SQL body after asynchronous acquisition. */

import {
  attachMediaToMessage,
  clampWebContent,
  createMedia,
  getChatBranchByChatJid,
  getDb,
  getMediaInfoById,
  getMessageByRowId,
  storeChatMetadata,
  storeMessage,
} from "../../../db.js";
import { getWebPreviewMaxChars, shouldPreviewWebContent } from "../../../db/web-content.js";
import { normaliseExistingMediaFts, appendMediaTextToFts } from "../../../service-effects/current-piclaw/terminal-settlement-timeline-statements.js";
import { scheduleLinkPreviews, type LinkPreviewChannel } from "../media/link-previews.js";
import type { InteractionRow } from "../../../db.js";
import type { NewMessage } from "../../../types.js";
import type { Database } from "bun:sqlite";
import { readAccessConfig } from "../../../core/config-access.js";
import { requireOwnedSessionExecution } from "../../../agent-pool/owned-session-access.js";
import { createUuid } from "../../../utils/ids.js";
import { captureHostDatabaseBinding } from '../../../db/connection.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log = createLogger('web.message-store');

/** Options for storing a web channel message (content, media, thread). */
export interface StoreWebMessageOptions {
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  threadId?: number | null;
  /** Resolve a root reply's self-thread inside the row/receipt transaction. */
  threadToSelf?: boolean;
  screenHint?: string | null;
  isTerminalAgentReply?: boolean;
  isSteeringMessage?: boolean;
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

/** Resolved timeline message parameters (after defaults applied). */
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
  const messageId = prepared.messageId;
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
  if (!params.isBot) bindAddonLocalMessage(params.chatJid, { id: msg.id, content: msg.content, content_blocks: msg.content_blocks });

  if (allMediaIds.length > 0) {
    attachMediaToMessage(rowId, allMediaIds);
  }

  // Publish root threading in the original message transaction.
  if ((!params.isBot && (options.threadId === null || options.threadId === undefined)) || (options.threadToSelf && !options.threadId)) {
    // A queued source may already exist before its timeline row is published.
    const database = getDb();
    if (allMediaIds.length) normaliseExistingMediaFts(database, rowId, () => {});
    database.prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rowId, rowId);
    if (allMediaIds.length) appendMediaTextToFts(database, rowId, allMediaIds, () => {});
  }

  if (readAccessConfig().mode === "single-user") {
    storeChatMetadata(params.chatJid, msg.timestamp, getChatBranchByChatJid(params.chatJid)?.agent_name || undefined);
  } else {
    requireOwnedSessionExecution(params.chatJid);
    getDb().query("UPDATE chats SET last_message_time=MAX(COALESCE(last_message_time,''),?) WHERE jid=?").run(msg.timestamp, params.chatJid);
  }

  const committed = { params, options, msg, rowId, contentBlocks, allMediaIds };
  const interaction = buildWebInteraction(committed);
  return { ...committed, interaction };
}

/** One admitted timeline writer. Source/queue callbacks remain SQL-only and atomic. */
export async function admitWebMessage(channel: LinkPreviewChannel, params: StoreWebMessageParams, options: StoreWebMessageOptions,
  authorise?: (phase?: 'before' | 'after') => void, signal?: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null> {
  if (readAccessConfig().mode !== 'single-user') throw Error('Web message admission requires single-user authority.');
  if (params.isBot && (options.acceptSource || deferBeforeInsert)) throw Error('Agent replies cannot admit or defer model input.');
  const identity = getExecutionIdentity(), chatJid = params.chatJid;
  const targetKey = () => { const branch = getChatBranchByChatJid(chatJid); return JSON.stringify(branch && [branch.branch_id, branch.chat_jid, branch.archived_at]); };
  const originalTarget = targetKey();
  let writtenTarget = originalTarget;
  const database = getDb();
  if (database.inTransaction) throw new TypeError('Web message admission requires its own transaction.');
  const assertBinding = captureHostDatabaseBinding(database);
  const check = (phase: 'before' | 'after') => {
    assertBinding();
    if (readAccessConfig().mode !== 'single-user' || getExecutionIdentity() !== identity) throw Error('Message authority changed.');
    requireOwnedSessionExecution(chatJid);
    if ((phase === "before" && targetKey() !== originalTarget) || getChatBranchByChatJid(chatJid)?.archived_at) throw Error("Message target lifetime changed.");
    authorise?.(phase);
    if (phase === "after" && targetKey() !== writtenTarget) throw Error("Message target lifetime changed.");
  };
  const prepared = prepareWebMessage(params, options);
  const acceptSource = options.acceptSource;
  const committed = await admitSqliteWrite(database, () => {
    for (const mediaId of prepared.params.mediaIds) if (!getMediaInfoById(mediaId)) throw Error('Incoming media is unavailable.');
    if (deferBeforeInsert?.()) { writtenTarget = targetKey(); return null; }
    const stored = writePreparedWebMessage(prepared);
    writtenTarget = targetKey();
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
    try { debugSuppressedError(log, 'Optional preview scheduling failed after message commit.', error, { operation: 'web_message_store.preview_after_commit', rowId: committed.rowId }); } catch { return committed.interaction; }
  }
  return committed.interaction;
}
