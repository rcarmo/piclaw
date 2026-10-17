import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../../runtime/durable-engine/src/index.js";

type Row = { boot: string; pid: number; start: string; nonce: string; generation: number; active: number };
const table = "qualification_process_owner";
const boot = () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
function processStart(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm may contain spaces and parentheses. Field 22 is offset 19 after comm.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error; // inaccessible /proc is NOT evidence of death
  }
}
function same(a: Row | null | undefined, b: Row) {
  return !!a && a.active === 1 && a.boot === b.boot && a.pid === b.pid && a.start === b.start
    && a.nonce === b.nonce && a.generation === b.generation;
}

/** Linux, one disposable file / one chat only. No deadline and no living-writer steal. */
export class TestOwner {
  private constructor(readonly path: string, private readonly db: Database, readonly token: Readonly<Row>) {}
  static acquire(path: string) {
    if (process.platform !== "linux") throw new Error("Linux qualification only");
    const db = new Database(path, { create: true, strict: true });
    try {
      db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; BEGIN IMMEDIATE");
      db.exec(`CREATE TABLE IF NOT EXISTS ${table} (singleton INTEGER PRIMARY KEY CHECK(singleton=1), boot TEXT, pid INTEGER, start TEXT, nonce TEXT, generation INTEGER, active INTEGER)`);
      const old = db.query(`SELECT * FROM ${table} WHERE singleton=1`).get() as Row | null;
      const currentBoot = boot();
      if (old?.active && old.boot === currentBoot && processStart(old.pid) === old.start) {
        throw new Error("owner busy: live process (including paused writer)");
      }
      const token: Row = { boot: currentBoot, pid: process.pid, start: processStart(process.pid)!,
        nonce: crypto.randomUUID(), generation: (old?.generation ?? 0) + 1, active: 1 };
      db.query(`INSERT OR REPLACE INTO ${table} VALUES (1,?,?,?,?,?,1)`)
        .run(token.boot, token.pid, token.start, token.nonce, token.generation);
      db.exec("COMMIT");
      return new TestOwner(path, db, Object.freeze(token));
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      db.close();
      if (error instanceof Error && "code" in error && error.code === "SQLITE_BUSY") {
        throw new Error("owner busy: admission lock contention");
      }
      throw error;
    }
  }
  get acquired() { return same(this.db.query(`SELECT * FROM ${table} WHERE singleton=1`).get() as Row | null, this.token); }
  assert() { if (!this.acquired) throw new Error("owner lost"); }
  async check(tx: SqliteExecutor) {
    if (!same(await tx.get<Row>(`SELECT * FROM ${table} WHERE singleton=1`), this.token)) throw new Error("owner lost");
  }
  /** Caller MUST close/drain Harness + storage before releasing. Not a takeover API. */
  releaseAfterClose() {
    this.db.query(`UPDATE ${table} SET active=0 WHERE singleton=1 AND nonce=? AND generation=?`)
      .run(this.token.nonce, this.token.generation);
  }
  closeConnection() { this.db.close(); }
}

/** Existing facade queue; checks use the SAME SQLite transaction as candidate writes. */
export class OwnedSqlite implements SqliteDatabase {
  private readonly base: BunSqliteDatabase;
  private readonly ready: Promise<void>;
  constructor(private readonly owner: TestOwner, options: { foreignKeys?: boolean } = {}) {
    owner.assert(); // before constructing candidate storage connection
    this.base = new BunSqliteDatabase(owner.path);
    // PRAGMA must run outside a transaction, before SDK schema initialization.
    this.ready = options.foreignKeys ? this.base.exec("PRAGMA foreign_keys=ON") : Promise.resolve();
  }
  async transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    await this.ready;
    return this.base.transaction(async tx => {
      await this.owner.check(tx);
      const result = await callback(tx);
      await this.owner.check(tx); // includes rollback if callback itself changed the token
      return result;
    });
  }
  exec(sql: string) { return this.transaction(tx => tx.exec(sql)); }
  run(sql: string, ...params: SqliteValue[]) { return this.transaction(tx => tx.run(sql, ...params)); }
  get<T extends object>(sql: string, ...params: SqliteValue[]) { return this.transaction(tx => tx.get<T>(sql, ...params)); }
  all<T extends object>(sql: string, ...params: SqliteValue[]) { return this.transaction(tx => tx.all<T>(sql, ...params)); }
  close() { return this.base.close(); }
}
