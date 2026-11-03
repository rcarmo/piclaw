import { isSqliteContention } from './sqlite-async-admission.js';
import { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";

declare const self: Worker & { close(): void };
let started = false, database: Database | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function closeSqlite(): void {
  clearInterval(timer);
  database?.close();
  database = undefined;
  // Positive acknowledgement follows SQLite teardown, not a termination request.
  self.postMessage({ type: "closed" });
  self.close();
}
self.addEventListener("message", event => {
  if (event.data?.type === "close") {
    try { closeSqlite(); }
    catch (error) { self.postMessage({ type: "close-error", error: String(error) }); }
    return;
  }
  if (started) return;
  started = true;
  const { path, dev, ino } = event.data;
  const assertFile = () => {
    const current = statSync(path);
    if (realpathSync(path) !== path || current.nlink !== 1 || current.dev !== dev || current.ino !== ino)
      throw Error("Checkpoint database identity changed");
  };
  try {
    assertFile();
    const db = database = new Database(path, { create: false, strict: true });
    assertFile();
    if ((db.query("PRAGMA journal_mode").get() as any).journal_mode !== "wal") throw Error("Checkpoint requires WAL");
    db.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; PRAGMA mmap_size=0;");
    self.postMessage({ type: "ready" });
    timer = setInterval(() => {
      try {
        assertFile();
        const walBytes = statSync(path + "-wal").size;
        // PASSIVE never waits for readers/writers or truncates retained allocation.
        const result = db.query("PRAGMA wal_checkpoint(PASSIVE)").get();
        self.postMessage({ type: "checkpoint", result, walBytes });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ENOENT") {
          try { assertFile(); } // An absent WAL means no work; a missing main is fatal.
          catch (failure) {
            try { closeSqlite(); } catch (cleanup) { self.postMessage({ type: "close-error", error: String(cleanup) }); }
            throw failure;
          }
          return;
        }
        if (isSqliteContention(error)) {
          self.postMessage({ type: "checkpoint", result: { busy: 1, log: -1, checkpointed: -1 }, error: code });
          return;
        }
        try { closeSqlite(); }
        catch (cleanup) { self.postMessage({ type: "close-error", error: String(cleanup) }); }
        throw error;
      }
    }, 1000);
  } catch (error) {
    try { closeSqlite(); }
    catch (cleanup) { self.postMessage({ type: "close-error", error: String(cleanup) }); }
    throw error;
  }
});
