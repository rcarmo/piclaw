import type { Database } from "bun:sqlite";
import { isSqliteContention } from "../../../runtime/src/db/sqlite-async-admission.js";
import { enableSqliteWal } from "../../../runtime/src/db/sqlite-journal.js";
import { BunSqliteDatabase } from "../../../runtime/durable-engine/src/bun-sqlite.js";

// Qualification policy only: copied host and standalone candidate fixtures remain
// separate databases, unlike the already-qualified shared application root.
export function configureHostWalFixtureDatabase(db: Database): void {
  const before = db.query("PRAGMA synchronous").get() as { synchronous: number };
  if (before.synchronous !== 2) throw new Error("Host fixture requires existing synchronous=FULL (2)");
  enableSqliteWal(db); // Verifies returned WAL mode and preserves the owner's busy_timeout.
  db.exec("PRAGMA synchronous=FULL");
  const after = db.query("PRAGMA synchronous").get() as { synchronous: number };
  if (after.synchronous !== 2) throw new Error("Host fixture did not retain synchronous=FULL (2)");
}

export async function openWalFixtureDatabase(path: string): Promise<BunSqliteDatabase> {
  // A copied WAL fixture can still be releasing a checkpoint-worker lock.
  // Retry connection setup only, before any SDK callback or effect can run.
  const deadline = performance.now() + 5000;
  let db: BunSqliteDatabase;
  for (;;) {
    try { db = new BunSqliteDatabase(path); break; }
    catch (error) {
      if (!isSqliteContention(error) || performance.now() >= deadline) throw error;
      await Bun.sleep(10);
    }
  }
  try {
    const before = await db.get<{ synchronous: number }>("SELECT * FROM pragma_synchronous");
    if (before?.synchronous !== 2) throw new Error("Candidate fixture requires existing synchronous=FULL (2)");
    // The SDK connection role owns setup; this facade verifies but cannot
    // mutate connection policy through its public SQL executors.
    const journal = await db.get<{ journal_mode: string }>("SELECT * FROM pragma_journal_mode");
    const after = await db.get<{ synchronous: number }>("SELECT * FROM pragma_synchronous");
    if (journal?.journal_mode.toLowerCase() !== "wal" || after?.synchronous !== 2)
      throw new Error("Candidate fixture requires WAL and synchronous=FULL (2)");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
