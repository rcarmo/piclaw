/**
 * db/media-recompress.ts — One-time migration to compress existing uncompressed media.
 *
 * Scans the media table for text-based records that aren't yet compressed,
 * compresses them, and updates in place. Safe to run multiple times.
 *
 * Called from the startup migration path when upgrading to 2.0.
 */

import { getDb } from "./connection.js";
import { isCompressible, maybeCompress } from "./media-compression.js";

export interface RecompressResult {
  scanned: number;
  compressed: number;
  savedBytes: number;
  skipped: number;
  errors: number;
}

export function recompressExistingMedia(): RecompressResult {
  const db = getDb();
  const result: RecompressResult = { scanned: 0, compressed: 0, savedBytes: 0, skipped: 0, errors: 0 };

  // Fetch all media IDs and types (without loading blobs)
  const rows = db
    .prepare("SELECT id, content_type, metadata FROM media")
    .all() as Array<{ id: number; content_type: string; metadata: string | null }>;

  result.scanned = rows.length;

  const updateStmt = db.prepare("UPDATE media SET data = ?, metadata = ? WHERE id = ?");

  for (const row of rows) {
    if (!isCompressible(row.content_type)) { result.skipped++; continue; }

    // Check if already compressed
    let meta: Record<string, unknown> | null = null;
    try { if (row.metadata) meta = JSON.parse(row.metadata); } catch (e) { void e; }
    if (meta?.compressed === "gzip") { result.skipped++; continue; }

    // Load the blob
    const blobRow = db
      .prepare("SELECT data FROM media WHERE id = ?")
      .get(row.id) as { data: Uint8Array } | undefined;
    if (!blobRow?.data) { result.skipped++; continue; }

    try {
      const { data: compressed, metadata: newMeta } = maybeCompress(blobRow.data, row.content_type, meta);
      if (newMeta?.compressed !== "gzip") { result.skipped++; continue; }

      const saved = blobRow.data.length - compressed.length;
      updateStmt.run(compressed, JSON.stringify(newMeta), row.id);
      result.compressed++;
      result.savedBytes += saved;
    } catch {
      result.errors++;
    }
  }

  return result;
}
