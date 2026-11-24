import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { getDb } from "../../../db/connection.js";
/**
 * web/workspace/file-service.ts – File read/write operations for the explorer.
 *
 * Provides file content retrieval, creation, directory listing, and file
 * writing with path safety validation (must be within workspace root).
 *
 * Consumers: web/handlers/workspace.ts delegates file operations here.
 */

import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

import { createMedia } from "../../../db.js";
import { DATA_DIR, getWebRuntimeConfig } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { MAX_ATTACH_BYTES, MAX_EDIT_BYTES, MAX_PREVIEW_BYTES } from "./constants.js";
import { contentTypeForPath, detectBinary, formatMtime, isImageFile, isTextFile } from "./file-utils.js";
import { isHiddenPath, isRealWorkspacePath, resolveWorkspacePath, shouldIgnorePath, toRelativePath } from "./paths.js";

const log = createLogger("web.workspace.file-service");

function isEscapedExistingWorkspacePath(absPath: string): boolean {
  return existsSync(absPath) && !isRealWorkspacePath(absPath);
}

function getWorkspaceUploadMaxBytes(): number {
  return Math.max(1, Math.round((getWebRuntimeConfig().workspaceUploadLimitMb || 256) * 1024 * 1024));
}

type FflateModule = typeof import("fflate");

let fflatePromise: Promise<FflateModule> | null = null;

async function loadFflate(): Promise<FflateModule> {
  if (!fflatePromise) {
    fflatePromise = import("fflate");
  }
  return await fflatePromise;
}

interface ArchiveEntrySummary {
  name: string;
  compressedSize: number | null;
  uncompressedSize: number;
  isDirectory: boolean;
}

function readZipEntries(filePath: string, maxEntries = 200): { entries: ArchiveEntrySummary[]; totalEntries: number; truncated: boolean } {
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw Error("Preview requires a regular file");
    return parseZipEntries(fd, stats.size, maxEntries);
  } finally { closeSync(fd); }
}

function parseZipEntries(fd: number, size: number, maxEntries: number): { entries: ArchiveEntrySummary[]; totalEntries: number; truncated: boolean } {
  const eocdSignature = 0x06054b50;
  const cdSignature = 0x02014b50;
  const minEocdSize = 22;
  const maxCommentSize = 0xffff;
  const tailSize = Math.min(size, minEocdSize + maxCommentSize);
  const tail = Buffer.allocUnsafe(tailSize);
  readExact(fd, tail, size - tailSize);

  let eocdOffset = -1;
  for (let offset = tail.length - minEocdSize; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === eocdSignature &&
        offset + minEocdSize + tail.readUInt16LE(offset + 20) === tail.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("ZIP end-of-central-directory record not found");
  }

  const entryCount = tail.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);
  const end = centralDirectoryOffset + tail.readUInt32LE(eocdOffset + 12);
  if (tail.readUInt16LE(eocdOffset + 4) !== 0 || tail.readUInt16LE(eocdOffset + 6) !== 0 ||
      tail.readUInt16LE(eocdOffset + 8) !== entryCount || end > size - tailSize + eocdOffset ||
      entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) throw Error("Unsupported ZIP directory");

  const entries: ArchiveEntrySummary[] = [];
  const header = Buffer.allocUnsafe(46);
  let offset = centralDirectoryOffset;
  let totalEntries = 0;
  let shownNameBytes = 0;

  while (totalEntries < entryCount) {
    if (offset + header.length > end) throw Error("Truncated ZIP directory");
    readExact(fd, header, offset);
    if (header.readUInt32LE(0) !== cdSignature) throw Error("Invalid ZIP directory entry");
    const fileNameLength = header.readUInt16LE(28);
    const nameStart = offset + header.length;
    const nameEnd = nameStart + fileNameLength;
    offset = nameEnd + header.readUInt16LE(30) + header.readUInt16LE(32);
    if (offset > end) throw Error("Truncated ZIP directory entry");
    totalEntries += 1;
    // Bound displayed text as well as buffers. Once the first name cannot fit,
    // keep counting headers, but don't read more names or any member data.
    if (entries.length !== totalEntries - 1 || entries.length >= maxEntries ||
        shownNameBytes + fileNameLength > MAX_PREVIEW_BYTES) continue;
    const nameBytes = Buffer.allocUnsafe(fileNameLength);
    readExact(fd, nameBytes, nameStart);
    const name = nameBytes.toString("utf8");
    shownNameBytes += fileNameLength;
    entries.push({ name, compressedSize: header.readUInt32LE(20), uncompressedSize: header.readUInt32LE(24),
      isDirectory: name.endsWith("/") || ((header.readUInt32LE(38) >>> 16) & 0o170000) === 0o040000 });
  }

  return {
    entries,
    totalEntries,
    truncated: totalEntries > entries.length,
  };
}

