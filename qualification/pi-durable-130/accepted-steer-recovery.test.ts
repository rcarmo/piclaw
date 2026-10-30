import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STORE_DIR } from "../../runtime/src/core/config.js";
import { TestOwner } from "./src/ownership.js";
import { context, barrier } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups } from "../../runtime/src/db.js";
import { type DurableConversationOperation } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";

import { acceptedSteerFixture, sdkRecoverySnapshot, type RecoveryCheckpoint } from "./src/accepted-steer-recovery-fixture.js";

async function checkSharedFiles(dir: string, hostPath: string) {
  const files: string[] = [];
  async function scan(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await scan(next); else files.push(next);
    }
  }
  await scan(dir); await scan(dirname(hostPath));
  // Ownership must live in main too; only SQLite WAL/SHM sidecars are allowed.
  expect(files.filter(p => ![hostPath, `${hostPath}-wal`, `${hostPath}-shm`].includes(p))).toEqual([]);
}

async function crashChild(dir: string, boundary: string, sharedDatabase = false) {
  if (sharedDatabase) {
    closeDatabase(); // The parent must not initialize host/SDK before replacement ownership.
    expect(() => getDb()).toThrow("Database not initialized");
  }
  const env: Record<string,string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "PICLAW_WORKSPACE", "PICLAW_STORE", "PI_CODING_AGENT_DIR", "PICLAW_TEST_FS_ISOLATION_ACTIVE", "PICLAW_TEST_FS_ISOLATION_ROOT"]) if (process.env[key]) env[key] = process.env[key]!;
  const child = Bun.spawn([process.execPath, "src/accepted-steer-recovery-child.ts", "--accepted-steer-crash", dir, boundary, ...(sharedDatabase ? ["shared"] : [])], { cwd: import.meta.dir, env, stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  try {
    const reader = child.stdout.getReader(); let pending = "";
    const checkpoint = await Promise.race([(async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) throw Error("child exited before checkpoint: " + await stderr);
        pending += new TextDecoder().decode(next.value);
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0,end); pending = pending.slice(end+1);
          try { const event = JSON.parse(line); if (event.event === "accepted-steer-committed") return event as RecoveryCheckpoint; } catch {}
        }
      }
    })(), Bun.sleep(10000).then(() => { throw Error("child checkpoint timeout"); })]);
    reader.releaseLock();
    expect(child.exitCode).toBeNull(); // The checkpoint writer is still alive and owns the lease.
    expect(() => TestOwner.acquire(sharedDatabase ? join(STORE_DIR, "messages.db") : join(dir,"candidate.sqlite"))).toThrow("owner busy");
    child.kill("SIGKILL"); await child.exited;
    expect(child.signalCode).toBe("SIGKILL");
    if (sharedDatabase) await checkSharedFiles(dir, join(STORE_DIR, "messages.db"));
    return checkpoint;
  } finally { child.kill("SIGKILL"); await child.exited; }
}

