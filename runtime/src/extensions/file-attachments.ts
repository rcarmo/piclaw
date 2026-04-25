/**
 * file-attachments – registers the attach_file tool as an extension.
 *
 * The tool stores a file from the workspace as a media blob and registers
 * it with the shared AttachmentRegistry so the AgentPool can include
 * attachment metadata in the response.
 *
 * Reads the current chat JID from AsyncLocalStorage/env at execution time.
 */
import { basename, resolve, relative } from "path";
import { Type, type Static } from "@sinclair/typebox";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import { createMedia, getMediaById } from "../db.js";
import { WORKSPACE_DIR } from "../core/config.js";
import { AttachmentRegistry, getAttachmentRegistry } from "../agent-pool/attachments.js";
import { getChatJid } from "../core/chat-context.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("extensions.file-attachments");

// ── Schema ────────────────────────────────────────────────

const AttachmentSchema = Type.Object({
  path: Type.String({ description: "Path to a file inside the workspace." }),
  name: Type.Optional(Type.String({ description: "Optional display name for the attachment." })),
  content_type: Type.Optional(Type.String({ description: "Optional MIME type override." })),
  kind: Type.Optional(
    Type.Union([Type.Literal("image"), Type.Literal("file")], { description: "Force attachment kind." }),
  ),
});

const ReadAttachmentSchema = Type.Object({
  id: Type.Number({ description: "Attachment (media) ID to load." }),
  mode: Type.Optional(
    Type.Union(
      [Type.Literal("auto"), Type.Literal("text"), Type.Literal("image"), Type.Literal("base64")],
      { description: "How to return the attachment content." }
    )
  ),
  max_bytes: Type.Optional(Type.Number({ description: "Max bytes to read (default 5 MB)." })),
});

const ExportAttachmentSchema = Type.Object({
  id: Type.Number({ description: "Attachment (media) ID to export." }),
  filename: Type.Optional(Type.String({ description: "Optional filename override." })),
});

type AttachmentParams = Static<typeof AttachmentSchema>;
/** Attachment type: "file" for workspace files. */
export type AttachmentKind = "image" | "file";

type ReadAttachmentParams = Static<typeof ReadAttachmentSchema>;
type ExportAttachmentParams = Static<typeof ExportAttachmentSchema>;

// ── Helpers ───────────────────────────────────────────────

function resolveWorkspacePath(inputPath: string): string | null {
  if (!inputPath) return null;
  const resolved = resolve(WORKSPACE_DIR, inputPath);
  const rel = relative(WORKSPACE_DIR, resolved);
  if (rel.startsWith("..") || rel.startsWith("/")) return null;
  return resolved;
}

function detectContentType(path: string, fallback?: string): string {
  if (fallback) return fallback;
  try {
    const file = Bun.file(path);
    if (file.type) return file.type;
  } catch (err) {
    debugSuppressedError(log, "Failed to detect attachment content type from Bun.file metadata.", err, {
      operation: "file_attachments.detect_content_type",
      path,
    });
  }
  return "application/octet-stream";
}