function readExact(fd: number, buffer: Buffer, position: number): void {
  for (let offset = 0; offset < buffer.length;) {
    const count = readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (count === 0) throw Error("Truncated ZIP archive");
    offset += count;
  }
}

function readFilePrefix(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw Error("Preview requires a regular file");
    const buffer = Buffer.allocUnsafe(limit);
    let offset = 0;
    while (offset < limit) {
      const count = readSync(fd, buffer, offset, limit - offset, offset);
      if (!count) break;
      offset += count;
    }
    return buffer.subarray(0, offset);
  } finally { closeSync(fd); }
}

function isTarGzPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

const MAX_TAR_PREVIEW_DECODED_BYTES = 512 * 1024 * 1024;

async function readTarGzEntries(filePath: string, signal?: AbortSignal): Promise<{ entries: ArchiveEntrySummary[]; totalEntries: number; truncated: boolean }> {
  signal?.throwIfAborted();
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  let input: ReturnType<typeof createReadStream>;
  try {
    if (!fstatSync(fd).isFile()) throw Error("Preview requires a regular file");
    input = createReadStream(filePath, { fd, autoClose: true });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  const entries: ArchiveEntrySummary[] = [];
  const header = Buffer.allocUnsafe(512);
  let filled = 0, skip = 0, decoded = 0, totalEntries = 0, end = false;
  // The pipeline owns the descriptor and both streams. Retain one header,
  // discard member bytes, and let gzip validate its trailer even after tar EOF.
  await pipeline(input, createGunzip(), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      decoded += chunk.length;
      if (decoded > MAX_TAR_PREVIEW_DECODED_BYTES) throw Error("Archive exceeds the decoded preview limit");
      for (let offset = 0; offset < chunk.length && !end;) {
        if (skip) {
          const bytes = Math.min(skip, chunk.length - offset);
          skip -= bytes;
          offset += bytes;
          continue;
        }
        const bytes = Math.min(header.length - filled, chunk.length - offset);
        chunk.copy(header, filled, offset, offset + bytes);
        filled += bytes;
        offset += bytes;
        if (filled < header.length) continue;
        filled = 0;
        if (header.every(byte => byte === 0)) { end = true; break; }
        const name = header.toString("utf8", 0, 100).split("\0", 1)[0];
        const prefix = header.toString("utf8", 345, 500).split("\0", 1)[0];
        const sizeOctal = header.toString("ascii", 124, 136).split("\0", 1)[0].trim();
        if ((!name && !prefix) || !/^[0-7]*$/.test(sizeOctal)) throw Error("Invalid tar header");
        const size = sizeOctal ? Number.parseInt(sizeOctal, 8) : 0;
        skip = Math.ceil(size / 512) * 512;
        totalEntries += 1;
        if (entries.length < 200) {
          const member = prefix ? `${prefix}/${name}` : name;
          entries.push({ name: member, compressedSize: null, uncompressedSize: size,
            isDirectory: header[156] === 53 || member.endsWith("/") });
        }
      }
    }
    if (!end && (filled || skip)) throw Error("Truncated tar archive");
  }, { signal });
  return { entries, totalEntries, truncated: totalEntries > entries.length };
}

