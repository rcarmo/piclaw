import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

/** Inactive host bridge. The host must acquire ownership BEFORE construction. */
export class BunSqliteDatabase implements SqliteDatabase {
  private readonly db: Database;
  private readonly callback = new AsyncLocalStorage<boolean>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private failure?: Error;

  private idleGuard?: () => void;
  private readonly sourceScope = new AsyncLocalStorage<{ check(): void; persist(tx: SqliteExecutor): Promise<void> }>();
  private allocatingSource = false;

  /** Compose public SDK writes and host correlation in the same physical transaction. */
  async withHostSourceGuard<T>(check: () => void, persist: (tx: SqliteExecutor) => Promise<void>, body: () => Promise<T>): Promise<T> {
    if (!this.guard || this.allocatingSource || this.idleGuard) throw Error("Host source guard unavailable");
    this.allocatingSource = true;
    try { check(); return await this.sourceScope.run({ check, persist }, body); } finally { this.allocatingSource = false; }
  }
  private readonly identity?: ReturnType<typeof statSync>;
  constructor(private readonly path: string, private readonly guard?: { root: Database; assertOwner(): void; fenceTransactions?: boolean }) {
    guard?.assertOwner();
    this.identity = guard ? statSync(path) : undefined;
    if (guard) {
      const root = (guard.root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main");
      const identity = root?.file ? statSync(root.file) : undefined;
      if (!identity || identity.dev !== this.identity!.dev || identity.ino !== this.identity!.ino)
        throw new Error("Shared database identity required");
    }
    this.db = new Database(path, { create: !guard, strict: true });
    try { this.db.exec("PRAGMA foreign_keys=ON"); }
    catch (error) {
      try { this.db.close(); }
      catch (cleanupError) { throw new RuntimeStartupCleanupError([error, cleanupError], "SQLite construction cleanup uncertain"); }
      throw error;
    }
  }

  /** Trusted importer connection must borrow the exact application root. */
  assertApplicationRoot(root: Database): void {
    this.guard?.assertOwner();
    if (!this.guard || this.guard.root !== root || this.closing) throw new Error("Shared application root required");
    const current = statSync(this.path);
    if (current.dev !== this.identity!.dev || current.ino !== this.identity!.ino) throw new Error("Shared database identity changed");
  }

  /** Scope the next public storage transactions; checks run inside the candidate write lock. */
  async withIdleModelGuard<T>(body: () => Promise<T>): Promise<T> {
    if (!this.guard) return Promise.reject(new Error("Idle model guard unavailable"));
    const guard = this.guard;
    const check = () => {
      // A root read transaction can retain an idle WAL snapshot even while this
      // candidate holds BEGIN IMMEDIATE against newly committed host work.
      if (guard.root.inTransaction) throw new Error("Root connection transaction active");
      guard.assertOwner();
      const rootPath = (guard.root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")?.file;
      if (!rootPath) throw new Error("Shared file required");
      for (const path of [rootPath, this.path]) {
        const current = statSync(path);
        if (current.dev !== this.identity!.dev || current.ino !== this.identity!.ino) throw new Error("Shared database identity changed");
      }
      const busy = guard.root.query(`SELECT 1 FROM service_effect_s01_chats WHERE active_operation_id IS NOT NULL
        UNION ALL SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed')
        UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal'
        UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') LIMIT 1`).get();
      if (guard.root.inTransaction) throw new Error("Root connection transaction active");
      if (busy) throw new Error("Host work is not idle");
    };
    if (this.idleGuard || this.allocatingSource) throw new Error("Idle model guard already active");
    this.idleGuard = check;
    try { check(); return await body(); } finally { this.idleGuard = undefined; }
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the transaction handle inside its callback"));
    if (this.closing) return Promise.reject(new Error("SQLite database is closed"));
    const result = this.tail.then(() => {
      if (this.failure) throw this.failure;
      if (this.guard?.fenceTransactions) this.guard.assertOwner();
      return operation();
    });
    this.tail = result.catch(() => {}); // A rejected operation must not strand later admissions.
    return result;
  }

  private executor(valid: () => void): SqliteExecutor {
    return {
      exec: async sql => { valid(); this.db.exec(sql); },
      run: async (sql, ...params) => { valid(); this.db.query(sql).run(...params); },
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return (this.db.query(sql).get(...params) ?? undefined) as T | undefined;
      },
      all: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return this.db.query(sql).all(...params) as T[];
      },
    };
  }

  exec(sql: string): Promise<void> {
    return this.guard ? this.transaction(tx => tx.exec(sql)) : this.enqueue(() => this.executor(() => {}).exec(sql));
  }
  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.guard ? this.transaction(tx => tx.run(sql, ...params)) : this.enqueue(() => this.executor(() => {}).run(sql, ...params));
  }
  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.enqueue(() => this.executor(() => {}).get<T>(sql, ...params));
  }
  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.enqueue(() => this.executor(() => {}).all<T>(sql, ...params));
  }

  transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    const idle = this.idleGuard, source = this.sourceScope.getStore();
    return this.enqueue(async () => {
      this.db.exec(this.guard ? "BEGIN IMMEDIATE" : "BEGIN");
      let active = true, committed = false;
      const tx = this.executor(() => {
        if (!active) throw new Error("SQLite transaction handle expired");
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
      });
      try {
        idle?.(); source?.check();
        const value = await this.callback.run(true, () => callback(tx));
        await source?.persist(tx);
        source?.check();
        active = false;
        idle?.();
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
        this.db.exec("COMMIT");
        committed = true;
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
        return value;
      } catch (error) {
        active = false;
        if (committed) throw error;
        // Explicit SQL, never Bun's synchronous transaction(callback) helper.
        try { this.db.exec("ROLLBACK"); }
        catch (rollbackError) {
          this.failure = new AggregateError([error, rollbackError], "SQLite rollback failed; database unusable until close");
          throw this.failure;
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the transaction handle inside its callback"));
    // Seal now, close only after all admitted operations settle, including failures.
    return this.closing ??= this.tail.then(() => { this.db.close(); });
  }
}
