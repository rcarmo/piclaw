import "./src/test-guard.js";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage, type SqliteExecutor } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { registerStorageConformance } from "../../runtime/durable-engine/qualification/testing.ts";
import { AssistantEntry } from "../../runtime/durable-engine/qualification/durable.ts";
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
      await db.exec("PRAGMA foreign_keys = ON; CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
      await expect(db.transaction(async tx => { await tx.run("INSERT INTO child VALUES (99)"); })).rejects.toThrow();
      expect(await db.all("SELECT * FROM child")).toEqual([]);
      await db.transaction(async tx => { await tx.run("INSERT INTO parent VALUES (99)"); });
    } finally { await db.close(); }
  }));

  test("rollback failure is explicit, poisons queued operations, still drains close", () => disk(async path => {
    const db = new BunSqliteDatabase(path);
    const entered = barrier(), hold = barrier(), original = new Error("not guaranteed rolled back");
    const failed = db.transaction(async tx => {
      // Deliberate contract-breaking SQL fault injection: the adapter's ROLLBACK must now fail.
      await tx.exec("ROLLBACK"); entered.release(); await hold.promise; throw original;
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
