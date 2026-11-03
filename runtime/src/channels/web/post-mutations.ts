/**
 * channels/web/post-mutations.ts – Post update/internal-post endpoint orchestration.
 */

import { captureWebRequestAuthority } from "./auth/auth-gateway.js";
import type { WebChannelLike } from "./core/web-channel-contracts.js";
import { createLogger } from "../../utils/logger.js";
import { getDb, captureHostDatabaseBinding } from "../../db/connection.js";
import { admitSqliteWrite } from "../../db/sqlite-async-admission.js";
import { getMessageByRowIdFromDatabase, replaceMessageContentInDatabase, updateMessageAnnotationsInDatabase } from "../../db/messages.js";

const log = createLogger("web.post-mutations");

function resolveChatJid(req: Request, defaultChatJid: string, bodyChatJid?: unknown): string {
  const urlChatJid = new URL(req.url).searchParams.get("chat_jid");
  const candidate = typeof bodyChatJid === "string" && bodyChatJid.trim()
    ? bodyChatJid
    : typeof urlChatJid === "string" && urlChatJid.trim()
      ? urlChatJid
      : defaultChatJid;
  return candidate.trim() || defaultChatJid;
}

/** Request-scoped fencing only: the existing SQLite primitive owns acquisition.
 * Row identity excludes editable fields; stable archived/branchless history stays editable. */
function capturePostAuthority(channel: WebChannelLike, req: Request, database: ReturnType<typeof getDb>, id?: number) {
  const gateway = channel.authGateway, requestAuthority = captureWebRequestAuthority(gateway, req);
  const assertBinding = captureHostDatabaseBinding(database);
  const rowKey = () => JSON.stringify(database.query(`SELECT m.id,m.chat_jid,b.branch_id,b.archived_at FROM messages m
    LEFT JOIN chat_branches b ON b.chat_jid=m.chat_jid WHERE m.rowid=?`).get(id!) ?? null);
  let originalRow: string | null = null;
  const check = (phase?: 'before' | 'after') => {
    assertBinding();
    if (phase === undefined && database.inTransaction) throw Error('Post mutation requires its own transaction.');
    if (channel.authGateway !== gateway) throw Error('Post request gateway changed.');
    requestAuthority();
    if (originalRow !== null && rowKey() !== originalRow) throw Error('Post mutation identity changed.');
  };
  check();
  if (id !== undefined) originalRow = rowKey();
  return check;
}

/** PATCH /post/:id orchestration. */
export async function handleUpdatePostRequest(
  channel: WebChannelLike, req: Request, id: number | null, defaultChatJid: string,
): Promise<Response> {
  if (!id || id < 1) return channel.json({ error: "Missing or invalid post id" }, 400);
  const database = getDb(), check = capturePostAuthority(channel, req, database, id);

  let body: { content?: string; thread_id?: number; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return channel.json({ error: "Invalid JSON" }, 400);
  }

  if (!body || typeof body.content !== "string") {
    return channel.json({ error: "Missing content" }, 400);
  }
  if (typeof body.content === "string" && body.content.length > 100 * 1024) {
    return channel.json({ error: "Content too large (max 100 KB)" }, 400);
  }

  if (body.thread_id !== undefined && (!Number.isSafeInteger(body.thread_id) || body.thread_id < 1)) {
    return channel.json({ error: "Invalid thread_id" }, 400);
  }
  const chatJid = resolveChatJid(req, defaultChatJid, body.chat_jid);
  const content = body.content, threadId = body.thread_id;
  const updated = await admitSqliteWrite(database, () => {
    if (!replaceMessageContentInDatabase(database, chatJid, id, content)) return null;
    if (threadId !== undefined) database.query("UPDATE messages SET thread_id=? WHERE chat_jid=? AND rowid=?").run(threadId, chatJid, id);
    const row = getMessageByRowIdFromDatabase(database, chatJid, id);
    if (!row) throw Error('Post mutation readback is unavailable.');
    return row;
  }, check, req.signal, undefined, check);
  if (!updated) return channel.json({ error: "Post not found" }, 404);

  const response = channel.json({ status: "ok", ok: true, id: updated.id });
  try { channel.interactionBroadcaster.broadcastInteractionUpdated(updated); }
  catch (error) { try { log.warn('Post update publication deferred after commit', { error, chatJid, rowId: id }); } catch { return response; } }
  return response;
}

/** POST /internal/post orchestration. */
export async function handleInternalPostRequest(channel: WebChannelLike, req: Request, defaultChatJid: string): Promise<Response> {
  const lastCommand = channel.lastCommandInteractionId, admit = channel.admitMessage?.bind(channel);
  if (!admit) return channel.json({ error: "Message admission is unavailable." }, 503);
  const authorise = capturePostAuthority(channel, req, getDb());
  let body: { content?: string; thread_id?: number; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return channel.json({ error: "Invalid JSON" }, 400);
  }

  if (!body || typeof body.content !== "string" || !body.content) return channel.json({ error: "Missing content" }, 400);
  if (body.content.length > 100 * 1024) {
    return channel.json({ error: "Content too large (max 100 KB)" }, 400);
  }

  const chatJid = resolveChatJid(req, defaultChatJid, body.chat_jid);
  const threadId = body.thread_id || lastCommand || undefined;
  const interaction = await admit(
    chatJid,
    body.content,
    true,
    [],
    threadId ? { threadId } : {}, authorise, req.signal
  );
  if (!interaction) return channel.json({ error: "Failed to store" }, 500);

  const response = channel.json({ status: "ok", ok: true, id: interaction.id }, 201);
  try { channel.interactionBroadcaster.broadcastAgentResponse(interaction); }
  catch (error) { try { log.warn("Internal post publication deferred after commit", { error, chatJid, rowId: interaction.id }); } catch { return response; } }
  return response;
}

/** PATCH /post/:id/annotations orchestration. */
export async function handleUpdatePostAnnotationsRequest(
  channel: WebChannelLike, req: Request, id: number, defaultChatJid: string,
): Promise<Response> {
  if (!id || id < 1) return channel.json({ error: "Missing or invalid post id" }, 400);
  const database = getDb(), check = capturePostAuthority(channel, req, database, id);

  let body: { annotations?: unknown[]; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return channel.json({ error: "Invalid JSON" }, 400);
  }

  if (!body || !Array.isArray(body.annotations)) {
    return channel.json({ error: "Missing or invalid annotations array" }, 400);
  }

  // Cap annotation count to prevent abuse
  if (body.annotations.length > 200) {
    return channel.json({ error: "Too many annotations (max 200)" }, 400);
  }

  const chatJid = resolveChatJid(req, defaultChatJid, body.chat_jid);
  const annotations = structuredClone(body.annotations);
  const updated = await admitSqliteWrite(database, () => {
    if (!updateMessageAnnotationsInDatabase(database, chatJid, id, annotations.length ? annotations : null)) return null;
    const row = getMessageByRowIdFromDatabase(database, chatJid, id);
    if (!row) throw Error('Post mutation readback is unavailable.');
    return row;
  }, check, req.signal, undefined, check);
  if (!updated) return channel.json({ error: "Post not found" }, 404);

  return channel.json({ status: "ok", ok: true, id, annotations: updated.data.annotations ?? [] });
}
