import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

/** Only for the exclusively created, inactive rehearsal file. No host policy,
 * checkpoint workers, logging, profile configuration or application database. */
export class RehearsalSqliteDatabase implements SqliteDatabase {
  private readonly db: Database;
  private readonly callback = new AsyncLocalStorage<boolean>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private failure?: Error;

  constructor(path: string) {
    this.db = new Database(path, { create: false, strict: true });
    try {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=0");
      // Keep SQLite's built-in synchronous checkpointing: this offline, bounded
      // import must not start host workers or emit their diagnostics on stdout.
    } catch (error) { this.db.close(); throw error; }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the rehearsal transaction handle"));
    if (this.closing) return Promise.reject(new Error("Rehearsal database is closed"));
    const result = this.tail.then(() => {
      if (this.failure) throw this.failure;
      return operation();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  private executor(valid: () => void): SqliteExecutor {
    return {
      exec: async sql => { valid(); this.db.exec(sql); },
      run: async (sql, ...params) => { valid(); this.db.query(sql).run(...params); },
      runCounted: async (sql, ...params) => { valid(); return this.db.query(sql).run(...params).changes; },
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return (this.db.query(sql).get(...params) ?? undefined) as T | undefined;
      },
      all: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return this.db.query(sql).all(...params) as T[];
      },
    };
  }

  exec(sql: string) { return this.enqueue(() => this.executor(() => {}).exec(sql)); }
  run(sql: string, ...params: SqliteValue[]) { return this.enqueue(() => this.executor(() => {}).run(sql, ...params)); }
  runCounted(sql:string,...params:SqliteValue[]):Promise<number> {
    return this.enqueue(()=>this.executor(()=>{}).runCounted(sql,...params));
  }
  get<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(() => this.executor(() => {}).get<T>(sql, ...params));
  }
  all<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(() => this.executor(() => {}).all<T>(sql, ...params));
  }

  transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      let active = true;
      const tx = this.executor(() => { if (!active) throw new Error("Rehearsal transaction expired"); });
      try {
        const value = await this.callback.run(true, () => callback(tx));
        active = false;
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        active = false;
        try { this.db.exec("ROLLBACK"); }
        catch (rollbackError) {
          this.failure = new AggregateError([error, rollbackError], "Rehearsal rollback failed");
          throw this.failure;
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the rehearsal transaction handle"));
    return this.closing ??= this.tail.then(() => { this.db.close(); });
  }
}
