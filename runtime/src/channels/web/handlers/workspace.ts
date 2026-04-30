/**
 * web/handlers/workspace.ts – HTTP handlers for the workspace explorer API.
 *
 * Handles GET /workspace/tree, GET /workspace/file, PUT/DELETE /workspace/file,
 * and upload/download/attach workspace endpoints for the web UI sidebar.
 *
 * Consumers: web/http/dispatch-workspace.ts routes workspace paths here.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import * as path from "path";

import { errorJson, jsonResponse } from "../http/http-utils.js";
import { WorkspaceService } from "../workspace/service.js";
import { isRealWorkspacePath, resolveWorkspacePath, toRelativePath } from "../workspace/paths.js";
import { formatMtime } from "../workspace/file-utils.js";

const workspaceService = new WorkspaceService();

/** Contract required by the workspace watcher bridge. */
export interface WorkspaceWatcherChannel {
  /** Whether the workspace pane is currently visible in the web UI. */
  workspaceVisible: boolean;
  /** Whether hidden files should be included in watcher-driven updates. */
  workspaceShowHidden: boolean;
  /** Broadcast a workspace event payload to subscribed web clients. */
  broadcastEvent(eventType: string, data: unknown): void;
}

/**
 * Handle GET `/workspace/tree` requests for sidebar tree listing.
 * @param req Incoming HTTP request containing optional path/depth/show_hidden filters.
 * @returns JSON response with tree payload or a validation/service error body.
 */
export function handleWorkspaceTree(req: Request): Response {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("show_hidden") === "1" || url.searchParams.get("show_hidden") === "true";
  const result = workspaceService.getTree(
    url.searchParams.get("path"),
    url.searchParams.get("depth"),
    showHidden
  );
  return jsonResponse(result.body, result.status);
}

/**
 * Handle GET `/workspace/file` requests to read workspace file content.
 * @param req Incoming HTTP request with path/max/mode query parameters.
 * @returns JSON response containing file content metadata or an error payload.
 */
export function handleWorkspaceFile(req: Request): Response {
  const url = new URL(req.url);
  const result = workspaceService.getFile(
    url.searchParams.get("path"),
    url.searchParams.get("max"),
    url.searchParams.get("mode")
  );
  return jsonResponse(result.body, result.status);
}

/**
 * Handle GET `/workspace/stat` requests — lightweight mtime-only check.
 * Returns { path, mtime, size } without reading file content.
 */
export function handleWorkspaceStat(req: Request): Response {
  const url = new URL(req.url);
  const targetPath = resolveWorkspacePath(url.searchParams.get("path"));
  if (!targetPath) return jsonResponse({ error: "Invalid path" }, 400);
  if (existsSync(targetPath) && !isRealWorkspacePath(targetPath)) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }
  try {
    const stats = statSync(targetPath);
    return jsonResponse({
      path: toRelativePath(targetPath),
      mtime: formatMtime(stats),
      size: stats.size,
    }, 200);
  } catch {
    return jsonResponse({ error: "File not found" }, 404);
  }
}

/**
 * Handle GET `/workspace/branch` requests to resolve the nearest git branch.
 * @param req Incoming HTTP request with optional path query parameter.
 * @returns JSON response containing branch metadata or an error payload.
 */
export function handleWorkspaceBranch(req: Request): Response {
  const url = new URL(req.url);
  const result = workspaceService.getGitBranch(url.searchParams.get("path"));
  return jsonResponse(result.body, result.status);
}

/**
 * Handle GET `/workspace/index-status` requests for workspace FTS lifecycle status.
 * @param req Incoming HTTP request with optional `scope` query parameter.
 * @returns JSON response containing the current workspace index status snapshot.
 */
export function handleWorkspaceIndexStatus(req: Request): Response {
  const url = new URL(req.url);
  const result = workspaceService.getIndexStatus(url.searchParams.get("scope"));
  return jsonResponse(result.body, result.status);
}

/**
 * Handle PUT `/workspace/file` requests to update file contents.
 * @param req Incoming HTTP request containing JSON `{ path, content }`.
 * @returns JSON response with update result, or a 400 error for invalid/missing input.
 */
