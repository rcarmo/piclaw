import "./src/test-guard.js";
import { expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import type { DocumentId } from "../../runtime/durable-engine/qualification/durable.ts";
import { admitSqliteWrite } from "../../runtime/src/db/sqlite-async-admission.js";
import { barrier, context, openFixture } from "./src/fixture.js";

async function disk(body: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "sqlite-admission-"));
  try { await body(join(directory, "owned.sqlite")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function ownedRoot(path: string) {
  const root = new Database(path);
  root.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; CREATE TABLE probe(n INTEGER)");
  return root;
}
const guarded = (path: string, root: Database) => new BunSqliteDatabase(path, {
  root, assertOwner() {}, fenceTransactions: true,
});
const outcome = <T>(p: Promise<T>) => p.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));

// A failed real BEGIN, not elapsed sleep, establishes that the captured guard is
// waiting on a foreign WAL writer. These are intentionally RED until wait-loop
// admission checks exist; do not release the lock to make the assertion pass.
for (const scope of ["admission", "host-source"] as const) {
  test(`${scope} revocation rejects within 500ms while the foreign WAL writer remains held`, () => disk(async path => {
    const root = ownedRoot(path), db = guarded(path, root), writer = new Database(path);
    writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; INSERT INTO probe VALUES(1)");
    const attempted = barrier(), controller = new AbortController(), reason = Error(`${scope} revoked`);
    let callbacks = 0, persists = 0;
    const exec = Database.prototype.exec;
    const spy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
      try { return exec.call(this, sql); }
      catch (error) {
        if (this !== root && this !== writer && sql === "BEGIN IMMEDIATE" && writer.inTransaction) attempted.release();
        throw error;
      }
    });
    const check = () => controller.signal.throwIfAborted();
    const body = () => db.transaction(async tx => { callbacks++; await tx.run("INSERT INTO probe VALUES(2)"); });
    const pending = outcome(scope === "admission" ? db.withAdmissionGuard(check, body)
      : db.withHostSourceGuard(check, async tx => { persists++; await tx.run("INSERT INTO probe VALUES(3)"); }, body));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await attempted.promise;
      controller.abort(reason);
      const result = await Promise.race([pending, new Promise<"timeout"> (resolve => { timer = setTimeout(() => resolve("timeout"), 500); })]);
      expect(writer.inTransaction).toBe(true);
      expect(callbacks).toBe(0); expect(persists).toBe(0);
      expect(result).not.toBe("timeout");
      if (result !== "timeout") expect(result.error).toBe(reason);
    } finally {
      if (timer) clearTimeout(timer);
      if (writer.inTransaction) writer.exec("ROLLBACK");
      await pending; // Join even when the bounded race fails on the current code.
      spy.mockRestore(); await db.close(); writer.close(); root.close();
    }
  }));
}

for (const outer of ['source','admission'] as const) test(`one captured write context preserves both guards and isolates queued work; outer=${outer}`, () => disk(async path => {
  const root = ownedRoot(path), db = guarded(path,root), entered = barrier(), release = barrier();
  let admissionChecks=0,sourceChecks=0,persists=0,callbacks=0,queuedChecksBeforeCommit=-1;
  const admission = (body:()=>Promise<void>) => db.withAdmissionGuard(() => {admissionChecks++;},body);
  const source = (body:()=>Promise<void>) => db.withHostSourceGuard(() => {sourceChecks++;},async tx => {persists++;await tx.run('INSERT INTO probe VALUES(11)');},body);
  const body = () => db.transaction(async tx => {callbacks++;await tx.run('INSERT INTO probe VALUES(1)');entered.release();await release.promise;});
  const scoped = outcome(outer === 'source' ? source(() => admission(body)) : admission(() => source(body)));
  let queued: Promise<void>|undefined;
  try {
    await entered.promise;
    queued = db.transaction(async tx => {await tx.run('INSERT INTO probe VALUES(2)');queuedChecksBeforeCommit=admissionChecks;});
    release.release(); expect((await scoped).error).toBeUndefined(); await queued;
    expect(callbacks).toBe(1);expect(persists).toBe(1);
    expect(admissionChecks).toBeGreaterThan(1);expect(sourceChecks).toBeGreaterThan(1);
    expect(admissionChecks).toBe(queuedChecksBeforeCommit);
    expect(root.query('SELECT n FROM probe ORDER BY rowid').all()).toEqual([{n:1},{n:11},{n:2}]);
  } finally {
    release.release();await Promise.allSettled([scoped,queued]);await db.close();root.close();
  }
}));

