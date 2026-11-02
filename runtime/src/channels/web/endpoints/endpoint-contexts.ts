/**
 * channels/web/endpoint-contexts.ts – shared builders for WebChannel endpoint context objects.
 */

import type { InteractionRow } from "../../../db.js";
import type { PostMutationsContext } from "../post-mutations.js";

interface JsonLike {
  json(payload: unknown, status?: number): Response;
}

/** Dependencies required to assemble the post-mutation endpoint context. */
export interface PostMutationsContextDeps extends JsonLike {
  defaultChatJid: string;
  getLastCommandInteractionId(): number | null;
  replaceMessageContent(chatJid: string, id: number, content: string, threadId?: number): InteractionRow | null;
  broadcastInteractionUpdated(interaction: InteractionRow): void;
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: { threadId?: number }
  ): InteractionRow | null;
  broadcastAgentResponse(interaction: InteractionRow): void;
}

/** Build the post-mutation endpoint context from live channel dependencies. */
export function createPostMutationsContext(deps: PostMutationsContextDeps): PostMutationsContext {
  return {
    defaultChatJid: deps.defaultChatJid,
    lastCommandInteractionId: deps.getLastCommandInteractionId(),
    json: deps.json,
    replaceMessageContent: deps.replaceMessageContent,
    broadcastInteractionUpdated: deps.broadcastInteractionUpdated,
    storeMessage: deps.storeMessage,
    broadcastAgentResponse: deps.broadcastAgentResponse,
  };
}
