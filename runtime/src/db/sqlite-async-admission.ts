import type { Database } from 'bun:sqlite';
import { performance } from 'node:perf_hooks';

export function isSqliteContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  return (typeof code === 'string' && /^SQLITE_(?:BUSY|LOCKED)(?:_[A-Z]+)*$/.test(code))
    || [code, errno].some(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      && ((value & 0xff) === 5 || (value & 0xff) === 6));
}

/** Retry an atomic transaction only after confirmed rollback/no admission.
 * Restore connection policy before yielding; revalidate on every attempt. */
export async function admitSqliteWrite<T>(
  database: Database,
  operation: () => T,
  authorise: (phase: 'before' | 'after') => void,
  signal: AbortSignal,
  timeoutMs = 5000,
  assertBinding: () => void = () => {},
  afterRollback: () => void = () => {},
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    // No access to a captured handle until its current binding is confirmed.
    assertBinding();
    const previous = (database.query('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    let contention: unknown;
    database.exec('PRAGMA busy_timeout=0');
    try {
      return database.transaction(() => {
        authorise('before');
        signal.throwIfAborted();
        const result = operation();
        authorise('after');
        signal.throwIfAborted();
        return result;
      }).immediate();
    } catch (error) {
      afterRollback(); // Synchronous: restore attempt-local memory before any retry yields.
      if (!isSqliteContention(error)) throw error;
      contention = error;
    } finally {
      database.exec(`PRAGMA busy_timeout=${previous}`);
    }
    if (performance.now() >= deadline) throw contention;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, Math.min(25, Math.max(1, deadline - performance.now())));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    if (performance.now() >= deadline) throw contention;
  }
}