// Host-only rehearsal: no production registration or recovery controller.
for (const { mode, sharedDatabase } of [
  { mode: "clean-close", sharedDatabase: false },
  { mode: "SIGKILL", sharedDatabase: false },
  { mode: "SIGKILL", sharedDatabase: true },
] as const) for (const boundary of ["before-submit", "committed-ack-lost"] as const) {
 test(`accepted steering disk recovery: ${boundary} (${mode}${sharedDatabase ? ", single physical database" : ""})`, async () => {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "accepted-recovery-"));
  const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
  const checkpoint = mode === "SIGKILL" ? await crashChild(dir,boundary,sharedDatabase) : undefined;
  const f = await acceptedSteerFixture(dir,boundary,checkpoint, false, { sharedDatabase });
  try {
    const { primary, primaryId, b } = checkpoint ?? await f.prepare();
    if (!checkpoint) {
      expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
      await f.runtime!.close(); // Public close aborts cooperative active generation; pending input remains durable.
      closeDatabase(); f.owner.releaseAfterClose(); f.owner.closeConnection();
      f.owner = TestOwner.acquire(f.path);
      expect(f.owner.token.generation).toBe(f.generation + 1);
      initDatabase(); f.db = getDb(); f.ports = f.stores(); f.permit = false;
    } else {
      expect(f.owner.token.generation).toBe(checkpoint.generation + 1);
      f.committedIntentId = checkpoint.committedIntentId;
      f.base.host.modelHold = barrier();
    }
      const checkSharedConnections = async () => {
        if (!sharedDatabase) return;
        expect((await stat(f.path)).ino).toBe((await stat(f.hostPath)).ino);
        for (const rows of [f.db.query("PRAGMA database_list").all(), await f.candidateDatabase.all("SELECT * FROM pragma_database_list")]) {
          expect((rows as { name: string; file: string }[]).filter(r => r.name !== "temp")).toEqual([{ seq: 0, name: "main", file: f.hostPath }]);
        }
        expect(f.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
        expect(await f.candidateDatabase.get("SELECT * FROM pragma_foreign_keys")).toEqual({ foreign_keys: 1 });
        expect(f.db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
        expect(await f.candidateDatabase.all("SELECT * FROM pragma_integrity_check")).toEqual([{ integrity_check: "ok" }]);
        expect(f.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(await f.candidateDatabase.all("SELECT * FROM pragma_foreign_key_check")).toEqual([]);
        const owner = f.db.query("SELECT generation, pid, active FROM main.qualification_process_owner WHERE singleton=1").get();
        expect(owner).toEqual({ generation: f.owner.token.generation, pid: process.pid, active: 1 });
        expect(await f.candidateDatabase.get("SELECT generation, pid, active FROM main.qualification_process_owner WHERE singleton=1")).toEqual(owner);
        await checkSharedFiles(dir, f.hostPath);
      };
      const calls = f.base.host.modelCalls, entriesAtReopen = f.providerEntries;
      const adapter = await f.open();
      const sdkSnapshot = () => sdkRecoverySnapshot(f.candidateDatabase);
      if (sharedDatabase) {
        expect(checkpoint?.sdkSnapshot).toBeDefined();
        // Pre-kill child evidence, not a baseline first taken AFTER open.
        // Must precede any explicit submit/resume, including rejected submissions.
        expect(await sdkSnapshot()).toEqual(checkpoint!.sdkSnapshot!);
      }
      await Bun.sleep(20);
      expect(f.providerEntries).toBe(entriesAtReopen); // Entry hook runs BEFORE the still-closed model hold.
      expect(f.base.host.modelCalls).toBe(calls);
      expect(f.toolEntries).toBe(0); // Existing tool-entry signal fires before its hold.
      const captured = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as { input: string }).input) as DurableConversationOperation;
      expect(captured.requestId).toBe(`queued-steer:${f.intentSourceId}`);
      expect(captured.claimed.source.sourceId).toBe(f.intentSourceId);
      expect(f.ports.work.getAcceptedSource(f.chatJid, b.sourceId)?.state).toBe("claimed");
      expect(getDeferredQueuedFollowups(f.chatJid)).toEqual([]);
      if (checkpoint) {
        expect(captured).toEqual(checkpoint.intent);
        expect(checkpoint.modelCalls).toBe(1); // Only primary A finished in the killed process.
        expect(checkpoint.effects).toBe(0);
        expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context))?.id).toBe(checkpoint.candidate?.id);
        expect(f.providerEntries).toBe(0);
      }
      await checkSharedConnections();
      if (sharedDatabase) {
        expect((await f.ports.bindings.intents!.list(primary)).find(b => b.requestId === captured.requestId)?.submissionId ?? null).toBeNull();
        expect(await sdkSnapshot()).toEqual(checkpoint!.sdkSnapshot!); // Still exact after paused observations.
      }
      const unchanged = f.snapshot();
      await expect(adapter.submitIntent({ ...captured, content: "mismatched provenance" })).rejects.toThrow();
      expect(f.snapshot()).toEqual(unchanged);
      expect(f.providerEntries).toBe(entriesAtReopen);
      expect(await f.runtime!.settle(primary)).toBeNull();
      expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(0);
      expect(f.toolEntries).toBe(0);
      f.permit = true;
      expect(f.providerEntries).toBe(entriesAtReopen); // All paused replay observations above are entry-free.
      f.entryObserved = barrier();
      const beforeRepair = sharedDatabase && boundary === "committed-ack-lost" ? await sdkSnapshot() : undefined;
      const sid = await adapter.submitIntent(captured); // Public committed lookup/provenance precedes any submit.
      if (sharedDatabase) expect((await f.ports.bindings.intents!.list(primary)).find(b => b.requestId === captured.requestId)?.submissionId).toBe(sid);
      if (beforeRepair) expect(await sdkSnapshot()).toEqual(beforeRepair); // Binding repair must not append any SDK entry/submission.
      if (boundary === "committed-ack-lost") expect(sid).toBe(f.committedIntentId);
      else await f.entryObserved.promise; // Synchronize the first legitimate dispatch, not its model completion.
      const entriesAfterSubmit = f.providerEntries;
      expect(entriesAfterSubmit).toBe(entriesAtReopen + (boundary === "before-submit" ? 1 : 0));
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await f.runtime!.submit(primary)).toBe(primaryId);
      await Bun.sleep(20);
      expect(f.providerEntries).toBe(entriesAfterSubmit);
      expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context))?.id).toBe(primaryId);
      expect(f.base.host.modelCalls).toBe(calls);
      f.base.host.finalContent = [{ type: "text", text: "recovered B answer" }];
      f.base.host.modelHold.release();
      await f.runtime!.resume(primary, primaryId);
      let terminal = await f.runtime!.settle(primary);
      for (let n = 0; !terminal && n < 200; n++) { await Bun.sleep(5); terminal = await f.runtime!.settle(primary); }
      expect(terminal?.disposition).toBe("completed");
      expect(value(await f.ports.work.getChatFrontier(f.chatJid)).consumedThroughSourceSeq).toBe(b.sourceSeq);
      expect(f.db.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(f.chatJid)).toEqual([{ content: "recovered B answer" }]);
      expect(f.db.query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?").all(f.incarnation)).toHaveLength(1);
      expect(f.base.host.modelCalls).toBe(calls + 1); // One expected pending generation transition, not side-effect-free replay.
      const completed = f.snapshot();
      const completedSdk = sharedDatabase ? await sdkSnapshot() : undefined;
      const bindingSnapshot = async () => ({
        primary: await f.candidateStorage!.submissionByRequest(f.base.root.id, f.primaryRequestId, context),
        intent: await f.candidateStorage!.submissionByRequest(f.base.root.id, captured.requestId, context),
        primaryBinding: await f.ports.bindings.get(primary),
        intents: await f.ports.bindings.intents!.list(primary),
      });
      const completedBindings = await bindingSnapshot(), completedEntries = f.providerEntries;
      f.base.host.modelHold = barrier(); // New entry would be visible even though completion is blocked.
      expect(await adapter.submitIntent(captured)).toBe(sid);
      expect(await f.runtime!.submit(primary)).toBe(primaryId);
      expect((await f.runtime!.settle(primary))?.disposition).toBe("completed");
      await Bun.sleep(20);
      expect(await bindingSnapshot()).toEqual(completedBindings);
      if (completedSdk) expect(await sdkSnapshot()).toEqual(completedSdk);
      expect(f.providerEntries).toBe(completedEntries);
      expect(f.snapshot()).toEqual(completed); expect(f.base.host.modelCalls).toBe(calls + 1);
      expect(getDeferredQueuedFollowups(f.chatJid)).toEqual([]); expect(f.authorizations).toBeGreaterThan(0);
      expect(f.toolEntries).toBe(0);
      expect(f.base.host.effects).toBe(0);
      expect(f.base.host.credentialLookups).toBe(0);
      await checkSharedConnections();
  } finally {
    await f.close(); process.env.PICLAW_DB_IN_MEMORY = oldMemory;
    await rm(dir, { recursive: true, force: true });
  }
 }, 20000);
}
