/**
 * web/media-service.ts – File upload and retrieval service.
 *
 * Wraps db/media.ts operations with validation:
 *   - File size limit (configurable; default 32 MB) — returns 413 if exceeded
 *   - Content-type normalization (non-image types are served as downloads)
 *
 * Consumers: web/handlers/media.ts delegates to MediaService methods.
 */

import { readFileSync, statSync } from "fs";
import { resolveAudioContentType } from "../../../utils/audio-media.js";
import { basename, extname } from "path";
import { createMediaInDatabase, getMediaById, getMediaInfoById } from "../../../db/media.js";
import type Database from "bun:sqlite";
import { DATABASE_ATTACHMENT_MAX_BYTES } from "../../../core/upload-limits.js";
import { getDb, getDatabaseBinding } from "../../../db/connection.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { getWorkspaceDir, getStoreDir, getConfigPath } from "../../../core/config.js";
import { getWebRuntimeConfig } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.media");

/**
 * Resolve the database-backed attachment ceiling, capped by the shared upload
 * limit. Larger chat attachments use /media/upload-chunk and workspace storage.
 * The per-request HTTP cap does not apply to their total assembled size.
 */
function getMaxMediaUploadBytes(): number {
  return Math.min(DATABASE_ATTACHMENT_MAX_BYTES, Math.max(1, Math.round(getWebRuntimeConfig().workspaceUploadLimitMb * 1024 * 1024)));
}

/**
 * File upload/download service wrapping db/media.ts operations.
 * Validates size and normalizes content type before persisting.
 */
const normalizeContentType = (value: string | undefined, fallback?: string): string => {
  const type = (value || fallback || "application/octet-stream").toLowerCase();
  return type || "application/octet-stream";
};

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "text/xml",
  ".json": "application/json",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript",
  ".zip": "application/zip",
  ".gz": "application/gzip",
};

const inferContentTypeFromPath = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();
  return EXTENSION_MEDIA_TYPES[extension] || "application/octet-stream";
};

const TEXT_SNIFF_EXTENSIONS = new Set([".sb"]);

function isProbablyTextData(data: Uint8Array): boolean {
  if (!(data instanceof Uint8Array) || data.length === 0) return true;
  const sample = data.subarray(0, Math.min(data.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12;
    if (isControl) suspicious += 1;
  }
  return suspicious / sample.length < 0.02;
}

function maybePromoteUnknownTextType(pathLike: string, contentType: string, data: Uint8Array): string {
  const normalized = normalizeContentType(contentType);
  const extension = extname(pathLike).toLowerCase();
  if (normalized !== "application/octet-stream") return normalized;
  if (!TEXT_SNIFF_EXTENSIONS.has(extension)) return normalized;
  return isProbablyTextData(data) ? "text/plain" : normalized;
}

/** Synchronous SQL-only authority checks; the HTTP caller supplies request authority. */
export interface MediaWriteAdmissionOptions {
  authorise?: (phase: 'before' | 'after') => void;
  signal?: AbortSignal;
}

function captureMediaBinding(database: Database, singleton: boolean): () => void {
  const binding = getDatabaseBinding();
  const paths = JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]);
  const file = (database.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')?.file;
  const identity = () => { const stat = statSync(file!); return `${stat.dev}:${stat.ino}`; };
  const original = file ? identity() : undefined;
  return () => {
    if (singleton && (getDb() !== database || JSON.stringify(getDatabaseBinding()) !== JSON.stringify(binding)
      || JSON.stringify([getWorkspaceDir(), getStoreDir(), getConfigPath()]) !== paths)) {
      throw Error('Media database binding changed.');
    }
    if (file && identity() !== original) throw Error('Media database file changed.');
  };
}

/**
 * Service for validating and persisting uploaded media blobs.
 *
 * Used by web handlers and IPC path-based ingestion to create media rows and
 * retrieve media payloads/metadata for rendering and downloads.
 */
