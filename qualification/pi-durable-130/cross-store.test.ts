import "./src/test-guard.js";
import { Database } from "bun:sqlite";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { TestOwner } from "./src/ownership.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { hostHandoff, at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver as Payloads } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import type { TerminalSettlementStore } from "../../runtime/src/service-effects/contracts/terminal-settlement-store.js";

// Disposable qualification ONLY: one host DB + one durable sidecar, one chat,
// trusted Linux PID namespace. NOT a production storage-layout decision.
// Cross-file candidate writes are NOT atomically fenced by the host owner row.
// Safety here depends on TestOwner refusing live/paused owners, reaping SIGKILL
// before reacquisition, and closing the old writer before voluntary release.
const incarnation = "disposable-cross-store";
const requestId = "cross-store-request";
type Window = "accepted" | "submitted" | "answer" | "terminal";

async function seed(directory: string) {
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  try { getDb().query("VACUUM INTO ?").run(join(directory, "host.sqlite")); }
  finally { closeDatabase(); }
  const db = new Database(join(directory, "host.sqlite"), { strict: true });
  try { installTerminalSettlementCompositionSchema(db); }
  finally { db.close(); }
}

async function open(directory: string) {
  const hostPath = join(directory, "host.sqlite");
  const owner = TestOwner.acquire(hostPath); // authoritative owner lives in HOST DB
  const db = new Database(hostPath, { strict: true });
  db.exec("PRAGMA foreign_keys=ON");
  let current: Awaited<ReturnType<typeof openFixture>> | undefined;
  try {
    // Bind the new host incarnation/generation BEFORE even constructing candidate
    // storage. hostHandoff's later call must match, not retroactively fence open.
    db.exec("BEGIN IMMEDIATE");
    try {
      owner.assert();
      db.exec("CREATE TABLE IF NOT EXISTS qualification_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), incarnation TEXT NOT NULL, generation INTEGER NOT NULL)");
      db.query("INSERT OR IGNORE INTO qualification_owner VALUES (1,?,?)").run(incarnation, owner.token.generation);
      const binding = db.query("SELECT incarnation FROM qualification_owner WHERE singleton=1").get() as { incarnation: string };
      if (binding.incarnation !== incarnation) throw new Error("incarnation conflict");
      db.query("UPDATE qualification_owner SET generation=? WHERE singleton=1").run(owner.token.generation);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    current = await openFixture(owner, () => {
      owner.assert();
      const binding = db.query("SELECT incarnation,generation FROM qualification_owner WHERE singleton=1").get() as { incarnation: string; generation: number };
      if (binding.incarnation !== incarnation || binding.generation !== owner.token.generation) throw new Error("before-open binding missing");
    }, () => SqliteStorage.open(new BunSqliteDatabase(join(directory, "durable.sqlite"))));
    const fixture = current;
    // Durable synthetic-call receipt, not an effect mirror or a real provider.
    let calls = 0;
    Object.defineProperty(fixture.host, "modelCalls", {
      get: () => calls,
      set: (next: number) => { appendFileSync(join(directory, "model-calls"), "synthetic-model\n"); calls = next; },
    });
    const payloads = new Payloads();
    let loseAck = false, checks = 0;
    const runtime = {
      validateOwnership() {
        checks++;
        if (!db.inTransaction) throw new Error("ownership check outside host transaction");
        // IMPORTANT: read the authoritative process token AND incarnation using
        // THIS host settlement connection inside actual EF-S02's transaction.
        // Calling owner.acquired here would use another connection, not this seam.
        const row = db.query("SELECT boot,pid,start,nonce,generation,active FROM qualification_process_owner WHERE singleton=1").get();
        const bound = db.query("SELECT incarnation,generation FROM qualification_owner WHERE singleton=1").get();
        return JSON.stringify(row) === JSON.stringify(owner.token)
          && JSON.stringify(bound) === JSON.stringify({ incarnation, generation: owner.token.generation });
      },
      hitFault(point: string) {
        if (point === "effect_then_lost_acknowledgement" && loseAck) { loseAck = false; return true; }
        return false;
      },
      recordTrace() {},
    };
    const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
    const actual = value(createCurrentPiclawTerminalSettlementStore(db, payloads, runtime));
    // Existing handoff deliberately has no outbox. Add ONE synthetic broadcast
    // intent to its actual EF-S02 request, not a parallel/mirrored effects table.
    const terminal: TerminalSettlementStore = {
      getTerminal: id => actual.getTerminal(id),
      getTerminalByKey: key => actual.getTerminalByKey(key),
      commitTerminal: request => actual.commitTerminal(sealed({ ...request, outboxIntents: [sealed({
        effect: effect("cross-store-broadcast", request.effect.operationId, 1),
        outboxId: "cross-store-broadcast", kind: "timeline_broadcast" as const,
        payloadRef: "synthetic:broadcast", destinationRef: null, availableAt: at, enqueuedAt: at,
        repeatability: "repeatable" as const,
      })] })),
    };
    const handoff = hostHandoff(db, work, terminal, fixture, incarnation, owner.token.generation,
      (ref, text) => payloads.putText(ref, text));
    return { owner, db, current: fixture, payloads, work, terminal, handoff,
      loseAck: () => { loseAck = true; }, checks: () => checks,
      async close() {
        await fixture.close(); // release ONLY after candidate writer closes
        owner.releaseAfterClose(); db.close(); owner.closeConnection();
      },
    };
  } catch (error) {
    await current?.close(); owner.releaseAfterClose(); db.close(); owner.closeConnection(); throw error;
  }
}

async function submission(current: Awaited<ReturnType<typeof openFixture>>) {
  const record = await current.storage.submissionByRequest(current.root.id, requestId, context);
  return record ? await current.harness.submission(record.id, context) : undefined;
}

async function child(directory: string, window: Window) {
  const f = await open(directory);
  if (window === "submitted") f.current.host.modelHold = barrier();
  await f.handoff(requestId, "hello", window === "accepted" ? "accepted" : "submitted");
  if (window === "answer" || window === "terminal") {
    await (await submission(f.current))!.wait(context); // explicit execution, not reconciliation
  }
  if (window === "terminal") {
    f.loseAck();
    let lost = false;
    try { await f.handoff(requestId, "hello"); }
    catch (error) { if (!String(error).includes("storage_unavailable")) throw error; lost = true; }
    if (!lost) throw new Error("expected actual EF-S02 lost acknowledgement");
  }
  console.log(JSON.stringify({ ready: window, generation: f.owner.token.generation, modelCalls: f.current.host.modelCalls }));
  setInterval(() => {}, 1000); // parent kills this exact owned PID; no graceful close
}

function spawn(directory: string, window: Window) {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "PICLAW_WORKSPACE", "PICLAW_STORE", "PI_CODING_AGENT_DIR", "PICLAW_TEST_FS_ISOLATION_ACTIVE", "PICLAW_TEST_FS_ISOLATION_ROOT"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  const processChild = Bun.spawn([process.execPath, import.meta.path, "--cross-store-child", directory, window],
    { cwd: import.meta.dir, env, stdout: "pipe", stderr: "pipe" });
  const ready = (async () => {
    const reader = processChild.stdout.getReader();
    let text = "";
    try {
      while (!text.includes("\n")) {
        const next = await reader.read();
        if (next.done) throw new Error(`child exited: ${text} ${await new Response(processChild.stderr).text()}`);
        text += new TextDecoder().decode(next.value);
      }
      return JSON.parse(text.split("\n")[0]!);
    } finally { reader.releaseLock(); }
  })();
  return { process: processChild, ready };
}
function modelCalls(directory: string) {
  try { return readFileSync(join(directory, "model-calls"), "utf8").trim().split("\n").length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

if (process.argv.includes("--cross-store-child")) {
  await child(process.argv[process.argv.length - 2]!, process.argv.at(-1)! as Window);
} else {
  const { test, expect } = await import("bun:test");
  for (const window of ["accepted", "submitted", "answer", "terminal"] as const) {
    test(`cross-store SIGKILL after ${window}: bind host owner before paused reopen, recover actual EF-S02 once`, async () => {
      const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "cross-store-"));
      let c: ReturnType<typeof spawn> | undefined;
      let recovered: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await seed(directory);
        c = spawn(directory, window);
        const ready = await c.ready;
        expect(ready.ready).toBe(window);
        expect(() => TestOwner.acquire(join(directory, "host.sqlite"))).toThrow("owner busy");
        c.process.kill("SIGKILL");
        await c.process.exited; // confirmed/reaped death, never a lease timeout
        expect(c.process.signalCode).toBe("SIGKILL");
        recovered = await open(directory);
        const f = recovered;
        expect(f.owner.token.generation).toBe(ready.generation + 1);
        expect(f.current.host.modelCalls).toBe(0); // Harness.open is paused
        expect(f.current.host.credentialLookups).toBe(0);
        const handle = await submission(f.current); // public passive lookup only
        expect(!!handle).toBe(window !== "accepted");
        expect(modelCalls(directory)).toBe(window === "accepted" || window === "submitted" ? 0 : 1);
        expect(f.db.query("SELECT count(*) AS n FROM service_effect_s02_commits").get()).toEqual({ n: window === "terminal" ? 1 : 0 });
        // Revalidate host authority and permissions before explicit progress.
        f.owner.assert();
        f.current.host.modelAllowed = true;
        f.current.host.toolAllowed = false; // no tools/effects needed or permitted
        f.current.harness.resume();
        await f.handoff(requestId, "hello", "submitted");
        await (await submission(f.current))!.wait(context);
        const settled = await f.handoff(requestId, "hello");
        expect(settled?.disposition).toBe("completed");
        expect(await f.handoff(requestId, "hello")).toEqual(settled);
        expect(f.db.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
        expect(f.db.query("SELECT count(*) AS n FROM service_effect_s02_commits").get()).toEqual({ n: 1 });
        expect(f.db.query("SELECT outbox_id,state FROM service_effect_s05_outbox").all()).toEqual([{ outbox_id: "cross-store-broadcast", state: "pending" }]);
        expect(value(await f.work.getChatFrontier("web:qualification")).consumedThroughSourceSeq).toBe(1);
        expect(modelCalls(directory)).toBe(1); // committed answer is never re-executed
        expect(f.current.host.effects).toBe(0);
        expect(f.current.host.credentialLookups).toBe(0);
        // Ownership and candidate data really are separate files/tables.
        expect(f.db.query("SELECT name FROM sqlite_master WHERE name='conversations'").all()).toEqual([]);
        const sidecar = new Database(join(directory, "durable.sqlite"), { readonly: true, strict: true });
        try {
          expect(sidecar.query("SELECT name FROM sqlite_master WHERE name='qualification_process_owner'").all()).toEqual([]);
          expect(sidecar.query("SELECT name FROM sqlite_master WHERE name='conversations'").all()).toHaveLength(1);
        } finally { sidecar.close(); }
      } finally {
        if (c) { if (c.process.exitCode === null) c.process.kill("SIGKILL"); await c.process.exited; }
        await recovered?.close();
        await rm(directory, { recursive: true, force: true });
      }
    }, 20000);
  }

  test("cross-store host token revocation during payload await rolls back actual EF-S02 inside HOST transaction", async () => {
    const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "cross-store-fence-"));
    let f: Awaited<ReturnType<typeof open>> | undefined;
    let release: (() => void) | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      await seed(directory); f = await open(directory);
      await f.handoff(requestId, "hello", "submitted");
      const handle = (await submission(f.current))!;
      await handle.wait(context);
      release = f.payloads.hold(`answer:${handle.id}`);
      pending = f.handoff(requestId, "hello").catch(error => error);
      await f.payloads.waitUntilHeld(`answer:${handle.id}`);
      expect(f.checks()).toBe(0);
      const before = value(await f.work.getOperation(`host:${requestId}`));
      // Explicit CAS fault injection, NOT permission to replace a live writer.
      const contender = new Database(join(directory, "host.sqlite"), { strict: true });
      try {
        const result = contender.query("UPDATE qualification_process_owner SET nonce='revoked',generation=generation+1 WHERE singleton=1 AND nonce=? AND generation=?")
          .run(f.owner.token.nonce, f.owner.token.generation);
        expect(result.changes).toBe(1);
      } finally { contender.close(); }
      release();
      expect(String(await pending)).toContain('"_tag":"owner_conflict","certainty":"not_applied","retryable":false');
      expect(f.checks()).toBe(1);
      expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
      expect(f.db.query("SELECT * FROM service_effect_s05_outbox").all()).toEqual([]);
      expect(value(await f.work.getOperation(`host:${requestId}`))).toEqual(before);
      expect(value(await f.work.getChatFrontier("web:qualification")).consumedThroughSourceSeq).toBe(0);
      expect(value(await f.terminal.getTerminal(`host:${requestId}`))).toBeNull();
    } finally {
      release?.(); await pending; await f?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
}
