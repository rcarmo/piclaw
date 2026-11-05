import { closeSync, constants, fstatSync, openSync, readSync, statSync, type BigIntStats } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_CACHED_FILES = 16;
type Snapshot = { bytes: Buffer; length: number; scratch: Buffer; value: unknown };
const snapshots = new Map<string, Snapshot>();

// Do not normalise '..': a symlink followed by '..' has filesystem semantics
// that differ from path.resolve(). Relative paths still need a cwd-specific key.
function cachePath(path: string): string {
  return isAbsolute(path) ? path : `${process.cwd()}/${path}`;
}

function version(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}:${stat.uid}:${stat.gid}:${stat.nlink}`;
}

// Copy mutable containers; primitive strings (including inline avatars) are safe
// to share. Object.fromEntries preserves own '__proto__' keys without setters.
function copyJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJson(child)]));
  }
  return value;
}

export function invalidateJsonFileCache(filePath: string): void {
  snapshots.delete(cachePath(filePath));
}

/** Reuse parsed JSON only after re-authorising and comparing file contents.
 * Metadata alone cannot detect same-size writes with colliding timestamps.
 * Errors never return an older snapshot. The caller owns error/default policy.
 */
export function readCachedJsonFile(filePath: string): unknown {
  const path = cachePath(filePath);
  let observedFile = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd: number;
      try {
        // O_NONBLOCK prevents replacement with a FIFO from hanging the server.
        fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
        observedFile = true;
      } catch (error) {
        if (observedFile && (error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Configuration disappeared while reading: ${path}`, { cause: error });
        }
        throw error;
      }
      const cached = snapshots.get(path);
      let bytes: Buffer;
      let length = 0;
      let initialVersion: string;
      let finalVersion: string;
      try {
        const initial = fstatSync(fd, { bigint: true });
        if (!initial.isFile()) throw new Error(`Configuration is not a regular file: ${path}`);
        initialVersion = version(initial);
        const capacity = Number(initial.size) + 1;
        bytes = cached && cached.scratch.length >= capacity ? cached.scratch : Buffer.allocUnsafe(capacity);
        while (length < capacity) {
          const count = readSync(fd, bytes, length, capacity - length, length);
          if (count === 0) break;
          length += count;
        }
        finalVersion = version(fstatSync(fd, { bigint: true }));
        if (length === capacity) continue; // File grew; reopen with the new size.
      } finally {
        closeSync(fd);
      }
      let pathVersion: string;
      try {
        pathVersion = version(statSync(path, { bigint: true }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (initialVersion !== finalVersion || finalVersion !== pathVersion) continue;
      if (cached && cached.length === length && cached.bytes.subarray(0, length).equals(bytes.subarray(0, length))) {
        snapshots.delete(path);
        snapshots.set(path, cached);
        return copyJson(cached.value);
      }
      snapshots.delete(path);
      const value: unknown = JSON.parse(bytes.toString("utf8", 0, length));
      const scratch = cached && cached.bytes.length >= bytes.length ? cached.bytes : Buffer.allocUnsafe(bytes.length);
      snapshots.set(path, { bytes, length, scratch, value });
      if (snapshots.size > MAX_CACHED_FILES) snapshots.delete(snapshots.keys().next().value!);
      return copyJson(value);
    }
    throw new Error(`Configuration changed while reading: ${path}`);
  } catch (error) {
    snapshots.delete(path);
    throw error;
  }
}
