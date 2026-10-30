import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { barrier } from "./src/fixture.js";

async function disk(body: (db: BunSqliteDatabase, root: Database) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "native-admission-"));
  const root = new Database(join(dir, "application.sqlite"));
  let db: BunSqliteDatabase | undefined;
  let owned = true, ownerChecks = 0;
  try {
    root.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE operations (id TEXT PRIMARY KEY);
      CREATE TABLE settlements (operation_id TEXT PRIMARY KEY REFERENCES operations(id), value TEXT NOT NULL);
      INSERT INTO operations VALUES ('queued'), ('mutated'), ('a'), ('b'), ('failed'), ('legitimate');`);
    db = new BunSqliteDatabase(join(dir, "application.sqlite"), {
      root, fenceTransactions: true,
      assertOwner() { ownerChecks++; if (!owned) throw new Error("Fixture owner released"); },
    });
    db.assertApplicationRoot(root);
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(await db.get("SELECT * FROM pragma_foreign_keys")).toEqual({ foreign_keys: 1 });
    await body(db, root);
    expect(root.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(ownerChecks).toBeGreaterThan(2);
  } finally {
    await db?.close();
    owned = false;
    root.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const rows = (root: Database) => root.query("SELECT operation_id, value FROM settlements ORDER BY operation_id").all();

// No timers: each seal occurs at an explicit async boundary on the actual adapter queue.
test("admission sealed while waiting on the serial queue refuses before callback/write", () => disk(async (db, root) => {
  const entered = barrier(), release = barrier();
  const blocker = db.transaction(async () => { entered.release(); await release.promise; });
  let sealed = false, checks = 0, callbacks = 0;
  const denied = new Error("queued admission sealed");
  try {
    await entered.promise;
    const pending = db.withAdmissionGuard(() => {
      checks++; if (sealed) throw denied;
    }, () => db.transaction(async tx => {
      callbacks++;
      await tx.run("INSERT INTO settlements VALUES ('queued', 'forbidden')");
    }));
    // Initial admission passed, but the adapter is still executing the blocker.
    expect(checks).toBe(1);
    sealed = true;
    release.release();
    await blocker;
    await expect(pending).rejects.toBe(denied);
    expect(checks).toBe(2);
    expect(callbacks).toBe(0);
    expect(rows(root)).toEqual([]);
    expect(root.inTransaction).toBe(false);
  } finally { release.release(); await blocker; }
}));

test("admission flip after SQL mutation rolls back immediately before COMMIT", () => disk(async (db, root) => {
  const mutated = barrier(), release = barrier();
  let sealed = false, checks = 0;
  const denied = new Error("commit admission sealed");
  const pending = db.withAdmissionGuard(() => {
    checks++; if (sealed) throw denied;
  }, () => db.transaction(async tx => {
    await tx.run("INSERT INTO settlements VALUES ('mutated', 'uncommitted')");
    expect(await tx.get("SELECT value FROM settlements WHERE operation_id='mutated'"))
      .toEqual({ value: "uncommitted" });
    mutated.release(); await release.promise;
  }));
  try {
    await mutated.promise;
    expect(checks).toBe(2);
    expect(rows(root)).toEqual([]); // Separate WAL reader cannot see the mutation.
    sealed = true;
    release.release();
    await expect(pending).rejects.toBe(denied);
    expect(checks).toBe(3);
    expect(rows(root)).toEqual([]);
    expect(await db.all("SELECT * FROM settlements")).toEqual([]);
  } finally { release.release(); await pending.catch(() => {}); }
}));

test("concurrent distinct async admission scopes retain their own guards", () => disk(async (db, root) => {
  const aEntered = barrier(), releaseA = barrier(), bEntered = barrier(), releaseB = barrier();
  let sealA = false, checksA = 0, checksB = 0;
  const deniedA = new Error("only A sealed");
  const a = db.withAdmissionGuard(() => {
    checksA++; if (sealA) throw deniedA;
  }, async () => {
    await Promise.resolve();
    return db.transaction(async tx => {
      await tx.run("INSERT INTO settlements VALUES ('a', 'rolled back')");
      aEntered.release(); await releaseA.promise;
    });
  });
  let b: Promise<void> | undefined;
  try {
    await aEntered.promise;
    b = db.withAdmissionGuard(() => { checksB++; }, async () => {
      await Promise.resolve();
      return db.transaction(async tx => {
        await tx.run("INSERT INTO settlements VALUES ('b', 'committed')");
        bEntered.release(); await releaseB.promise;
      });
    });
    expect(checksB).toBe(1);
    sealA = true;
    releaseA.release();
    await expect(a).rejects.toBe(deniedA);
    await bEntered.promise;
    expect(checksA).toBe(3);
    expect(checksB).toBe(2);
    expect(rows(root)).toEqual([]);
    releaseB.release();
    await b;
    expect(checksA).toBe(3);
    expect(checksB).toBe(3);
    expect(rows(root)).toEqual([{ operation_id: "b", value: "committed" }]);
  } finally {
    releaseA.release(); releaseB.release();
    await Promise.allSettled([a, ...(b ? [b] : [])]);
  }
}));

test("failed and exited admission scope does not poison later unguarded settlement", () => disk(async (db, root) => {
  const denied = new Error("scope revoked");
  let sealed = false, checks = 0;
  await expect(db.withAdmissionGuard(() => {
    checks++; if (sealed) throw denied;
  }, () => db.transaction(async tx => {
    await tx.run("INSERT INTO settlements VALUES ('failed', 'rolled back')");
    sealed = true;
  }))).rejects.toBe(denied);
  expect(checks).toBe(3);
  expect(rows(root)).toEqual([]);
  // Outside the removed ALS scope: normal completion must not inherit its sealed guard.
  await db.transaction(async tx => {
    await tx.run("INSERT INTO settlements VALUES ('legitimate', 'settled')");
  });
  expect(checks).toBe(3);
  expect(rows(root)).toEqual([{ operation_id: "legitimate", value: "settled" }]);
  // Both connections enforce the real operation FK, not an orphan fixture owner.
  await expect(db.run("INSERT INTO settlements VALUES ('missing', 'invalid')")).rejects.toThrow("FOREIGN KEY");
  expect(rows(root)).toEqual([{ operation_id: "legitimate", value: "settled" }]);
}));
