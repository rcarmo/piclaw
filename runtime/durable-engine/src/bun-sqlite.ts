import { isSqliteContention, waitForSqliteContention } from '../../src/db/sqlite-async-admission.js';
import { performance } from 'node:perf_hooks';
import { prepareSqliteRead } from '../../src/db/sqlite-read.js';
import { assertSqliteMutation, execSqliteMutation } from '../../src/db/sqlite-write.js';
import { registerSqliteCheckpoint } from "../../src/db/sqlite-checkpoint.js";
import { openSqliteRole } from "../../src/db/sqlite-role-policy.js";
import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

type SqliteWriteScope = { admission?: () => void; source?: { check(): void; persist(tx: SqliteExecutor): Promise<void> } };

/** Inactive host bridge. The host must acquire ownership BEFORE construction. */
export class BunSqliteDatabase implements SqliteDatabase {
  private readonly db: Database;
  private stopCheckpoint?: () => void;
  private readonly callback = new AsyncLocalStorage<boolean>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private failure?: Error;

  private idleGuard?: () => void;
  private readonly writeScope = new AsyncLocalStorage<SqliteWriteScope>();

  /** Recheck asynchronous host admission at the actual SQL write boundaries. */
  async withAdmissionGuard<T>(check: () => void, body: () => Promise<T>): Promise<T> {
    check();
    return this.writeScope.run({ ...this.writeScope.getStore(), admission: check }, body);
  }
  private allocatingSource = false;

  /** Compose public SDK writes and host correlation in the same physical transaction. */
  async withHostSourceGuard<T>(check: () => void, persist: (tx: SqliteExecutor) => Promise<void>, body: () => Promise<T>): Promise<T> {
    if (!this.guard || this.allocatingSource || this.idleGuard) throw Error("Host source guard unavailable");
    this.allocatingSource = true;
    try { check(); return await this.writeScope.run({ ...this.writeScope.getStore(), source: { check, persist } }, body); } finally { this.allocatingSource = false; }
  }
  private readonly identity?: ReturnType<typeof statSync>;
  constructor(private readonly path: string, private readonly guard?: { root: Database; assertOwner(): void; fenceTransactions?: boolean }) {
    guard?.assertOwner();
    this.identity = guard ? statSync(path) : undefined;
    let expectedPath: string | undefined;
    if (guard) {
      const root = (guard.root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main");
      const identity = root?.file ? statSync(root.file) : undefined;
      expectedPath = root?.file;
      if (!identity || identity.dev !== this.identity!.dev || identity.ino !== this.identity!.ino)
        throw new Error("Shared database identity required");
    }
    this.db = openSqliteRole(path, { role: "sdk", create: !guard, expectedPath,
      expectedIdentity: this.identity ? `${this.identity.dev}:${this.identity.ino}` : undefined,
      assertOwner: () => guard?.assertOwner() });
    try { this.stopCheckpoint = registerSqliteCheckpoint(this.db, path); }
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

  /** SDK compaction is conversation-scoped and can coexist with accepted work.
   * Preserve file/owner fencing at every SQL boundary, without a global idle gate. */
  async withCompactionGuard<T>(body: () => Promise<T>): Promise<T> {
    if (!this.guard || !this.identity) throw new Error("Shared SQLite guard required");
    const check = () => {
      this.guard!.assertOwner();
      if (this.guard!.root.inTransaction) throw new Error("Root connection transaction active");
      const identity = statSync(this.path);
      if (identity.dev !== this.identity!.dev || identity.ino !== this.identity!.ino) throw new Error("Shared database identity changed");
    };
    return this.withAdmissionGuard(check, body);
  }

  /** Scope the next public storage transactions; checks run inside the candidate write lock. */
  async withIdleModelGuard<T>(body: () => Promise<T>): Promise<T> {
    return this.withIdleGuard(body);
  }

  async withSessionResetGuard<T>(chatJid: string, body: () => Promise<T>): Promise<T> {
    if (!chatJid.trim()) throw new Error("Reset chat required");
    return this.withIdleGuard(body, chatJid);
  }

  private async withIdleGuard<T>(body: () => Promise<T>, chatJid?: string): Promise<T> {
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
      const scope = chatJid ?? null;
      const busy = guard.root.query(`SELECT 1 FROM service_effect_s01_chats WHERE active_operation_id IS NOT NULL AND (? IS NULL OR chat_jid = ?)
        UNION ALL SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed') AND (? IS NULL OR chat_jid = ?)
        UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal' AND (? IS NULL OR chat_jid = ?)
        UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') AND (? IS NULL OR chat_jid = ?) LIMIT 1`)
        .get(scope, scope, scope, scope, scope, scope, scope, scope);
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
      exec: async sql => { valid(); execSqliteMutation(this.db, sql); },
      run: async (sql, ...params) => { valid(); assertSqliteMutation(sql); this.db.query(sql).run(...params); },
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return (prepareSqliteRead(this.db, sql).get(...params) ?? undefined) as T | undefined;
      },
      all: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return prepareSqliteRead(this.db, sql).all(...params) as T[];
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

  /** Await only transaction-local executor SQL in callback/source.persist.
   * Facade reentry is rejected; arbitrary external awaits cannot be detected and
   * would retain the writer. Perform external work before this scope. */
  transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    const idle = this.idleGuard, { source, admission } = this.writeScope.getStore() ?? {};
    return this.enqueue(async () => {
      // Yield while another host connection owns the writer lock, allowing an
      // in-process asynchronous transaction to finish without a blocking wait.
      const deadline = performance.now() + 10_000;
      for (;;) {
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
        // Captured authority can expire while acquisition yields. Check it
        // before another attempt; no entered callback or persistence is replayed.
        admission?.(); idle?.(); source?.check();
        // Match the public Node adapter: reserve the writer before invoking SDK
        // code, including unguarded stores. A deferred read-to-write upgrade can
        // lose to a checkpoint and cannot safely replay its callback.
        try { this.db.exec("BEGIN IMMEDIATE"); break; }
        catch (error) {
          if (!isSqliteContention(error) || performance.now() >= deadline) throw error;
          await waitForSqliteContention(deadline);
          if (performance.now() >= deadline) throw error;
        }
      }
      let phase: "callback" | "persist" | "closed" = "callback";
      const executorFor = (expected: "callback" | "persist") => this.executor(() => {
        if (phase !== expected) throw new Error("SQLite transaction handle expired");
        if (!this.db.inTransaction) throw new Error('SQLite transaction ended before completion');
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
      });
      try {
        admission?.(); idle?.(); source?.check();
        // Both async phases are transaction-local; neither may enqueue facade
        // work behind itself. The SDK handle expires before host persistence.
        const value = await this.callback.run(true, async () => {
          try {
            const result = await callback(executorFor("callback"));
            if (!this.db.inTransaction) throw new Error('SQLite transaction ended before completion');
            phase = "persist";
            await source?.persist(executorFor("persist"));
            return result;
          } finally { phase = "closed"; }
        });
        source?.check();
        admission?.(); idle?.();
        if (this.guard?.fenceTransactions) this.guard.assertOwner();
        this.db.exec("COMMIT");
        // No fallible observation after durability. The next queued operation
        // still fences ownership before accessing SQL; never replay this body.
        return value;
      } catch (error) {
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
    return this.closing ??= this.tail.then(() => { this.stopCheckpoint?.(); this.stopCheckpoint = undefined; this.db.close(); });
  }
}
