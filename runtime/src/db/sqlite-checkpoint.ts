import type { Database } from "bun:sqlite";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
const log = createLogger("db.checkpoint");

/** SQLite's default WAL checkpoint runs inside COMMIT on the HTTP thread. On
 * ZFS, move only checkpoint IO to a worker; retain FULL commit durability. */
export function isZfsFilesystem(path: string): boolean {
  try {
    const target = realpathSync(path);
    let best = "", zfs = false;
    for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
      const [mount, fs] = line.split(" - ");
      if (!mount || !fs) continue;
      const point = mount.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
      if (point && (target === point || target.startsWith(point.endsWith("/") ? point : point + "/")) && point.length >= best.length) {
        best = point; zfs = fs.split(" ")[0] === "zfs";
      }
    }
    return zfs;
  } catch { return false; }
}
interface HandlePolicy { refs: number; original: number; }
interface CheckpointGroup {
  worker?: Worker;
  shutdown: ReturnType<typeof Promise.withResolvers<void>>;
  closing: boolean;
  closed: boolean;
  file: string;
  handles: Map<Database, HandlePolicy>;
  ready: boolean;
  failed: boolean;
  startupTimer?: ReturnType<typeof setTimeout>;
  observation?: { state: string; checkpointed: number; log: number; at: number; connections: number };
}
// Identity keys prevent duplicate workers; canonical paths also enforce one WAL name.
const groups = new Map<string, CheckpointGroup>();
const pragma = (db: Database, name: string) =>
  (db.query(`PRAGMA ${name}`).get() as Record<string, any>)[name];

function mainFile(database: Database, path: string) {
  const opened = (database.query("PRAGMA database_list").all() as { name: string; file: string }[])
    .find(row => row.name === "main")?.file;
  if (!opened || !path || path.startsWith("file:")) throw Error("Unsupported checkpoint database path");
  const file = realpathSync(path), actual = realpathSync(opened);
  const requested = statSync(file), current = statSync(actual);
  // Hardlinks can have independent -wal/-shm files. Never join those writers.
  if (!requested.isFile() || requested.nlink !== 1 || file !== actual ||
      requested.dev !== current.dev || requested.ino !== current.ino) {
    throw Error("Checkpoint path does not identify the opened main database with one WAL name");
  }
  return { file, dev: requested.dev, ino: requested.ino, key: `${requested.dev}:${requested.ino}` };
}
function validate(database: Database, file: string, key: string) {
  if (mainFile(database, file).key !== key || pragma(database, "journal_mode") !== "wal" ||
      pragma(database, "synchronous") !== 2) throw Error("Checkpoint writer requires the same WAL database and FULL durability");
}
function restore(database: Database, original: number) {
  try { database.exec(`PRAGMA wal_autocheckpoint=${original}`); }
  catch (error) {
    debugSuppressedError(log, "Could not restore automatic checkpoints on an unavailable SQLite handle.", error,
      { operation: "sqlite_checkpoint.restore_unavailable_handle" });
  }
}
function requestClose(group: CheckpointGroup): void {
  clearTimeout(group.startupTimer);
  if (group.closing || group.closed) return;
  group.closing = true;
  if (!group.worker) { group.closed = true; group.shutdown.resolve(); return; }
  try { group.worker.postMessage({ type: "close" }); }
  catch (error) { group.shutdown.reject(error); }
}
function fail(group: CheckpointGroup, error?: unknown) {
  if (group.failed) return;
  group.failed = true;
  group.ready = false;
  for (const [handle, policy] of group.handles) restore(handle, policy.original > 0 ? policy.original : 1000);
  requestClose(group);
  log.warn("SQLite checkpoint worker failed; restored safe built-in checkpoint policies", {
    operation: "sqlite_checkpoint.fallback", path: group.file, activeConnectionCount: group.handles.size, err: error,
  });
}
function observe(group: CheckpointGroup, data: any) {
  const result = data.result;
  if (!result || !Number.isFinite(result.log) || !Number.isFinite(result.checkpointed)) return;
  const known = result.log >= 0 && result.checkpointed >= 0;
  const pendingFrames = known ? Math.max(0, result.log - result.checkpointed) : null;
  const previous = group.observation;
  const state = result.busy || data.error ? "busy" : !known ? "unavailable" : !pendingFrames ? "complete" :
    previous && result.log >= previous.log && result.checkpointed === previous.checkpointed ? "stalled" : "progress";
  const now = Date.now();
  // Frame counters describe work, NOT the retained physical WAL allocation.
  if (!previous || state !== previous.state || group.handles.size !== previous.connections || now - previous.at >= 30_000) {
    log.info("SQLite PASSIVE checkpoint observation", {
      operation: "sqlite_checkpoint.progress", path: group.file, state,
      busy: result.busy, logFrames: result.log, checkpointedFrames: result.checkpointed,
      pendingFrames, walBytes: data.walBytes, activeConnectionCount: group.handles.size, err: data.error,
    });
    group.observation = { state, log: result.log, checkpointed: result.checkpointed, at: now, connections: group.handles.size };
  } else {
    group.observation = { ...previous, log: result.log, checkpointed: result.checkpointed };
  }
}

