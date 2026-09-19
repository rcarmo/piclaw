/**
 * web/handlers/media.ts – HTTP handlers for media upload and retrieval.
 *
 * Handles POST /media/upload (file upload) and GET /media/:id (download/thumbnail).
 * Media uploads are validated by MediaService (size + content-type checks).
 * Downloads use Content-Disposition: attachment for types that are not safe
 * browser media, preventing stored XSS via HTML/SVG file uploads.
 *
 * Consumers: web/http/dispatch-media.ts routes media paths here.
 */

import { buildContentDisposition } from "../http/content-disposition.js";
import { MediaService } from "../media/media-service.js";

const mediaService = new MediaService();

/** Minimal response contract needed by media endpoint handlers. */
export interface MediaResponseContext {
  /** Build JSON responses for media endpoint success/error payloads. */
  json(payload: unknown, status?: number): Response;
}

/**
 * Handle POST `/media` requests for media upload.
 * @param channel Response context used to encode JSON result payloads.
 * @param req Incoming HTTP request containing multipart form data with `file`.
 * @returns JSON response with created media metadata or validation errors.
 */
export async function handleMediaUpload(channel: MediaResponseContext, req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return channel.json({ error: "Invalid form data" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return channel.json({ error: "Missing file" }, 400);

  const result = await mediaService.createFromFile(file);
  return channel.json(result.body, result.status);
}

/**
 * Content types safe to serve inline (rendered by the browser).
 * All other types get Content-Disposition: attachment to force download
 * and prevent stored XSS (e.g., an uploaded HTML file executing JS).
 */
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
]);

function isInlineSafeType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() || "";
  return INLINE_SAFE_TYPES.has(normalized) || normalized.startsWith("audio/");
}

/**
 * Resolve media binary requests, including thumbnail and inline/attachment behavior.
 * @param channel Response context used for JSON errors.
 * @param id Media row id to fetch.
 * @param thumbnail Whether to return a thumbnail variant when available.
 * @returns Binary media response on success, or JSON error response when media is missing.
 */
export function handleMedia(channel: MediaResponseContext, id: number, thumbnail: boolean): Response {
  const result = mediaService.getMedia(id, thumbnail);
  if (result.status !== 200) return channel.json({ error: "Media not found" }, result.status);

  const contentType = result.contentType || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    ...(result.body.size > 0 ? { "Content-Length": String(result.body.size) } : {}),
  };
  // Force download for types that are not safe browser media to prevent stored
  // XSS via HTML/SVG uploads. Audio remains inline so the native player can load it.
  // Include a concrete filename because iOS Safari can ignore the HTML download
  // attribute for PDFs and will otherwise open the response fullscreen.
  if (!isInlineSafeType(contentType)) {
    headers["Content-Disposition"] = buildContentDisposition("attachment", result.filename || `attachment-${id}`);
  }
  return new Response(result.body, { headers });
}

/**
 * Handle GET `/media/:id/info` metadata lookup requests.
 * @param channel Response context used to serialize JSON payloads.
 * @param id Media row id to inspect.
 * @returns JSON response containing media metadata or not-found status.
 */
export function handleMediaInfo(channel: MediaResponseContext, id: number): Response {
  const result = mediaService.getInfo(id);
  return channel.json(result.body, result.status);
}
