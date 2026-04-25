/**
 * db/media-compression.ts — Transparent gzip compression for non-image media.
 *
 * Non-image attachments (text, code, JSON, SVG, markdown, etc.) are
 * gzip-compressed when stored in the media table and transparently
 * decompressed when read. This reduces SQLite database size significantly
 * for text-heavy workloads.
 *
 * The `metadata` JSON field gets a `compressed: "gzip"` flag when compressed.
 * Reading code checks for this flag and decompresses automatically.
 */

import { gzipSync, gunzipSync } from "bun";

// Bun's gzip functions have strict ArrayBuffer typing; cast via Buffer.
function compress(data: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(data)));
}
function decompress(data: Uint8Array): Uint8Array {
  return new Uint8Array(gunzipSync(Buffer.from(data)));
}

/** Content types that should NOT be compressed (already compressed or binary). */
const SKIP_COMPRESSION = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp",
  "image/avif", "image/bmp", "image/tiff",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "video/mp4", "video/webm", "video/ogg",
  "application/zip", "application/gzip", "application/x-gzip",
  "application/x-bzip2", "application/x-xz", "application/x-7z-compressed",
  "application/x-rar-compressed", "application/x-tar",
  "application/pdf",
  "application/wasm",
]);

/** Minimum size in bytes to bother compressing. */
const MIN_COMPRESS_SIZE = 256;

/** Check if a content type is eligible for compression. */
export function isCompressible(contentType: string): boolean {
  if (!contentType) return false;
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (SKIP_COMPRESSION.has(ct)) return false;
  // Compress text/*, application/json, application/xml, etc.
  if (ct.startsWith("text/")) return true;
  if (ct.startsWith("image/svg")) return true;
  if (ct === "application/json" || ct === "application/xml" || ct === "application/javascript") return true;
  if (ct === "application/x-yaml" || ct === "application/yaml") return true;
  return false;
}

/**
 * Compress data if eligible. Returns { data, metadata } with the
 * compressed flag set in metadata when compression was applied.
 */
export function maybeCompress(
  data: Uint8Array,
  contentType: string,
  metadata: Record<string, unknown> | null,
): { data: Uint8Array; metadata: Record<string, unknown> | null } {
  if (!isCompressible(contentType) || data.length < MIN_COMPRESS_SIZE) {
    return { data, metadata };
  }
  try {
    const compressed = compress(data);
    // Only keep compressed version if it's actually smaller
    if (compressed.length >= data.length) return { data, metadata };
    const updatedMeta = { ...(metadata || {}), compressed: "gzip", originalSize: data.length };
    return { data: new Uint8Array(compressed), metadata: updatedMeta };
  } catch {
    return { data, metadata };
  }
}

/**
 * Decompress data if the metadata indicates compression.
 * Returns the original uncompressed data.
 */
export function maybeDecompress(
  data: Uint8Array,
  metadata: Record<string, unknown> | null,
): Uint8Array {
  if (!metadata || metadata.compressed !== "gzip") return data;
  try {
    return decompress(data);
  } catch {
    // If decompression fails, return raw data (might be uncompressed despite flag)
    return data;
  }
}

/** Check if a metadata object indicates the data is compressed. */
export function isCompressed(metadata: Record<string, unknown> | null): boolean {
  return Boolean(metadata && metadata.compressed === "gzip");
}