function isTextContentType(contentType: string): boolean {
  if (!contentType) return false;
  if (contentType.startsWith("text/")) return true;
  return /json|xml|yaml|x-www-form-urlencoded|csv|markdown|javascript|typescript/i.test(contentType);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildExportPath(id: number, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const workspaceDir = resolve(process.env.PICLAW_WORKSPACE?.trim() || WORKSPACE_DIR);
  return resolve(workspaceDir, "tmp", `${id}-${safeName}`);
}

// ── Tool execute ──────────────────────────────────────────

async function execute(
  registry: AttachmentRegistry,
  _toolCallId: string,
  params: AttachmentParams,
  _signal?: AbortSignal,
  _onUpdate?: unknown,
  _ctx?: ExtensionContext,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const resolved = resolveWorkspacePath(params.path);
  if (!resolved) {
    return { content: [{ type: "text", text: "Attachment path must be inside the workspace." }], details: {} };
  }

  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    return { content: [{ type: "text", text: `File not found: ${params.path}` }], details: {} };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const filename = params.name || basename(resolved);
  const contentType = detectContentType(resolved, params.content_type);
  const size = file.size;
  const kind: AttachmentKind = params.kind || (contentType.startsWith("image/") ? "image" : "file");

  const mediaId = createMedia(filename, contentType, data, null, { size, source_path: resolved, kind });

  registry.register(getChatJid("web:default"), {
    id: mediaId,
    name: filename,
    contentType,
    size,
    kind,
    sourcePath: resolved,
  });

  return {
    content: [{ type: "text", text: `Attached "${filename}" (${Math.round(size / 1024)} KB). A download card will appear in the chat automatically.` }],
    details: { filename, content_type: contentType, size, kind },
  };
}

async function executeReadAttachment(
  _toolCallId: string,
  params: ReadAttachmentParams,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return { content: [{ type: "text", text: "Attachment id must be a positive number." }], details: {} };
  }

  const record = getMediaById(id);
  if (!record) {
    return { content: [{ type: "text", text: `No attachment found for id ${id}.` }], details: {} };
  }

  const contentType = record.content_type || "application/octet-stream";
  const filename = record.filename || `attachment-${id}`;
  const size = record.data?.length || 0;
  const maxBytes = typeof params.max_bytes === "number" && Number.isFinite(params.max_bytes)
    ? Math.max(1, params.max_bytes)
    : 5 * 1024 * 1024;
  const mode = (params.mode || "auto").toLowerCase();
  const isImage = contentType.startsWith("image/");
  const isText = isTextContentType(contentType);

  if (mode === "image" || (mode === "auto" && isImage)) {
    if (!VALID_IMAGE_MIMES.has(contentType)) {
      return {
        content: [{ type: "text", text: `Attachment ${filename} (${contentType}, ${formatBytes(size)}) cannot be returned as an image — only jpeg, png, gif, and webp are supported. Use mode: "text" or "base64" instead.` }],
        details: { id, filename, content_type: contentType, size, mode: "text", unsupported_image_mime: true },
      };
    }
    if (size > maxBytes) {
      return {
        content: [{ type: "text", text: `Attachment ${filename} is ${formatBytes(size)}. Increase max_bytes to load the full image.` }],
        details: { id, filename, content_type: contentType, size, truncated: true },
      };
    }
    // Validate and normalize the image using sharp before embedding.
    // This prevents corrupt or mismatched images from poisoning the session
    // with permanent 400 errors from the provider.
    const rawBuffer = Buffer.from(record.data);
    const validated = await validateAndNormalizeImage(rawBuffer, contentType);
    if (!validated.ok) {
      return {
        content: [{ type: "text", text: `Attachment ${filename} (${contentType}, ${formatBytes(size)}) failed image validation: ${validated.reason}. Use mode: "base64" to get the raw data instead.` }],
        details: { id, filename, content_type: contentType, size, mode: "text", image_validation_failed: true, reason: validated.reason },
      };
    }
    const encoded = validated.data.toString("base64");
    const effectiveMime = validated.mimeType;
    const converted = effectiveMime !== contentType;
    return {
      content: [
        { type: "text", text: `Attachment ${filename} (${formatBytes(validated.data.length)})${converted ? ` [converted from ${contentType} to ${effectiveMime}]` : ""}` },
        { type: "image", data: encoded, mimeType: effectiveMime },
      ],
      details: { id, filename, content_type: effectiveMime, original_content_type: contentType, size: validated.data.length, mode: "image", converted },
    };
  }

  const slice = record.data.slice(0, maxBytes);
  const truncated = size > maxBytes;

  if (mode === "text" || (mode === "auto" && isText)) {
    const text = new TextDecoder().decode(slice);
    const suffix = truncated ? `\n\n[truncated to ${formatBytes(maxBytes)}]` : "";
    return {
      content: [{ type: "text", text: `${text}${suffix}` }],
      details: { id, filename, content_type: contentType, size, truncated, mode: "text" },
    };
  }

  const base64 = Buffer.from(slice).toString("base64");
  const note = truncated ? ` (truncated to ${formatBytes(maxBytes)})` : "";
  return {
    content: [{ type: "text", text: `Attachment ${filename} (${contentType}, ${formatBytes(size)}) base64${note}:\n${base64}` }],
    details: { id, filename, content_type: contentType, size, truncated, mode: "base64" },
  };
}