test("unchanged 10000ms acquisition deadline survives a >=10200ms foreign lock; close drains queued progress once", () => disk(async path => {
  const root = ownedRoot(path), db = guarded(path, root), writer = new Database(path);
  writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  let callbacks = 0, queuedCallbacks = 0, beats = 0;
  const heartbeat = setInterval(() => { beats++; }, 20);
  const start = performance.now();
  let failureResult: { error: unknown } | undefined;
  const failed = outcome(db.transaction(async () => { callbacks++; })).then(result => { failureResult = result; return result; });
  let queued: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  try {
    // This is a real long-lock workload, not an enlarged adapter timeout.
    do { await new Promise(resolve => setTimeout(resolve, Math.max(1, 10_200 - (performance.now() - start)))); }
    while (performance.now() - start < 10_200);
    expect(performance.now() - start).toBeGreaterThanOrEqual(10_200);
    expect(writer.inTransaction).toBe(true);
    expect(failureResult).toBeDefined(); // Do not await indefinitely behind the still-held lock on RED.
    expect(failureResult?.error).toMatchObject({ code: "SQLITE_BUSY" });
    expect(callbacks).toBe(0); expect(beats).toBeGreaterThan(10);
    queued = db.transaction(async tx => { queuedCallbacks++; await tx.run("INSERT INTO probe VALUES(7)"); });
    closing = db.close();
    expect(db.close()).toBe(closing);
    await expect(db.transaction(async () => { throw Error("must not enter"); })).rejects.toThrow("closed");
    await expect(db.get("SELECT 1")).rejects.toThrow("closed");
    writer.exec("ROLLBACK");
    await queued; await closing;
    expect(queuedCallbacks).toBe(1);
    expect(root.query("SELECT n FROM probe").all()).toEqual([{ n: 7 }]);
  } finally {
    clearInterval(heartbeat);
    if (writer.inTransaction) writer.exec("ROLLBACK");
    await Promise.allSettled([failed, queued, closing]);
    try { await db.close(); } finally { writer.close(); root.close(); }
  }
}), 20_000);

// Caller lifetime replaces only the contended acquisition budget, never the body.
test("caller signal survives a >=10200ms foreign WAL writer without early settlement or replay", () => disk(async path => {
  const root = ownedRoot(path), controller = new AbortController();
  const db = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true, contentionSignal: controller.signal });
  const writer = new Database(path), attempted = barrier();
  writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; INSERT INTO probe VALUES(1)");
  let callbacks = 0, persists = 0, beats = 0, settled = false;
  const exec = Database.prototype.exec;
  const spy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    try { return exec.call(this, sql); }
    catch (error) {
      if (this !== root && this !== writer && sql === "BEGIN IMMEDIATE" && (error as { code?: string }).code === "SQLITE_BUSY") attempted.release();
      throw error;
    }
  });
  const heartbeat = setInterval(() => { beats++; }, 20), start = performance.now();
  const pending = outcome(db.withHostSourceGuard(() => {}, async tx => {
    persists++; await tx.run("INSERT INTO probe VALUES(3)");
  }, () => db.transaction(async tx => { callbacks++; await tx.run("INSERT INTO probe VALUES(2)"); })))
    .then(result => { settled = true; return result; });
  try {
    await attempted.promise;
    do { await new Promise(resolve => setTimeout(resolve, Math.max(1, 10_200 - (performance.now() - start)))); }
    while (performance.now() - start < 10_200);
    expect(performance.now() - start).toBeGreaterThanOrEqual(10_200);
    expect(writer.inTransaction).toBe(true); expect(settled).toBe(false);
    expect(callbacks).toBe(0); expect(persists).toBe(0); expect(beats).toBeGreaterThan(10);
    writer.exec("COMMIT");
    expect((await pending).error).toBeUndefined();
    expect(callbacks).toBe(1); expect(persists).toBe(1);
    expect(root.query("SELECT n FROM probe ORDER BY rowid").all()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  } finally {
    clearInterval(heartbeat);
    if (writer.inTransaction) writer.exec("ROLLBACK");
    await pending; spy.mockRestore();
    try { await db.close(); } finally { writer.close(); root.close(); }
  }
}), 20_000);