function formatArchiveListing(label: string, relPath: string, stats: { size: number }, parsed: { entries: ArchiveEntrySummary[]; totalEntries: number; truncated: boolean }): string {
  const lines = [
    `${label}: ${relPath}`,
    `Entries: ${parsed.totalEntries}`,
    `Archive size: ${stats.size} bytes`,
    "",
  ];

  for (const entry of parsed.entries) {
    const kind = entry.isDirectory ? "dir " : "file";
    const compressionLabel = entry.compressedSize != null && entry.compressedSize !== entry.uncompressedSize
      ? `, ${entry.compressedSize} B compressed`
      : "";
    const sizeLabel = entry.isDirectory ? "" : ` (${entry.uncompressedSize} B${compressionLabel})`;
    lines.push(`${kind}  ${entry.name}${sizeLabel}`);
  }

  if (parsed.truncated) {
    lines.push("");
    lines.push(`… showing first ${parsed.entries.length} entries of ${parsed.totalEntries}.`);
  }

  return lines.join("\n");
}

function normalizeEntryName(raw: string | null | undefined): string | null {
  const name = (raw || "").trim();
  if (!name || name === "." || name === "..") return null;
  if (name.includes("/") || name.includes("\\")) return null;
  const base = path.basename(name);
  if (base !== name) return null;
  return name;
}

const WORKSPACE_UPLOAD_CHUNK_ROOT = path.join(DATA_DIR, "workspace-upload-chunks");
const WORKSPACE_UPLOAD_CHUNK_TTL_MS = 24 * 60 * 60 * 1000;

