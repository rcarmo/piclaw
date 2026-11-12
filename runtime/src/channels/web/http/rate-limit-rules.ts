/**
 * web/http/rate-limit-rules.ts – Route-to-limit mapping for web endpoint throttling.
 */

/** Sliding-window duration for passkey enrol endpoints. */
export const ENROLL_RATE_WINDOW_MS = 5 * 60 * 1000;
/** Request cap for passkey enrol endpoints per window. */
export const ENROLL_RATE_LIMIT = 20;
/** Sliding-window duration for auth endpoints. */
export const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000;
/** Request cap for auth endpoints per window. */
export const AUTH_RATE_LIMIT = 10;

/** Sliding-window duration for data-mutating endpoints. */
export const DATA_RATE_WINDOW_MS = 60 * 1000;

const DATA_POST_LIMIT = 30;
const DATA_REPLY_LIMIT = 30;
const DATA_AGENT_MESSAGE_LIMIT = 30;
const DATA_MEDIA_UPLOAD_LIMIT = 20;
const DATA_WORKSPACE_UPLOAD_LIMIT = 20;
const DATA_WORKSPACE_UPLOAD_CHUNK_LIMIT = 240;
const DATA_DELETE_LIMIT = 60;
const DATA_WRITE_LIMIT = 30;
const DATA_POST_UPDATE_LIMIT = 30;
const DATA_WORKSPACE_ATTACH_LIMIT = 30;
const DATA_WORKSPACE_UI_LIMIT = 60;
const DATA_AGENT_QUEUE_LIMIT = 30;
const DATA_AGENT_BRANCH_LIMIT = 20;
const DATA_AGENT_PEER_LIMIT = 30;
const DATA_AGENT_UI_LIMIT = 30;
const DATA_AGENT_TASK_LIMIT = 30;
const DATA_AGENT_SIDE_PROMPT_LIMIT = 20;

/** Rate-limit rule returned for a specific method/path endpoint. */
export type DataRateLimitRule = {
  /** Logical bucket key used by the in-memory rate limiter. */
  bucket: string;
  /** Maximum number of allowed requests within the configured data window. */
  limit: number;
  /** Client-facing error message returned when the limit is exceeded. */
  message: string;
};

/**
 * Resolve the data-plane rate-limit rule for a request method/path pair.
 * @param method HTTP method for the current request.
 * @param pathname Parsed request pathname.
 * @returns Matching rate-limit rule, or null when no rule applies.
 */
