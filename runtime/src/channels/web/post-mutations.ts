/**
 * channels/web/post-mutations.ts – Post update/internal-post endpoint orchestration.
 */

import { captureWebRequestAuthority } from "./auth/auth-gateway.js";
import type { WebChannelLike } from "./core/web-channel-contracts.js";
import { createLogger } from "../../utils/logger.js";
import type { InteractionRow } from "../../db.js";
import { updateMessageAnnotations } from "../../db/messages.js";

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

/** Context contract consumed by post update/internal-post mutation handlers. */
export interface PostMutationsContext {
  defaultChatJid: string;
  lastCommandInteractionId: number | null;
  json(payload: unknown, status?: number): Response;
  replaceMessageContent(chatJid: string, id: number, content: string, threadId?: number): InteractionRow | null;
  broadcastInteractionUpdated(interaction: InteractionRow): void;
  authGateway?: WebChannelLike["authGateway"];
  admitMessage: WebChannelLike["admitMessage"];
  broadcastAgentResponse(interaction: InteractionRow): void;
}

/** PATCH /post/:id orchestration. */
export async function handleUpdatePostRequest(
  req: Request,
  id: number | null,
  ctx: PostMutationsContext
): Promise<Response> {
  if (!id || id < 1) return ctx.json({ error: "Missing or invalid post id" }, 400);

  let body: { content?: string; thread_id?: number; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  if (typeof body.content !== "string") {
    return ctx.json({ error: "Missing content" }, 400);
  }
  if (typeof body.content === "string" && body.content.length > 100 * 1024) {
    return ctx.json({ error: "Content too large (max 100 KB)" }, 400);
  }

  if (body.thread_id !== undefined && (!Number.isSafeInteger(body.thread_id) || body.thread_id < 1)) {
    return ctx.json({ error: "Invalid thread_id" }, 400);
  }
  const chatJid = resolveChatJid(req, ctx.defaultChatJid, body.chat_jid);
  let updated: InteractionRow | null;
  try {
    updated = ctx.replaceMessageContent(chatJid, id, body.content, body.thread_id);
  } catch (error) {
    throw error;
  }
  if (!updated) return ctx.json({ error: "Post not found" }, 404);

  ctx.broadcastInteractionUpdated(updated);
  return ctx.json({ status: "ok", ok: true, id: updated.id });
}

/** POST /internal/post orchestration. */
export async function handleInternalPostRequest(req: Request, ctx: PostMutationsContext): Promise<Response> {
  const authorise = captureWebRequestAuthority(ctx.authGateway, req), admit = ctx.admitMessage?.bind(ctx);
  if (!admit) return ctx.json({ error: "Message admission is unavailable." }, 503);
  const defaultChatJid = ctx.defaultChatJid, lastCommand = ctx.lastCommandInteractionId;
  let body: { content?: string; thread_id?: number; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.content) return ctx.json({ error: "Missing content" }, 400);
  if (body.content.length > 100 * 1024) {
    return ctx.json({ error: "Content too large (max 100 KB)" }, 400);
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
  if (!interaction) return ctx.json({ error: "Failed to store" }, 500);

  try { ctx.broadcastAgentResponse(interaction); }
  catch (error) { log.warn("Internal post publication deferred after commit", { error, chatJid, rowId: interaction.id }); }
  return ctx.json({ status: "ok", ok: true, id: interaction.id }, 201);
}

/** PATCH /post/:id/annotations orchestration. */
export async function handleUpdatePostAnnotationsRequest(
  req: Request,
  id: number,
  ctx: PostMutationsContext,
): Promise<Response> {
  if (!id || id < 1) return ctx.json({ error: "Missing or invalid post id" }, 400);

  let body: { annotations?: unknown[]; chat_jid?: string };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  if (!Array.isArray(body.annotations)) {
    return ctx.json({ error: "Missing or invalid annotations array" }, 400);
  }

  // Cap annotation count to prevent abuse
  if (body.annotations.length > 200) {
    return ctx.json({ error: "Too many annotations (max 200)" }, 400);
  }

  const chatJid = resolveChatJid(req, ctx.defaultChatJid, body.chat_jid);
  let ok: boolean;
  try {
    ok = updateMessageAnnotations(chatJid, id, body.annotations.length > 0 ? body.annotations : null);
  } catch (error) {
    throw error;
  }
  if (!ok) return ctx.json({ error: "Post not found" }, 404);

  return ctx.json({ status: "ok", ok: true, id, annotations: body.annotations });
}