test("caller abort rejects within 500ms of a confirmed busy BEGIN and leaves the queue usable", () => disk(async path => {
  const root = ownedRoot(path), controller = new AbortController(), reason = Error("caller stopped");
  const db = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true, contentionSignal: controller.signal });
  const writer = new Database(path), attempted = barrier();
  writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  let callbacks = 0, persists = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const exec = Database.prototype.exec;
  const spy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    try { return exec.call(this, sql); }
    catch (error) {
      if (this !== root && this !== writer && sql === "BEGIN IMMEDIATE" && (error as { code?: string }).code === "SQLITE_BUSY") attempted.release();
      throw error;
    }
  });
  const pending = outcome(db.withHostSourceGuard(() => {}, async tx => {
    persists++; await tx.run("INSERT INTO probe VALUES(3)");
  }, () => db.transaction(async tx => { callbacks++; await tx.run("INSERT INTO probe VALUES(2)"); })));
  let queued: Promise<void> | undefined;
  try {
    await attempted.promise; controller.abort(reason);
    const result = await Promise.race([pending, new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), 500); })]);
    expect(writer.inTransaction).toBe(true); expect(result).not.toBe("timeout");
    if (result !== "timeout") expect(result.error).toBe(reason);
    expect(callbacks).toBe(0); expect(persists).toBe(0);
    writer.exec("ROLLBACK");
    queued = db.transaction(async tx => { await tx.run("INSERT INTO probe VALUES(7)"); });
    await queued;
    expect(root.query("SELECT n FROM probe").all()).toEqual([{ n: 7 }]);
  } finally {
    if (timer) clearTimeout(timer);
    if (writer.inTransaction) writer.exec("ROLLBACK");
    await Promise.allSettled([pending, queued]); spy.mockRestore();
    try { await db.close(); } finally { writer.close(); root.close(); }
  }
}));

test("retry owner check abort wins even when releasing the writer makes the next BEGIN possible", () => disk(async path => {
  const root = ownedRoot(path), writer = new Database(path), controller = new AbortController();
  const reason = Error("retry boundary stopped");
  let armed = false, failedBegins = 0, begins = 0, callbacks = 0, persists = 0, boundary = false;
  const guard = { root, fenceTransactions: true, contentionSignal: controller.signal, assertOwner() {
    if (armed && failedBegins && !boundary) {
      boundary = true; controller.abort(reason); writer.exec("ROLLBACK");
    }
  } };
  const db = new BunSqliteDatabase(path, guard);
  writer.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  const exec = Database.prototype.exec;
  const spy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    const candidate = this !== root && this !== writer && sql === "BEGIN IMMEDIATE";
    if (candidate) begins++;
    try { return exec.call(this, sql); }
    catch (error) {
      if (candidate && (error as { code?: string }).code === "SQLITE_BUSY") failedBegins++;
      throw error;
    }
  });
  armed = true;
  const pending = outcome(db.withHostSourceGuard(() => {}, async () => { persists++; },
    () => db.transaction(async () => { callbacks++; })));
  try {
    expect((await pending).error).toBe(reason);
    expect(boundary).toBe(true); expect(writer.inTransaction).toBe(false);
    expect(failedBegins).toBe(1); expect(begins).toBe(1);
    expect(callbacks).toBe(0); expect(persists).toBe(0);
    expect(root.query("SELECT n FROM probe").all()).toEqual([]);
  } finally {
    if (writer.inTransaction) writer.exec("ROLLBACK");
    await pending; spy.mockRestore();
    try { await db.close(); } finally { writer.close(); root.close(); }
  }
}));