interface WorkspaceUploadState {
  version: 1;
  uploadId: string;
  targetDir: string;
  filename: string;
  fileSize: number;
  chunkTotal: number;
  nextChunkIndex: number;
  overwrite: boolean;
  bytesWritten: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceChunkUploadParams {
  pathParam: string | null;
  uploadId: string;
  chunkIndex: number;
  chunkTotal: number;
  fileName: string;
  fileSize: number;
  overwrite?: boolean;
  data: Uint8Array;
}

function sanitizeUploadId(raw: string | null | undefined): string | null {
  const value = (raw || "").trim();
  if (!value || value.length > 160) return null;
  if (value === "." || value === "..") return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function isPathInsideDirectory(candidatePath: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function getUploadStatePaths(uploadId: string): { dir: string; statePath: string; partPath: string } | null {
  const root = path.resolve(WORKSPACE_UPLOAD_CHUNK_ROOT);
  const dir = path.resolve(root, uploadId);
  if (!isPathInsideDirectory(dir, root)) return null;
  return {
    dir,
    statePath: path.join(dir, "state.json"),
    partPath: path.join(dir, "upload.part"),
  };
}

function readUploadState(statePath: string): WorkspaceUploadState | null {
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as WorkspaceUploadState;
  } catch {
    return null;
  }
}

function writeUploadState(statePath: string, state: WorkspaceUploadState): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function cleanupStaleChunkUploads(now = Date.now()): void {
  try {
    mkdirSync(WORKSPACE_UPLOAD_CHUNK_ROOT, { recursive: true });
    for (const entry of readdirSync(WORKSPACE_UPLOAD_CHUNK_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(WORKSPACE_UPLOAD_CHUNK_ROOT, entry.name);
      try {
        const stats = statSync(dirPath);
        if (now - stats.mtimeMs > WORKSPACE_UPLOAD_CHUNK_TTL_MS) {
          rmSync(dirPath, { recursive: true, force: true });
        }
      } catch (e) {
        // Ignore stale upload cleanup failures; later requests can retry cleanup.
        void e;
      }
    }
  } catch (e) {
    // Ignore cleanup bootstrap failures; upload requests will fail later if storage is unusable.
    void e;
  }
}

/** File read/write service for the workspace explorer API. */
export class WorkspaceFileService {
  async getFile(
    pathParam: string | null,
    maxParam?: string | null,
    modeParam?: string | null,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetPath);
      if (stats.isDirectory()) {
        return { status: 400, body: { error: "Path is a directory" } };
      }

      const relPath = toRelativePath(targetPath);
      const contentType = contentTypeForPath(targetPath);
      const isImage = isImageFile(targetPath);
      const ext = path.extname(targetPath).toLowerCase();

      if (isImage) {
        const rawUrl = `/workspace/raw?path=${encodeURIComponent(relPath)}`;
        return {
          status: 200,
          body: {
            path: relPath,
            name: path.basename(targetPath),
            kind: "image",
            content_type: contentType,
            size: stats.size,
            mtime: formatMtime(stats),
            url: rawUrl,
          },
        };
      }

      const maxParsed = parseInt(maxParam || "", 10);
      const isEditMode = modeParam === "edit";
      const maxLimit = isEditMode ? MAX_EDIT_BYTES : MAX_PREVIEW_BYTES;
      const maxBytes = Number.isFinite(maxParsed)
        ? Math.min(Math.max(maxParsed, 1024), maxLimit)
        : isEditMode
          ? maxLimit
          : 20000;

      if (isEditMode && stats.size > MAX_EDIT_BYTES) {
        return { status: 400, body: { error: "File too large to edit" } };
      }

      if (!isEditMode && (ext === ".zip" || isTarGzPath(targetPath))) {
        try {
          const isZip = ext === ".zip";
          const parsed = isZip ? readZipEntries(targetPath) : await readTarGzEntries(targetPath, signal);
          return {
            status: 200,
            body: {
              path: relPath,
              name: path.basename(targetPath),
              kind: "text",
              content_type: contentType,
              size: stats.size,
              mtime: formatMtime(stats),
              text: formatArchiveListing(isZip ? "ZIP archive" : "tar.gz archive", relPath, stats, parsed),
              truncated: parsed.truncated,
            },
          };
        } catch {
          return {
            status: 200,
            body: {
              path: relPath,
              name: path.basename(targetPath),
              kind: "binary",
              content_type: contentType,
              size: stats.size,
              mtime: formatMtime(stats),
              truncated: false,
            },
          };
        }
      }

      // One lookahead byte preserves the truncation signal without reading the whole file.
      const prefix = readFilePrefix(targetPath, maxBytes + 1);
      const slice = prefix.subarray(0, maxBytes);
      const truncated = prefix.length > maxBytes;

      if (!isTextFile(targetPath) && detectBinary(slice)) {
        return {
          status: isEditMode ? 400 : 200,
          body: isEditMode
            ? { error: "Binary file cannot be edited" }
            : {
                path: relPath,
                name: path.basename(targetPath),
                kind: "binary",
                content_type: contentType,
                size: stats.size,
                mtime: formatMtime(stats),
                truncated,
              },
        };
      }

      let text = slice.toString("utf-8");
      if (path.extname(targetPath).toLowerCase() === ".json") {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch (error) {
          debugSuppressedError(log, "Workspace JSON preview was invalid; returning raw text.", error, {
            operation: "get_file.invalid_json_preview",
            targetPath,
          });
        }
      }

      return {
        status: 200,
        body: {
          path: relPath,
          name: path.basename(targetPath),
          kind: "text",
          content_type: contentType,
          size: stats.size,
          mtime: formatMtime(stats),
          text,
          truncated,
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to read file" } };
    }
  }

  getRaw(
    pathParam: string | null,
    download = false,
  ): { status: number; body: string | Blob; contentType?: string; filePath?: string; size?: number; filename?: string; download?: boolean } {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: "Invalid path" };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: "Invalid path" };
    }

    try {
      const stats = statSync(targetPath);
      if (stats.isDirectory()) return { status: 400, body: "Path is a directory" };
      const contentType = contentTypeForPath(targetPath);
      const file = Bun.file(targetPath);
      return {
        status: 200,
        body: file,
        contentType,
        filePath: targetPath,
        size: stats.size,
        filename: path.basename(targetPath),
        download,
      };
    } catch {
      return { status: 404, body: "Not found" };
    }
  }

  async attachFile(pathParam: string | null, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetPath);
      if (stats.isDirectory()) return { status: 400, body: { error: "Path is a directory" } };
      if (stats.size > MAX_ATTACH_BYTES) {
        return { status: 400, body: { error: "File too large to attach" } };
      }

