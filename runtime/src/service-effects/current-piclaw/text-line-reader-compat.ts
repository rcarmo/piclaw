import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileError, Result, type ExecutionEnv, type Result as ResultValue } from "../contracts/execution-env.js";
import type { Context } from "@earendil-works/chord/context";
import { createLogger, debugSuppressedError } from '../../utils/logger.js';

const log = createLogger('service-effects.text-line-reader');

/** Structural form of the public Earendil 0.87.1 TextLineReader contract. */
export interface TextLineRecord { readonly text: string; readonly terminated: boolean }
export interface TextLineReader { readLine(context: Context): Promise<ResultValue<TextLineRecord | undefined, FileError>>; close(context: Context): Promise<void> }
export type TextLineEnvironment = ExecutionEnv & { openTextLineReader(path: string, context: Context): Promise<ResultValue<TextLineReader, FileError>> };

/** Compatibility fallback for older injected Node environments; 0.87.1 supplies the method itself. */
export function withLocalTextLineReader(delegate: ExecutionEnv): TextLineEnvironment {
  const original = delegate as Partial<TextLineEnvironment>;
  if (typeof original.openTextLineReader === 'function') return delegate as TextLineEnvironment;
  const cached = new Map<PropertyKey, unknown>();
  return new Proxy(delegate as TextLineEnvironment, {
    get(target, key) {
      if (cached.has(key)) return cached.get(key);
      if (key === 'openTextLineReader') { const method = openLocalTextLineReader.bind(null, target.cwd); cached.set(key, method); return method; }
      const value = Reflect.get(target, key, target);
      const stable = typeof value === 'function' ? value.bind(target) : value;
      cached.set(key, stable);
      return stable;
    },
  });
}

async function openLocalTextLineReader(cwd: string, path: string, context: Context): Promise<ResultValue<TextLineReader, FileError>> {
  const addressed = resolve(cwd, path);
  if (context.abortSignal?.aborted) return Result.err(new FileError('aborted', 'aborted', addressed));
  try {
    const file = await open(addressed, 'r');
    if (context.abortSignal?.aborted) { await file.close().catch(() => undefined); return Result.err(new FileError('aborted', 'aborted', addressed)); }
    return Result.ok(new LocalTextLineReader(file, addressed));
  } catch (error) { return Result.err(fileError(error, addressed)); }
}

class LocalTextLineReader implements TextLineReader {
  private readonly decoder = new TextDecoder();
  private readonly chunk = new Uint8Array(64 * 1024);
  private offset = 0;
  private buffered = '';
  private ended = false;
  private closed = false;
  constructor(private readonly file: Awaited<ReturnType<typeof open>>, private readonly path: string) {}
  async readLine(context: Context): Promise<ResultValue<TextLineRecord | undefined, FileError>> {
    if (context.abortSignal?.aborted) return Result.err(new FileError('aborted', 'aborted', this.path));
    if (this.closed) return Result.err(new FileError('invalid', 'Text line reader is closed.', this.path));
    try {
      while (true) {
        const newline = this.buffered.indexOf('\n');
        if (newline >= 0) { const text = this.buffered.slice(0, newline); this.buffered = this.buffered.slice(newline + 1); return Result.ok({ text, terminated: true }); }
        if (this.ended) { if (!this.buffered) return Result.ok(undefined); const text = this.buffered; this.buffered = ''; return Result.ok({ text, terminated: false }); }
        const { bytesRead } = await this.file.read(this.chunk, 0, this.chunk.length, this.offset);
        if (context.abortSignal?.aborted) return Result.err(new FileError('aborted', 'aborted', this.path));
        this.offset += bytesRead;
        if (!bytesRead) { this.buffered += this.decoder.decode(); this.ended = true; }
        else this.buffered += this.decoder.decode(this.chunk.subarray(0, bytesRead), { stream: true });
      }
    } catch (error) { return Result.err(fileError(error, this.path)); }
  }
  async close(_context: Context): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.buffered = '';
    try { await this.file.close(); }
    catch (error) { debugSuppressedError(log, 'Text line reader close failed.', error, { operation: 'text_line_reader.close' }); }
  }
}
function fileError(error: unknown, path: string): FileError {
  const code = (error as NodeJS.ErrnoException)?.code;
  const tag = code === 'ENOENT' ? 'not_found' : code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : code === 'ENOTDIR' ? 'not_directory' : code === 'EISDIR' ? 'is_directory' : code === 'EINVAL' ? 'invalid' : code === 'ABORT_ERR' ? 'aborted' : 'unknown';
  return new FileError(tag, `Filesystem operation failed (${tag}).`, path);
}
