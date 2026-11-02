/**
 * web/posts-service.ts – Post payload parsing and validation.
 *
 * Parses inbound post payloads and normalizes media identifiers.
 * Consumers: web/handlers/posts.ts and messaging/agent-message-service.ts.
 */

/** Shape of the JSON body received from the compose box on POST /post. */
export interface PostPayload {
  content?: string;
  thread_id?: number | null;
  media_ids?: number[];
  content_blocks?: unknown[];
  link_previews?: unknown[];
}

/**
 * Max allowed message content length (100 KB).
 * Prevents users from submitting extremely large messages that would
 * bloat the SQLite database and FTS index. This limit is also enforced
 * in agent-message-service.ts and handleInternalPost/handleUpdatePost.
 */
const MAX_POST_CONTENT_LENGTH = 100 * 1024;

/**
 * Validate and parse a raw POST body into a PostPayload.
 * Checks for:
 *   - Valid object body
 *   - Non-empty content field
 *   - Content length within MAX_POST_CONTENT_LENGTH
 */
export function parsePostPayload(body: unknown): { ok: boolean; error?: string; data?: PostPayload } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON" };
  const data = body as PostPayload;
  if (!data.content) return { ok: false, error: "Missing 'content' field" };
  if (typeof data.content === "string" && data.content.length > MAX_POST_CONTENT_LENGTH) {
    return { ok: false, error: `Content too large (max ${MAX_POST_CONTENT_LENGTH} bytes)` };
  }
  return { ok: true, data };
}

/** Parse a comma-separated media ID string into a number array. */
export function normalizeMediaIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
}
