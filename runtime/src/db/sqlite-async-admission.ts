import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { isAsyncFunction, isPromise } from 'node:util/types';
import { createLogger } from '../utils/logger.js';

const log = createLogger('db.admission');

export function isSqliteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  try {
    // Do not execute getters on a thrown value while classifying it.
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    const errno = Object.getOwnPropertyDescriptor(error, 'errno')?.value;
    return (typeof code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z]+)*$/.test(code))
      || [code, errno].some(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        && ((value & 0xff) === 5 || (value & 0xff) === 6));
  } catch { return false; }
}

/** Shared acquisition pause only. Transaction ownership and callback execution
 * remain with the synchronous host primitive or the asynchronous SDK adapter. */
export async function waitForSqliteContention(deadline: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, Math.min(25, Math.max(1, deadline - performance.now())));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Retry writer acquisition only; never replay an entered transaction callback.
 * Keep operations/authorization synchronous and SQL-only. Rejecting async misuse
 * cannot cancel work already started. Restore connection
 * policy before yielding and run rollback cleanup before returning any failure. */
export async function admitSqliteWrite<T>(
  database: Database,
  operation: () => T,
  authorise: (phase: 'before' | 'after') => void = () => {},
  signal: AbortSignal = new AbortController().signal,
  timeoutMs = 5000,
  assertBinding: () => void = () => {},
  afterRollback: () => void = () => {},
): Promise<T> {
  signal.throwIfAborted(); assertBinding();
  const file = (database.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')?.file;
  const identity = () => { const stat = statSync(file!); return `${stat.dev}:${stat.ino}`; };
  const original = file ? identity() : undefined;
  const checkFile = () => { if (file && identity() !== original) throw Error('SQLite database file changed.'); };
  if (isAsyncFunction(operation)) throw new TypeError('SQLite admission callback must be synchronous');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    // No access to a captured handle until its current binding is confirmed.
    assertBinding(); checkFile();
    const previous = (database.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    let contention: unknown;
    let callbackEntered = false, completed = false;
    database.exec('PRAGMA busy_timeout=0');
    try {
      const result = database.transaction(() => {
        callbackEntered = true; // Authorization can mutate attempt-local state too.
        checkFile(); authorise('before');
        signal.throwIfAborted();
        const result = operation();
        if (result !== null && (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as { then?: unknown }).then === 'function') {
          if (isPromise(result)) void Promise.prototype.catch.call(result, () => {});
          throw new TypeError('SQLite admission callback must be synchronous');
        }
        authorise('after'); checkFile();
        signal.throwIfAborted();
        return result;
      }).immediate();
      completed = true; return result;
    } catch (error) {
      afterRollback(); // Synchronous: restore attempt-local memory on terminal failures too.
      if (callbackEntered || !isSqliteContention(error)) throw error;
      contention = error;
    } finally {
      try { database.exec(`PRAGMA busy_timeout=${previous}`); }
      catch (error) {
        if (!completed) throw error;
        // The transaction has completed. Cleanup failure cannot mean not_applied.
        try { log.warn('SQLite timeout restoration failed after completed transaction', { error }); }
        catch { /* Diagnostics cannot replace the completed transaction result. */ }
      }
    }
    if (performance.now() >= deadline) throw contention;
    await waitForSqliteContention(deadline, signal);
    if (performance.now() >= deadline) throw contention;
  }
}
