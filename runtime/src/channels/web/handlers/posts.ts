import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
import { captureInputTarget } from "../messaging/input-request-authority.js";
/**
 * web/handlers/posts.ts – HTTP handlers for timeline post endpoints.
 *
 * Handles GET /timeline, GET /hashtag/:tag, GET /search, POST /post,
 * PUT /post/:id, DELETE /post/:id. Delegates to timeline-service.ts
 * and posts-service.ts for data operations.
 *
 * Consumers: web/request-router.ts routes post paths here.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { parsePostPayload, normalizeMediaIds } from "../posts-service.js";
import { sanitizePublicInboundContentBlocks } from "../messaging/content-block-safety.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.posts");

/**
 * Handle post-create requests by validating payload and persisting a timeline entry.
 * @param channel Web channel contract used for JSON response encoding and post storage dependencies.
 * @param req Incoming HTTP request containing post JSON payload.
 * @param isReply Whether the new post should be stored as a reply.
 * @param chatJid Chat JID that owns the new post.
 * @returns JSON response with stored post payload or validation errors.
 */
export async function handlePost(channel: WebChannelLike, req: Request, isReply: boolean, chatJid: string): Promise<Response> {
  const requestAuthority = captureWebRequestAuthority(channel.authGateway, req);
  const admit = channel.admitUserMessage?.bind(channel);
  if (!admit) return channel.json({ error: "Input admission is unavailable." }, 503);
  const target = captureInputTarget(chatJid);
  const authorise = (phase?: "before" | "after") => { requestAuthority(); target(phase); };
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return channel.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parsePostPayload(body);
  if (!parsed.ok || !parsed.data) return channel.json({ error: parsed.error }, 400);

  const data = parsed.data;
  if (isReply && !data.thread_id) return channel.json({ error: "Missing 'thread_id' field" }, 400);
  const interaction = await admit(chatJid, data.content || "", normalizeMediaIds(data.media_ids), {
    contentBlocks: sanitizePublicInboundContentBlocks(data.content_blocks),
    linkPreviews: Array.isArray(data.link_previews) ? data.link_previews : undefined,
    threadId: isReply && data.thread_id ? Number(data.thread_id) : undefined,
  }, authorise, req.signal);
  if (!interaction) return channel.json({ error: "Failed to store message" }, 500);
  if (isReply && data.thread_id) interaction.data.thread_id = Number(data.thread_id);

  // Publication/wake failures cannot revoke an accepted row or invite replay.
  try { channel.broadcastEvent(isReply ? "new_reply" : "new_post", interaction); }
  catch (error) { log.warn("Post publication deferred after commit", { error, chatJid, rowId: interaction.id }); }
  const threadRootId = typeof interaction.data?.thread_id === "number" ? interaction.data.thread_id : interaction.id;
  try { channel.resumeChat(chatJid, threadRootId); }
  catch (error) { log.warn("Post wake deferred after commit", { error, chatJid, rowId: interaction.id }); }
  return channel.json(interaction, 201);
}