export class MediaService {
  /**
   * Validate and store an uploaded file.
   * Returns 413 if file exceeds the configured compose/media upload limit.
   */
  async createFromFile(file: File, database?: Database, onCreated?: (mediaId: number) => void, admission: MediaWriteAdmissionOptions = {}): Promise<{ status: number; body: unknown }> {
    // Size check — reject before reading the full body into memory
    const maxMediaUploadBytes = getMaxMediaUploadBytes();
    if (file.size > maxMediaUploadBytes) {
      return {
        status: 413,
        body: { error: `File too large (max ${maxMediaUploadBytes / 1024 / 1024} MB)` },
      };
    }

    const target = database ?? getDb();
    const assertBinding = captureMediaBinding(target, !database);
    admission.signal?.throwIfAborted();
    const check = (phase: 'before' | 'after') => { assertBinding(); admission.authorise?.(phase); };
    const detectedContentType = resolveAudioContentType(file.type, file.name)
      || normalizeContentType(file.type, inferContentTypeFromPath(file.name || "upload"));

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const contentType = maybePromoteUnknownTextType(file.name || "upload", detectedContentType, data);

    // Generate a thumbnail for image uploads
    let thumbnail: Uint8Array | null = null;
    if (contentType.startsWith("image/") && !contentType.includes("svg")) {
      try {
        const { generateThumbnail } = await import("../../../utils/image-processing.js");
        const thumb = await generateThumbnail(data);
        if (thumb) thumbnail = new Uint8Array(thumb.data);
      } catch (error) {
        debugSuppressedError(log, "Thumbnail generation failed; skipping.", error);
      }
    }

    const mediaId = await admitSqliteWrite(target, () => {
      const id = createMediaInDatabase(target, file.name || "upload", contentType, data, thumbnail, { size: file.size });
      const result: unknown = onCreated?.(id);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).then(() => undefined, () => undefined);
        throw Error('Media ownership callback must be synchronous.');
      }
      return id;
    }, check, admission.signal, 5000, assertBinding);

    return { status: 200, body: { id: mediaId, filename: file.name, size: file.size, contentType } };
  }

  /**
   * Validate and store a file by filesystem path.
   * Returns 413 if file exceeds the configured compose/media upload limit.
   * Returns 404 if the file does not exist.
   */
  async createFromPath(filePath: string, contentTypeOverride?: string, filenameOverride?: string, admission: MediaWriteAdmissionOptions = {}): Promise<{ status: number; body: unknown }> {
    const database = getDb();
    const assertBinding = captureMediaBinding(database, true);
    admission.signal?.throwIfAborted();
    const check = (phase: 'before' | 'after') => { assertBinding(); admission.authorise?.(phase); };
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(filePath);
    } catch {
      return { status: 404, body: { error: `Media file not found: ${filePath}` } };
    }

    if (!stats.isFile()) {
      return { status: 400, body: { error: `Media path is not a regular file: ${filePath}` } };
    }

    const maxMediaUploadBytes = getMaxMediaUploadBytes();
    if (stats.size > maxMediaUploadBytes) {
      return {
        status: 413,
        body: { error: `File too large (max ${maxMediaUploadBytes / 1024 / 1024} MB)` },
      };
    }

    const detectedContentType = resolveAudioContentType(contentTypeOverride, filenameOverride || filePath)
      || normalizeContentType(contentTypeOverride, inferContentTypeFromPath(filePath));

    let data: Uint8Array;
    try {
      data = readFileSync(filePath);
    } catch {
      return { status: 500, body: { error: `Unable to read media file: ${filePath}` } };
    }

    const contentType = maybePromoteUnknownTextType(filenameOverride || filePath, detectedContentType, data);

    // Generate a thumbnail for image uploads
    let thumbnail: Uint8Array | null = null;
    if (contentType.startsWith("image/") && !contentType.includes("svg")) {
      try {
        const { generateThumbnail } = await import("../../../utils/image-processing.js");
        const thumb = await generateThumbnail(data);
        if (thumb) thumbnail = new Uint8Array(thumb.data);
      } catch (error) {
        debugSuppressedError(log, "Thumbnail generation failed; skipping.", error);
      }
    }

    const mediaId = await admitSqliteWrite(database, () => createMediaInDatabase(
      database,
      filenameOverride || basename(filePath),
      contentType,
      data,
      thumbnail,
      { size: stats.size }
    ), check, admission.signal, 5000, assertBinding);

    return {
      status: 200,
      body: {
        id: mediaId,
        filename: filenameOverride || basename(filePath),
        size: stats.size,
        contentType,
      },
    };
  }

  getMedia(id: number, thumbnail: boolean): { status: number; body: Blob; contentType?: string; filename?: string } {
    const media = getMediaById(id);
    if (!media) return { status: 404, body: new Blob([JSON.stringify({ error: "Media not found" })]) };

    const blob = thumbnail && media.thumbnail ? media.thumbnail : media.data;
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer;
    const body = new Blob([buffer], { type: media.content_type });
    return { status: 200, body, contentType: resolveAudioContentType(media.content_type, media.filename) || media.content_type, filename: media.filename };
  }

  getInfo(id: number): { status: number; body: unknown } {
    const info = getMediaInfoById(id);
    if (!info) return { status: 404, body: { error: "Media not found" } };
    return { status: 200, body: info };
  }
}
