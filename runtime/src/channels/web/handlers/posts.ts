/**
 * web/handlers/posts.ts – HTTP handlers for timeline post endpoints.
 *
 * Handles GET /timeline, GET /hashtag/:tag, GET /search, POST /post,
 * PUT /post/:id, DELETE /post/:id. Delegates to timeline-service.ts
 * and posts-service.ts for data operations.
 *
 * Consumers: web/request-router.ts routes post paths here.
 */

import type { InteractionRow } from "../../../db.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { parsePostPayload, storePost } from "../posts-service.js";

/**
 * Handle post-create requests by validating payload and persisting a timeline entry.
 * @param channel Web channel contract used for JSON response encoding and post storage dependencies.
 * @param req Incoming HTTP request containing post JSON payload.
 * @param isReply Whether the new post should be stored as a reply.
 * @param chatJid Chat JID that owns the new post.
 * @returns JSON response with stored post payload or validation errors.
 */
export async function handlePost(channel: WebChannelLike, req: Request, isReply: boolean, chatJid: string): Promise<Response> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return channel.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parsePostPayload(data);
  if (!parsed.ok || !parsed.data) return channel.json({ error: parsed.error }, 400);

  const result = storePost(channel, chatJid, parsed.data, { isReply });

  if (result.status === 201) {
    const interaction = result.body as InteractionRow | null;
    const threadRootId = typeof interaction?.data?.thread_id === "number"
      ? interaction.data.thread_id
      : (typeof interaction?.id === "number" ? interaction.id : null);
    channel.resumeChat(chatJid, threadRootId);
  }

  return channel.json(result.body, result.status);
}