async function executeExportAttachment(
  _toolCallId: string,
  params: ExportAttachmentParams,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return { content: [{ type: "text", text: "Attachment id must be a positive number." }], details: {} };
  }

  const record = getMediaById(id);
  if (!record) {
    return { content: [{ type: "text", text: `No attachment found for id ${id}.` }], details: {} };
  }

  const filename = params.filename || record.filename || `attachment-${id}`;
  const outputPath = buildExportPath(id, filename);
  await Bun.write(outputPath, record.data);

  return {
    content: [{ type: "text", text: `Attachment ${filename} exported to ${outputPath}.` }],
    details: {
      id,
      filename,
      output_path: outputPath,
      content_type: record.content_type || "application/octet-stream",
      size: record.data?.length || 0,
    },
  };
}

// ── System prompt hint ─────────────────────────────────────

const ATTACHMENT_HINT = [
  "## File Attachments",
  "You have an attach_file tool. When you create or generate a file the user",
  "will want (images, charts, CSVs, PDFs, archives, code exports, etc.),",
  "always call attach_file with the workspace path so they get a download",
  "card in the chat. Do not just tell the user the file path — attach it.",
  "You do NOT need to paste the file contents into your reply.",
  "After attaching, briefly mention what you attached so the user knows",
  "to look for the download card below your message.",
  "Use attachment:<id> when you want to reference an uploaded attachment by id.",
  "Use read_attachment to load an attachment by id (auto/text/image/base64 modes).",
  "Use export_attachment to save an attachment into /workspace/tmp for shell tools.",
].join("\n");

// ── Factory ───────────────────────────────────────────────

/** MIME types Claude's API accepts for image content blocks. */
const VALID_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Validate and optionally re-encode image data using sharp.
 *
 * Returns a safe { data, mimeType } pair ready for embedding, or an error.
 * If the image is already a valid supported format, it passes through unchanged.
 * If the image is a supported format but corrupt/mismatched, it attempts
 * re-encoding to JPEG as a safe fallback.
 */
async function validateAndNormalizeImage(
  rawData: Buffer,
  claimedMime: string,
): Promise<{ ok: true; data: Buffer; mimeType: string } | { ok: false; reason: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(rawData).metadata();
    if (!metadata.format) {
      return { ok: false, reason: "sharp could not detect image format" };
    }
    const FORMAT_TO_MIME: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    };
    const detectedMime = FORMAT_TO_MIME[metadata.format] ?? `image/${metadata.format}`;

    // If detected format matches claimed and is in the valid set, pass through
    if (detectedMime === claimedMime && VALID_IMAGE_MIMES.has(claimedMime)) {
      return { ok: true, data: rawData, mimeType: claimedMime };
    }

    // If detected format is valid but doesn't match the claim, use the detected one
    if (VALID_IMAGE_MIMES.has(detectedMime)) {
      return { ok: true, data: rawData, mimeType: detectedMime };
    }

    // Unsupported format — re-encode to JPEG as a safe fallback
    const converted = await sharp(rawData).jpeg({ quality: 90 }).toBuffer();
    return { ok: true, data: converted, mimeType: "image/jpeg" };
  } catch (error) {
    // sharp failed entirely — image is likely corrupt
    return { ok: false, reason: error instanceof Error ? error.message : "image validation failed" };
  }
}