      const dataBuf = readFileSync(targetPath);
      const filename = path.basename(targetPath);
      const contentType = contentTypeForPath(targetPath);
      const database = getDb();
      const mediaId = await admitSqliteWrite(database, () => createMedia(filename, contentType, new Uint8Array(dataBuf), null, {
        size: stats.size,
        kind: "file",
        source_path: targetPath,
      }), undefined, signal, undefined, () => { if (getDb() !== database) throw Error("Attachment database changed"); });

      return {
        status: 200,
        body: {
          media_id: mediaId,
          filename,
          size: stats.size,
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to attach file" } };
    }
  }

  async uploadFile(
    pathParam: string | null,
    file: File,
    overwrite = false
  ): Promise<{ status: number; body: unknown }> {
    const targetDir = resolveWorkspacePath(pathParam);
    if (!targetDir) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetDir)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetDir);
      if (!stats.isDirectory()) {
        return { status: 400, body: { error: "Path is not a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "Directory not found" } };
    }

    const rawName = typeof file?.name === "string" ? file.name : "";
    const filename = path.basename(rawName || `upload-${Date.now()}`);
    if (!filename) return { status: 400, body: { error: "Missing filename" } };

    const size = typeof file?.size === "number" ? file.size : 0;
    const maxUploadBytes = getWorkspaceUploadMaxBytes();
    if (size > maxUploadBytes) {
      return { status: 400, body: { error: "File too large to upload" } };
    }

    const destPath = path.join(targetDir, filename);
    const existed = existsSync(destPath);
    if (existed && !isRealWorkspacePath(destPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }
    if (existed && !overwrite) {
      return { status: 409, body: { error: "File already exists", code: "file_exists" } };
    }
    if (existed) {
      const existing = statSync(destPath);
      if (existing.isDirectory()) {
        return { status: 400, body: { error: "Path is a directory" } };
      }
    }

    try {
      await Bun.write(destPath, file);
      const updated = statSync(destPath);
      if (updated.size > maxUploadBytes) {
        try { unlinkSync(destPath); } catch (error) {
          log.warn("Failed to remove oversized upload", {
            operation: "upload.cleanup_oversized_file",
            destPath,
            err: error,
          });
        }
        return { status: 400, body: { error: "File too large to upload" } };
      }
      const relPath = toRelativePath(destPath);
      return {
        status: 200,
        body: {
          path: relPath,
          name: filename,
          size: updated.size,
          overwritten: existed,
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to upload file" } };
    }
  }

  async uploadChunk(params: WorkspaceChunkUploadParams): Promise<{ status: number; body: unknown }> {
    cleanupStaleChunkUploads();

    const uploadId = sanitizeUploadId(params.uploadId);
    if (!uploadId) return { status: 400, body: { error: "Invalid upload ID" } };

    const targetDir = resolveWorkspacePath(params.pathParam);
    if (!targetDir) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetDir)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetDir);
      if (!stats.isDirectory()) {
        return { status: 400, body: { error: "Path is not a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "Directory not found" } };
    }

    const filename = normalizeEntryName(params.fileName || "");
    if (!filename) return { status: 400, body: { error: "Invalid filename" } };

    const chunkIndex = Number(params.chunkIndex);
    const chunkTotal = Number(params.chunkTotal);
    const fileSize = Number(params.fileSize);
    const overwrite = Boolean(params.overwrite);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return { status: 400, body: { error: "Invalid chunk index" } };
    }
    if (!Number.isInteger(chunkTotal) || chunkTotal <= 0) {
      return { status: 400, body: { error: "Invalid chunk total" } };
    }
    if (chunkIndex >= chunkTotal) {
      return { status: 400, body: { error: "Chunk index exceeds chunk total" } };
    }
    if (!Number.isInteger(fileSize) || fileSize < 0) {
      return { status: 400, body: { error: "Invalid file size" } };
    }

    const maxUploadBytes = getWorkspaceUploadMaxBytes();
    if (fileSize > maxUploadBytes) {
      return { status: 400, body: { error: "File too large to upload" } };
    }

    const uploadStatePaths = getUploadStatePaths(uploadId);
    if (!uploadStatePaths) return { status: 400, body: { error: "Invalid upload ID" } };
    const { dir, statePath, partPath } = uploadStatePaths;
    const destPath = path.join(targetDir, filename);
    let state = readUploadState(statePath);

    if (!state) {
      if (chunkIndex !== 0) {
        return { status: 409, body: { error: "Upload state not initialized", expected_chunk_index: 0 } };
      }
      const existed = existsSync(destPath);
      if (existed && !isRealWorkspacePath(destPath)) {
        return { status: 400, body: { error: "Invalid path" } };
      }
      if (existed && !overwrite) {
        return { status: 409, body: { error: "File already exists", code: "file_exists" } };
      }
      if (existed) {
        const existing = statSync(destPath);
        if (existing.isDirectory()) {
          return { status: 400, body: { error: "Path is a directory" } };
        }
      }

      mkdirSync(dir, { recursive: true });
      state = {
        version: 1,
        uploadId,
        targetDir,
        filename,
        fileSize,
        chunkTotal,
        nextChunkIndex: 0,
        overwrite,
        bytesWritten: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeUploadState(statePath, state);
    }

    if (
      state.targetDir !== targetDir ||
      state.filename !== filename ||
      state.fileSize !== fileSize ||
      state.chunkTotal !== chunkTotal ||
      state.overwrite !== overwrite
    ) {
      return { status: 409, body: { error: "Upload metadata mismatch" } };
    }

    if (chunkIndex !== state.nextChunkIndex) {
      return {
        status: 409,
        body: { error: "Unexpected chunk index", expected_chunk_index: state.nextChunkIndex },
      };
    }

    const chunkBytes = params.data instanceof Uint8Array ? params.data : new Uint8Array(params.data || []);
    if (state.bytesWritten + chunkBytes.length > fileSize) {
      return { status: 400, body: { error: "Chunk exceeds declared file size" } };
    }

    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(partPath, chunkBytes);
      state.bytesWritten += chunkBytes.length;
      state.nextChunkIndex += 1;
      state.updatedAt = new Date().toISOString();

      if (state.nextChunkIndex < state.chunkTotal) {
        writeUploadState(statePath, state);
        return {
          status: 200,
          body: {
            upload_id: uploadId,
            chunk_index: chunkIndex,
            chunk_total: chunkTotal,
            received_bytes: state.bytesWritten,
            complete: false,
          },
        };
      }

      if (state.bytesWritten !== fileSize) {
        rmSync(dir, { recursive: true, force: true });
        return { status: 400, body: { error: "Uploaded bytes did not match declared file size" } };
      }

      const existed = existsSync(destPath);
      if (existed && !isRealWorkspacePath(destPath)) {
        rmSync(dir, { recursive: true, force: true });
        return { status: 400, body: { error: "Invalid path" } };
      }
      if (existed && !overwrite) {
        rmSync(dir, { recursive: true, force: true });
        return { status: 409, body: { error: "File already exists", code: "file_exists" } };
      }
      if (existed) {
        const existing = statSync(destPath);
        if (existing.isDirectory()) {
          rmSync(dir, { recursive: true, force: true });
          return { status: 400, body: { error: "Path is a directory" } };
        }
        unlinkSync(destPath);
      }

      renameSync(partPath, destPath);
      rmSync(dir, { recursive: true, force: true });
      const updated = statSync(destPath);
      const relPath = toRelativePath(destPath);
      return {
        status: 200,
        body: {
          upload_id: uploadId,
          path: relPath,
          name: filename,
          size: updated.size,
          overwritten: existed,
          complete: true,
        },
      };
    } catch (error) {
      log.warn("Failed to process workspace upload chunk", {
        operation: "workspace_upload_chunk",
        uploadId,
        chunkIndex,
        err: error,
      });
      return { status: 500, body: { error: "Failed to process upload chunk" } };
    }
  }

  createFile(
    pathParam: string | null,
    nameParam: string | null,
    content: string
  ): { status: number; body: unknown } {
    const targetDir = resolveWorkspacePath(pathParam);
    if (!targetDir) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetDir)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    const filename = normalizeEntryName(nameParam);
    if (!filename) return { status: 400, body: { error: "Invalid filename" } };

    if (typeof content !== "string") {
      return { status: 400, body: { error: "Missing file content" } };
    }

    try {
      const stats = statSync(targetDir);
      if (!stats.isDirectory()) {
        return { status: 400, body: { error: "Path is not a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "Directory not found" } };
    }

    const size = Buffer.byteLength(content, "utf-8");
    if (size > MAX_EDIT_BYTES) {
      return { status: 400, body: { error: "File too large to edit" } };
    }

    const destPath = path.join(targetDir, filename);
    if (existsSync(destPath)) {
      if (!isRealWorkspacePath(destPath)) {
        return { status: 400, body: { error: "Invalid path" } };
      }
      return { status: 409, body: { error: "File already exists", code: "file_exists" } };
    }

    try {
      writeFileSync(destPath, content, "utf-8");
      const updated = statSync(destPath);
      const relPath = toRelativePath(destPath);
      return {
        status: 200,
        body: {
          path: relPath,
          name: filename,
          size: updated.size,
          mtime: formatMtime(updated),
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to create file" } };
    }
  }

  renameFile(pathParam: string | null, nameParam: string | null): { status: number; body: unknown } {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    const relPath = toRelativePath(targetPath);
    if (relPath === ".") {
      return { status: 400, body: { error: "Cannot rename workspace root" } };
    }

    const filename = normalizeEntryName(nameParam);
    if (!filename) return { status: 400, body: { error: "Invalid filename" } };

    try {
      statSync(targetPath);
    } catch {
      return { status: 404, body: { error: "File not found" } };
    }

    const parentDir = path.dirname(targetPath);
    const nextPath = path.join(parentDir, filename);
    if (nextPath === targetPath) {
      return {
        status: 200,
        body: {
          path: relPath,
          name: filename,
        },
      };
    }

    if (existsSync(nextPath)) {
      if (!isRealWorkspacePath(nextPath)) {
        return { status: 400, body: { error: "Invalid path" } };
      }
      return { status: 409, body: { error: "File already exists", code: "file_exists" } };
    }

    try {
      renameSync(targetPath, nextPath);
      const nextRel = toRelativePath(nextPath);
      return {
        status: 200,
        body: {
          path: nextRel,
          name: filename,
          old_path: relPath,
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to rename file" } };
    }
  }

  moveEntry(pathParam: string | null, targetParam: string | null): { status: number; body: unknown } {
    const sourcePath = resolveWorkspacePath(pathParam);
    if (!sourcePath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(sourcePath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    const relSource = toRelativePath(sourcePath);
    if (relSource === ".") {
      return { status: 400, body: { error: "Cannot move workspace root" } };
    }

    const targetDir = resolveWorkspacePath(targetParam);
    if (!targetDir) return { status: 400, body: { error: "Invalid target" } };
    if (isEscapedExistingWorkspacePath(targetDir)) {
      return { status: 400, body: { error: "Invalid target" } };
    }

    try {
      const stats = statSync(targetDir);
      if (!stats.isDirectory()) {
        return { status: 400, body: { error: "Target is not a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "Target directory not found" } };
    }

    let sourceStats;
    try {
      sourceStats = statSync(sourcePath);
    } catch {
      return { status: 404, body: { error: "File not found" } };
    }

    const filename = path.basename(sourcePath);
    const nextPath = path.join(targetDir, filename);

    if (nextPath === sourcePath) {
      return {
        status: 200,
        body: {
          path: relSource,
          name: filename,
        },
      };
    }

    if (sourceStats.isDirectory()) {
      const relTarget = toRelativePath(targetDir);
      if (relTarget === relSource || relTarget.startsWith(`${relSource}/`)) {
        return { status: 400, body: { error: "Cannot move a folder into itself" } };
      }
    }

    if (existsSync(nextPath)) {
      if (!isRealWorkspacePath(nextPath)) {
        return { status: 400, body: { error: "Invalid target" } };
      }
      return { status: 409, body: { error: "Target already exists", code: "file_exists" } };
    }

    try {
      renameSync(sourcePath, nextPath);
      const nextRel = toRelativePath(nextPath);
      return {
        status: 200,
        body: {
          path: nextRel,
          name: filename,
          old_path: relSource,
          target: toRelativePath(targetDir),
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to move entry" } };
    }
  }

  updateFile(pathParam: string | null, content: string): { status: number; body: unknown } {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    if (typeof content !== "string") {
      return { status: 400, body: { error: "Missing file content" } };
    }

    try {
      const stats = statSync(targetPath);
      if (stats.isDirectory()) {
        return { status: 400, body: { error: "Path is a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "File not found" } };
    }

    const size = Buffer.byteLength(content, "utf-8");
    if (size > MAX_EDIT_BYTES) {
      return { status: 400, body: { error: "File too large to edit" } };
    }

    try {
      writeFileSync(targetPath, content, "utf-8");
      const updated = statSync(targetPath);
      const relPath = toRelativePath(targetPath);
      return {
        status: 200,
        body: {
          path: relPath,
          name: path.basename(targetPath),
          size: updated.size,
          mtime: formatMtime(updated),
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to write file" } };
    }
  }

  deleteFile(pathParam: string | null): { status: number; body: unknown } {
    const targetPath = resolveWorkspacePath(pathParam);
    if (!targetPath) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetPath)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetPath);
      if (stats.isDirectory()) {
        return { status: 400, body: { error: "Path is a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "File not found" } };
    }

    try {
      unlinkSync(targetPath);
      const relPath = toRelativePath(targetPath);
      return {
        status: 200,
        body: {
          path: relPath,
          name: path.basename(targetPath),
          deleted: true,
        },
      };
    } catch {
      return { status: 500, body: { error: "Failed to delete file" } };
    }
  }

  async downloadZip(
    pathParam: string | null,
    includeHidden = false
  ): Promise<{ status: number; body: unknown; filename?: string }> {
    const targetDir = resolveWorkspacePath(pathParam);
    if (!targetDir) return { status: 400, body: { error: "Invalid path" } };
    if (isEscapedExistingWorkspacePath(targetDir)) {
      return { status: 400, body: { error: "Invalid path" } };
    }

    try {
      const stats = statSync(targetDir);
      if (!stats.isDirectory()) {
        return { status: 400, body: { error: "Path is not a directory" } };
      }
    } catch {
      return { status: 404, body: { error: "Directory not found" } };
    }

    const rootName = path.basename(targetDir) || "workspace";
    const zipRoot = rootName.replace(/[\\/]+/g, "").trim() || "workspace";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const { Zip, ZipDeflate, ZipPassThrough } = await loadFflate();
        const zip = new Zip();
        zip.ondata = (err, data, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          controller.enqueue(data);
          if (final) controller.close();
        };

        const addDir = async (absDir: string, zipBase: string) => {
          const entries = await readdir(absDir, { withFileTypes: true });
          for (const entry of entries) {
            const absPath = path.join(absDir, entry.name);
            if (shouldIgnorePath(absPath)) continue;
            if (!includeHidden && isHiddenPath(absPath)) continue;
            const zipPath = `${zipBase}/${entry.name}`;
            if (entry.isDirectory()) {
              const dirEntry = new ZipPassThrough(`${zipPath}/`);
              zip.add(dirEntry);
              dirEntry.push(new Uint8Array(), true);
              await addDir(absPath, zipPath);
            } else if (entry.isFile()) {
              const deflate = new ZipDeflate(zipPath);
              zip.add(deflate);
              const file = Bun.file(absPath);
              const fileStream = file.stream();
              for await (const chunk of fileStream) {
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
                deflate.push(data, false);
              }
              deflate.push(new Uint8Array(), true);
            }
          }
        };

        try {
          const rootEntry = new ZipPassThrough(`${zipRoot}/`);
          zip.add(rootEntry);
          rootEntry.push(new Uint8Array(), true);
          await addDir(targetDir, zipRoot);
          zip.end();
        } catch (error) {
          log.warn("Failed to stream workspace zip archive", {
            operation: "download_zip.stream",
            targetDir,
            err: error,
          });
          controller.error(error);
        }
      },
    });

    return {
      status: 200,
      body: stream,
      filename: `${zipRoot}.zip`,
    };
  }
}