export function getDataRateLimitRule(method: string, pathname: string): DataRateLimitRule | null {
  if (method === "POST" && pathname === "/post") {
    return { bucket: "data/post", limit: DATA_POST_LIMIT, message: "Too many posts. Slow down." };
  }
  if (method === "POST" && pathname === "/post/reply") {
    return { bucket: "data/reply", limit: DATA_REPLY_LIMIT, message: "Too many replies. Slow down." };
  }
  if (method === "PATCH" && pathname.startsWith("/post/")) {
    return { bucket: "data/post_update", limit: DATA_POST_UPDATE_LIMIT, message: "Too many post updates. Slow down." };
  }
  if (method === "POST" && pathname.endsWith("/message")) {
    return { bucket: "data/agent_message", limit: DATA_AGENT_MESSAGE_LIMIT, message: "Too many agent messages. Slow down." };
  }
  if (method === "POST" && pathname === "/media/upload-chunk") {
    return { bucket: "data/media_upload_chunk", limit: DATA_WORKSPACE_UPLOAD_CHUNK_LIMIT, message: "Too many upload chunks. Slow down." };
  }
  if (method === "POST" && pathname === "/media/upload") {
    return { bucket: "data/media_upload", limit: DATA_MEDIA_UPLOAD_LIMIT, message: "Too many media uploads. Slow down." };
  }
  if (method === "POST" && (pathname === "/agent/queue-remove" || pathname === "/agent/queue-steer")) {
    return {
      bucket: "data/agent_queue",
      limit: DATA_AGENT_QUEUE_LIMIT,
      message: "Too many queued-message actions. Slow down.",
    };
  }
  if (method === "POST" && (pathname === "/agent/branch-fork" || pathname === "/agent/root-session" || pathname === "/agent/branch-rename" || pathname === "/agent/branch-merge-parent" || pathname === "/agent/branch-prune" || pathname === "/agent/branch-purge" || pathname === "/agent/branch-restore")) {
    return {
      bucket: "data/agent_branch",
      limit: DATA_AGENT_BRANCH_LIMIT,
      message: "Too many branch actions. Slow down.",
    };
  }
  if (method === "POST" && pathname === "/agent/peer-message") {
    return {
      bucket: "data/agent_peer",
      limit: DATA_AGENT_PEER_LIMIT,
      message: "Too many peer-agent messages. Slow down.",
    };
  }
  if ((method === "GET" && ["/agent/settings/mcp", '/agent/settings/mcp/servers'].includes(pathname)) || (method === "POST" && ["/agent/settings/mcp/preview", "/agent/settings/mcp/apply", '/agent/settings/mcp/servers/preview', '/agent/settings/mcp/servers/apply'].includes(pathname))) {
    return { bucket: "data/mcp_settings", limit: DATA_AGENT_UI_LIMIT, message: "Too many MCP settings requests. Slow down." };
  }
  if (method === "POST" && pathname === "/agent/scheduled-tasks/action") {
    return {
      bucket: "data/agent_scheduled_tasks",
      limit: DATA_AGENT_TASK_LIMIT,
      message: "Too many scheduled-task actions. Slow down.",
    };
  }
  if (method === "POST" && (
    pathname === "/agent/thought/visibility" ||
    pathname === "/agent/respond" ||
    pathname === "/agent/card-action" ||
    pathname === "/agent/tool-abort"
  )) {
    return {
      bucket: "data/agent_ui",
      limit: DATA_AGENT_UI_LIMIT,
      message: "Too many agent UI actions. Slow down.",
    };
  }
  if (method === "POST" && (
    pathname === "/agent/side-prompt" ||
    pathname === "/agent/side-prompt/stream"
  )) {
    return {
      bucket: "data/agent_side_prompt",
      limit: DATA_AGENT_SIDE_PROMPT_LIMIT,
      message: "Too many side-prompt requests. Slow down.",
    };
  }
  if (method === "POST" && pathname === "/workspace/upload") {
    return {
      bucket: "data/workspace_upload",
      limit: DATA_WORKSPACE_UPLOAD_LIMIT,
      message: "Too many workspace uploads. Slow down.",
    };
  }
  if (method === "POST" && pathname === "/workspace/upload-chunk") {
    return {
      bucket: "data/workspace_upload_chunk",
      limit: DATA_WORKSPACE_UPLOAD_CHUNK_LIMIT,
      message: "Too many workspace upload chunks. Slow down.",
    };
  }
  if (method === "POST" && pathname === "/workspace/attach") {
    return {
      bucket: "data/workspace_attach",
      limit: DATA_WORKSPACE_ATTACH_LIMIT,
      message: "Too many workspace attach actions. Slow down.",
    };
  }
  if (method === "POST" && (pathname === "/workspace/visibility" || pathname === "/workspace/reindex" || pathname.startsWith("/agent/settings/workspace/indexing/"))) {
    return {
      bucket: "data/workspace_ui",
      limit: DATA_WORKSPACE_UI_LIMIT,
      message: "Too many workspace UI actions. Slow down.",
    };
  }
  if (method === "DELETE" && pathname.startsWith("/post/")) {
    return { bucket: "data/delete_post", limit: DATA_DELETE_LIMIT, message: "Too many deletions. Slow down." };
  }
  if (
    ((method === "PUT" || method === "DELETE" || method === "POST") && pathname === "/workspace/file") ||
    (method === "POST" && pathname === "/workspace/rename") ||
    (method === "POST" && pathname === "/workspace/move")
  ) {
    return { bucket: "data/write", limit: DATA_WRITE_LIMIT, message: "Too many file writes. Slow down." };
  }

  return null;
}
