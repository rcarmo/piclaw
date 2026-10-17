import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { openFixture, context, barrier } from "./src/fixture.js";

async function fixture(run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "ownership-"));
  try { await run(join(dir, "durable.sqlite")); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const open = (owner: TestOwner, constructed = () => {}) => openFixture(owner, constructed, () => SqliteStorage.open(new OwnedSqlite(owner)));
function child(path: string) {
  // Deliberate allowlist: no inherited provider credentials/profile/tool environment.
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "PICLAW_WORKSPACE", "PICLAW_STORE", "PI_CODING_AGENT_DIR", "PICLAW_TEST_FS_ISOLATION_ACTIVE", "PICLAW_TEST_FS_ISOLATION_ROOT"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  const processChild = Bun.spawn([process.execPath, "src/ownership-child.ts", "--qualification-owner-child", path],
    { cwd: import.meta.dir, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = processChild.stdout.getReader();
  const stderr = new Response(processChild.stderr).text();
  let text = "";
  async function readRecord() {
    while (!text.includes("\n")) {
      const next = await reader.read();
      if (next.done) throw new Error(`child exited: ${text} ${await stderr}`);
      text += new TextDecoder().decode(next.value);
    }
    const end = text.indexOf("\n");
    const record = JSON.parse(text.slice(0, end));
    text = text.slice(end + 1);
    return record;
  }
  return { process: processChild, ready: readRecord(), readRecord, stderr };
}

test("same-process duplicate owner denied before storage construction; exact stale token cannot reopen", () => fixture(async path => {
  const owner = TestOwner.acquire(path);
  let constructions = 0;
  try {
    expect(() => TestOwner.acquire(path)).toThrow("owner busy");
    const current = await open(owner);
    await current.close();
    owner.releaseAfterClose();
    const replacement = TestOwner.acquire(path);
    try {
      expect(replacement.token.generation).toBe(owner.token.generation + 1);
      expect(replacement.token.nonce).not.toBe(owner.token.nonce);
      await expect(open(owner, () => { constructions++; })).rejects.toThrow("before open");
      expect(constructions).toBe(0);
    } finally { replacement.releaseAfterClose(); replacement.closeConnection(); }
  } finally { owner.closeConnection(); }
}));

test("preconstructed facade rejects stale public storage open before migrations/normalization", () => fixture(async path => {
  const owner = TestOwner.acquire(path), db = new OwnedSqlite(owner);
  const raw = new Database(path, { strict: true });
  try {
    const before = raw.query("SELECT name,sql FROM sqlite_master ORDER BY name").all();
    raw.run("UPDATE qualification_process_owner SET nonce='revoked'");
    await expect(SqliteStorage.open(db)).rejects.toThrow("owner lost");
    expect(raw.query("SELECT name,sql FROM sqlite_master ORDER BY name").all()).toEqual(before);
    expect(raw.query("SELECT nonce FROM qualification_process_owner").get()).toEqual({ nonce: "revoked" });
  } finally { await db.close(); raw.close(); owner.closeConnection(); }
}));

test("owner check inside facade transaction rolls back token change AND candidate writes", () => fixture(async path => {
  const owner = TestOwner.acquire(path), db = new OwnedSqlite(owner);
  try {
    await db.exec("CREATE TABLE synthetic_settlement (value TEXT)");
    await expect(db.transaction(async tx => {
      await tx.run("INSERT INTO synthetic_settlement VALUES ('stale')");
      await tx.run("UPDATE qualification_process_owner SET nonce='wrong'");
    })).rejects.toThrow("owner lost");
    expect(owner.acquired).toBe(true);
    expect(await db.all("SELECT * FROM synthetic_settlement")).toEqual([]);
  } finally { await db.close(); owner.releaseAfterClose(); owner.closeConnection(); }
}));

test("diagnostic: contender reserved lock overlaps acquired owner's deferred storage migration", () => fixture(async path => {
  const owner = TestOwner.acquire(path);
  const contender = new Database(path, { strict: true });
  const db = new OwnedSqlite(owner);
  try {
    contender.exec("BEGIN IMMEDIATE");
    contender.query("SELECT * FROM qualification_process_owner").get();
    let failure: unknown;
    try { await SqliteStorage.open(db); } catch (error) { failure = error; }
    console.log(JSON.stringify({ diagnostic: "contender-held-BEGIN-IMMEDIATE", error: String(failure),
      stack: failure instanceof Error ? failure.stack : undefined }));
    expect(String(failure)).toContain("database is locked");
  } finally {
    contender.exec("ROLLBACK"); contender.close(); await db.close(); owner.releaseAfterClose(); owner.closeConnection();
  }
}));

test("two child contenders: one opens; SIGSTOP is not death; SIGKILL recovers paused before model resume", () => fixture(async path => {
  const children = [child(path), child(path)];
  let owner: TestOwner | undefined;
  let current: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const acquisition = await Promise.all(children.map(c => c.ready));
    const results = await Promise.all(children.map(async (c, i) => {
      if (acquisition[i].phase !== "acquired") return acquisition[i];
      c.process.stdin.write("open\n");
      c.process.stdin.end();
      return c.readRecord();
    }));
    if (results.filter(r => r.admitted).length !== 1) {
      for (const c of children) c.process.kill("SIGKILL");
      const stderr = await Promise.all(children.map(c => c.stderr));
      throw new Error(`expected exactly one successful opener: ${JSON.stringify({ acquisition, results, stderr })}`);
    }
    expect(acquisition.filter(r => r.leaseAcquired)).toHaveLength(1);
    expect(results.filter(r => r.leaseAcquired)).toHaveLength(1);
    expect(results.filter(r => r.admitted)).toHaveLength(1);
    const winner = children[results.findIndex(r => r.admitted)]!;
    expect(results.find(r => !r.admitted).constructions).toBe(0);
    expect(results.find(r => !r.admitted).error).toContain("owner busy");
    expect(results.find(r => r.admitted).modelCalls).toBe(0);
    process.kill(winner.process.pid, "SIGSTOP");
    expect(() => TestOwner.acquire(path)).toThrow("owner busy");
    process.kill(winner.process.pid, "SIGCONT");
    winner.process.kill("SIGKILL");
    await winner.process.exited; // reaped, /proc disappearance is evidence, not a deadline
    owner = TestOwner.acquire(path);
    current = await open(owner);
    expect(current.host.modelCalls).toBe(0);
    const record = await current.storage.submissionByRequest(current.root.id, "crash-pending", context);
    expect(record).toBeDefined();
    expect(current.host.modelCalls).toBe(0);
    current.harness.resume();
    await (await current.harness.submission(record!.id, context))!.wait(context);
    expect(current.host.modelCalls).toBe(1);
  } finally {
    for (const c of children) { c.process.kill("SIGKILL"); await c.process.exited; }
    await current?.close(); owner?.releaseAfterClose(); owner?.closeConnection();
  }
}), 15000);

for (const kind of ["model", "tool"] as const) {
  test(`raw revocation fault: held old ${kind} rechecks authoritative token at actual dispatch`, () => fixture(async path => {
    const owner = TestOwner.acquire(path), current = await open(owner);
    const raw = new Database(path, { strict: true });
    const hold = barrier(), entered = barrier();
    const heldPromise = hold.promise;
    Object.defineProperty(hold, "promise", { get() { entered.release(); return heldPromise; } });
    let submission: Awaited<ReturnType<typeof current.submit>> | undefined;
    try {
      if (kind === "model") current.host.modelHold = hold;
      else current.host.toolHold = hold;
      submission = await current.submit(`held-${kind}`, kind === "tool" ? "use-tool" : "hello");
      if (kind === "tool") await current.host.toolEntered.promise;
      else await entered.promise;
      // Fault injection, NOT a supported live-owner takeover policy.
      raw.run("UPDATE qualification_process_owner SET nonce='revoked'");
      hold.release();
      await submission.wait(context).catch(() => {});
      expect(current.host.denials).toContain(kind);
      expect(current.host.effects).toBe(0);
      if (kind === "model") expect(current.host.modelCalls).toBe(0);
      await expect(current.settlement(submission)).rejects.toThrow();
    } finally { hold.release(); await current.close().catch(() => {}); raw.close(); owner.closeConnection(); }
  }), 10000);
}
