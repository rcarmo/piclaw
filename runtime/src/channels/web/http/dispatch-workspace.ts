/**
 * web/http/dispatch-workspace.ts – Workspace route dispatch helpers.
 */

import {
  handleWorkspaceAttach,
  handleWorkspaceBranch,
  handleWorkspaceCreate,
  handleWorkspaceDelete,
  handleWorkspaceDownload,
  handleWorkspaceFile,
  handleWorkspaceIndexStatus,
  handleWorkspaceRaw,
  handleWorkspaceStat,
  handleWorkspaceMove,
  handleWorkspaceReindex,
  handleWorkspaceRename,
  handleWorkspaceTree,
  handleWorkspaceUpdate,
  handleWorkspaceUpload,
  handleWorkspaceUploadChunk,
} from "../handlers/workspace.js";

/** Channel contract required by workspace-route HTTP dispatcher. */
export interface WorkspaceDispatchChannel {
  /** Handle workspace visibility toggles from the UI. */
  handleWorkspaceVisibility(req: Request): Promise<Response>;
  /** Optional override for GET `/workspace/tree` requests. */
  handleWorkspaceTree?(req: Request): Response;
  /** Optional override for GET `/workspace/file` requests. */
  handleWorkspaceFile?(req: Request): Response | Promise<Response>;
  /** Optional override for GET `/workspace/branch` requests. */
  handleWorkspaceBranch?(req: Request): Response;
  /** Optional override for GET `/workspace/index-status` requests. */
  handleWorkspaceIndexStatus?(req: Request): Response;
  /** Optional override for PUT `/workspace/file` requests. */
  handleWorkspaceUpdate?(req: Request): Promise<Response>;
  /** Optional override for DELETE `/workspace/file` requests. */
  handleWorkspaceDelete?(req: Request): Response;
  /** Optional override for GET `/workspace/raw` requests. */
  handleWorkspaceRaw?(req: Request): Response;
  /** Optional override for GET `/workspace/download` requests. */
  handleWorkspaceDownload?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/attach` requests. */
  handleWorkspaceAttach?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/upload` requests. */
  handleWorkspaceUpload?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/upload-chunk` requests. */
  handleWorkspaceUploadChunk?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/file` create requests. */
  handleWorkspaceCreate?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/rename` requests. */
  handleWorkspaceRename?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/move` requests. */
  handleWorkspaceMove?(req: Request): Promise<Response>;
  /** Optional override for POST `/workspace/reindex` requests. */
  handleWorkspaceReindex?(req: Request): Promise<Response>;
}

/**
 * Dispatch `/workspace/*` routes and return null when no workspace route matches.
 * @param channel Workspace dispatcher contract with optional handler overrides.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname used for route matching.
 * @returns Matched workspace response, or null when another dispatcher should continue.
 */
export async function handleWorkspaceRoutes(
  channel: WorkspaceDispatchChannel,
  req: Request,
  pathname: string
): Promise<Response | null> {
  if (req.method === "GET" && pathname === "/workspace/tree") {
    return channel.handleWorkspaceTree?.(req) ?? handleWorkspaceTree(req);
  }

  if (req.method === "GET" && pathname === "/workspace/file") {
    return channel.handleWorkspaceFile?.(req) ?? handleWorkspaceFile(req);
  }

  if (req.method === "GET" && pathname === "/workspace/stat") {
    return handleWorkspaceStat(req);
  }

  if (req.method === "GET" && pathname === "/workspace/branch") {
    return channel.handleWorkspaceBranch?.(req) ?? handleWorkspaceBranch(req);
  }

  if (req.method === "GET" && pathname === "/workspace/index-status") {
    return channel.handleWorkspaceIndexStatus?.(req) ?? handleWorkspaceIndexStatus(req);
  }

  if (req.method === "PUT" && pathname === "/workspace/file") {
    return await (channel.handleWorkspaceUpdate?.(req) ?? handleWorkspaceUpdate(req));
  }

  if (req.method === "DELETE" && pathname === "/workspace/file") {
    return channel.handleWorkspaceDelete?.(req) ?? handleWorkspaceDelete(req);
  }

  if (req.method === "GET" && pathname === "/workspace/raw") {
    return channel.handleWorkspaceRaw?.(req) ?? handleWorkspaceRaw(req);
  }

  if (req.method === "GET" && pathname === "/workspace/download") {
    return await (channel.handleWorkspaceDownload?.(req) ?? handleWorkspaceDownload(req));
  }

  if (req.method === "POST" && pathname === "/workspace/attach") {
    return await (channel.handleWorkspaceAttach?.(req) ?? handleWorkspaceAttach(req));
  }

  if (req.method === "POST" && pathname === "/workspace/upload") {
    return await (channel.handleWorkspaceUpload?.(req) ?? handleWorkspaceUpload(req));
  }

  if (req.method === "POST" && pathname === "/workspace/upload-chunk") {
    return await (channel.handleWorkspaceUploadChunk?.(req) ?? handleWorkspaceUploadChunk(req));
  }

  if (req.method === "POST" && pathname === "/workspace/file") {
    return await (channel.handleWorkspaceCreate?.(req) ?? handleWorkspaceCreate(req));
  }

  if (req.method === "POST" && pathname === "/workspace/rename") {
    return await (channel.handleWorkspaceRename?.(req) ?? handleWorkspaceRename(req));
  }

  if (req.method === "POST" && pathname === "/workspace/move") {
    return await (channel.handleWorkspaceMove?.(req) ?? handleWorkspaceMove(req));
  }

  if (req.method === "POST" && pathname === "/workspace/reindex") {
    return await (channel.handleWorkspaceReindex?.(req) ?? handleWorkspaceReindex(req));
  }

  if (req.method === "POST" && pathname === "/workspace/visibility") {
    return channel.handleWorkspaceVisibility(req);
  }

  return null;
}
