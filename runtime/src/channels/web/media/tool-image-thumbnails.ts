/**
 * web/media/tool-image-thumbnails.ts – small previews of images returned by tools.
 *
 * Tool results (view_image, read, codemode …) keep full images in the durable
 * transcript for the model. The timeline shows them as thumbnails instead:
 * each source image is downscaled once to a bounded WebP and stored under a
 * content-addressed name, so repeated views and reloads reuse the stored copy.
 *
 * Consumers: handlers/turn-activity.ts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATA_DIR } from "../../../core/config.js";
import { resizeImage } from "../../../utils/image-processing.js";

/** Longest edge of a stored thumbnail, in pixels. */
export const TOOL_IMAGE_THUMBNAIL_EDGE = 320;
/** Encoded source images above this are not decoded for previews. */
const MAX_SOURCE_BASE64 = 32 * 1024 * 1024;
/** Stored thumbnails kept (most recently used first); about 20 MB at typical sizes. */
export const TOOL_IMAGE_THUMBNAIL_KEEP = 2000;
const PRUNE_EVERY = 100;
let writesSincePrune = 0;

/** Remove the least recently used thumbnails beyond `keep`. */
export function pruneToolImageThumbnails(cacheDir: string, keep = TOOL_IMAGE_THUMBNAIL_KEEP): number {
  if (!existsSync(cacheDir)) return 0;
  const files = readdirSync(cacheDir).filter((name) => name.endsWith(".webp"))
    .map((name) => ({ path: join(cacheDir, name), used: statSync(join(cacheDir, name)).mtimeMs }))
    .sort((a, b) => b.used - a.used);
  for (const file of files.slice(keep)) unlinkSync(file.path);
  return Math.max(0, files.length - keep);
}

export const defaultToolImageThumbnailDir = () => resolve(DATA_DIR, "cache", "tool-image-thumbnails");

/** A stored WebP thumbnail for one base64 tool-result image, or null if it cannot be decoded. */
export async function toolImageThumbnail(base64: string, cacheDir = defaultToolImageThumbnailDir()): Promise<Uint8Array | null> {
  if (!base64 || base64.length > MAX_SOURCE_BASE64) return null;
  const key = createHash("sha256").update(base64).digest("hex");
  const file = join(cacheDir, `${key}-${TOOL_IMAGE_THUMBNAIL_EDGE}.webp`);
  if (existsSync(file)) {
    const now = new Date();
    utimesSync(file, now, now); // mark as recently used for pruning
    return readFileSync(file);
  }
  const resized = await resizeImage(Buffer.from(base64, "base64"), {
    maxWidth: TOOL_IMAGE_THUMBNAIL_EDGE, maxHeight: TOOL_IMAGE_THUMBNAIL_EDGE, quality: 72, format: "webp",
  });
  if (!resized) return null;
  mkdirSync(cacheDir, { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, resized.data);
  renameSync(temp, file);
  if (++writesSincePrune >= PRUNE_EVERY) { writesSincePrune = 0; pruneToolImageThumbnails(cacheDir); }
  return resized.data;
}
