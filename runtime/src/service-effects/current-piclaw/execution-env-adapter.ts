import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  applyShellOutputUpdate,
  ExecutionError,
  FileError,
  Result,
  type ExecutionEnv,
  type ExecutionErrorCode,
  type FileErrorCode,
  type FileInfo,
  type Result as ResultValue,
  type ShellExecOptions,
  type ShellExecResult,
  type ShellOutputMetadata,
  type ShellOutputTruncation,
  type ShellOutputUpdate,
  type ShellOutputView,
} from "../contracts/execution-env.js";
import type { Context } from "@earendil-works/chord/context";
import type { TextLineEnvironment, TextLineReader, TextLineRecord } from './text-line-reader-compat.js';
import { createLogger, debugSuppressedError } from '../../utils/logger.js';

const log = createLogger('service-effects.execution-env');

export type ShellEnvironmentPreparer = (
  command: string,
  options: Readonly<ShellExecOptions>,
) => Promise<Record<string, string>> | Record<string, string>;

type FileNormaliser<T> = (value: unknown) => T | null;
type InvocationContext = Readonly<{ context: Context; abortSignal: AbortSignal | undefined }>;

/** Defensive Earendil boundary around one captured environment instance. */
export class PiclawExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  readonly #absolutePath: ExecutionEnv["absolutePath"];
  readonly #joinPath: ExecutionEnv["joinPath"];
  readonly #readTextFile: ExecutionEnv["readTextFile"];
  readonly #openTextLineReader: TextLineEnvironment["openTextLineReader"];
  readonly #openReaders = new Set<TextLineReader>();
  readonly #readTextLines: ExecutionEnv["readTextLines"];
  readonly #readBinaryFile: ExecutionEnv["readBinaryFile"];
  readonly #writeFile: ExecutionEnv["writeFile"];
  readonly #appendFile: ExecutionEnv["appendFile"];
  readonly #renameFile: ExecutionEnv["renameFile"];
  readonly #fileInfo: ExecutionEnv["fileInfo"];
  readonly #listDir: ExecutionEnv["listDir"];
  readonly #canonicalPath: ExecutionEnv["canonicalPath"];
  readonly #exists: ExecutionEnv["exists"];
  readonly #createDir: ExecutionEnv["createDir"];
  readonly #remove: ExecutionEnv["remove"];
  readonly #createTempDir: ExecutionEnv["createTempDir"];
  readonly #createTempFile: ExecutionEnv["createTempFile"];
  readonly #exec: ExecutionEnv["exec"];
  readonly #cleanup: ExecutionEnv["cleanup"];
  readonly #prepareShellEnvironment: ShellEnvironmentPreparer;
  #cleanupPromise: Promise<void> | null = null;
  #closed = false;

  constructor(delegate: ExecutionEnv, prepareShellEnvironment: ShellEnvironmentPreparer) {
    this.cwd = requireStableCwd(delegate);
    this.#absolutePath = captureMethod(delegate, "absolutePath");
    this.#joinPath = captureMethod(delegate, "joinPath");
    this.#readTextFile = captureMethod(delegate, "readTextFile");
    this.#openTextLineReader = captureTextLineMethod(delegate);
    this.#readTextLines = captureMethod(delegate, "readTextLines");
    this.#readBinaryFile = captureMethod(delegate, "readBinaryFile");
    this.#writeFile = captureMethod(delegate, "writeFile");
    this.#appendFile = captureMethod(delegate, "appendFile");
    this.#renameFile = captureMethod(delegate, "renameFile");
    this.#fileInfo = captureMethod(delegate, "fileInfo");
    this.#listDir = captureMethod(delegate, "listDir");
    this.#canonicalPath = captureMethod(delegate, "canonicalPath");
    this.#exists = captureMethod(delegate, "exists");
    this.#createDir = captureMethod(delegate, "createDir");
    this.#remove = captureMethod(delegate, "remove");
    this.#createTempDir = captureMethod(delegate, "createTempDir");
    this.#createTempFile = captureMethod(delegate, "createTempFile");
    this.#exec = captureMethod(delegate, "exec");
    this.#cleanup = captureMethod(delegate, "cleanup");
    if (typeof prepareShellEnvironment !== "function") throw new TypeError("Invalid shell environment preparer.");
    this.#prepareShellEnvironment = prepareShellEnvironment;
    Object.freeze(this);
  }

  async absolutePath(path: string, context: Context) { return this.file(path, context, stringValue, (invocation) => this.#absolutePath(path, invocation.context)); }
  async joinPath(parts: string[], context: Context) {
    return this.file(undefined, context, stringValue, (invocation) => {
      const snapshot = snapshotStringArray(parts);
      if (!snapshot) throw new TypeError("Invalid path parts.");
      return this.#joinPath(snapshot, invocation.context);
    });
  }
  async readTextFile(path: string, context: Context) { return this.file(path, context, stringValue, (invocation) => this.#readTextFile(path, invocation.context)); }
  async openTextLineReader(path: string, context: Context): Promise<ResultValue<TextLineReader, FileError>> {
    const addressed = this.addressedPath(path);
    if (this.#closed) return fileFailure('aborted', 'Execution environment is closed.', addressed);
    const invocation = snapshotContext(context);
    if (!invocation) return fileFailure('unknown', 'Invalid execution context.', addressed);
    if (isAborted(invocation)) return fileFailure('aborted', 'aborted', addressed);
    let candidate: unknown;
    try { candidate = await this.#openTextLineReader(path, invocation.context); }
    catch { return fileFailure('unknown', 'Filesystem environment failed.', addressed); }
    if (this.#closed || isAborted(invocation)) { await closeUnknownReader(candidate, invocation.context); return fileFailure('aborted', 'aborted', addressed); }
    try {
      if (!record(candidate)) return fileFailure('unknown', 'Filesystem environment returned a malformed result.', addressed);
      if (stable(candidate, 'ok') === false) return normaliseFileError(stable(candidate, 'error'), addressed);
      if (stable(candidate, 'ok') !== true) return fileFailure('unknown', 'Filesystem environment returned a malformed result.', addressed);
      const delegate = stable(candidate, 'value');
      let reader!: TextLineReader;
      reader = captureTextLineReader(delegate, addressed, () => this.#closed, () => this.#openReaders.delete(reader))!;
      if (!reader) { await closeUnknownReader(candidate, invocation.context); return fileFailure('unknown', 'Filesystem environment returned a malformed reader.', addressed); }
      this.#openReaders.add(reader);
      return Result.ok(reader);
    } catch { await closeUnknownReader(candidate, invocation.context); return fileFailure('unknown', 'Filesystem environment returned a malformed result.', addressed); }
  }
  async readTextLines(path: string, options: { maxLines?: number } | undefined, context: Context) {
    return this.file(path, context, stringArrayValue, (invocation) => this.#readTextLines(path, snapshotReadOptions(options), invocation.context));
  }
  async readBinaryFile(path: string, context: Context) { return this.file(path, context, binaryValue, (invocation) => this.#readBinaryFile(path, invocation.context)); }
  async writeFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, voidValue, (invocation) => this.#writeFile(path, snapshotContent(content), invocation.context));
  }
  async appendFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, voidValue, (invocation) => this.#appendFile(path, snapshotContent(content), invocation.context));
  }
  async renameFile(sourcePath: string, destinationPath: string, context: Context) { return this.file(sourcePath, context, voidValue, (invocation) => this.#renameFile(sourcePath, destinationPath, invocation.context)); }
  async fileInfo(path: string, context: Context) { return this.file(path, context, (value) => fileInfoValue(value, this.cwd), (invocation) => this.#fileInfo(path, invocation.context)); }
  async listDir(path: string, context: Context) { return this.file(path, context, (value) => fileInfoArrayValue(value, this.cwd), (invocation) => this.#listDir(path, invocation.context)); }
  async canonicalPath(path: string, context: Context) { return this.file(path, context, stringValue, (invocation) => this.#canonicalPath(path, invocation.context)); }
  async exists(path: string, context: Context) { return this.file(path, context, booleanValue, (invocation) => this.#exists(path, invocation.context)); }
  async createDir(path: string, options: { recursive?: boolean } | undefined, context: Context) {
    return this.file(path, context, voidValue, (invocation) => this.#createDir(path, snapshotCreateOptions(options), invocation.context));
  }
  async remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context) {
    return this.file(path, context, voidValue, (invocation) => this.#remove(path, snapshotRemoveOptions(options), invocation.context));
  }
  async createTempDir(prefix: string | undefined, context: Context) { return this.file(undefined, context, stringValue, (invocation) => this.#createTempDir(prefix, invocation.context)); }
  async createTempFile(options: { prefix?: string; suffix?: string } | undefined, context: Context) {
    return this.file(undefined, context, stringValue, (invocation) => this.#createTempFile(snapshotTempOptions(options), invocation.context));
  }

  async exec(command: string, options: ShellExecOptions | undefined, context: Context): Promise<ResultValue<ShellExecResult, ExecutionError>> {
    if (this.#closed) return executionFailure("aborted", "Execution environment is closed.");
    let invocation: InvocationContext;
    let snapshot: Readonly<ShellExecOptions>;
    try {
      if (typeof command !== "string") return executionFailure("unknown", "Invalid shell command.");
      const capturedContext = snapshotContext(context);
      if (!capturedContext) return executionFailure("unknown", "Invalid execution context.");
      invocation = capturedContext;
      snapshot = snapshotShellOptions(options);
      if (isAborted(invocation)) return executionFailure("aborted", "aborted");
    } catch (error) {
      return error instanceof InvalidTimeoutError
        ? executionFailure("timeout", "Invalid timeout.")
        : executionFailure("unknown", "Invalid shell execution options.");
    }

    let prepared: unknown;
    try { prepared = await Promise.resolve(this.#prepareShellEnvironment(command, snapshot)); }
    catch { return executionFailure("unknown", "Shell environment preparation failed."); }
    const env = normaliseEnvironment(prepared);
    if (!env) return executionFailure("unknown", "Shell environment preparation returned an invalid environment.");
    if (this.#closed || isAborted(invocation)) return executionFailure("aborted", "aborted");

    const limits = snapshot.capture?.limits ?? { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES };
    let outputView: ShellOutputView | undefined;
    let callbackFault = false;
    let terminal = false;
    const onUpdate = snapshot.onUpdate;
    const guardedUpdate = onUpdate
      ? (update: ShellOutputUpdate, _delegateContext: Context): void => {
        if (terminal) return;
        try {
          if (this.#closed || isAborted(invocation)) { terminal = true; return; }
          const copied = normaliseShellUpdate(update);
          if (!copied) throw new TypeError("Malformed shell update.");
          outputView = validateOutputReplay(outputView, copied, limits);
          onUpdate(copied, invocation.context);
        } catch {
          callbackFault = true;
          terminal = true;
          throw new Error("Shell output callback failed.");
        }
      }
      : undefined;

    const delegateOptions = Object.freeze({
      ...snapshot,
      env: Object.freeze(env),
      inheritEnv: false,
      ...(guardedUpdate === undefined ? { onUpdate: undefined } : { onUpdate: guardedUpdate }),
    });
    let result: unknown;
    try { result = await this.#exec(command, delegateOptions, invocation.context); }
    catch {
      terminal = true;
      return callbackFault
        ? executionFailure("callback_error", "Shell output callback failed.")
        : isAborted(invocation)
          ? executionFailure("aborted", "aborted")
          : executionFailure("unknown", "Execution environment failed.");
    }
    terminal = true;
    if (callbackFault) return executionFailure("callback_error", "Shell output callback failed.");
    if (this.#closed || isAborted(invocation)) return executionFailure("aborted", "aborted");
    const normalized = normaliseExecutionResult(result);
    if (normalized.ok && !matchesCaptureLimits(normalized.value, limits)) {
      return executionFailure("unknown", "Shell result exceeds admitted capture limits.");
    }
    if (normalized.ok && outputView && !sameShellMetadata(normalized.value, outputView)) {
      return executionFailure("unknown", "Shell result disagrees with the final output metadata.");
    }
    return normalized;
  }

  cleanup(context: Context): Promise<void> {
    this.#closed = true;
    if (!this.#cleanupPromise) {
      this.#cleanupPromise = Promise.resolve().then(async () => {
        await Promise.all([...this.#openReaders].map(reader => reader.close(context)));
        try { await this.#cleanup(context); }
        catch (error) { void error; /* cleanup is best effort by contract */ }
      });
    }
    return this.#cleanupPromise;
  }

  private async file<T>(
    path: string | undefined,
    context: Context,
    normalise: FileNormaliser<T>,
    effect: (invocation: InvocationContext) => Promise<unknown>,
  ): Promise<ResultValue<T, FileError>> {
    const addressed = this.addressedPath(path);
    if (this.#closed) return fileFailure("aborted", "Execution environment is closed.", addressed);
    try {
      const invocation = snapshotContext(context);
      if (!invocation) return fileFailure("unknown", "Invalid execution context.", addressed);
      if (isAborted(invocation)) return fileFailure("aborted", "aborted", addressed);
      const candidate = await effect(invocation);
      if (this.#closed || isAborted(invocation)) return fileFailure("aborted", "aborted", addressed);
      return normaliseFileResult(candidate, addressed, normalise);
    } catch { return fileFailure("unknown", "Filesystem environment failed.", addressed); }
  }

  private addressedPath(path: string | undefined): string | undefined {
    try { return typeof path === "string" ? resolveSelectedPath(this.cwd, path) : undefined; }
    catch { return undefined; }
  }
}

function captureTextLineMethod(receiver: ExecutionEnv): TextLineEnvironment['openTextLineReader'] {
  const value = receiver as Partial<TextLineEnvironment>;
  const first = value.openTextLineReader; const second = value.openTextLineReader;
  if (first !== second || typeof first !== 'function') throw new TypeError('Invalid ExecutionEnv method: openTextLineReader');
  return first.bind(receiver);
}
function captureTextLineReader(value: unknown, path: string | undefined, closed: () => boolean, onClose: () => void): TextLineReader | null {
  if (!record(value)) return null;
  const read = stable(value, 'readLine'), close = stable(value, 'close');
  if (typeof read !== 'function' || typeof close !== 'function') return null;
  const delegateRead = read.bind(value), delegateClose = close.bind(value);
  let stopped = false;
  return Object.freeze({
    async readLine(context: Context): Promise<ResultValue<TextLineRecord | undefined, FileError>> {
      if (stopped) return fileFailure('invalid', 'Text line reader is closed.', path);
      const invocation = snapshotContext(context);
      if (!invocation) return fileFailure('unknown', 'Invalid execution context.', path);
      if (closed() || isAborted(invocation)) return fileFailure('aborted', 'aborted', path);
      let candidate: unknown;
      try { candidate = await delegateRead(invocation.context); }
      catch { return fileFailure('unknown', 'Filesystem reader failed.', path); }
      if (closed() || isAborted(invocation)) return fileFailure('aborted', 'aborted', path);
      return normaliseFileResult(candidate, path, (line): TextLineRecord | undefined | null => {
        if (line === undefined) return undefined;
        if (!record(line)) return null;
        const text = stable(line, 'text'), terminated = stable(line, 'terminated');
        return typeof text === 'string' && typeof terminated === 'boolean' ? Object.freeze({ text, terminated }) : null;
      });
    },
    async close(context: Context): Promise<void> {
      if (stopped) return;
      stopped = true; onClose();
      try { await delegateClose(context); }
      catch (error) { debugSuppressedError(log, 'Delegate text reader close failed.', error, { operation: 'execution_env.reader.close' }); }
    },
  });
}
async function closeUnknownReader(candidate: unknown, context: Context): Promise<void> {
  try {
    if (!record(candidate) || stable(candidate, 'ok') !== true) return;
    const value = stable(candidate, 'value'); if (!record(value)) return;
    const close = stable(value, 'close'); if (typeof close === 'function') await close.call(value, context);
  } catch (error) { debugSuppressedError(log, 'Malformed text reader cleanup failed.', error, { operation: 'execution_env.reader.cleanup' }); }
}
function captureMethod<K extends keyof ExecutionEnv>(receiver: ExecutionEnv, key: K): ExecutionEnv[K] {
  const first = receiver[key]; const second = receiver[key];
  if (first !== second || typeof first !== "function") throw new TypeError(`Invalid ExecutionEnv method: ${key}`);
  return first.bind(receiver) as ExecutionEnv[K];
}
function requireStableCwd(value: ExecutionEnv): string {
  const cwd = value.cwd;
  if (value.cwd !== cwd || typeof cwd !== "string" || cwd.trim().length === 0 || !cwd.startsWith("/")) throw new TypeError("Invalid ExecutionEnv cwd.");
  return resolveSelectedPath("/", cwd);
}
function snapshotContext(value: unknown): InvocationContext | null {
  try {
    if (!record(value)) return null;
    const signal = stable(value, "abortSignal");
    if (signal !== undefined && !(signal instanceof AbortSignal)) return null;
    return Object.freeze({ context: value as unknown as Context, abortSignal: signal as AbortSignal | undefined });
  } catch { return null; }
}
function isAborted(context: InvocationContext): boolean {
  try { return context.abortSignal?.aborted === true; }
  catch { return true; }
}
function normaliseFileResult<T>(candidate: unknown, fallbackPath: string | undefined, normalise: FileNormaliser<T>): ResultValue<T, FileError> {
  try {
    if (!record(candidate)) return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath);
    const ok = stable(candidate, "ok");
    if (ok === true) {
      const value = stable(candidate, "value"); const snapshot = normalise(value);
      return snapshot === null ? fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath) : Result.ok(snapshot);
    }
    if (ok !== false) return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath);
    return normaliseFileError(stable(candidate, "error"), fallbackPath);
  } catch { return fileFailure("unknown", "Filesystem environment returned a malformed result.", fallbackPath); }
}
function normaliseFileError(value: unknown, fallbackPath: string | undefined): ResultValue<never, FileError> {
  try {
    if (!(value instanceof FileError)) return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath);
    const code = stableObject(value, "code"); const message = stableObject(value, "message"); const path = stableObject(value, "path");
    if (!FILE_CODES.has(code as FileErrorCode) || typeof message !== "string" || (path !== undefined && typeof path !== "string")) return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath);
    return fileFailure(code as FileErrorCode, `Filesystem operation failed (${code as string}).`, normaliseErrorPath(path as string | undefined, fallbackPath));
  } catch { return fileFailure("unknown", "Filesystem environment returned a malformed error.", fallbackPath); }
}
function normaliseExecutionResult(candidate: unknown): ResultValue<ShellExecResult, ExecutionError> {
  try {
    if (!record(candidate)) return executionFailure("unknown", "Execution environment returned a malformed result.");
    const ok = stable(candidate, "ok");
    if (ok === true) {
      const value = stable(candidate, "value");
      if (!record(value)) return executionFailure("unknown", "Execution environment returned a malformed result.");
      const exitCode = stable(value, "exitCode");
      const metadata = normaliseShellMetadata(value);
      return Number.isSafeInteger(exitCode) && metadata
        ? Result.ok(Object.freeze({ exitCode: exitCode as number, ...metadata }))
        : executionFailure("unknown", "Execution environment returned a malformed result.");
    }
    if (ok !== false) return executionFailure("unknown", "Execution environment returned a malformed result.");
    const value = stable(candidate, "error");
    if (!(value instanceof ExecutionError)) return executionFailure("unknown", "Execution environment returned a malformed error.");
    const code = stableObject(value, "code"); const message = stableObject(value, "message");
    return EXECUTION_CODES.has(code as ExecutionErrorCode) && typeof message === "string"
      ? executionFailure(code as ExecutionErrorCode, `Execution failed (${code as string}).`)
      : executionFailure("unknown", "Execution environment returned a malformed error.");
  } catch { return executionFailure("unknown", "Execution environment returned a malformed result."); }
}
function snapshotShellOptions(value: unknown): Readonly<ShellExecOptions> {
  if (value === undefined) return Object.freeze({});
  if (!record(value)) throw new TypeError("Invalid shell options.");
  const cwd = stable(value, "cwd"); const timeout = stable(value, "timeout");
  const update = stable(value, "onUpdate"); const environment = stable(value, "env");
  const inherit = stable(value, "inheritEnv"); const captureValue = stable(value, "capture");
  if (cwd !== undefined && typeof cwd !== "string") throw new TypeError("Invalid cwd.");
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS)) throw new InvalidTimeoutError();
  if (update !== undefined && typeof update !== "function") throw new TypeError("Invalid callback.");
  if (inherit !== undefined && typeof inherit !== "boolean") throw new TypeError("Invalid inheritance option.");
  const candidateEnv = environment === undefined ? undefined : normaliseEnvironment(environment);
  if (environment !== undefined && !candidateEnv) throw new TypeError("Invalid environment.");
  const env = candidateEnv ?? undefined;
  const capture = snapshotCaptureOptions(captureValue);
  return Object.freeze({
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(update === undefined ? {} : { onUpdate: update as ShellExecOptions["onUpdate"] }),
    ...(env === undefined ? {} : { env: Object.freeze(env) }),
    ...(inherit === undefined ? {} : { inheritEnv: inherit }),
    ...(capture === undefined ? {} : { capture }),
  });
}
function snapshotCaptureOptions(value: unknown): ShellExecOptions["capture"] {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Invalid capture options.");
  const limitsValue = stable(value, "limits"); const spill = stable(value, "spill");
  if (!record(limitsValue) || (spill !== undefined && typeof spill !== "boolean")) throw new TypeError("Invalid capture options.");
  const maxBytes = stable(limitsValue, "maxBytes"); const maxLines = stable(limitsValue, "maxLines"); const retain = stable(limitsValue, "retain");
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) throw new TypeError("Invalid capture byte limit.");
  if (!Number.isSafeInteger(maxLines) || (maxLines as number) <= 0) throw new TypeError("Invalid capture line limit.");
  if (retain !== undefined && retain !== "head" && retain !== "tail") throw new TypeError("Invalid capture retention.");
  const limits = Object.freeze({ maxBytes, maxLines: maxLines as number, ...(retain === undefined ? {} : { retain }) });
  return Object.freeze({ limits, ...(spill === undefined ? {} : { spill }) });
}
function snapshotReadOptions(value: unknown): { maxLines?: number } | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Invalid read options.");
  const maxLines = stable(value, "maxLines");
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || (maxLines as number) < 0)) throw new TypeError("Invalid read options.");
  return Object.freeze(maxLines === undefined ? {} : { maxLines: maxLines as number });
}
function snapshotCreateOptions(value: unknown): { recursive?: boolean } | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Invalid create options.");
  const recursive = stable(value, "recursive");
  if (recursive !== undefined && typeof recursive !== "boolean") throw new TypeError("Invalid create options.");
  return Object.freeze(recursive === undefined ? {} : { recursive });
}
function snapshotRemoveOptions(value: unknown): { recursive?: boolean; force?: boolean } | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Invalid remove options.");
  const recursive = stable(value, "recursive"); const force = stable(value, "force");
  if ((recursive !== undefined && typeof recursive !== "boolean") || (force !== undefined && typeof force !== "boolean")) throw new TypeError("Invalid remove options.");
  return Object.freeze({ ...(recursive === undefined ? {} : { recursive }), ...(force === undefined ? {} : { force }) });
}
function snapshotTempOptions(value: unknown): { prefix?: string; suffix?: string } | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Invalid temp options.");
  const prefix = stable(value, "prefix"); const suffix = stable(value, "suffix");
  if ((prefix !== undefined && typeof prefix !== "string") || (suffix !== undefined && typeof suffix !== "string")) throw new TypeError("Invalid temp options.");
  return Object.freeze({ ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }) });
}
function sameShellMetadata(left: ShellOutputMetadata, right: ShellOutputMetadata): boolean {
  return left.spillPath === right.spillPath && left.lastLineBytes === right.lastLineBytes
    && (Object.keys(left.truncation) as Array<keyof ShellOutputMetadata["truncation"]>)
      .every((key) => left.truncation[key] === right.truncation[key]);
}

function matchesCaptureLimits(metadata: ShellOutputMetadata, limits: { maxBytes: number; maxLines: number }): boolean {
  const t = metadata.truncation;
  return t.maxBytes === limits.maxBytes && t.maxLines === limits.maxLines
    && t.outputBytes <= limits.maxBytes && t.outputLines <= limits.maxLines;
}

function validateOutputReplay(current: ShellOutputView | undefined, update: ShellOutputUpdate, limits: { maxBytes: number; maxLines: number }): ShellOutputView {
  const metadata = update.kind === "replace" ? update.output : update.metadata;
  if (!matchesCaptureLimits(metadata, limits)) throw new TypeError("Shell output capture limits changed.");
  const added = update.kind === "replace" ? update.output.text : update.kind === "metadata" ? "" : update.text;
  // Bound each fragment before concatenation, including malicious UTF-16 input.
  if (added.length > limits.maxBytes || Buffer.byteLength(added, "utf8") > limits.maxBytes) throw new TypeError("Oversized shell output fragment.");
  if (update.kind === "slide") {
    const previous = current?.text ?? "";
    if (update.drop > previous.length) throw new TypeError("Invalid shell output slide.");
    const before = previous.charCodeAt(update.drop - 1), after = previous.charCodeAt(update.drop);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) throw new TypeError("Shell output slide splits a code point.");
  }
  const retainedLength = update.kind === "replace" ? 0 : Math.max(0, (current?.text.length ?? 0) - (update.kind === "slide" ? update.drop : 0));
  if (retainedLength + added.length > limits.maxBytes) throw new TypeError("Oversized shell output replay.");
  const next = applyShellOutputUpdate(current, update);
  const bytes = Buffer.byteLength(next.text, "utf8");
  const lines = next.text === "" ? 0 : next.text.split("\n").length - (next.text.endsWith("\n") ? 1 : 0);
  // The source may strip control characters after calculating metadata, so the
  // displayed byte/line counts can be smaller but must never exceed it.
  if (bytes > metadata.truncation.outputBytes || lines > metadata.truncation.outputLines) throw new TypeError("Shell output disagrees with capture metadata.");
  return next;
}

function normaliseShellUpdate(value: unknown): ShellOutputUpdate | null {
  try {
    if (!record(value)) return null;
    const kind = stable(value, "kind");
    if (kind === "replace") {
      const output = stable(value, "output");
      if (!record(output)) return null;
      const text = stable(output, "text"); const metadata = normaliseShellMetadata(output);
      return typeof text === "string" && metadata ? Object.freeze({ kind, output: Object.freeze({ text, ...metadata }) }) : null;
    }
    const metadata = normaliseShellMetadata(stable(value, "metadata"));
    if (!metadata) return null;
    if (kind === "metadata") return Object.freeze({ kind, metadata });
    const text = stable(value, "text");
    if (typeof text !== "string") return null;
    if (kind === "append") return Object.freeze({ kind, text, metadata });
    if (kind === "slide") {
      const drop = stable(value, "drop");
      return Number.isSafeInteger(drop) && (drop as number) >= 0 ? Object.freeze({ kind, drop: drop as number, text, metadata }) : null;
    }
    return null;
  } catch { return null; }
}
function normaliseShellMetadata(value: unknown): ShellOutputMetadata | null {
  try {
    if (!record(value)) return null;
    const truncation = normaliseTruncation(stable(value, "truncation"));
    const spillPath = stable(value, "spillPath"); const lastLineBytes = stable(value, "lastLineBytes");
    if (!truncation || (spillPath !== undefined && typeof spillPath !== "string") || (lastLineBytes !== undefined && !nonNegativeInteger(lastLineBytes))) return null;
    return Object.freeze({
      truncation,
      ...(spillPath === undefined ? {} : { spillPath }),
      ...(lastLineBytes === undefined ? {} : { lastLineBytes: lastLineBytes as number }),
    });
  } catch { return null; }
}
function normaliseTruncation(value: unknown): ShellOutputTruncation | null {
  try {
    if (!record(value)) return null;
    const truncated = stable(value, "truncated"); const truncatedBy = stable(value, "truncatedBy");
    const totalLines = stable(value, "totalLines"); const totalBytes = stable(value, "totalBytes");
    const outputLines = stable(value, "outputLines"); const outputBytes = stable(value, "outputBytes");
    const lastLinePartial = stable(value, "lastLinePartial"); const firstLineExceedsLimit = stable(value, "firstLineExceedsLimit");
    const maxLines = stable(value, "maxLines"); const maxBytes = stable(value, "maxBytes");
    if (typeof truncated !== "boolean" || (truncatedBy !== null && truncatedBy !== "lines" && truncatedBy !== "bytes")) return null;
    if (![totalLines, totalBytes, outputLines, outputBytes].every(nonNegativeInteger)) return null;
    if (!Number.isSafeInteger(maxLines) || (maxLines as number) <= 0 || typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) return null;
    if (typeof lastLinePartial !== "boolean" || typeof firstLineExceedsLimit !== "boolean") return null;
    if (truncated !== (truncatedBy !== null)) return null;
    if ((outputLines as number) > (totalLines as number) || (outputBytes as number) > (totalBytes as number) || (outputLines as number) > (maxLines as number) || (outputBytes as number) > maxBytes) return null;
    if (!truncated && ((outputLines as number) !== (totalLines as number) || (outputBytes as number) !== (totalBytes as number) || lastLinePartial || firstLineExceedsLimit)) return null;
    if (firstLineExceedsLimit && (outputLines !== 0 || outputBytes !== 0)) return null;
    return Object.freeze({ truncated, truncatedBy, totalLines: totalLines as number, totalBytes: totalBytes as number, outputLines: outputLines as number, outputBytes: outputBytes as number, lastLinePartial, firstLineExceedsLimit, maxLines: maxLines as number, maxBytes });
  } catch { return null; }
}
function snapshotContent(value: unknown): string | Uint8Array { if (typeof value === "string") return value; if (!(value instanceof Uint8Array)) throw new TypeError("Invalid content."); return new Uint8Array(value); }
function snapshotStringArray(value: unknown): string[] | null {
  try { if (!Array.isArray(value)) return null; const length = value.length; if (value.length !== length) return null; const output: string[] = []; for (let index = 0; index < length; index += 1) { const item = value[index]; if (value[index] !== item || typeof item !== "string") return null; output.push(item); } return Object.freeze(output) as string[]; }
  catch { return null; }
}
function normaliseEnvironment(value: unknown): Record<string, string> | null {
  try { if (!record(value)) return null; const output: Record<string, string> = {}; for (const key of Object.keys(value)) { const item = stable(value, key); if (typeof item !== "string") return null; output[key] = item; } return output; }
  catch { return null; }
}
function fileInfoValue(value: unknown, cwd: string): FileInfo | null {
  try { if (!record(value)) return null; const name = stable(value, "name"); const path = stable(value, "path"); const kind = stable(value, "kind"); const size = stable(value, "size"); const mtimeMs = stable(value, "mtimeMs"); if (typeof name !== "string" || typeof path !== "string" || !FILE_KINDS.has(kind as FileInfo["kind"]) || !Number.isSafeInteger(size) || (size as number) < 0 || typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs) || mtimeMs < 0) return null; return Object.freeze({ name, path: resolveSelectedPath(cwd, path), kind: kind as FileInfo["kind"], size: size as number, mtimeMs }); }
  catch { return null; }
}
function fileInfoArrayValue(value: unknown, cwd: string): FileInfo[] | null { try { if (!Array.isArray(value)) return null; const output = value.map((entry) => fileInfoValue(entry, cwd)); return output.some((item) => item === null) ? null : Object.freeze(output) as FileInfo[]; } catch { return null; } }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function stringArrayValue(value: unknown): string[] | null { const output = snapshotStringArray(value); return output ? Object.freeze(output) as string[] : null; }
function binaryValue(value: unknown): Uint8Array | null { try { return value instanceof Uint8Array ? new Uint8Array(value) : null; } catch { return null; } }
function booleanValue(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function voidValue(value: unknown): undefined | null { return value === undefined ? undefined : null; }
function nonNegativeInteger(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function normaliseErrorPath(path: string | undefined, fallback: string | undefined): string | undefined { try { return path === undefined ? fallback : path.startsWith("/") || path === "~" || path.startsWith("~/") || path.startsWith("file://") ? resolveSelectedPath("/", path) : fallback; } catch { return fallback; } }
function fileFailure(code: FileErrorCode, message: string, path?: string): ResultValue<never, FileError> { return Result.err(new FileError(code, message, path)); }
function executionFailure(code: ExecutionErrorCode, message: string): ResultValue<never, ExecutionError> { return Result.err(new ExecutionError(code, message)); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stable(value: Record<string, unknown>, key: string): unknown { const first = value[key]; return value[key] === first ? first : CHANGED; }
function stableObject(value: object, key: string): unknown { return stable(value as Record<string, unknown>, key); }
function resolveSelectedPath(cwd: string, path: string): string {
  let normalised = path;
  if (normalised === "~") normalised = homedir();
  else if (normalised.startsWith("~/")) normalised = join(homedir(), normalised.slice(2));
  else if (normalised.startsWith("file://")) {
    try { normalised = fileURLToPath(normalised); }
    catch (error) { void error; /* selected Earendil behavior treats malformed URLs as paths */ }
  }
  return resolvePath(cwd, normalised);
}
class InvalidTimeoutError extends Error {}
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
const CHANGED = Symbol("changed");
const FILE_CODES = new Set<FileErrorCode>(["aborted", "not_found", "permission_denied", "not_directory", "is_directory", "invalid", "not_supported", "unknown"]);
const EXECUTION_CODES = new Set<ExecutionErrorCode>(["aborted", "timeout", "shell_unavailable", "spawn_error", "callback_error", "unknown"]);
const FILE_KINDS = new Set<FileInfo["kind"]>(["file", "directory", "symlink"]);
