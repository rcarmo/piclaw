/**
 * web/media/tool-image-thumbnails.ts – small previews of images returned by tools.
 *
 * Tool results (view_image, read, codemode …) keep full images in the durable
 * transcript for the model. The timeline shows reduced previews. Like other
 * timeline media they live in the `media` table, linked to the reply's
 * timeline row through `message_inline_media`, so deleting the reply deletes
 * them. A preview is made on first view and reused afterwards. The running
 * turn has no reply row yet, so its previews are made per request and not kept.
 *
 * Consumers: handlers/turn-activity.ts.
 */

import { getDb } from "../../../db/connection.js";
import { createMediaInDatabase, getMediaByIdFromDatabase } from "../../../db/media.js";
import { getMessageInlineMedia, putMessageInlineMedia } from "../../../db/message-inline-media.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { resizeImage } from "../../../utils/image-processing.js";

/** Longest edge of a preview, in pixels. */
export const TOOL_IMAGE_THUMBNAIL_EDGE = 320;
/** Encoded source images above this are not decoded for previews. */
const MAX_SOURCE_BASE64 = 32 * 1024 * 1024;

/** Downscale one base64 tool-result image to a WebP preview, or null if it cannot be decoded. */
export async function renderToolImageThumbnail(base64: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  if (!base64 || base64.length > MAX_SOURCE_BASE64) return null;
  const resized = await resizeImage(Buffer.from(base64, "base64"), {
    maxWidth: TOOL_IMAGE_THUMBNAIL_EDGE, maxHeight: TOOL_IMAGE_THUMBNAIL_EDGE, quality: 72, format: "webp",
  });
  return resized ? { data: resized.data, width: resized.width, height: resized.height } : null;
}

/**
 * The stored preview for image `index` of tool call `callId` in the reply at
 * `messageRowId`, created on first use. Returns null if the image cannot be
 * decoded. If the reply was deleted meanwhile, the preview is served unstored.
 */
export async function storedToolImageThumbnail(chatJid: string, messageRowId: number, callId: string, index: number, base64: string): Promise<Uint8Array | null> {
  const database = getDb();
  const binding = () => { if (getDb() !== database) throw Error("Tool image preview database changed"); };
  const ref = `${callId}:${index}`;
  const existing = getMessageInlineMedia(database, messageRowId, "tool_image", ref);
  const stored = existing === undefined ? undefined : getMediaByIdFromDatabase(database, existing);
  if (stored) return stored.data;
  const preview = await renderToolImageThumbnail(base64);
  if (!preview) return null;
  await admitSqliteWrite(database, () => {
    const reply = database.prepare("SELECT 1 FROM messages WHERE chat_jid = ? AND rowid = ?").get(chatJid, messageRowId);
    if (!reply || getMessageInlineMedia(database, messageRowId, "tool_image", ref) !== undefined) return;
    const mediaId = createMediaInDatabase(database, `tool-image-${callId}-${index}.webp`, "image/webp", preview.data, null, {
      cache_kind: "tool_image_thumbnail", size: preview.data.byteLength, width: preview.width, height: preview.height,
    });
    putMessageInlineMedia(database, messageRowId, "tool_image", ref, mediaId);
  }, undefined, undefined, undefined, binding);
  return preview.data;
}