/** Build a file-attachments extension bound to a specific registry instance. */
export function createFileAttachmentsExtension(registry: AttachmentRegistry = getAttachmentRegistry()): ExtensionFactory {
  const extension: ExtensionFactory = function fileAttachments(pi: ExtensionAPI) {
    pi.on("before_agent_start", async (event) => {
      return { systemPrompt: `${event.systemPrompt}\n\n${ATTACHMENT_HINT}` };
    });

    // Sanitize session context before each API call: strip image blocks with
    // invalid MIME types that would cause permanent 400 errors. This recovers
    // poisoned sessions automatically without manual JSONL editing.
    pi.on("context", async (event) => {
      let modified = false;
      const sanitizeBlocks = (blocks: unknown[]): { blocks: unknown[]; modified: boolean } => {
        let blockModified = false;
        const cleaned = blocks.map((block: any) => {
          if (block?.type === "image") {
            const mime = block.mimeType || block.source?.media_type || "";
            if (typeof mime === "string" && mime && !VALID_IMAGE_MIMES.has(mime)) {
              blockModified = true;
              return { type: "text", text: `[Invalid image block removed: unsupported MIME ${mime}]` };
            }
            // Light sync validation: check that base64 data decodes to something
            // with recognizable image magic bytes. Heavy validation via sharp
            // happens at ingest (read_attachment); this catches corruption that
            // slipped through or was introduced by manual session edits.
            const b64 = typeof block.data === "string" ? block.data : (typeof block.source?.data === "string" ? block.source.data : null);
            if (b64) {
              try {
                const buf = Buffer.from(b64, "base64");
                if (buf.length < 4) {
                  blockModified = true;
                  return { type: "text", text: "[Corrupt image block removed: data too short]" };
                }
              } catch {
                blockModified = true;
                return { type: "text", text: "[Corrupt image block removed: invalid base64]" };
              }
            }
          }
          if (block?.type === "tool_result" && Array.isArray(block.content)) {
            const nested = sanitizeBlocks(block.content);
            if (nested.modified) {
              blockModified = true;
              return { ...block, content: nested.blocks };
            }
          }
          return block;
        });
        return { blocks: cleaned, modified: blockModified };
      };

      const messages = event.messages.map((msg: any) => {
        if (!Array.isArray(msg?.content)) return msg;
        const cleaned = sanitizeBlocks(msg.content);
        if (!cleaned.modified) return msg;
        modified = true;
        return { ...msg, content: cleaned.blocks };
      });
      if (modified) {
        log.warn("Stripped invalid image blocks from session context to prevent API errors");
        return { messages };
      }
      return {};
    });

    pi.registerTool({
      name: "attach_file",
      label: "attach_file",
      description: "Attach a file from the workspace so the user can download it in the web UI. Returns an attachment handle.",
      promptSnippet: "attach_file: upload a workspace file so the user gets a download card.",
      parameters: AttachmentSchema,
      execute: (toolCallId, params, signal, onUpdate, ctx) => execute(registry, toolCallId, params, signal, onUpdate, ctx),
    });

    pi.registerTool({
      name: "read_attachment",
      label: "read_attachment",
      description: "Load an attachment by id and return its contents (text/image/base64).",
      promptSnippet: "read_attachment: load attachment bytes/text/image data by media id.",
      parameters: ReadAttachmentSchema,
      execute: executeReadAttachment,
    });

    pi.registerTool({
      name: "export_attachment",
      label: "export_attachment",
      description: "Export an attachment by id to /workspace/tmp for shell tools.",
      promptSnippet: "export_attachment: write attachment content to /workspace/tmp and return the file path.",
      parameters: ExportAttachmentSchema,
      execute: executeExportAttachment,
    });
  };
  return extension;
}

/** Extension factory that registers the attach_file tool. */
export const fileAttachments = createFileAttachmentsExtension(getAttachmentRegistry());
