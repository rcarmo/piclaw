import type { Context } from "@earendil-works/chord/context";
import type { TruncationResult } from "@earendil-works/pi-coding-agent";
import type { Result } from "./result.js";

export type { Context } from "@earendil-works/chord/context";
export { BACKGROUND_CONTEXT, createContextKey, withAbortSignal, withContextValue } from "@earendil-works/chord/context";
export { Result } from "./result.js";
export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "@earendil-works/pi-coding-agent";

/** Piclaw's filesystem/process port. No agent runtime or durable storage owner. */
export type FileErrorCode = "aborted" | "not_found" | "permission_denied" | "not_directory" | "is_directory" | "invalid" | "not_supported" | "unknown";
export type ExecutionErrorCode = "aborted" | "timeout" | "shell_unavailable" | "spawn_error" | "callback_error" | "unknown";

export class FileError extends Error {
  constructor(readonly code: FileErrorCode, message: string, readonly path?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FileError";
  }
}
export class ExecutionError extends Error {
  constructor(readonly code: ExecutionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExecutionError";
  }
}
export interface FileInfo { name: string; path: string; kind: "file" | "directory" | "symlink"; size: number; mtimeMs: number }
export interface TextLine { text: string; terminated: boolean }
export interface TextLineReader {
  readLine(context: Context): Promise<Result<TextLine | undefined, FileError>>;
  /** Best effort; must not reject. */
  close(context: Context): Promise<void>;
}
export interface FileSystem {
  cwd: string;
  absolutePath(path: string, context: Context): Promise<Result<string, FileError>>;
  joinPath(parts: string[], context: Context): Promise<Result<string, FileError>>;
  readTextFile(path: string, context: Context): Promise<Result<string, FileError>>;
  openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>>;
  readTextLines(path: string, options: { maxLines?: number } | undefined, context: Context): Promise<Result<string[], FileError>>;
  readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>>;
  writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
  appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
  renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>>;
  fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>>;
  listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>>;
  canonicalPath(path: string, context: Context): Promise<Result<string, FileError>>;
  exists(path: string, context: Context): Promise<Result<boolean, FileError>>;
  createDir(path: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>>;
  remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context): Promise<Result<void, FileError>>;
  createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>>;
  createTempFile(options: { prefix?: string; suffix?: string } | undefined, context: Context): Promise<Result<string, FileError>>;
  /** Best effort; must not reject. */
  cleanup(context: Context): Promise<void>;
}
export type ShellOutputRetention = "head" | "tail";
export interface ShellOutputLimits { maxBytes: number; maxLines: number; retain?: ShellOutputRetention }
export interface ShellOutputCaptureOptions { limits: ShellOutputLimits; spill?: boolean }
export type ShellOutputTruncation = Omit<TruncationResult, "content">;
export interface ShellOutputMetadata { truncation: ShellOutputTruncation; spillPath?: string; lastLineBytes?: number }
export interface ShellOutputView extends ShellOutputMetadata { text: string }
export type ShellOutputUpdate =
  | { kind: "replace"; output: ShellOutputView }
  | { kind: "append"; text: string; metadata: ShellOutputMetadata }
  | { kind: "slide"; drop: number; text: string; metadata: ShellOutputMetadata }
  | { kind: "metadata"; metadata: ShellOutputMetadata };
export interface ShellExecResult extends ShellOutputMetadata { exitCode: number }
export interface ShellExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  timeout?: number;
  capture?: ShellOutputCaptureOptions;
  onUpdate?: (update: ShellOutputUpdate, context: Context) => void;
}
export interface Shell {
  exec(command: string, options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>>;
  /** Best effort; must not reject. */
  cleanup(context: Context): Promise<void>;
}
export interface ExecutionEnv extends FileSystem, Shell {}

/** Apply a validated source-side bounded update. The adapter owns validation. */
export function applyShellOutputUpdate(current: ShellOutputView | undefined, update: ShellOutputUpdate): ShellOutputView {
  switch (update.kind) {
    case "replace": return update.output;
    case "append": return { text: (current?.text ?? "") + update.text, ...update.metadata };
    case "slide": return { text: (current?.text.slice(update.drop) ?? "") + update.text, ...update.metadata };
    case "metadata": return { text: current?.text ?? "", ...update.metadata };
  }
}
export function sanitizeBinaryOutput(text: string): string {
  // Shell output deliberately removes controls except tab and LF.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b-\x1f\ufff9-\ufffb]/g, "");
}