test("queued transaction captures signal A at call; later B cancels contention but permits authorized uncontended cleanup", () => disk(async path => {
  const root = ownedRoot(path), writer = new Database(path), a = new AbortController(), b = new AbortController();
  const reason = Error("B stopped"), denied = Error("owner denied"), sourceDenied = Error("source denied");
  b.abort(reason);
  let ownerAllowed = true, callbacks = 0, persists = 0, lockAfterCommit = false;
  const guard = { root, fenceTransactions: true, contentionSignal: a.signal, assertOwner() { if (!ownerAllowed) throw denied; } };
  const db = new BunSqliteDatabase(path, guard), entered = barrier(), release = barrier(), attempted = barrier();
  const exec = Database.prototype.exec;
  const spy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    try {
      const result = exec.call(this, sql);
      if (this !== root && this !== writer && sql === "COMMIT" && lockAfterCommit) {
        lockAfterCommit = false; writer.exec("BEGIN IMMEDIATE");
      }
      return result;
    } catch (error) {
      if (this !== root && this !== writer && sql === "BEGIN IMMEDIATE" && (error as { code?: string }).code === "SQLITE_BUSY") attempted.release();
      throw error;
    }
  });
  const blocker = outcome(db.transaction(async () => { entered.release(); await release.promise; }));
  let captured: ReturnType<typeof outcome<void>> | undefined, later: ReturnType<typeof outcome<void>> | undefined;
  try {
    await entered.promise;
    captured = outcome(db.withHostSourceGuard(() => {}, async tx => {
      persists++; await tx.run("INSERT INTO probe VALUES(2)");
    }, () => db.transaction(async tx => { callbacks++; await tx.run("INSERT INTO probe VALUES(1)"); })));
    guard.contentionSignal = b.signal;
    lockAfterCommit = true; release.release();
    await attempted.promise;
    expect((await blocker).error).toBeUndefined();
    expect(writer.inTransaction).toBe(true); expect(callbacks).toBe(0);
    writer.exec("ROLLBACK");
    expect((await captured).error).toBeUndefined();
    expect(callbacks).toBe(1); expect(persists).toBe(1);
    writer.exec("BEGIN IMMEDIATE");
    later = outcome(db.transaction(async () => { callbacks++; }));
    expect((await later).error).toBe(reason);
    expect(writer.inTransaction).toBe(true); expect(callbacks).toBe(1);
    writer.exec("ROLLBACK");
    await db.run("INSERT INTO probe VALUES(3)"); // Already-aborted, uncontended SDK cleanup.
    ownerAllowed = false;
    expect((await outcome(db.run("INSERT INTO probe VALUES(99)"))).error).toBe(denied);
    ownerAllowed = true;
    expect((await outcome(db.withHostSourceGuard(() => { throw sourceDenied; }, async () => { persists++; },
      () => db.run("INSERT INTO probe VALUES(99)")))).error).toBe(sourceDenied);
    expect(persists).toBe(1);
    expect(root.query("SELECT n FROM probe ORDER BY rowid").all()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  } finally {
    lockAfterCommit = false; ownerAllowed = true; release.release();
    if (writer.inTransaction) writer.exec("ROLLBACK");
    await Promise.allSettled([blocker, captured, later]); spy.mockRestore();
    try { await db.close(); } finally { writer.close(); root.close(); }
  }
}));