export function registerSqliteCheckpoint(database: Database, path: string, enabled = isZfsFilesystem(path)): (() => void | Promise<void>) | undefined {
  if (!enabled || path === ":memory:") return;
  let identity: ReturnType<typeof mainFile>, original: number;
  try {
    if (pragma(database, "journal_mode") !== "wal") return;
    identity = mainFile(database, path);
    validate(database, identity.file, identity.key);
    original = pragma(database, "wal_autocheckpoint");
  } catch (error) {
    log.warn("SQLite checkpoint registration rejected; built-in policy unchanged", { operation: "sqlite_checkpoint.rejected", path, err: error });
    return;
  }
  const { file, key, dev, ino } = identity;
  let group = groups.get(key);
  if (group && group.file !== file) return;
  if (group?.closing && !group.closed) throw Error("Checkpoint SQLite connection is closing");
  const fresh = !group;
  if (!group) {
    const shutdown = Promise.withResolvers<void>();
    // Observe ignored release callers without converting a failed close into success.
    void shutdown.promise.catch(error => debugSuppressedError(log, "Checkpoint SQLite cleanup remains uncertain", error));
    group = { file, handles: new Map(), ready: false, failed: false, shutdown, closing: false, closed: false };
    groups.set(key, group);
  }
  const current = group;
  const policy = current.handles.get(database);
  if (policy) policy.refs++;
  else current.handles.set(database, { refs: 1, original });
  if (fresh) {
    try {
      const worker = new Worker(new URL("./sqlite-checkpoint-worker.ts", import.meta.url).href, { smol: true, ref: false });
      current.worker = worker;
      worker.addEventListener("message", event => {
        if (event.data?.type === "closed") {
          current.closed = true; current.ready = false; current.shutdown.resolve();
          if (!current.handles.size && groups.get(key) === current) groups.delete(key);
          return;
        }
        if (event.data?.type === "close-error") { current.shutdown.reject(Error(event.data.error)); return; }
        if (groups.get(key) !== current || current.failed || current.closing || current.closed) return;
        if (event.data?.type === "checkpoint") { if (current.ready) observe(current, event.data); return; }
        if (event.data?.type !== "ready" || current.ready) return;
        try {
          for (const handle of current.handles.keys()) {
            validate(handle, file, key);
            handle.exec("PRAGMA wal_autocheckpoint=0");
          }
          clearTimeout(current.startupTimer);
          current.ready = true;
          log.info("ZFS WAL checkpoint worker ready; FULL commit durability retained", {
            operation: "sqlite_checkpoint.ready", path: file, connections: current.handles.size,
            activeConnectionCount: current.handles.size,
          });
        } catch (error) { fail(current, error); }
      });
      worker.addEventListener("error", event => {
        event.preventDefault();
        if (groups.get(key) === current) fail(current, event.message);
      });
      worker.addEventListener("close", () => {
        if (!current.closed) current.shutdown.reject(Error("Checkpoint worker closed without confirmed SQLite cleanup"));
        if (groups.get(key) === current && !current.closing) fail(current, "Worker closed");
      });
      current.startupTimer = setTimeout(() => fail(current, "Worker readiness timed out"), 5000);
      current.startupTimer.unref();
      worker.postMessage({ path: file, dev, ino });
    } catch (error) { fail(current, error); }
  } else if (current.ready && !current.failed) {
    try { validate(database, file, key); database.exec("PRAGMA wal_autocheckpoint=0"); }
    catch (error) { fail(current, error); }
  } else if (current.failed) {
    const previous = policy?.original ?? original;
    restore(database, previous > 0 ? previous : 1000);
  }
  let stopped = false, completion: Promise<void> | undefined;
  return () => {
    if (stopped) return completion;
    stopped = true;
    const policy = current.handles.get(database);
    if (policy && --policy.refs === 0) {
      current.handles.delete(database);
      restore(database, policy.original);
    }
    if (!current.handles.size && groups.get(key) === current) {
      requestClose(current);
      if (current.closed) groups.delete(key);
      else completion = current.shutdown.promise;
      return completion;
    }
  };
}