export async function handleWorkspaceUpdate(req: Request): Promise<Response> {
  let data: { path?: string; content?: string };
  try {
    data = await req.json();
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  if (!data?.path) {
    return errorJson("Missing path", 400);
  }

  const result = workspaceService.updateFile(data.path, data.content ?? "");
  return jsonResponse(result.body, result.status);
}

/**
 * Handle DELETE `/workspace/file` requests to remove a file or directory entry.
 * @param req Incoming HTTP request with `path` query parameter.
 * @returns JSON response describing delete success or failure.
 */
export function handleWorkspaceDelete(req: Request): Response {
  const url = new URL(req.url);
  const result = workspaceService.deleteFile(url.searchParams.get("path"));
  return jsonResponse(result.body, result.status);
}

/**
 * Handle GET `/workspace/raw` requests by streaming raw file content.
 * @param req Incoming HTTP request with file path and optional range headers.
 * @returns File response with security/range headers, or an error response when file access fails.
 */
function buildWorkspaceRawCsp(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.startsWith('text/html')) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https: http:",
      "frame-src 'self' blob:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }
  return "default-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
}

export function handleWorkspaceRaw(req: Request): Response {
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
  const result = workspaceService.getRaw(url.searchParams.get("path"), download);
  if (result.status !== 200) {
    return new Response(result.body as string, {
      status: result.status,
      headers: {
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      },
    });
  }

  const contentType = result.contentType || "application/octet-stream";
  const contentSecurityPolicy = buildWorkspaceRawCsp(contentType);
  const file = result.body as ReturnType<typeof Bun.file>;
  const filePath = result.filePath || null;
  const fileSize = typeof result.size === "number" ? result.size : (typeof file?.size === "number" ? file.size : 0);
  const downloadFilename = String(result.filename || "download").replace(/["\\]/g, "_");
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": contentSecurityPolicy,
    ...(result.download ? { "Content-Disposition": `attachment; filename="${downloadFilename}"` } : {}),
  };

  const readRangeChunk = (start: number, chunkSize: number): Uint8Array | null => {
    if (!filePath || chunkSize <= 0) return null;
    const buffer = new Uint8Array(chunkSize);
    let fd: number | null = null;
    try {
      fd = openSync(filePath, "r");
      const bytesRead = readSync(fd, buffer, 0, chunkSize, start);
      return bytesRead === chunkSize ? buffer : buffer.subarray(0, Math.max(0, bytesRead));
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* expected: fd may already be closed on range-read failure paths. */ }
      }
    }
  };

  // Handle Range requests (required for <video>/<audio> playback)
  const rangeHeader = req.headers.get("range");
  if (rangeHeader && fileSize > 0) {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      const clampedEnd = Math.min(end, fileSize - 1);
      if (start >= fileSize || start > clampedEnd) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
            ...baseHeaders,
          },
        });
      }
      const chunkSize = clampedEnd - start + 1;
      const chunk = readRangeChunk(start, chunkSize);
      if (!chunk) {
        return new Response("Failed to read file", { status: 500, headers: baseHeaders });
      }
      const chunkBody = new Blob([Uint8Array.from(chunk)], { type: contentType });
      return new Response(chunkBody, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${clampedEnd}/${fileSize}`,
          "Content-Length": String(chunk.length),
        },
      });
    }
  }

  return new Response(file, {
    headers: {
      ...baseHeaders,
      ...(fileSize > 0 ? { "Content-Length": String(fileSize) } : {}),
    },
  });
}

/**
 * Handle POST `/workspace/attach` requests to attach a file into agent context.
 * @param req Incoming HTTP request containing JSON `{ path }`.
 * @returns JSON response with attachment metadata or validation/service errors.
 */
export async function handleWorkspaceAttach(req: Request): Promise<Response> {
  let data: { path?: string };
  try {
    data = await req.json();
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  const result = workspaceService.attachFile(data.path || null);
  return jsonResponse(result.body, result.status);
}

/**
 * Handle POST `/workspace/upload` requests to upload files into the workspace.
 * @param req Incoming HTTP request containing multipart form data and overwrite options.
 * @returns JSON response with upload result or validation errors.
 */
export async function handleWorkspaceUpload(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorJson("Invalid form data", 400);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorJson("Missing file", 400);
  }

  const overwrite = url.searchParams.get("overwrite") === "1" || url.searchParams.get("overwrite") === "true";
  const result = await workspaceService.uploadFile(url.searchParams.get("path"), file, overwrite);
  return jsonResponse(result.body, result.status);
}

function readRequiredHeader(req: Request, name: string): string | null {
  const value = req.headers.get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readRequiredHeaderInt(req: Request, name: string): number | null {
  const value = readRequiredHeader(req, name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Handle POST `/workspace/upload-chunk` requests for chunked workspace uploads.
 * Accepts raw request-body bytes plus upload metadata headers.
 */
export async function handleWorkspaceUploadChunk(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const uploadId = readRequiredHeader(req, "X-Upload-Id");
  const chunkIndex = readRequiredHeaderInt(req, "X-Chunk-Index");
  const chunkTotal = readRequiredHeaderInt(req, "X-Chunk-Total");
  const fileName = readRequiredHeader(req, "X-File-Name");
  const fileSize = readRequiredHeaderInt(req, "X-File-Size");
  if (!uploadId || chunkIndex === null || chunkTotal === null || !fileName || fileSize === null) {
    return errorJson("Missing upload chunk metadata", 400);
  }

  let data: Uint8Array;
  try {
    data = new Uint8Array(await req.arrayBuffer());
  } catch {
    return errorJson("Invalid upload body", 400);
  }

  const overwrite = url.searchParams.get("overwrite") === "1" || url.searchParams.get("overwrite") === "true";
  const result = await workspaceService.uploadChunk({
    pathParam: url.searchParams.get("path"),
    uploadId,
    chunkIndex,
    chunkTotal,
    fileName,
    fileSize,
    overwrite,
    data,
  });
  return jsonResponse(result.body, result.status);
}

/**
 * Handle POST `/workspace/file` requests to create a new workspace file.
 * @param req Incoming HTTP request containing JSON `{ path, name, content }`.
 * @returns JSON response with created file metadata or validation errors.
 */
export async function handleWorkspaceCreate(req: Request): Promise<Response> {
  let data: { path?: string; name?: string; content?: string };
  try {
    data = await req.json();
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  if (!data?.name) {
    return errorJson("Missing filename", 400);
  }

  const result = workspaceService.createFile(data.path ?? null, data.name ?? null, data.content ?? "");
  return jsonResponse(result.body, result.status);
}

/**
 * Handle POST `/workspace/rename` requests to rename a file or folder.
 * @param req Incoming HTTP request containing JSON `{ path, name }`.
 * @returns JSON response with rename outcome or validation errors.
 */
export async function handleWorkspaceRename(req: Request): Promise<Response> {
  let data: { path?: string; name?: string };
  try {
    data = await req.json();
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  if (!data?.path) {
    return errorJson("Missing path", 400);
  }

  if (!data?.name) {
    return errorJson("Missing filename", 400);
  }

  const result = workspaceService.renameFile(data.path ?? null, data.name ?? null);
  return jsonResponse(result.body, result.status);
}

/**
 * Handle POST `/workspace/move` requests to move a file or folder.
 * @param req Incoming HTTP request containing JSON `{ path, target }`.
 * @returns JSON response with move result or validation errors.
 */
export async function handleWorkspaceMove(req: Request): Promise<Response> {
  let data: { path?: string; target?: string };
  try {
    data = await req.json();
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  if (!data?.path) {
    return errorJson("Missing path", 400);
  }

  if (!data?.target) {
    return errorJson("Missing target", 400);
  }

  const result = workspaceService.moveEntry(data.path ?? null, data.target ?? null);
  return jsonResponse(result.body, result.status);
}

/**
 * Handle POST `/workspace/reindex` requests to rebuild workspace FTS state.
 * @param req Incoming HTTP request containing optional JSON `{ scope }`.
 * @returns JSON response with the updated workspace index status snapshot.
 */
export async function handleWorkspaceReindex(req: Request): Promise<Response> {
  let data: { scope?: string } = {};
  try {
    const text = await req.text();
    if (text.trim()) data = JSON.parse(text);
  } catch {
    return errorJson("Invalid JSON", 400);
  }

  const result = await workspaceService.reindex(data.scope ?? null);
  return jsonResponse(result.body, result.status);
}

/**
 * Handle GET `/workspace/download` requests by streaming a ZIP archive.
 * @param req Incoming HTTP request with optional path/show_hidden query options.
 * @returns ZIP stream response on success, or JSON error response on failure.
 */
export async function handleWorkspaceDownload(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("show_hidden") === "1" || url.searchParams.get("show_hidden") === "true";
  const result = await workspaceService.downloadZip(url.searchParams.get("path"), showHidden);
  if (result.status !== 200) {
    return jsonResponse(result.body, result.status);
  }
  return new Response(result.body as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=\"${result.filename || "workspace.zip"}\"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Start filesystem watching for workspace updates and broadcast them over SSE.
 * @param channel Watcher channel contract providing visibility flags and event broadcasting.
 * @returns Watch handle with an async `close()` method for cleanup.
 */
export function startWorkspaceWatcher(channel: WorkspaceWatcherChannel): { close: () => Promise<void> } {
  return workspaceService.startWatcher(
    (updates) => {
      if (!channel.workspaceVisible) return;
      channel.broadcastEvent("workspace_update", { updates });
    },
    () => channel.workspaceShowHidden
  );
}
