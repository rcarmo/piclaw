/**
 * runtime/single-instance.ts – workspace-scoped runtime lock.
 *
 * Prevents accidental second Piclaw runtimes from opening the same live state
 * and running startup recovery while the managed service is still active.
 */

import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "fs";
import { randomUUID } from "crypto";
import { dirname, resolve } from "path";
import { STORE_DIR, WORKSPACE_DIR } from "../core/config.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger('single-instance');

export interface RuntimeLockRecord {
  pid: number;
  startedAt: string;
  workspace: string;
  command: string;
  kind?: 'maintenance';
  bootId?: string;
  processStart?: string;
  nonce?: string;
}

export interface RuntimeProcessInspector {
  pid: number;
  now(): Date;
  isAlive(pid: number): boolean;
  bootId?(): string;
  processStart?(pid: number): string;
}

export interface RuntimeLockHandle {
  readonly path: string;
  readonly record: Readonly<RuntimeLockRecord>;
  readonly enabled: boolean;
  readonly strictOwnership: boolean;
  /** Strict lock authority only, not DB binding. Validate immediately before opening storage. */
  assertCurrentOwner(): void;
  /** Permit exit cleanup only after the application explicitly certifies disposal. */
  markSafeReleaseOnExit(): void;
  release(): void;
}

export interface AcquireRuntimeLockOptions {
  lockPath?: string;
  inspector?: RuntimeProcessInspector;
  disabled?: boolean;
  /** Mark an offline maintenance owner; all acquirers refuse every existing path. */
  maintenance?: boolean;
  /** Never remove an existing lock, even if stale. Operator cleanup is offline only. */
  strictOwnership?: boolean;
}

const DEFAULT_LOCK_FILE = "runtime.lock";
const DISABLE_LOCK_ENV = "PICLAW_DISABLE_RUNTIME_LOCK";

function isRuntimeLockDisabled(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env[DISABLE_LOCK_ENV] || "").trim().toLowerCase());
}

export function getDefaultRuntimeLockPath(): string {
  return resolve(STORE_DIR, DEFAULT_LOCK_FILE);
}

export function createDefaultRuntimeProcessInspector(): RuntimeProcessInspector {
  return {
    pid: process.pid,
    now: () => new Date(),
    isAlive(pid: number): boolean {
      if (!Number.isFinite(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        return code === "EPERM";
      }
    },
    bootId: () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    processStart: (pid: number) => {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      if (!start || !/^\d+$/.test(start)) throw new Error('Cannot verify runtime process start');
      return start;
    },
  };
}

function createRuntimeLockRecord(inspector: RuntimeProcessInspector, strictOwnership: boolean): RuntimeLockRecord {
  let bootId: string | undefined;
  let processStart: string | undefined;
  try {
    bootId = inspector.bootId?.();
    processStart = inspector.processStart?.(inspector.pid);
  } catch (cause) {
    if (strictOwnership) throw new Error('Cannot verify strict runtime process identity', { cause });
    // Legacy exclusion must still work without Linux /proc identity support.
  }
  return {
    pid: inspector.pid,
    startedAt: inspector.now().toISOString(),
    workspace: WORKSPACE_DIR,
    command: process.argv.join(" "),
    nonce: randomUUID(),
    bootId,
    processStart,
  };
}

function writeNewLockFile(lockPath: string, raw: string): { dev: number; ino: number; fd: number } {
  mkdirSync(dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    const bytes = Buffer.from(raw);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
    // Keep the original inode open until release so unlink/recreate cannot reuse it.
    const { dev, ino } = fstatSync(fd);
    return { dev, ino, fd };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function acquireRuntimeLock(options: AcquireRuntimeLockOptions = {}): RuntimeLockHandle {
  const disabled = options.disabled ?? isRuntimeLockDisabled();
  const lockPath = resolve(options.lockPath ?? getDefaultRuntimeLockPath());
  const inspector = options.inspector ?? createDefaultRuntimeProcessInspector();
  const strictOwnership = options.strictOwnership === true;
  if (strictOwnership && disabled) throw new Error('Strict runtime ownership requires an enabled lock');
  const record = createRuntimeLockRecord(inspector, strictOwnership && !disabled);
  if (options.maintenance) record.kind = 'maintenance';
  Object.freeze(record);
  const raw = `${JSON.stringify(record, null, 2)}\n`;
  if (strictOwnership && (!record.bootId || !record.processStart || !record.nonce)) {
    throw new Error('Strict runtime ownership requires boot and process-start identity');
  }

  if (disabled) {
    return Object.freeze({
      path: lockPath, record, enabled: false, strictOwnership: false,
      assertCurrentOwner() { throw new Error('Runtime ownership is disabled'); },
      markSafeReleaseOnExit() {},
      release() {},
    });
  }

  try {
    const identity = writeNewLockFile(lockPath, raw);
    let released = false;
    let safeToReleaseOnExit = false;
    const releaseOnExit = (): void => { if (safeToReleaseOnExit) release(); };
    const matches = (): boolean => {
      const fd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino
          || readFileSync(fd, 'utf8') !== raw) return false;
        const pathStat = lstatSync(lockPath);
        return pathStat.isFile() && pathStat.dev === stat.dev && pathStat.ino === stat.ino;
      } finally { closeSync(fd); }
    };
    const assertCurrentOwner = (): void => {
      if (!strictOwnership) throw new Error('Durable ownership requires strict runtime lock acquisition');
      try {
        if (released || inspector.pid !== record.pid || inspector.bootId?.() !== record.bootId
          || inspector.processStart?.(record.pid) !== record.processStart || !matches()) {
          throw new Error('Runtime ownership lost');
        }
      } catch (cause) {
        throw new Error('Runtime ownership lost or cannot be verified', { cause });
      }
    };
    const release = (): void => {
      if (released) return;
      released = true;
      process.removeListener('exit', releaseOnExit);
      try {
        // The lock directory is trusted; Node has no atomic unlink-if-inode API.
        // Operators must never replace locks concurrently with a running owner.
        if (matches()) rmSync(lockPath);
      } catch (error) {
        debugSuppressedError(log, 'Failed to release runtime lock; leaving unverified path untouched.', error, { lockPath });
      } finally {
        closeSync(identity.fd);
      }
    };
    // Normal exit and the shutdown backstop are not proof of quiescence.
    // This applies to legacy handles too: production must remain portable.
    process.once("exit", releaseOnExit);
    const markSafeReleaseOnExit = (): void => { safeToReleaseOnExit = true; };
    return Object.freeze({ path: lockPath, record, enabled: true, strictOwnership, assertCurrentOwner, markSafeReleaseOnExit, release });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    // O_EXCL publishes the path before its record is written. Never read or
    // remove an existing path, even if apparently stale: it may belong to a
    // publishing owner or have been replaced since any stale observation.
    throw new Error(`Piclaw refuses existing lock ${lockPath}; another runtime may be already running. Offline operator cleanup required: stop all workspace runtimes and maintenance processes, verify no owner remains, then remove the lock manually.`, { cause: error });
  }
}
