import "./src/test-guard.js";
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { SqliteStorage, applySqliteMigrations, SQLITE_MIGRATIONS, type SqliteExecutor } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { registerStorageConformance } from "../../runtime/durable-engine/qualification/testing.ts";
import { AssistantEntry, Harness, defineTask, defineExtension, type TaskId } from "../../runtime/durable-engine/qualification/durable.ts";
import { readSchemaInventory } from "../../runtime/scripts/lib/schema-ownership.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context, openFixture } from "./src/fixture.js";

async function disk(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "sqlite-"));
  try { await run(join(directory, "qualification.sqlite")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const storageAt = (path: string) => SqliteStorage.open(new BunSqliteDatabase(path));
const fixtureAt = (path: string, owner = { acquired: true }) => openFixture(owner, () => {}, () => storageAt(path));

// Upstream supplies no timeout; bound disk-history cases above Bun's 5s default.
registerStorageConformance({ describe, expect, it: (name, run) => test(name, run, 15_000) }, "public SQLite storage conformance (Bun, disk)", use => disk(async path => {
  const storage = await storageAt(path);
  try { await use(storage); } finally { await storage.close(context); }
}));

describe("Bun asynchronous database facade", () => {
  for (const guarded of [false, true]) test(`${guarded ? "guarded" : "unguarded"} writer admission yields before the callback while another connection commits`, () => disk(async path => {
    const root = new Database(path);
    root.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample (n INTEGER)");
    const db = new BunSqliteDatabase(path, guarded ? { root, assertOwner() {}, fenceTransactions: true } : undefined);
    root.exec("BEGIN IMMEDIATE; INSERT INTO sample VALUES (1)");
    const release = setTimeout(() => root.exec("COMMIT"), 50);
    let callbacks = 0;
    try {
      await db.transaction(async tx => {
        callbacks++;
        expect(root.inTransaction).toBe(false);
        expect(await tx.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
        await tx.run("INSERT INTO sample VALUES (2)");
      });
      expect(callbacks).toBe(1);
      expect(await db.all("SELECT n FROM sample ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }]);
    } finally {
      clearTimeout(release);
      if (root.inTransaction) root.exec("ROLLBACK");
      await db.close(); root.close();
    }
  }));

  for (const guarded of [false, true]) test(`${guarded ? "guarded" : "unguarded"} SDK callback BUSY is terminal and leaves later transactions usable`, () => disk(async path => {
    const root = new Database(path);
    root.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample (n INTEGER)");
    const db = new BunSqliteDatabase(path, guarded ? { root, assertOwner() {}, fenceTransactions: true } : undefined);
    const busy = Object.assign(Error("callback busy"), { code: "SQLITE_BUSY" });
    let callbacks = 0;
    try {
      await expect(db.transaction(async tx => {
        callbacks++;
        await tx.run("INSERT INTO sample VALUES (1)");
        if (callbacks === 1) throw busy;
      })).rejects.toBe(busy);
      expect(callbacks).toBe(1);
      expect(await db.all("SELECT n FROM sample")).toEqual([]);
      await db.transaction(async tx => { await tx.run("INSERT INTO sample VALUES (2)"); });
      expect(await db.all("SELECT n FROM sample")).toEqual([{ n: 2 }]);
    } finally { await db.close(); root.close(); }
  }));

  test('a committed SDK transaction returns its result; a later owner denial cannot recast it as unapplied', () => disk(async path => {
    const root = new Database(path); root.exec('PRAGMA journal_mode=WAL; CREATE TABLE sample(n INTEGER)');
    const lost = Error('owner changed after durability');
    let checksAfterCommit = 0, callbacks = 0;
    const db = new BunSqliteDatabase(path, { root, fenceTransactions: true, assertOwner() {
      if (root.query('SELECT 1 FROM sample WHERE n=1').get()) { checksAfterCommit++; throw lost; }
    } });
    try {
      const committed = await db.transaction(async tx => { callbacks++; await tx.run('INSERT INTO sample VALUES (1)'); return 'original committed value'; });
      expect(committed).toBe('original committed value'); expect(callbacks).toBe(1);
      expect(root.query('SELECT n FROM sample').all()).toEqual([{ n: 1 }]);
      expect(checksAfterCommit).toBe(0);
      await expect(db.get('SELECT n FROM sample')).rejects.toBe(lost);
      expect(checksAfterCommit).toBe(1); expect(callbacks).toBe(1);
      expect(root.query('SELECT n FROM sample').all()).toEqual([{ n: 1 }]);
    } finally { await db.close(); root.close(); }
  }));

  test("async transaction isolates unrelated read/write/transaction and close drains", () => disk(async path => {
    const db = new BunSqliteDatabase(path);
    await db.exec("CREATE TABLE sample (n INTEGER)");
    const entered = barrier(), hold = barrier();
    let escaped!: SqliteExecutor;
    const events: string[] = [];
    const transaction = db.transaction(async tx => {
      escaped = tx;
      await tx.run("INSERT INTO sample VALUES (?)", 1);
      entered.release(); await hold.promise;
      await tx.run("INSERT INTO sample VALUES (?)", 2);
      events.push("transaction");
    });
    await entered.promise;
    const read = db.all<{ n: number }>("SELECT n FROM sample ORDER BY n").then(rows => { events.push("read"); return rows; });
    const write = db.run("INSERT INTO sample VALUES (?)", 3).then(() => { events.push("write"); });
    const other = db.transaction(async tx => { await tx.run("INSERT INTO sample VALUES (?)", 4); events.push("other"); });
    const closing = db.close();
    try {
      await expect(db.get("SELECT 1")).rejects.toThrow("closed");
      await expect(db.transaction(async () => {})).rejects.toThrow("closed");
      await Bun.sleep(5); expect(events).toEqual([]);
    } finally { hold.release(); }
    await transaction;
    expect(await read).toEqual([{ n: 1 }, { n: 2 }]);
    await write; await other; await closing;
    expect(events).toEqual(["transaction", "read", "write", "other"]);
    await expect(escaped.run("INSERT INTO sample VALUES (5)")).rejects.toThrow("expired");
    await db.close();
    const reopened = new BunSqliteDatabase(path);
    try { expect(await reopened.all("SELECT n FROM sample ORDER BY n")).toEqual([1, 2, 3, 4].map(n => ({ n }))); }
    finally { await reopened.close(); }
  }));

  test("callback rejection rolls back before queued reads; original error, expired handle, reopen", () => disk(async path => {
    const db = new BunSqliteDatabase(path);
    await db.exec("CREATE TABLE sample (n INTEGER); INSERT INTO sample VALUES (1)");
    const entered = barrier(), hold = barrier(), error = new Error("callback rejected");
    let escaped!: SqliteExecutor;
    const failed = db.transaction(async tx => {
      escaped = tx; await tx.run("INSERT INTO sample VALUES (2)");
      entered.release(); await hold.promise; throw error;
    });
    await entered.promise;
    const read = db.all("SELECT n FROM sample");
    hold.release();
    await expect(failed).rejects.toBe(error);
    expect(await read).toEqual([{ n: 1 }]);
    await expect(escaped.exec("SELECT 1")).rejects.toThrow("expired");
    await expect(db.exec("INVALID SQL")).rejects.toThrow();
    await db.run("INSERT INTO sample VALUES (3)"); // A failed queue item does not hang the queue.
    await db.close();
    const reopened = new BunSqliteDatabase(path);
    try { expect(await reopened.all("SELECT n FROM sample ORDER BY n")).toEqual([{ n: 1 }, { n: 3 }]); }
    finally { await reopened.close(); }
  }));

  test("commit failure rolls back before unlock", () => disk(async path => {
    const db = new BunSqliteDatabase(path);
    try {
      expect(await db.get('SELECT foreign_keys FROM pragma_foreign_keys')).toEqual({ foreign_keys: 1 });
      await db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
      await expect(db.transaction(async tx => { await tx.run("INSERT INTO child VALUES (99)"); })).rejects.toThrow();
      expect(await db.all("SELECT * FROM child")).toEqual([]);
      await db.transaction(async tx => { await tx.run("INSERT INTO parent VALUES (99)"); });
    } finally { await db.close(); }
  }));

  test("rollback failure is explicit, poisons queued operations, still drains close", () => disk(async path => {
    const db = new BunSqliteDatabase(path);
    await db.exec('CREATE TABLE sample(n INTEGER UNIQUE); INSERT INTO sample VALUES(1)');
    const entered = barrier(), hold = barrier(), original = new Error("not guaranteed rolled back");
    const failed = db.transaction(async tx => {
      // Seed outside this transaction: a missed lifetime guard would otherwise
      // autocommit these later writes after the implicit rollback.
      await expect(tx.run('INSERT OR ROLLBACK INTO sample VALUES(1)')).rejects.toThrow('UNIQUE');
      await expect(tx.run('INSERT INTO sample VALUES(2)')).rejects.toThrow('transaction ended');
      await expect(tx.exec('INSERT INTO sample VALUES(3)')).rejects.toThrow('transaction ended');
      await expect(tx.get('SELECT 1')).rejects.toThrow('transaction ended');
      await expect(tx.all('SELECT 1')).rejects.toThrow('transaction ended');
      entered.release(); await hold.promise; throw original;
    });
    await entered.promise;
    const queued = db.get("SELECT 1");
    const closing = db.close();
    hold.release();
    await expect(failed).rejects.toBeInstanceOf(AggregateError);
    await expect(queued).rejects.toThrow("rollback failed");
    await closing;
    const failure = await failed.catch(error => error);
    expect(failure.errors[0]).toBe(original);
    expect(failure.errors).toHaveLength(2);
    await expect(db.run("SELECT 1")).rejects.toThrow("closed");
    const observed = new Database(path);
    try { expect(observed.query('SELECT n FROM sample').all()).toEqual([{ n: 1 }]); }
    finally { observed.close(); }
  }));

  test("nested facade operations reject instead of deadlocking; tx handle remains usable", async () => {
    const db = new BunSqliteDatabase(":memory:");
    try {
      await db.transaction(async tx => {
        await expect(db.exec("SELECT 1")).rejects.toThrow("transaction handle");
        await expect(db.transaction(async () => {})).rejects.toThrow("transaction handle");
        await expect(db.close()).rejects.toThrow("transaction handle");
        expect(await tx.get("SELECT 1 AS n")).toEqual({ n: 1 });
      });
      expect(await db.get("SELECT 2 AS n")).toEqual({ n: 2 });
    } finally { await db.close(); }
  });
});

describe("host persistence transaction scope", () => {
  for (const rollback of [false, true]) test(`host persistence expires the SDK callback handle before ${rollback ? "rollback" : "commit"}`, () => disk(async path => {
    const root = new Database(path);
    root.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample (n INTEGER)");
    const db = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true });
    const entered = barrier(), hold = barrier(), rejected = new Error("host persistence rejected");
    let callback!: SqliteExecutor, persistence!: SqliteExecutor;
    const operation = db.withHostSourceGuard(() => {}, async tx => {
      persistence = tx;
      entered.release(); await hold.promise;
      expect(await tx.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
      await tx.run("INSERT INTO sample VALUES (2)");
      if (rollback) throw rejected;
    }, () => db.transaction(async tx => {
      callback = tx;
      await tx.run("INSERT INTO sample VALUES (1)");
      return "original result";
    }));
    // Observe rejection immediately; the test may still be checking a retained handle.
    const settled = operation.catch(error => error);
    const expired = async (tx: SqliteExecutor) => {
      await expect(tx.get("SELECT 1")).rejects.toThrow("expired");
      await expect(tx.all("SELECT 1")).rejects.toThrow("expired");
      await expect(tx.exec("INSERT INTO sample VALUES (99)")).rejects.toThrow("expired");
      await expect(tx.run("INSERT INTO sample VALUES (99)")).rejects.toThrow("expired");
    };
    try {
      await entered.promise;
      expect(root.query("SELECT n FROM sample").all()).toEqual([]);
      await expired(callback);
      hold.release();
      expect(await settled).toBe(rollback ? rejected : "original result");
      expect(await db.all("SELECT n FROM sample ORDER BY n")).toEqual(rollback ? [] : [{ n: 1 }, { n: 2 }]);
      await expired(callback); await expired(persistence);
      await db.transaction(async tx => { await tx.run("INSERT INTO sample VALUES (3)"); });
      expect(await db.all("SELECT n FROM sample ORDER BY n")).toEqual(rollback ? [{ n: 3 }] : [{ n: 1 }, { n: 2 }, { n: 3 }]);
    } finally { hold.release(); await settled; await db.close(); root.close(); }
  }));

  for (const operation of ["read", "close"] as const) test(`host persistence rejects outer ${operation} during an actual SDK commit without queueing it`, () => disk(async path => {
    const root = new Database(path);
    root.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample (n INTEGER)");
    const db = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true });
    const storage = await SqliteStorage.open(db);
    const before = root.query("SELECT next_seq FROM durable_metadata").get() as { next_seq: number };
    let observed: unknown = "pending", calls = 0, attempt = Promise.resolve<unknown>(undefined);
    try {
      const seq = await db.withHostSourceGuard(() => {}, async tx => {
        calls++;
        attempt = (operation === "read" ? db.get("SELECT 1") : db.close()).then(
          () => { observed = "resolved"; }, error => { observed = error; });
        // A reentrant facade call must reject before this transaction can finish,
        // not wait behind itself. One microtask observes Promise.reject without a timer.
        await Promise.resolve();
        expect(observed).toBeInstanceOf(Error);
        expect((observed as Error).message).toContain("transaction handle");
        await tx.run("INSERT INTO sample VALUES (1)");
      }, () => storage.commit([], context));
      await attempt;
      expect(typeof seq).toBe("number");
      expect(Number(seq)).toBe(before.next_seq);
      expect(root.query("SELECT next_seq FROM durable_metadata").get()).toEqual({ next_seq: before.next_seq + 1 });
      expect(await db.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
      expect(calls).toBe(1);
      await storage.commit([], context);
      expect(root.query("SELECT next_seq FROM durable_metadata").get()).toEqual({ next_seq: before.next_seq + 2 });
    } finally { await attempt; await storage.close(context); root.close(); }
  }));
});

describe('SDK SQLite mutation boundaries', () => {
  for (const mechanism of ['statement', 'schema', 'trigger'] as const) test(`implicit ${mechanism} rollback cannot escape into host persistence or autocommit writes`, () => disk(async path => {
    const root = new Database(path);
    root.exec(`PRAGMA journal_mode=WAL; CREATE TABLE sample(n INTEGER UNIQUE ${mechanism === 'schema' ? 'ON CONFLICT ROLLBACK' : ''}); INSERT INTO sample VALUES(1)`);
    if (mechanism === 'trigger') root.exec("CREATE TRIGGER rollback_probe BEFORE INSERT ON sample WHEN NEW.n=1 BEGIN SELECT RAISE(ROLLBACK, 'implicit rollback'); END");
    const db = new BunSqliteDatabase(path, { root, fenceTransactions: true, assertOwner() {} });
    let persistence = 0;
    try {
      await expect(db.withHostSourceGuard(() => {}, async tx => { persistence++; await tx.run('INSERT INTO sample VALUES(3)'); }, () => db.transaction(async tx => {
        await expect(tx.run(`INSERT ${mechanism === 'statement' ? 'OR ROLLBACK' : ''} INTO sample VALUES(1)`)).rejects.toThrow();
        await expect(tx.run('INSERT INTO sample VALUES(2)')).rejects.toThrow('transaction ended');
        return 'not committed';
      }))).rejects.toBeInstanceOf(AggregateError);
      expect(persistence).toBe(0); expect(root.query('SELECT n FROM sample').all()).toEqual([{ n: 1 }]);
      await expect(db.all('SELECT n FROM sample')).rejects.toThrow('rollback failed');
    } finally { await db.close(); root.close(); }
  }));

  for (const method of ['exec', 'run'] as const) for (const transaction of [false, true]) test(`${method} rejects connection and transaction control before preparation; transaction=${transaction}`, async () => {
    const db = new BunSqliteDatabase(':memory:');
    await db.exec('CREATE TABLE sample(n INTEGER)');
    const prepared = spyOn(Database.prototype, 'prepare'), queried = spyOn(Database.prototype, 'query');
    try {
      const check = async (tx: SqliteExecutor) => {
        for (const sql of ['BEGIN', 'COMMIT', 'END TRANSACTION', 'ROLLBACK', 'SAVEPOINT nested', 'RELEASE nested', 'ROLLBACK TO nested',
          'PRAGMA busy_timeout=1000', 'ATTACH DATABASE ":memory:" AS other', 'DETACH other', 'VACUUM',
          ' ; -- prefix\n /* control */ cOmMiT', '\ufeffROLLBACK', 'EXPLAIN PRAGMA query_only=ON', 'EXPLAIN QUERY PLAN COMMIT',
          '-- CR does not end SQLite comments\rSELECT 1\nCOMMIT']) {
          const p = prepared.mock.calls.length, q = queried.mock.calls.length;
          await expect(tx[method](sql)).rejects.toThrow('host-owned');
          expect(prepared.mock.calls.length).toBe(p); expect(queried.mock.calls.length).toBe(q);
        }
        await tx.run('INSERT INTO sample VALUES(?)', 1);
      };
      if (transaction) await db.transaction(check); else await check(db);
      expect(await db.all('SELECT n FROM sample')).toEqual([{ n: 1 }]);
      expect(await db.get('SELECT timeout FROM pragma_busy_timeout')).toEqual({ timeout: 0 });
      expect(await db.all('SELECT name FROM pragma_database_list')).toEqual([{ name: 'main' }]);
    } finally { prepared.mockRestore(); queried.mockRestore(); await db.close(); }
  });

  for (const control of ['COMMIT', 'ROLLBACK', 'SAVEPOINT hidden', 'PRAGMA busy_timeout=1000']) test(`multi-statement exec cannot hide ${control} after quoted semicolons`, async () => {
    const db = new BunSqliteDatabase(':memory:');
    try {
      await db.exec('CREATE TABLE sample(n INTEGER)');
      await expect(db.transaction(async tx => {
        await tx.run('INSERT INTO sample VALUES(1)');
        await tx.exec(`SELECT '; COMMIT is text', 'it''s; quoted'; /* prefix */ ${control}`);
      })).rejects.toThrow('host-owned');
      expect(await db.all('SELECT n FROM sample')).toEqual([]);
      await db.run('INSERT INTO sample VALUES(?)', 2);
      expect(await db.all('SELECT n FROM sample')).toEqual([{ n: 2 }]);
    } finally { await db.close(); }
  });

  test('SQLite delimits actual triggers and dependent DDL/DML without truncation or semicolon splitting', async () => {
    const db = new BunSqliteDatabase(':memory:');
    try {
      await db.exec(`-- schema\n CREATE TABLE sample(n INTEGER); CREATE TABLE audit(value TEXT);
        CREATE TRIGGER sample_insert AFTER INSERT ON sample BEGIN
          INSERT INTO audit VALUES('BEGIN; COMMIT; END');
          INSERT INTO audit VALUES('it''s; not ROLLBACK');
        END;
        INSERT INTO sample VALUES(7); INSERT INTO sample VALUES(8); -- trailing comment`);
      expect(await db.all('SELECT n FROM sample ORDER BY n')).toEqual([{ n: 7 }, { n: 8 }]);
      expect(await db.all('SELECT value FROM audit ORDER BY rowid')).toEqual([{ value: 'BEGIN; COMMIT; END' }, { value: "it's; not ROLLBACK" }, { value: 'BEGIN; COMMIT; END' }, { value: "it's; not ROLLBACK" }]);
      await db.exec(' ; ; /* empty tail */ -- comment');
      await expect(db.exec('EXPLAIN')).rejects.toThrow('Incomplete');
      await expect(db.exec('INSERT INTO sample VALUES(?)')).rejects.toThrow('parameter-free');
      expect(await db.all('SELECT n FROM sample ORDER BY n')).toEqual([{ n: 7 }, { n: 8 }]);
    } finally { await db.close(); }
  });
});

describe("SDK SQLite read executors", () => {
  for (const method of ["get", "all"] as const) for (const transaction of [false, true]) {
    test(`${method} rejects result-producing writes before stepping; transaction=${transaction}`, async () => {
      const db = new BunSqliteDatabase(":memory:");
      try {
        await db.exec("CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)");
        const check = async (tx: SqliteExecutor) => {
          for (const sql of ["INSERT INTO sample VALUES(2) RETURNING n", "UPDATE sample SET n=3 RETURNING n", "DELETE FROM sample RETURNING n",
            "WITH value(n) AS (SELECT 2) INSERT INTO sample SELECT n FROM value RETURNING n"])
            await expect(tx[method](sql)).rejects.toThrow("Read-only");
          expect(await tx.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
        };
        if (transaction) await db.transaction(check); else await check(db);
        expect(await db.all("SELECT n FROM sample")).toEqual([{ n: 1 }]);
      } finally { await db.close(); }
    });

    test(`${method} rejects PRAGMA grammar before prepare; transaction=${transaction}`, async () => {
      const db = new BunSqliteDatabase(":memory:");
      const prepared = spyOn(Database.prototype, "query");
      try {
        const check = async (tx: SqliteExecutor) => {
          for (const sql of [
            "PRAGMA busy_timeout=1000",
            " ; -- prefix\n /* policy */ pragma query_only=ON",
            "-- a carriage return does not end this comment\rSELECT 1\nPRAGMA busy_timeout=1000",
            "EXPLAIN PRAGMA busy_timeout=2000",
            "/* prefix */ EXPLAIN /* a */ QUERY /* b */ PLAN /* c */ PRAGMA busy_timeout=3000",
            "\ufeffPRAGMA query_only=ON",
          ]) await expect(tx[method](sql)).rejects.toThrow("Read-only");
          expect(prepared).not.toHaveBeenCalled();
        };
        if (transaction) await db.transaction(check); else await check(db);
      } finally { prepared.mockRestore(); await db.close(); }
    });

    if (transaction) test(`${method} cannot commit the owning transaction`, async () => {
      const db = new BunSqliteDatabase(":memory:");
      try {
        await db.exec("CREATE TABLE sample(n INTEGER)");
        await db.transaction(async tx => {
          await tx.run("INSERT INTO sample VALUES(1)");
          await expect(tx[method]("COMMIT")).rejects.toThrow("Read-only");
          await tx.run("INSERT INTO sample VALUES(2)");
        });
        expect(await db.all("SELECT n FROM sample ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }]);
      } finally { await db.close(); }
    });
  }

  test("read executors retain parameterised SELECT, CTE, EXPLAIN and pragma table functions", async () => {
    const db = new BunSqliteDatabase(":memory:");
    try {
      await db.exec("CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)");
      expect(await db.get("/* PRAGMA in a comment */ SELECT ? AS n", 7)).toEqual({ n: 7 });
      expect(await db.all("WITH value(n) AS (SELECT ?) SELECT n FROM value", 8)).toEqual([{ n: 8 }]);
      expect((await db.all("EXPLAIN SELECT n FROM sample")).length).toBeGreaterThan(0);
      expect(await db.all("SELECT name FROM pragma_table_info('sample')")).toEqual([{ name: "n" }]);
      await db.transaction(async tx => {
        await tx.run("INSERT INTO sample VALUES(2)");
        expect(await tx.all("SELECT n FROM sample ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }]);
      });
    } finally { await db.close(); }
  });
});

describe("public Harness on actual disk SQLite", () => {
  test("owner fence precedes file construction", () => disk(async path => {
    await expect(fixtureAt(path, { acquired: false })).rejects.toThrow("before open");
    expect(await Bun.file(path).exists()).toBe(false);
  }));

  test("committed answer, original conversation/context and requestId survive fresh paused open", () => disk(async path => {
    const first = await fixtureAt(path);
    let submissionId, answerId, conversationId, priorContext;
    try {
      const submission = await first.submit("durable-request", "hello from disk");
      await submission.wait(context);
      const evidence = await first.settlement(submission);
      submissionId = submission.id; answerId = evidence.answer.id; conversationId = first.root.id;
      priorContext = await first.root.context(context);
      expect(first.host.modelCalls).toBe(1);
    } finally { await first.close(); }
    const fresh = await fixtureAt(path);
    try {
      expect(fresh.root.id).toBe(conversationId);
      expect(await fresh.root.context(context)).toEqual(priorContext);
      const prior = await fresh.storage.submissionByRequest(fresh.root.id, "durable-request", context);
      expect(prior?.id).toBe(submissionId);
      const handle = await fresh.harness.submission(submissionId!, context);
      expect((await handle!.status(context)).status).toBe("done");
      const entry = await fresh.storage.entry(answerId!, context);
      expect(entry?.entry.kind).toBe(AssistantEntry.kind);
      const watch = await fresh.root.watch(context); watch.start(async () => {});
      const graph = await fresh.harness.taskGraph(context);
      await fresh.harness.inspect(context); await Bun.sleep(5);
      graph.dispose(); await watch.stop();
      expect(fresh.host.modelCalls).toBe(0); expect(fresh.host.effects).toBe(0);
      expect(fresh.host.admissions).toEqual([]);
      // submit wakes scheduling: only AFTER checking current host authority.
      const retry = await fresh.submit("durable-request", "hello from disk");
      expect(retry.id).toBe(submissionId);
      expect((await retry.wait(context)).status).toBe("done");
      expect(fresh.host.modelCalls).toBe(0);
      expect(fresh.reports).toEqual([]); expect(fresh.host.credentialLookups).toBe(0);
    } finally { await fresh.close(); }
  }));

  test("close with an executing unsafe tool; reopen remains paused and explicit progress does not replay it", () => disk(async path => {
    const first = await fixtureAt(path);
    let submissionId;
    try {
      first.host.toolHold = barrier();
      submissionId = (await first.submit("interrupted-tool", "use-tool")).id;
      await first.host.toolEntered.promise;
      expect(first.host.effects).toBe(0);
    } finally { await first.close(); } // Signals/join invocation, writes no outcome; NOT SIGKILL.
    const fresh = await fixtureAt(path);
    try {
      await fresh.harness.inspect(context); await fresh.root.context(context); await Bun.sleep(5);
      expect(fresh.host.modelCalls).toBe(0); expect(fresh.host.effects).toBe(0);
      const submission = await fresh.harness.submission(submissionId!, context);
      await submission!.wait(context); // Explicitly enables recovery scheduling.
      const entries = await fresh.root.entries({}, 100, undefined, context);
      const results = entries.items.filter(e => e.kind === "pi.tool-result");
      expect(results).toHaveLength(1);
      expect(results[0]!.model?.some(m => m.role === "toolResult" && m.isError && JSON.stringify(m.content).includes("interrupted"))).toBe(true);
      expect(fresh.host.effects).toBe(0);
      expect(fresh.host.admissions.every(a => !a.idempotencyKey.startsWith("tool:"))).toBe(true);
      expect(fresh.reports).toEqual([]);
    } finally { await fresh.close(); }
  }));

  test("queued submission abort and conversation abort persist across reopen without dispatch", () => disk(async path => {
    const first = await fixtureAt(path);
    let activeId, queuedId;
    try {
      first.host.modelHold = barrier();
      const active = await first.submit("active", "held"); activeId = active.id;
      const queued = await first.submit("withdrawn", "never execute"); queuedId = queued.id;
      expect(await queued.abort(context)).toBe("aborted");
      expect(await active.abort(context)).toBe("already_placed");
      await first.root.abort(context);
      expect(first.host.modelCalls).toBe(0);
    } finally { await first.close(); }
    const fresh = await fixtureAt(path);
    try {
      for (const id of [activeId!, queuedId!]) {
        const handle = await fresh.harness.submission(id, context);
        const status = await handle!.status(context);
        expect(status.status).toBe("unanswered");
        if (status.status === "unanswered") expect(status.reason).toBe("aborted");
      }
      fresh.harness.resume(); await fresh.root.waitForIdle(context);
      expect(fresh.host.modelCalls).toBe(0); expect(fresh.host.effects).toBe(0);
      expect(fresh.reports).toEqual([]);
    } finally { await fresh.close(); }
  }));
});

// Upgrade qualification only: the immutable v1 migration is the real 1.3
// producer. No live store or downloaded old implementation is opened.
test("SDK 1.4 upgrades v1 task storage losslessly and refuses down-level reopen", () => disk(async path => {
  const db = new BunSqliteDatabase(path);
  let storage: SqliteStorage | undefined;
  try {
    await applySqliteMigrations(db, SQLITE_MIGRATIONS.slice(0, 1));
    const records = [
      { id: 21, conversationId: 1, kind: "app.retained", version: 1, input: { sourceId: "unchanged", bytes: "original" }, background: false, abortRequested: false,
        state: { status: "pending", checkpoint: { phase: "wait" } } },
      { id: 22, conversationId: 1, kind: "app.retained", version: 1, input: { sourceId: "completed" }, background: false, abortRequested: false,
        state: { status: "terminal", outcome: { status: "completed", result: { receipt: "original" } } } },
    ];
    await db.transaction(async tx => {
      await tx.run("INSERT INTO conversations(id,record) VALUES(1,?)", JSON.stringify({ id: 1 }));
      await tx.run("INSERT INTO record_ids VALUES(1,'conversation')");
      for (const record of records) {
        await tx.run("INSERT INTO record_ids VALUES(?,'task')", record.id);
        await tx.run("INSERT INTO tasks(id,conversation_id,kind,status,abort_requested,background,record) VALUES(?,1,?,?,0,0,?)",
          record.id, JSON.stringify(record.kind), record.state.status, JSON.stringify(record));
      }
      await tx.run("UPDATE durable_metadata SET next_id='23'");
    });
    const rows = await db.all("SELECT * FROM tasks ORDER BY id");
    const root = new Database(path, { readonly: true });
    try {
      const before = readSchemaInventory(root);
      storage = await SqliteStorage.open(db);
      expect(await db.get("SELECT version FROM durable_schema WHERE singleton=1")).toEqual({ version: 2 });
      expect(await db.all("SELECT * FROM tasks ORDER BY id")).toEqual(rows);
      for (const record of records) expect(await storage.task(record.id as TaskId, context)).toEqual(JSON.parse(JSON.stringify(record)));
      const after = readSchemaInventory(root);
      expect(after.filter(object => !before.some(prior => JSON.stringify(prior) === JSON.stringify(object))).map(object => `${object.kind}:${object.name}`)).toEqual(["table:tasks"]);
      console.log("SDK_140_TASK_SCHEMA=" + JSON.stringify(after.find(object => object.name === "tasks")));
      await expect(applySqliteMigrations(db, SQLITE_MIGRATIONS.slice(0, 1))).rejects.toThrow("newer");
      expect(await db.all("SELECT * FROM tasks ORDER BY id")).toEqual(rows);
      expect(root.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(root.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { root.close(); }
  } finally { if (storage) await storage.close(context); else await db.close(); }
}));

test("SDK 1.4 sleeping task preserves deadline and next phase across cold reopen without replay", () => disk(async path => {
  const base = await openFixture({ acquired: true });
  await base.close();
  let clock = 1000, waits = 0, effects = 0;
  const wakes: { active: boolean; at?: number }[] = [];
  const delay = defineTask<{ at: number }, { phase: "wait" } | { phase: "deliver" }, null>({
    name: "app.upgrade-delay", version: 1, initial: () => ({ phase: "wait" }),
    phases: {
      wait(task, runtime, ctx) { waits++; return runtime.sleepUntil(task.input.at, { phase: "deliver" }, ctx); },
      async deliver(_task, runtime, ctx) { effects++; await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx); },
    },
    abort: (_task, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
  });
  base.registry.install(defineExtension({ name: "upgrade-delay", tasks: [delay] }));
  const options = { models: base.models, registry: base.registry, now: () => clock, onWake: (wake: { active: boolean; at?: number }) => { wakes.push({ ...wake }); } };
  let harness = await Harness.open(await storageAt(path), options, context);
  try {
    const root = await harness.root(context);
    const id = await root.commit(tx => tx.createTask(delay, { at: 2000 }, { ownership: { kind: "conversation" } }), context);
    harness.resume();
    const deadline = Date.now() + 1500;
    while ((await harness.getTask(id, context))?.state.status !== "sleeping" && Date.now() < deadline) await Bun.sleep(1);
    const sleeping = await harness.getTask(id, context);
    expect(sleeping?.state).toEqual({ status: "sleeping", until: 2000, checkpoint: { phase: "deliver" } });
    expect(waits).toBe(1); expect(effects).toBe(0);
    await harness.close(context);
    harness = await Harness.open(await storageAt(path), options, context);
    expect((await harness.getTask(id, context))?.state).toEqual(sleeping!.state);
    harness.resume();
    await Bun.sleep(5); expect(waits).toBe(1); expect(effects).toBe(0);
    expect(wakes.some(wake => wake.at === 2000)).toBe(true);
    clock = 2000; harness.resume();
    const result = await harness.waitForTask(id, context);
    expect(result.state.outcome).toEqual({ status: "completed", result: null });
    expect(waits).toBe(1); expect(effects).toBe(1);
    await harness.close(context);
    harness = await Harness.open(await storageAt(path), options, context);
    harness.resume(); await Bun.sleep(5);
    expect(effects).toBe(1); expect(base.host.modelCalls).toBe(0);
  } finally { await harness.close(context); }
}));