test("actual SDK Harness commits and document materialization: SQL inventory, writer holds and concurrent root admission", () => disk(async path => {
  const root = ownedRoot(path), db = guarded(path, root);
  const storage = await SqliteStorage.open(db);
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;
  const holds: { path: string; ms: number; crossedMacrotask: boolean }[] = [];
  const latencies: number[] = [], inventory = new Set<string>(), probes: Promise<unknown>[] = [];
  let label = "setup", sdk: Database | undefined, began: number | undefined, crossed = false;
  let marker: ReturnType<typeof setImmediate> | undefined, beats = 0, persistCalls = 0;
  const heartbeat = setInterval(() => { beats++; }, 1);
  const originalExec = Database.prototype.exec, originalQuery = Database.prototype.query;
  const execSpy = spyOn(Database.prototype, "exec").mockImplementation(function (this: Database, sql: string) {
    const result = originalExec.call(this, sql); // Record ONLY successful boundaries.
    if (this !== root && sql === "BEGIN IMMEDIATE") {
      sdk = this; began = performance.now(); crossed = false;
      marker = setImmediate(() => { crossed = true; });
      const admitted = performance.now();
      probes.push(outcome(admitSqliteWrite(root, () => { root.query("INSERT INTO probe VALUES(?)").run(9); })
        .then(() => { latencies.push(performance.now() - admitted); })));
    } else if (this === sdk && began !== undefined && (sql === "COMMIT" || sql === "ROLLBACK")) {
      holds.push({ path: label, ms: performance.now() - began, crossedMacrotask: crossed });
      began = undefined;
      if (marker) clearImmediate(marker);
    }
    return result;
  });
  const querySpy = spyOn(Database.prototype, "query").mockImplementation(function (this: Database, ...args: Parameters<Database["query"]>) {
    const result = originalQuery.apply(this, args);
    if (this === sdk) inventory.add(args[0].replace(/\s+/g, " ").trim());
    return result;
  });
  try {
    fixture = await openFixture({ acquired: true }, () => {}, async () => storage);
    // real 1.4 storage.js: commit -> metadata/get, checkGlobalIds,
    // applyTableWrite, applyDocumentActions -> claimId/documents/revisions,
    // metadata/run; document -> materializeDocument -> document/revision reads.
    // Harness -> Session transaction assembly -> this same public commit path.
    for (let n = 0; n < 3; n++) {
      label = "Harness.appendEntry";
      const entry = await db.withHostSourceGuard(() => {}, async tx => {
        persistCalls++; await tx.run("INSERT INTO probe VALUES(?)", n);
      }, () => fixture!.root.commit(tx => tx.appendEntry(fixture!.root.id, {
        kind: "qualification.sql-workload", data: { n },
      }), context));
      expect((await storage.entry(entry.id, context))?.entry.kind).toBe("qualification.sql-workload");
      label = "SqliteStorage.document.create";
      const id = await storage.mintId<DocumentId>();
      await db.withHostSourceGuard(() => {}, async tx => {
        persistCalls++; await tx.run("INSERT INTO probe VALUES(?)", n);
      }, () => storage.commit([{ type: "document.create", record: {
        id, kind: `qualification.sql-workload.${n}`, scope: { kind: "session" },
      }, content: { kind: "base", version: 1, value: { n } } }], context));
      label = "SqliteStorage.document.read";
      expect((await storage.document(id, "current", context))?.value).toEqual({ n });
      label = "Harness.context";
      await fixture.root.context(context);
    }
    await Promise.all(probes);
    expect(persistCalls).toBe(6); expect(beats).toBeGreaterThan(0);
    expect(holds.filter(sample => sample.path === "SqliteStorage.document.create").length).toBe(3);
    expect(latencies.length).toBe(holds.length);
    expect(holds.every(sample => !sample.crossedMacrotask)).toBe(true);
    for (const probe of await Promise.all(probes)) expect((probe as { error?: unknown }).error).toBeUndefined();
    const sql = [...inventory];
    for (const table of ["durable_metadata", "record_ids", "entries", "documents", "document_revisions"])
      expect(sql.some(statement => statement.includes(table))).toBe(true);
    expect(fixture.host.modelCalls).toBe(0); expect(fixture.host.effects).toBe(0);
    expect(fixture.host.credentialLookups).toBe(0); expect(fixture.reports).toEqual([]);
    console.log("SQLITE_ADMISSION_WORKLOAD=" + JSON.stringify({
      sampleCount: holds.length, writerHolds: holds, maxWriterHoldMs: Math.max(...holds.map(s => s.ms)),
      hostAdmissionLatenciesMs: latencies, heartbeatTicks: beats, sqlInventory: sql,
      timing: "writer hold starts AFTER successful BEGIN; host latency includes acquisition/retry, not writer hold; observational only",
    }));
  } finally {
    await Promise.all(probes);
    clearInterval(heartbeat); if (marker) clearImmediate(marker);
    querySpy.mockRestore(); execSpy.mockRestore();
    try { if (fixture) await fixture.close(); else await storage.close(context); }
    finally { root.close(); }
  }
}));

// Trusted async callbacks CAN hold the writer across external awaits. Keep this
// separate from the SQL-only SDK samples rather than attributing it to SQL cost.
test("entered external await holds writer; close seals immediately and joins entered/queued work exactly once", () => disk(async path => {
  const root = ownedRoot(path), controller = new AbortController(), entered = barrier(), release = barrier();
  const db = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true, contentionSignal: controller.signal });
  let first = 0, second = 0, persists = 0, closed = false;
  const pending = db.withHostSourceGuard(() => {}, async tx => {
    persists++; await tx.run("INSERT INTO probe VALUES(3)");
  }, () => db.transaction(async tx => {
    first++; await tx.run("INSERT INTO probe VALUES(1)"); entered.release(); await release.promise;
  }));
  await entered.promise;
  controller.abort(Error("entered callback must finish"));
  const queued = db.transaction(async tx => { second++; await tx.run("INSERT INTO probe VALUES(2)"); });
  const closing = db.close().then(() => { closed = true; });
  try {
    await expect(db.run("INSERT INTO probe VALUES(99)")).rejects.toThrow("closed");
    // An explicit macrotask gate observes the entered await without a sleep oracle.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).toBe(false); expect(second).toBe(0);
    expect(root.query("SELECT n FROM probe").all()).toEqual([]);
  } finally {
    release.release();
    try {
      const results = await Promise.allSettled([pending, queued, closing]);
      for (const result of results) expect(result.status).toBe("fulfilled");
      expect(root.query("SELECT n FROM probe ORDER BY rowid").all()).toEqual([{ n: 1 }, { n: 3 }, { n: 2 }]);
    }
    finally { await db.close(); root.close(); }
  }
  expect(first).toBe(1); expect(second).toBe(1); expect(persists).toBe(1); expect(closed).toBe(true);
}));
